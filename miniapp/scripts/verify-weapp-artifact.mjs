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
  '微信开发者工具必须使用爱买买真实小程序 AppID',
);

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
const pageCount = appConfig.pages.length
  + appConfig.subPackages.reduce((total, item) => total + item.pages.length, 0);
const pageWxmlCount = files.filter(({ relativePath }) => (
  relativePath.endsWith('.wxml')
  && relativePath !== 'base.wxml'
  && relativePath !== 'comp.wxml'
)).length;

assert.equal(pageCount, 71, 'app.json 应注册 71 个运行时页面');
assert.equal(pageWxmlCount, pageCount, '每个注册页面都应生成对应 WXML');
assert.equal(
  appConfig.subPackages.some(({ root }) => /delivery/i.test(root)),
  false,
  '首版不得包含配送分包',
);

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

const appOutput = readDist('app.js');
const baseTemplate = readDist('base.wxml');
assert.match(appOutput, /openType:"agreePrivacyAuthorization"/, '隐私同意按钮应使用微信专用 open-type');
assert.match(appOutput, /onAgreePrivacyAuthorization:/, '隐私同意按钮应绑定微信专用回调');
assert.match(baseTemplate, /bindagreeprivacyauthorization="eh"/, 'WXML 应生成隐私授权事件绑定');
assert.match(
  appOutput,
  /AbortSignal cannot be constructed directly/,
  '生产包必须包含独立 AbortController 实现，不能只引用可能不存在的运行时全局变量',
);

const inspectableOutput = files
  .filter(({ relativePath }) => /\.(?:js|json|wxml)$/.test(relativePath))
  .map(({ relativePath }) => readDist(relativePath))
  .join('\n');
assert.doesNotMatch(inspectableOutput, /["']PATCH["']/, '微信请求产物不得使用 PATCH');
assert.doesNotMatch(inspectableOutput, /voice_recognition/i, '录音产物不得使用废弃 voice_recognition 音源');
assert.doesNotMatch(inspectableOutput, /\.ico(?:["'?]|$)/i, '地图 Marker 不得引用微信不支持的 ICO');
assert.match(inspectableOutput, /https:\/\/api\.ai-maimai\.com/, '生产包应指向生产 API');
assert.match(inspectableOutput, /wss:\/\/api\.ai-maimai\.com/, '生产包应指向生产 WebSocket');
assert.doesNotMatch(inspectableOutput, /https:\/\/test-api\.ai-maimai\.com/, '生产包不得指向测试 API');
assert.doesNotMatch(inspectableOutput, /wss:\/\/test-api\.ai-maimai\.com/, '生产包不得指向测试 WebSocket');

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
