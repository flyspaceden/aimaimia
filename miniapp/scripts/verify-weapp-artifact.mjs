import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(projectRoot, 'dist');
const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'project.config.json'), 'utf8'));
const appConfig = JSON.parse(fs.readFileSync(path.join(distRoot, 'app.json'), 'utf8'));

assert.equal(
  projectConfig.appid,
  'wx1b33112db0d5267b',
  '微信开发者工具必须使用 AI爱买买真实小程序 AppID',
);
assert.equal(projectConfig.projectname, 'AI爱买买', '微信开发者工具工程名必须使用 AI爱买买');
assert.equal(projectConfig.description, 'AI爱买买买家微信小程序', '微信开发者工具工程描述必须使用 AI爱买买');
assert.equal(appConfig.window?.navigationBarTitleText, 'AI爱买买', '全局导航标题必须使用 AI爱买买');

const files = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    files.push({
      relativePath: path.relative(distRoot, absolutePath).split(path.sep).join('/'),
      size: fs.statSync(absolutePath).size,
    });
  }
};
walk(distRoot);

const readDist = (relativePath) => fs.readFileSync(path.join(distRoot, relativePath), 'utf8');
const homePageConfig = JSON.parse(readDist('pages/home/index.json'));
assert.equal(homePageConfig.navigationBarTitleText, 'AI爱买买', '首页导航标题必须使用 AI爱买买');
const pageCount = appConfig.pages.length
  + appConfig.subPackages.reduce((total, item) => total + item.pages.length, 0);
const generatedTemplateFiles = new Set(['base.wxml', 'comp.wxml']);
const pageWxmlCount = files.filter(({ relativePath }) => (
  relativePath.endsWith('.wxml')
  && !generatedTemplateFiles.has(relativePath)
)).length;

assert.equal(pageCount, 72, 'app.json 应注册 72 个运行时页面');
assert.equal(pageWxmlCount, pageCount, '每个注册页面都应生成对应 WXML');
const ordersPackage = appConfig.subPackages.find(({ root }) => root === 'packages/orders');
assert.ok(
  ordersPackage?.pages.includes('pickup-pass/index'),
  '订单分包应注册一次性取货凭证页',
);
assert.ok(
  files.some(({ relativePath }) => relativePath === 'packages/orders/pickup-pass/index.wxml'),
  '一次性取货凭证页应进入微信小程序产物',
);
assert.equal(
  appConfig.subPackages.some(({ root }) => /delivery/i.test(root)),
  false,
  '首版不得包含配送分包',
);

const expectedTabIcons = [
  ['pages/home/index', 'assets/seafood/icon-order-puffer.png'],
  ['pages/products/index', 'assets/seafood/icon-tool-starfish.png'],
  ['pages/me/index', 'assets/seafood/icon-tool-oyster.png'],
];
for (const [pagePath, iconPath] of expectedTabIcons) {
  const tab = appConfig.tabBar?.list?.find((item) => item.pagePath === pagePath);
  assert.equal(tab?.iconPath, iconPath, `${pagePath} 应配置与 App 对齐的 Tab 图标`);
  assert.equal(tab?.selectedIconPath, iconPath, `${pagePath} 应配置选中态 Tab 图标`);
  const icon = files.find(({ relativePath }) => relativePath === iconPath);
  assert.ok(icon, `${iconPath} 应进入微信小程序产物`);
  assert.ok(icon.size < 40 * 1024, `${iconPath} 应小于微信 Tab 图标 40 KiB 限制`);
}

const sharePages = [
  ['packages/commerce/catalog-company/index.js', false],
  ['packages/community/captain-center/index.js', false],
  ['packages/group-buy/activity-detail/index.js', true],
  ['packages/group-buy/current/index.js', true],
  ['packages/referral/center/index.js', true],
  ['packages/referral/landing/index.js', true],
];
for (const [relativePath, needsTimeline] of sharePages) {
  const output = readDist(relativePath);
  assert.match(output, /\.enableShareAppMessage=!0/, `${relativePath} 应开启好友分享`);
  if (needsTimeline) {
    assert.match(output, /\.enableShareTimeline=!0/, `${relativePath} 应开启朋友圈分享`);
  }
}

const referralCenterOutput = readDist('packages/referral/center/index.js');
assert.match(
  referralCenterOutput,
  /variant:"embedded"/,
  '推荐中心产物必须把小程序码作为分享码卡片的嵌入内容',
);

