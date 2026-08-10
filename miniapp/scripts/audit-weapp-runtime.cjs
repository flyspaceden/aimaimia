const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const automator = require('miniprogram-automator');

const CLI_PATH = process.env.WECHAT_DEVTOOLS_CLI
  || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const PROJECT_PATH = path.resolve(process.env.MINIAPP_RUNTIME_PROJECT || process.cwd());
const API_BASE = (process.env.MINIAPP_RUNTIME_API || 'https://test-api.ai-maimai.com/api/v1').replace(/\/$/, '');
const WAIT_MS = Math.max(1_000, Number(process.env.MINIAPP_RUNTIME_WAIT_MS || 2_500));
const ROUTE_FILTER = process.env.MINIAPP_RUNTIME_ROUTES
  ? new Set(process.env.MINIAPP_RUNTIME_ROUTES.split(',').map((value) => value.trim().replace(/^\//, '')).filter(Boolean))
  : null;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.resolve(process.env.MINIAPP_RUNTIME_OUTPUT || path.join(PROJECT_PATH, '.runtime-audit', RUN_ID));

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

function safeJson(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, item) => {
    if (/token|authorization|password|secret|phone/i.test(key)) return '<redacted>';
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    return item;
  });
}

function eventText(event) {
  try {
    return safeJson(event) || String(event);
  } catch {
    return String(event);
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

async function getJson(resource) {
  const response = await fetch(`${API_BASE}${resource}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`fixture ${resource} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || payload.ok !== true) throw new Error(`fixture ${resource} did not return ok=true`);
  return payload.data;
}

async function loadFixtures() {
  const [productPage, companies, groupBuyPage] = await Promise.all([
    getJson('/products?page=1&pageSize=20'),
    getJson('/companies'),
    getJson('/group-buy/activities'),
  ]);
  const product = productPage?.items?.[0];
  const company = companies?.[0];
  const activity = groupBuyPage?.items?.[0];
  assert(product?.id, 'staging has no public product fixture');
  assert(company?.id, 'staging has no public company fixture');
  const detail = await getJson(`/products/${encodeURIComponent(product.id)}`);
  return { product: detail, company, activity };
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
  const activityId = fixtures.activity?.id || 'runtime-missing-activity';
  const values = {
    'packages/commerce/catalog-search/index': { q: '龙虾' },
    'packages/commerce/company-search/index': { q: fixtures.company.name || '农业' },
    'packages/commerce/catalog-product/index': { id: productId },
    'packages/commerce/catalog-company/index': { id: fixtures.company.id },
    'packages/commerce/checkout/index': { buyNowProductId: productId, buyNowSkuId: skuId, buyNowQuantity: '1' },
    'packages/commerce/checkout-pending/index': { sessionId: 'runtime-missing-session' },
    'packages/orders/order-detail/index': { id: 'runtime-missing-order' },
    'packages/orders/order-track/index': { orderId: 'runtime-missing-order' },
    'packages/orders/receiver-info/index': { id: 'runtime-missing-order' },
    'packages/orders/payment-success/index': { orderIds: 'runtime-missing-order' },
    'packages/account/account-legal/index': { document: 'privacy' },
    'packages/after-sales/after-sale-apply/index': { orderId: 'runtime-missing-order' },
    'packages/after-sales/after-sale-detail/index': { id: 'runtime-missing-after-sale' },
    'packages/invoices/invoice-request/index': { orderId: 'runtime-missing-order' },
    'packages/invoices/invoice-detail/index': { id: 'runtime-missing-invoice' },
    'packages/group-buy/activity-detail/index': { activityId },
    'packages/group-buy/checkout/index': { activityId },
    'packages/group-buy/checkout-pending/index': { sessionId: 'runtime-missing-session' },
    'packages/ai/recommend/index': { q: '适合家庭聚餐的水产' },
    'packages/customer-service/chat/index': { source: 'GENERAL' },
    'packages/messages/detail/index': { id: 'runtime-missing-message' },
    'packages/referral/landing/index': { code: 'RUNTIME-CHECK', kind: 'vip' },
    'packages/community/captain-landing/index': { code: 'RUNTIME-CHECK' },
    'packages/community/author-detail/index': { id: 'runtime-missing-author' },
    'packages/community/scene/index': { scene: 'RUNTIME-CHECK' },
  }[route] || {};
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

function routeUrl(route, fixtures) {
  const query = new URLSearchParams(queryFor(route, fixtures)).toString();
  return `/${route}${query ? `?${query}` : ''}`;
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
    `- 页面：${report.summary.total}；通过 ${report.summary.passed}；登录门禁 ${report.summary.authGated}；失败 ${report.summary.failed}；警告 ${report.summary.warnings}`,
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
  const fixtures = await loadFixtures();
  const allRoutes = routeList(appConfig);
  const routes = ROUTE_FILTER ? allRoutes.filter((route) => ROUTE_FILTER.has(route)) : allRoutes;
  assert(routes.length, 'no routes selected');
  await fs.mkdir(path.join(OUTPUT_DIR, 'screenshots'), { recursive: true });

  let miniProgram;
  try {
    miniProgram = await automator.launch({
      cliPath: CLI_PATH,
      projectPath: PROJECT_PATH,
      trustProject: true,
      timeout: 60_000,
    });
  } catch (error) {
    throw new Error(`无法连接微信开发者工具。请打开“设置 → 安全设置 → 服务端口”，并保持项目窗口开启。原始错误：${error.message}`);
  }

  const authRaw = await miniProgram.callWxMethod('getStorageSync', 'aimai-miniapp-auth-v1:staging').catch(() => undefined);
  let authenticated = false;
  try {
    const rawValue = typeof authRaw === 'string' ? authRaw : authRaw?.data;
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    authenticated = Boolean(parsed?.state?.accessToken && parsed?.state?.userId);
  } catch {
    authenticated = false;
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
      const screenshot = path.join(OUTPUT_DIR, 'screenshots', fileName(route));
      let navigationError;
      let actualPath;
      try {
        await miniProgram.reLaunch(url);
        await sleep(WAIT_MS);
        actualPath = (await miniProgram.currentPage())?.path;
        await miniProgram.screenshot({ path: screenshot });
      } catch (error) {
        navigationError = error.message;
        // 一个分包编译失败不能污染后面几十页的结论；回到主包后继续隔离巡检。
        try {
          await miniProgram.reLaunch('/pages/home/index');
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
      const warnings = routeConsole.filter(isConsoleWarning).map(eventText);
      const gateOnly = !authenticated && AUTH_REQUIRED_ROUTES.has(route);
      const status = navigationError || errors.length || (actualPath && actualPath !== route && !gateOnly) ? 'FAIL'
        : gateOnly ? 'AUTH_GATE'
          : 'PASS';
      results.push({ route, url, actualPath, status, navigationError, errors, warnings, screenshot: navigationError ? undefined : screenshot });
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
    },
    summary: {
      total: results.length,
      passed: results.filter((result) => result.status === 'PASS').length,
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
