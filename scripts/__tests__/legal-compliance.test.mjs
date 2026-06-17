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

  assert.match(privacy, /version:\s*'v1\.0\.2'/);
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

test('privacy policy discloses OPPO-required payment SDK metadata', () => {
  const privacy = read(appPrivacyPath);

  assert.match(privacy, /SDK名称：APP支付客户端SDK/);
  assert.match(privacy, /开发者：支付宝\(杭州\)信息技术有限公司/);
  assert.match(privacy, /收集信息范围：设备信息、网络信息、支付订单信息/);
  assert.match(privacy, /目的：完成支付宝 App 支付、订单退款、消费积分提现到账能力/);
  assert.match(privacy, /https:\/\/opendocs\.alipay\.com\/open\/54\/01g6qm#%E6%94%AF%E4%BB%98%E5%AE%9D%20App%20%E6%94%AF%E4%BB%98%E5%AE%A2%E6%88%B7%E7%AB%AF%20SDK%20%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96/);
  assert.match(privacy, /SDK名称：微信OpenSDK Android/);
  assert.match(privacy, /开发者：深圳市腾讯计算机系统有限公司/);
  assert.match(privacy, /收集信息范围：设备信息、网络信息、微信账号授权信息、支付订单信息/);
  assert.match(privacy, /目的：完成微信授权登录、微信 App 支付及相关支付结果回调能力/);
  assert.match(privacy, /https:\/\/support\.weixin\.qq\.com\/cgi-bin\/mmsupportacctnodeweb-bin\/pages\/RYiYJkLOrQwu0nb8/);
  assert.doesNotMatch(privacy, /SDK 名称：@uiw\/react-native-alipay/);
  assert.doesNotMatch(privacy, /支付宝（中国）网络技术有限公司/);
  assert.doesNotMatch(privacy, /微信开放平台 SDK（腾讯公司）/);
});

test('privacy consent modal summary stays sourced from the privacy policy document', () => {
  const modal = read('src/components/overlay/PrivacyConsentModal.tsx');

  assert.match(modal, /PRIVACY_POLICY\.summary\.map/);
  assert.match(modal, /PRIVACY_POLICY\.version/);
  assert.match(modal, /PRIVACY_POLICY\.effectiveAt/);
  assert.doesNotMatch(modal, /身份证号/);
  assert.doesNotMatch(modal, /人脸图像/);
  assert.doesNotMatch(modal, /精确位置/);
  assert.doesNotMatch(modal, /AI 内容会脱敏后提交给合作服务商/);
});

test('website build generates crawler-readable static legal pages', () => {
  const websitePackageJson = JSON.parse(read('website/package.json'));

  assert.equal(existsSync('website/scripts/build-legal-static.mjs'), true);
  assert.match(websitePackageJson.scripts.prebuild, /build-legal-static\.mjs/);

  execFileSync('node', ['website/scripts/build-legal-static.mjs'], { encoding: 'utf8' });

  const staticPrivacy = read('website/public/privacy/index.html');
  const staticPrivacyAlias = read('website/public/privacy.html');

  for (const html of [staticPrivacy, staticPrivacyAlias]) {
    assert.match(html, /AI爱买买APP隐私政策/);
    assert.match(html, /版本 v1\.0\.2/);
    assert.match(html, /生效日期 2026-06-10/);
    assert.match(html, /剪贴板读取/);
    assert.match(html, /APP支付客户端SDK/);
    assert.match(html, /微信OpenSDK Android/);
    assert.match(html, /data-legal-format="app-legal-v1"/);
    assert.match(html, /class="app-header"/);
    assert.match(html, /class="document-header-card card"/);
    assert.match(html, /class="summary-card card"/);
    assert.match(html, /class="section-card card"/);
    assert.doesNotMatch(html, /<div id="root"><\/div>/);
    assert.doesNotMatch(html, /<nav aria-label="隐私政策目录">/);
    assert.doesNotMatch(html, /href="#scope"/);
    assert.doesNotMatch(html, /site-header/);
    assert.doesNotMatch(html, /page-hero/);
    assert.doesNotMatch(html, /breadcrumb/);
  }
});

test('VIP purchase flow prominently exposes membership service agreement', () => {
  const agreementPath = 'src/content/legal/memberServiceAgreement.ts';
  const agreementRoutePath = 'app/member-service-agreement.tsx';
  const vipGiftsPath = 'app/vip/gifts.tsx';
  const checkoutPath = 'app/checkout.tsx';

  assert.equal(existsSync(agreementPath), true);
  assert.equal(existsSync(agreementRoutePath), true);

  const agreement = read(agreementPath);
  const route = read(agreementRoutePath);
  const vipGifts = read(vipGiftsPath);
  const checkout = read(checkoutPath);

  assert.match(agreement, /会员服务协议/);
  assert.match(agreement, /VIP/);
  assert.match(route, /会员服务协议/);
  assert.match(route, /MEMBER_SERVICE_AGREEMENT/);
  assert.match(vipGifts, /会员服务协议/);
  assert.match(vipGifts, /member-service-agreement/);
  assert.match(checkout, /会员服务协议/);
  assert.match(checkout, /member-service-agreement/);
  assert.match(checkout, /请先阅读并同意《会员服务协议》/);
});

test('settings screen does not expose unfinished help and customer service entries', () => {
  const settings = read('app/settings.tsx');

  assert.doesNotMatch(settings, /帮助与客服/);
  assert.doesNotMatch(settings, /在线客服即将上线/);
  assert.doesNotMatch(settings, /帮助与反馈待接入/);
});

test('about screen exposes current company contact email', () => {
  const about = read('app/about.tsx');

  assert.match(about, /邮箱：zwf@huahainongke\.com/);
  assert.doesNotMatch(about, /zenghaifeng13@163\.com/);
});

test('privacy policy does not disclose removed in-app online support path', () => {
  const privacy = read(appPrivacyPath);
  const huahaiPrivacy = read('huahai-corporate-site/privacy.html');

  assert.match(privacy, /个人信息保护负责人邮箱：zwf@huahainongke\.com/);
  assert.match(privacy, /客服电话：0755-28509232/);
  assert.doesNotMatch(privacy, /App 内在线客服：我的 > 设置 > 在线客服/);
  assert.doesNotMatch(huahaiPrivacy, /App 内在线客服：我的 &gt; 设置 &gt; 在线客服/);
});

test('huahai corporate site exposes the same legal pages', () => {
  execFileSync('node', ['website/scripts/build-legal-static.mjs'], { encoding: 'utf8' });
  execFileSync('node', ['scripts/sync-huahai-legal.mjs'], { encoding: 'utf8' });

  assert.equal(existsSync('huahai-corporate-site/privacy.html'), true);
  assert.equal(existsSync('huahai-corporate-site/terms.html'), true);

  const privacy = read('huahai-corporate-site/privacy.html');
  const terms = read('huahai-corporate-site/terms.html');
  const websitePrivacy = read('website/public/privacy.html');
  const websiteTerms = read('website/public/terms.html');

  assert.match(privacy, /AI爱买买APP隐私政策/);
  assert.match(privacy, /剪贴板读取/);
  assert.match(terms, /AI爱买买APP用户协议/);
  assert.match(terms, /账号注销与权益终止规则/);
  assert.equal(privacy, websitePrivacy);
  assert.equal(terms, websiteTerms);
  assert.match(privacy, /data-legal-format="app-legal-v1"/);
  assert.doesNotMatch(privacy, /class="legal-toc"/);
  assert.doesNotMatch(privacy, /href="#scope"/);
  assert.doesNotMatch(privacy, /site-header/);
  assert.doesNotMatch(privacy, /page-hero/);
  assert.doesNotMatch(privacy, /breadcrumb/);
  assert.doesNotMatch(terms, /class="legal-toc"/);
  assert.doesNotMatch(terms, /href="#definitions"/);
  assert.doesNotMatch(terms, /site-header/);
  assert.doesNotMatch(terms, /page-hero/);
  assert.doesNotMatch(terms, /breadcrumb/);
});

test('all huahai corporate pages link to privacy and terms', () => {
  const pages = readdirSync('huahai-corporate-site')
    .filter((fileName) => fileName.endsWith('.html'))
    .filter((fileName) => !['privacy.html', 'terms.html'].includes(fileName))
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
  assert.match(markdown, /版本 v1\.0\.2/);
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
