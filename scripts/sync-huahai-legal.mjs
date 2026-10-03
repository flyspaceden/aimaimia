import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readLegalDocument, renderLegalPage } from './lib/legal-static-renderer.mjs';

const HUAHAI_ROOT = 'huahai-corporate-site';
const GENERATED_LEGAL_PAGES = new Set(['privacy.html', 'terms.html']);

// 官网译文由同一个入口切换；权威法律内容仍由中文源文件原样生成。
const withLanguageSupport = (html) => html.replace('</body>', '<script src="assets/script.js?v=20261002-i18n1"></script>\n</body>');

function syncFooterLegalLinks(pagePath) {
  let html = readFileSync(pagePath, 'utf8');
  const marker = '      <a class="icp-badge" href="https://beian.miit.gov.cn/"';
  if (!html.includes(marker)) throw new Error(`Cannot find footer ICP marker in ${pagePath}`);

  const markerIndex = html.indexOf(marker);
  const footerStart = html.lastIndexOf('<footer class="site-footer">', markerIndex);
  const footerPrefix = footerStart >= 0 ? html.slice(footerStart, markerIndex) : html.slice(0, markerIndex);
  if (footerPrefix.includes('href="privacy.html"') && footerPrefix.includes('href="terms.html"')) return;

  html = html.replace(
    marker,
    '      <a class="icp-badge" href="privacy.html">隐私政策</a>\n      <a class="icp-badge" href="terms.html">用户协议</a>\n' + marker,
  );
  writeFileSync(pagePath, html);
}

function listHuahaiContentPages() {
  return readdirSync(HUAHAI_ROOT)
    .filter((fileName) => fileName.endsWith('.html'))
    .filter((fileName) => !GENERATED_LEGAL_PAGES.has(fileName))
    .map((fileName) => `${HUAHAI_ROOT}/${fileName}`);
}

const privacy = readLegalDocument('src/content/legal/privacyPolicy.ts', 'PRIVACY_POLICY');
const terms = readLegalDocument('src/content/legal/termsOfService.ts', 'TERMS_OF_SERVICE');

writeFileSync(`${HUAHAI_ROOT}/privacy.html`, withLanguageSupport(renderLegalPage(privacy, 'privacy')));
writeFileSync(`${HUAHAI_ROOT}/terms.html`, withLanguageSupport(renderLegalPage(terms, 'terms')));

for (const page of listHuahaiContentPages()) syncFooterLegalLinks(page);