const appOutput = readDist('app.js');
const baseTemplate = readDist('base.wxml');
assert.match(appOutput, /openType:"agreePrivacyAuthorization"/, '隐私同意按钮应使用微信专用 open-type');
assert.match(appOutput, /onAgreePrivacyAuthorization:/, '隐私同意按钮应绑定微信专用回调');
assert.match(baseTemplate, /bindagreeprivacyauthorization="eh"/, 'WXML 应生成隐私授权事件绑定');
assert.doesNotMatch(
  baseTemplate,
  /<scroll-view[^>]*\spadding=/,
  'WebView 渲染模式下 ScrollView 不得携带仅 Skyline 支持的 padding 属性',
);
assert.match(
  appOutput,
  /AbortSignal cannot be constructed directly/,
  '生产包必须包含独立 AbortController 实现，不能只引用可能不存在的运行时全局变量',
);

const inspectableOutput = files
  .filter(({ relativePath }) => /\.(?:js|json|wxml)$/.test(relativePath))
  .map(({ relativePath }) => readDist(relativePath))
  .join('\n');
const wxssOutput = files
  .filter(({ relativePath }) => relativePath.endsWith('.wxss'))
  .map(({ relativePath }) => readDist(relativePath))
  .join('\n');
assert.doesNotMatch(inspectableOutput, /["']PATCH["']/, '微信请求产物不得使用 PATCH');
assert.doesNotMatch(inspectableOutput, /voice_recognition/i, '录音产物不得使用废弃 voice_recognition 音源');
assert.doesNotMatch(inspectableOutput, /\.ico(?:["'?]|$)/i, '地图 Marker 不得引用微信不支持的 ICO');
assert.match(inspectableOutput, /https:\/\/api\.ai-maimai\.com/, '生产包应指向生产 API');
assert.match(inspectableOutput, /wss:\/\/api\.ai-maimai\.com/, '生产包应指向生产 WebSocket');
assert.doesNotMatch(inspectableOutput, /https:\/\/test-api\.ai-maimai\.com/, '生产包不得指向测试 API');
assert.doesNotMatch(inspectableOutput, /wss:\/\/test-api\.ai-maimai\.com/, '生产包不得指向测试 WebSocket');
assert.doesNotMatch(wxssOutput, /:not\(/, 'WXSS 不得使用开发者工具不支持的 :not() 选择器');
assert.match(
  inspectableOutput,
  /mini-code-panel--embedded/,
  '小程序码组件产物必须包含嵌入模式，禁止复用旧的独立卡片缓存',
);
assert.match(
  wxssOutput,
  /\.mini-code-panel--embedded/,
  'WXSS 产物必须包含嵌入式小程序码布局',
);

const subpackageRoots = appConfig.subPackages.map(({ root }) => `${root}/`);
const totalBytes = files.reduce((total, file) => total + file.size, 0);
const mainBytes = files
  .filter(({ relativePath }) => !subpackageRoots.some((root) => relativePath.startsWith(root)))
  .reduce((total, file) => total + file.size, 0);
const subpackageSizes = appConfig.subPackages.map(({ root }) => ({
  root,
  bytes: files
    .filter(({ relativePath }) => relativePath.startsWith(`${root}/`))
    .reduce((total, file) => total + file.size, 0),
}));

const twoMiB = 2 * 1024 * 1024;
const twentyMiB = 20 * 1024 * 1024;
assert.ok(mainBytes < twoMiB, `主包 ${(mainBytes / 1048576).toFixed(3)} MiB 超过 2 MiB`);
for (const { root, bytes } of subpackageSizes) {
  assert.ok(bytes < twoMiB, `${root} 分包 ${(bytes / 1048576).toFixed(3)} MiB 超过 2 MiB`);
}
assert.ok(totalBytes < twentyMiB, `总包 ${(totalBytes / 1048576).toFixed(3)} MiB 超过 20 MiB`);

const largestSubpackage = subpackageSizes.sort((left, right) => right.bytes - left.bytes)[0];
console.log(JSON.stringify({
  pages: pageCount,
  totalMiB: Number((totalBytes / 1048576).toFixed(3)),
  mainMiB: Number((mainBytes / 1048576).toFixed(3)),
  largestSubpackage: largestSubpackage.root,
  largestSubpackageMiB: Number((largestSubpackage.bytes / 1048576).toFixed(3)),
}, null, 2));
