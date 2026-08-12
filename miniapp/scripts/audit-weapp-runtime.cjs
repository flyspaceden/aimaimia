const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const automator = require('miniprogram-automator');

const CLI_PATH = process.env.WECHAT_DEVTOOLS_CLI
  || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT_PATH = path.resolve(process.env.MINIAPP_RUNTIME_PROJECT || process.cwd());
const API_BASE = (process.env.MINIAPP_RUNTIME_API || 'https://test-api.ai-maimai.com/api/v1').replace(/\/$/, '');
const WAIT_MS = Math.max(1_000, Number(process.env.MINIAPP_RUNTIME_WAIT_MS || 2_500));
const NAVIGATION_TIMEOUT_MS = Math.max(8_000, Number(process.env.MINIAPP_RUNTIME_NAVIGATION_TIMEOUT_MS || 20_000));
const SCREENSHOT_TIMEOUT_MS = Math.max(3_000, Number(process.env.MINIAPP_RUNTIME_SCREENSHOT_TIMEOUT_MS || 8_000));
const CAPTURE_SCREENSHOTS = process.env.MINIAPP_RUNTIME_SCREENSHOTS !== 'false';
const AUTOMATION_WS_ENDPOINT = process.env.MINIAPP_RUNTIME_WS_ENDPOINT?.trim();
const ROUTE_FILTER = process.env.MINIAPP_RUNTIME_ROUTES
  ? new Set(process.env.MINIAPP_RUNTIME_ROUTES.split(',').map((value) => value.trim().replace(/^\//, '')).filter(Boolean))
  : null;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.resolve(process.env.MINIAPP_RUNTIME_OUTPUT || path.join(PROJECT_PATH, '.runtime-audit', RUN_ID));
const FIXTURE_FILE = process.env.MINIAPP_RUNTIME_FIXTURE_FILE
  ? path.resolve(process.env.MINIAPP_RUNTIME_FIXTURE_FILE)
  : null;

const AUTH_REQUIRED_ROUTES = new Set([
  'packages/commerce/cart/index',
  'packages/commerce/checkout/index',
  'packages/commerce/checkout-address/index',
  'packages/commerce/checkout-coupon/index',
  'packages/commerce/checkout-pending/index',
  'packages/orders/order-list/index',
  'packages/orders/order-detail/index',
  'packages/orders/order-track/index',
  'packages/orders/receiver-info/index',
  'packages/orders/payment-success/index',
  'packages/account/account-profile/index',
  'packages/account/account-bind-phone/index',
  'packages/account/account-appearance/index',
  'packages/account/account-addresses/index',
  'packages/account/account-address-form/index',
  'packages/account/account-deletion/index',
  'packages/account/account-security/index',
  'packages/member/wallet/index',
  'packages/member/wechat-withdraw/index',
  'packages/member/consumption-records/index',
  'packages/member/coupons/index',
  'packages/member/digital-assets/index',
  'packages/after-sales/after-sale-list/index',
  'packages/after-sales/after-sale-apply/index',
  'packages/after-sales/after-sale-detail/index',
  'packages/invoices/invoice-list/index',
  'packages/invoices/invoice-request/index',
  'packages/invoices/invoice-detail/index',
  'packages/invoices/profile-list/index',
  'packages/invoices/profile-edit/index',
  'packages/benefits/lottery/index',
  'packages/benefits/growth/index',
  'packages/benefits/vip-tree/index',
  'packages/benefits/normal-tree/index',
  'packages/benefits/queue-reward/index',
  'packages/group-buy/checkout/index',
  'packages/group-buy/checkout-pending/index',
  'packages/group-buy/current/index',
  'packages/group-buy/rebate-ledgers/index',
  'packages/customer-service/session-list/index',
  'packages/customer-service/chat/index',
  'packages/messages/inbox/index',
  'packages/messages/detail/index',
  'packages/referral/center/index',
  'packages/referral/records/index',
  'packages/community/captain-center/index',
  'packages/community/captain-application/index',
  'packages/community/following/index',
  'packages/community/scanner/index',
  'packages/settings/index/index',
]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function withTimeout(promise, milliseconds, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} 超过 ${milliseconds}ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function safeJson(value) {
  const seen = new WeakSet();
  const serialized = JSON.stringify(value, (key, item) => {
    if (/token|authorization|password|secret|phone/i.test(key)) return '<redacted>';
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    return item;
  });
  return redactSensitiveText(serialized);
}

function redactSensitiveText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/([?&](?:access_token|token|authorization|password|secret)=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/(^|\D)1[3-9]\d{9}(?=\D|$)/g, '$1<phone-redacted>');
}

function eventText(event) {
  try {
    return safeJson(event) || redactSensitiveText(String(event));
  } catch {
    return redactSensitiveText(String(event));
  }
}

function isConsoleError(event) {
  const text = eventText(event);
  const level = String(event?.level || event?.type || event?.method || '').toLowerCase();
  return level.includes('error')
    || /Minified React error|Unhandled(?:Promise)?Rejection|TypeError|ReferenceError|RangeError|WXSS\s*文件编译错误|模拟器启动失败/i.test(text);
}

function isConsoleWarning(event) {
  const level = String(event?.level || event?.type || event?.method || '').toLowerCase();
  return level.includes('warn') || /\bwarning\b|不支持|deprecated/i.test(eventText(event));
}

async function getJson(resource, accessToken) {
  const response = await fetch(`${API_BASE}${resource}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const error = new Error(`fixture ${resource} returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (!payload || payload.ok !== true) throw new Error(`fixture ${resource} did not return ok=true`);
  return payload.data;
}

function firstItem(value) {
  if (Array.isArray(value)) return value[0];
  if (Array.isArray(value?.items)) return value.items[0];
  return undefined;
}

async function loadFixtures(accessToken, userId) {
  const explicit = FIXTURE_FILE
    ? JSON.parse(await fs.readFile(FIXTURE_FILE, 'utf8'))
    : {};
  const [productPage, companies, groupBuyPage] = await Promise.all([
    getJson('/products?page=1&pageSize=20'),
    getJson('/companies'),
    getJson('/group-buy/activities'),
  ]);
  const product = productPage?.items?.[0];
  const company = companies?.[0];
  const activity = explicit.activity || groupBuyPage?.items?.[0];
  assert(product?.id, 'staging has no public product fixture');
  assert(company?.id, 'staging has no public company fixture');
  const detail = await getJson(`/products/${encodeURIComponent(product.id)}`);
  const mergedProduct = {
    ...detail,
    ...(explicit.product || {}),
    defaultSkuId: explicit.product?.skuId || detail.defaultSkuId,
  };
  if (!accessToken) return { ...explicit, product: mergedProduct, company, activity, userId };

  const [orders, afterSales, invoices, messages, pendingCheckout] = await Promise.all([
    getJson('/orders?page=1&pageSize=20', accessToken),
    getJson('/after-sale?page=1&pageSize=20', accessToken),
    getJson('/invoices?page=1&pageSize=20', accessToken),
    getJson('/inbox?page=1&pageSize=20', accessToken),
    getJson('/orders/checkout/me/pending/mini-program', accessToken),
  ]);
  const orderItems = Array.isArray(orders?.items) ? orders.items : [];
  const trackingOrder = orderItems.find((item) => ['SHIPPED', 'DELIVERED', 'RECEIVED'].includes(item?.status));
  return {
    ...explicit,
    product: mergedProduct,
    company,
    activity,
    userId: explicit.userId || userId,
    order: explicit.order || firstItem(orders),
    trackingOrder: explicit.trackingOrder || trackingOrder,
    afterSale: explicit.afterSale || firstItem(afterSales),
    invoice: explicit.invoice || firstItem(invoices),
    message: explicit.message || firstItem(messages),
    pendingCheckout: explicit.pendingCheckout || (pendingCheckout?.sessionId ? pendingCheckout : undefined),
  };
}

function routeList(appConfig) {
  const routes = [...(appConfig.pages || [])];
  for (const item of appConfig.subPackages || appConfig.subpackages || []) {
    for (const page of item.pages || []) routes.push(`${item.root}/${page}`);
  }
  return routes;
}

function queryFor(route, fixtures) {
  const productId = fixtures.product.id;
  const skuId = fixtures.product.defaultSkuId || fixtures.product.skus?.[0]?.id;
  const activityId = fixtures.activity?.id;
  const values = {
    'packages/commerce/catalog-search/index': { q: '龙虾' },
    'packages/commerce/company-search/index': { q: fixtures.company.name || '农业' },
    'packages/commerce/catalog-product/index': { id: productId },
    'packages/commerce/catalog-company/index': { id: fixtures.company.id },
    'packages/commerce/checkout/index': { buyNowProductId: productId, buyNowSkuId: skuId, buyNowQuantity: '1' },
    'packages/commerce/checkout-pending/index': { sessionId: fixtures.pendingCheckout?.sessionId },
    'packages/orders/order-detail/index': { id: fixtures.detailOrder?.id || fixtures.order?.id },
    'packages/orders/order-track/index': { orderId: fixtures.trackingOrder?.id },
    'packages/orders/receiver-info/index': { id: fixtures.receiverOrder?.id || fixtures.order?.id },
    'packages/orders/payment-success/index': { orderIds: [fixtures.detailOrder?.id, fixtures.eligibleOrder?.id].filter(Boolean).join(',') || fixtures.order?.id },
    'packages/account/account-legal/index': { document: 'privacy' },
    'packages/after-sales/after-sale-apply/index': { orderId: fixtures.eligibleOrder?.id || fixtures.order?.id },
    'packages/after-sales/after-sale-detail/index': { id: fixtures.afterSale?.id },
    'packages/invoices/invoice-request/index': { orderId: fixtures.eligibleOrder?.id || fixtures.order?.id },
    'packages/invoices/invoice-detail/index': { id: fixtures.invoice?.id },
    'packages/group-buy/activity-detail/index': { activityId },
    'packages/group-buy/checkout/index': { activityId },
    'packages/group-buy/checkout-pending/index': { sessionId: fixtures.pendingCheckout?.sessionId },
    'packages/ai/recommend/index': { q: '适合家庭聚餐的水产' },
    'packages/customer-service/chat/index': { source: 'GENERAL' },
    'packages/messages/detail/index': { id: fixtures.message?.id },
    'packages/community/author-detail/index': { id: fixtures.userId },
    'packages/referral/landing/index': { code: fixtures.referralCode, kind: fixtures.referralKind || 'normal' },
    'packages/community/captain-landing/index': { code: fixtures.captainCode },
    'packages/community/scene/index': { scene: fixtures.scene },
  }[route] || {};
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

const REQUIRED_QUERY_KEYS = {
  'packages/commerce/checkout-pending/index': ['sessionId'],
  'packages/orders/order-detail/index': ['id'],
  'packages/orders/order-track/index': ['orderId'],
  'packages/orders/receiver-info/index': ['id'],
  'packages/orders/payment-success/index': ['orderIds'],
  'packages/after-sales/after-sale-apply/index': ['orderId'],
  'packages/after-sales/after-sale-detail/index': ['id'],
  'packages/invoices/invoice-request/index': ['orderId'],
  'packages/invoices/invoice-detail/index': ['id'],
  'packages/group-buy/activity-detail/index': ['activityId'],
  'packages/group-buy/checkout/index': ['activityId'],
  'packages/group-buy/checkout-pending/index': ['sessionId'],
  'packages/messages/detail/index': ['id'],
  'packages/referral/landing/index': ['code'],
  'packages/community/captain-landing/index': ['code'],
  'packages/community/author-detail/index': ['id'],
  'packages/community/scene/index': ['scene'],
};

function missingFixture(route, fixtures) {
  const required = REQUIRED_QUERY_KEYS[route] || [];
  const query = queryFor(route, fixtures);
  return required.some((key) => !query[key]);
}

function routeUrl(route, fixtures) {
  const query = new URLSearchParams(queryFor(route, fixtures)).toString();
  return `/${route}${query ? `?${query}` : ''}`;
}

function actualPathMatches(route, actualPath, fixtures) {
  if (!actualPath) return false;
  if (actualPath === route) return true;
  return route === 'packages/community/scene/index'
    && typeof fixtures.expectedScenePath === 'string'
    && actualPath === fixtures.expectedScenePath.replace(/^\//, '');
}

function fileName(route) {
  return `${route.replace(/[^a-z0-9]+/gi, '__')}.png`;
}

function markdown(report) {
  const lines = [
    '# 微信小程序运行时逐页巡检',
    '',
    `- 时间：${report.startedAt}`,
    `- 工程：${report.projectPath}`,
    `- API：${report.apiBase}`,
    `- 登录态：${report.authenticated ? '已登录（覆盖真实会员页面）' : '未登录（登录后页面仅覆盖登录门禁）'}`,
    `- 页面：${report.summary.total}；通过 ${report.summary.passed}；无真实数据 ${report.summary.noFixture}；登录门禁 ${report.summary.authGated}；失败 ${report.summary.failed}；警告 ${report.summary.warnings}`,
    '',
    '| 状态 | 目标页面 | 实际页面 | 错误 | 警告 | 截图 |',
    '|---|---|---|---:|---:|---|',
  ];
  for (const result of report.results) {
    const screenshot = result.screenshot ? `[查看](./screenshots/${path.basename(result.screenshot)})` : '—';
    lines.push(`| ${result.status} | \`${result.route}\` | \`${result.actualPath || '—'}\` | ${result.errors.length} | ${result.warnings.length} | ${screenshot} |`);
  }
  lines.push('', '## 错误明细', '');
  const failed = report.results.filter((result) => result.errors.length || result.navigationError);
  if (!failed.length) lines.push('未捕获到页面级 JavaScript / React / WXSS 运行时错误。');
  for (const result of failed) {
    lines.push(`### ${result.route}`, '');
    if (result.navigationError) lines.push(`- 导航：${result.navigationError}`);
    for (const error of result.errors) lines.push(`- ${error.slice(0, 1_500)}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const startedAt = new Date().toISOString();
  const configPath = path.join(PROJECT_PATH, 'dist', 'app.json');
  const appConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const allRoutes = routeList(appConfig);
  const routes = ROUTE_FILTER ? allRoutes.filter((route) => ROUTE_FILTER.has(route)) : allRoutes;
  assert(routes.length, 'no routes selected');
  await fs.mkdir(path.join(OUTPUT_DIR, 'screenshots'), { recursive: true });

  let miniProgram;
  try {
    const connection = AUTOMATION_WS_ENDPOINT
      ? automator.connect({ wsEndpoint: AUTOMATION_WS_ENDPOINT })
      : automator.launch({
        cliPath: CLI_PATH,
        projectPath: PROJECT_PATH,
        trustProject: true,
        timeout: 60_000,
      });
    miniProgram = await withTimeout(Promise.resolve(connection), 65_000, '微信开发者工具连接');
  } catch (error) {
    const mode = AUTOMATION_WS_ENDPOINT
      ? `自动化端口 ${AUTOMATION_WS_ENDPOINT}`
      : '开发者工具服务端口';
    throw new Error(`无法连接微信开发者工具（${mode}）。请保持项目窗口和自动化端口开启。原始错误：${error.message}`);
  }

  const authRaw = await withTimeout(
    miniProgram.callWxMethod('getStorageSync', 'aimai-miniapp-auth-v1:staging'),
    5_000,
    '登录态读取',
  ).catch(() => undefined);
  let authenticated = false;
  let accessToken;
  let userId;
  try {
    const rawValue = typeof authRaw === 'string' ? authRaw : authRaw?.data;
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    accessToken = typeof parsed?.state?.accessToken === 'string' ? parsed.state.accessToken : undefined;
    userId = typeof parsed?.state?.userId === 'string' ? parsed.state.userId : undefined;
    authenticated = Boolean(accessToken && userId);
  } catch {
    authenticated = false;
  }
  let fixtures;
  try {
    try {
      fixtures = await loadFixtures(accessToken, userId);
    } catch (error) {
      if (!authenticated || ![401, 403].includes(error?.status)) throw error;
      process.stderr.write('登录态夹具已失效，降级为未登录逐页巡检；不会伪造会员数据。\n');
      authenticated = false;
      accessToken = undefined;
      userId = undefined;
      fixtures = await loadFixtures(undefined, undefined);
    }
  } catch (fixtureError) {
    miniProgram.disconnect();
    throw fixtureError;
  }

  const consoleEvents = [];
  const exceptionEvents = [];
  let activeRoute = 'startup';
  miniProgram.on('console', (event) => consoleEvents.push({ route: activeRoute, event }));
  miniProgram.on('exception', (event) => exceptionEvents.push({ route: activeRoute, event }));

  const results = [];
  try {
    for (const route of routes) {
      activeRoute = route;
      const consoleStart = consoleEvents.length;
      const exceptionStart = exceptionEvents.length;
      const url = routeUrl(route, fixtures);
      const fixtureUnavailable = missingFixture(route, fixtures);
      const screenshot = path.join(OUTPUT_DIR, 'screenshots', fileName(route));
      let navigationError;
      let screenshotError;
      let screenshotCaptured = false;
      let actualPath;
      try {
        await withTimeout(miniProgram.reLaunch(url), NAVIGATION_TIMEOUT_MS, `${route} 导航`);
        await sleep(WAIT_MS);
        actualPath = (await withTimeout(miniProgram.currentPage(), 5_000, `${route} 当前页面读取`))?.path;
        if (CAPTURE_SCREENSHOTS) {
          try {
            await withTimeout(
              miniProgram.screenshot({ path: screenshot }),
              SCREENSHOT_TIMEOUT_MS,
              `${route} 截图`,
            );
            screenshotCaptured = true;
          } catch (error) {
            // 个别复杂页面在特定开发者工具版本中可能无法完成 captureScreenshot。
            // 截图是审计证据，不是业务页面是否可用的裁决；记录警告并继续后续路由。
            screenshotError = error.message;
          }
        }
      } catch (error) {
        navigationError = error.message;
        // 一个分包编译失败不能污染后面几十页的结论；回到主包后继续隔离巡检。
        try {
          await withTimeout(
            miniProgram.reLaunch('/pages/home/index'),
            NAVIGATION_TIMEOUT_MS,
            '失败恢复到首页',
          );
          await sleep(1_000);
        } catch {
          // 原始页面保留 FAIL；下一页仍会再次独立 reLaunch。
        }
      }
      const routeConsole = consoleEvents.slice(consoleStart).map(({ event }) => event);
      const routeExceptions = exceptionEvents.slice(exceptionStart).map(({ event }) => event);
      const errors = [
        ...routeExceptions.map(eventText),
        ...routeConsole.filter(isConsoleError).map(eventText),
      ];
      const warnings = [
        ...routeConsole.filter(isConsoleWarning).map(eventText),
        ...(screenshotError ? [`截图未生成：${screenshotError}`] : []),
      ];
      const gateOnly = !authenticated && AUTH_REQUIRED_ROUTES.has(route);
      const status = navigationError || errors.length || (!actualPathMatches(route, actualPath, fixtures) && !gateOnly) ? 'FAIL'
        : gateOnly ? 'AUTH_GATE'
          : fixtureUnavailable ? 'NO_FIXTURE'
          : 'PASS';
      results.push({
        route,
        url,
        actualPath,
        status,
        fixtureUnavailable,
        navigationError,
        screenshotError,
        errors,
        warnings,
        screenshot: screenshotCaptured ? screenshot : undefined,
      });
      process.stdout.write(`[${results.length}/${routes.length}] ${status.padEnd(9)} ${route}${actualPath && actualPath !== route ? ` -> ${actualPath}` : ''}\n`);
    }
  } finally {
    miniProgram.disconnect();
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    projectPath: PROJECT_PATH,
    apiBase: API_BASE,
    authenticated,
    fixtures: {
      product: { id: fixtures.product.id, title: fixtures.product.title, hasNestedAttributes: Object.values(fixtures.product.attributes || {}).some((value) => value && typeof value === 'object') },
      company: { id: fixtures.company.id, name: fixtures.company.name },
      activity: fixtures.activity ? { id: fixtures.activity.id, title: fixtures.activity.title } : null,
      runtimePrefix: fixtures.prefix || null,
    },
    summary: {
      total: results.length,
      passed: results.filter((result) => result.status === 'PASS').length,
      noFixture: results.filter((result) => result.status === 'NO_FIXTURE').length,
      authGated: results.filter((result) => result.status === 'AUTH_GATE').length,
      failed: results.filter((result) => result.status === 'FAIL').length,
      warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    },
    results,
  };
  await fs.writeFile(path.join(OUTPUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(OUTPUT_DIR, 'report.md'), markdown(report));
  process.stdout.write(`REPORT ${path.join(OUTPUT_DIR, 'report.md')}\n`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
