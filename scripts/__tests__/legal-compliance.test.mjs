import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const appPrivacyPath = 'src/content/legal/privacyPolicy.ts';
const websitePrivacyPath = 'website/src/content/legal/privacyPolicy.ts';
const appTermsPath = 'src/content/legal/termsOfService.ts';
const websiteTermsPath = 'website/src/content/legal/termsOfService.ts';

test('app and website legal source files stay byte-for-byte aligned', () => {
  assert.equal(read(appPrivacyPath), read(websitePrivacyPath));
  assert.equal(read(appTermsPath), read(websiteTermsPath));
});

test('privacy policy discloses clipboard referral-link reads', () => {
  const privacy = read(appPrivacyPath);

  assert.match(privacy, /version:\s*'v1\.0\.1'/);
  assert.match(privacy, /剪贴板读取/);
  assert.match(privacy, /点击下载/);
  assert.match(privacy, /推荐链接/);
  assert.match(privacy, /不会保存或上传剪贴板原文/);
});

test('legal text matches reward dual-track semantics', () => {
  const privacy = read(appPrivacyPath);
  const terms = read(appTermsPath);
  const combined = `${privacy}\n${terms}`;

  assert.doesNotMatch(combined, /不支持提现/);
  assert.doesNotMatch(combined, /无现金价值/);
  assert.match(combined, /支付宝提现/);
  assert.match(combined, /普通商品订单/);
  assert.match(combined, /VIP 礼包禁止/);
  assert.match(combined, /代扣/);
});

test('huahai corporate site exposes the same legal pages', () => {
  assert.equal(existsSync('huahai-corporate-site/privacy.html'), true);
  assert.equal(existsSync('huahai-corporate-site/terms.html'), true);

  const privacy = read('huahai-corporate-site/privacy.html');
  const terms = read('huahai-corporate-site/terms.html');

  assert.match(privacy, /AI爱买买APP隐私政策/);
  assert.match(privacy, /剪贴板读取/);
  assert.match(terms, /AI爱买买APP用户协议/);
  assert.match(terms, /账号注销与权益终止规则/);
});

test('all huahai corporate pages link to privacy and terms', () => {
  const pages = readdirSync('huahai-corporate-site')
    .filter((fileName) => fileName.endsWith('.html'))
    .map((fileName) => `huahai-corporate-site/${fileName}`);

  for (const page of pages) {
    const html = read(page);

    assert.match(html, /href="privacy\.html"/, `${page} should link privacy.html`);
    assert.match(html, /href="terms\.html"/, `${page} should link terms.html`);
  }
});

test('legal review docx includes current privacy policy disclosure', () => {
  const markdown = execFileSync(
    'pandoc',
    ['docs/legal/爱买买法律文本审核稿.docx', '-t', 'markdown', '--wrap=none'],
    { encoding: 'utf8' },
  );

  assert.match(markdown, /AI爱买买APP隐私政策/);
  assert.match(markdown, /版本 v1\.0\.1/);
  assert.match(markdown, /剪贴板读取/);
  assert.match(markdown, /不会保存或上传剪贴板原文/);
  assert.match(markdown, /支付宝提现/);
  assert.doesNotMatch(markdown, /不支持提现/);
});

test('default test script includes legal compliance checks', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.scripts['test:legal'], 'node --test scripts/__tests__/*.test.mjs');
  assert.match(packageJson.scripts.test, /test:legal/);
});
