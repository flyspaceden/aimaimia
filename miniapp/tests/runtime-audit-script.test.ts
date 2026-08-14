import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('WeChat DevTools runtime audit resilience', () => {
  const source = readFileSync(resolve(process.cwd(), 'scripts/audit-weapp-runtime.cjs'), 'utf8');

  it('bounds navigation and screenshot operations so one route cannot block the full audit', () => {
    expect(source).toContain('MINIAPP_RUNTIME_NAVIGATION_TIMEOUT_MS');
    expect(source).toContain('MINIAPP_RUNTIME_SCREENSHOT_TIMEOUT_MS');
    expect(source).toMatch(/withTimeout\(miniProgram\.reLaunch\(url\)/);
    expect(source).toMatch(/withTimeout\(\s*miniProgram\.screenshot/);
    expect(source).toMatch(/withTimeout\(\s*miniProgram\.callWxMethod\('getStorageSync'/);
    expect(source).toContain("'登录态读取'");
  });

  it('records a screenshot timeout as a warning and keeps the route result', () => {
    expect(source).toContain('截图未生成');
    expect(source).toContain('screenshotError');
    expect(source).toContain('screenshotCaptured ? screenshot : undefined');
    expect(source).toContain("MINIAPP_RUNTIME_SCREENSHOTS !== 'false'");
  });

  it('can reuse an already-open automation endpoint instead of relaunching DevTools', () => {
    expect(source).toContain('MINIAPP_RUNTIME_WS_ENDPOINT');
    expect(source).toContain('automator.connect({ wsEndpoint: AUTOMATION_WS_ENDPOINT })');
    expect(source).toContain(': automator.launch({');
    expect(source).toContain("65_000, '微信开发者工具连接'");
  });

  it('uses authenticated fixtures and never manufactures missing business ids', () => {
    expect(source).toContain('MINIAPP_RUNTIME_FIXTURE_FILE');
    expect(source).toContain("Authorization: `Bearer ${accessToken}`");
    expect(source).toContain("getJson('/orders?page=1&pageSize=20', accessToken)");
    expect(source).toContain('...(explicit.product || {})');
    expect(source).toContain('defaultSkuId: explicit.product?.skuId || detail.defaultSkuId');
    expect(source).toContain('pendingCheckout: explicit.pendingCheckout ||');
    expect(source).toContain("'packages/orders/order-track/index': { orderId: fixtures.trackingOrder?.id }");
    expect(source).toContain("'packages/orders/pickup-pass/index': { orderId: fixtures.pickupOrder?.id");
    expect(source).toContain("'packages/group-buy/checkout-pending/index': { sessionId: fixtures.pendingCheckout?.sessionId }");
    expect(source).toContain("'packages/referral/landing/index': { code: fixtures.referralCode");
    expect(source).toContain("'packages/community/captain-landing/index': { code: fixtures.captainCode }");
    expect(source).toContain("'packages/community/scene/index': { scene: fixtures.scene }");
    expect(source).toContain("actualPath === fixtures.expectedScenePath.replace(/^\\//, '')");
    expect(source).not.toContain('async function optionalJson');
    expect(source).toContain("fixtureUnavailable ? 'NO_FIXTURE'");
    expect(source).not.toContain('runtime-missing-');
  });

  it('fails closed when DevTools does not return the current page path', () => {
    expect(source).toContain("if (!actualPath) return false");
    expect(source).not.toContain("if (!actualPath || actualPath === route) return true");
  });

  it('redacts credentials and phone numbers even when console events contain raw strings', () => {
    expect(source).toContain('function redactSensitiveText(value)');
    expect(source).toContain("'Bearer <redacted>'");
    expect(source).toContain("'$1<redacted>'");
    expect(source).toContain("'$1<phone-redacted>'");
    expect(source).toContain('redactSensitiveText(String(event))');
  });

  it('downgrades expired authenticated fixtures without fabricating member data', () => {
    expect(source).toContain('error.status = response.status');
    expect(source).toContain("![401, 403].includes(error?.status)");
    expect(source).toContain('登录态夹具已失效，降级为未登录逐页巡检；不会伪造会员数据。');
    expect(source).toContain('fixtures = await loadFixtures(undefined, undefined)');
    expect(source).toMatch(/catch \(fixtureError\) \{\s*miniProgram\.disconnect\(\);\s*throw fixtureError;/);
  });
});
