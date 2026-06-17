import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const HUAHAI_ROOT = 'huahai-corporate-site';
const GENERATED_LEGAL_PAGES = new Set(['privacy.html', 'terms.html']);

function readLegalDocument(filePath, exportName) {
  const source = readFileSync(filePath, 'utf8');
  const marker = `export const ${exportName}: LegalDocument = `;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Cannot find ${exportName} in ${filePath}`);

  const literalStart = start + marker.length;
  const literalEnd = source.indexOf('\n};', literalStart);
  if (literalEnd < 0) throw new Error(`Cannot find end of ${exportName} in ${filePath}`);

  const literal = source.slice(literalStart, literalEnd + 2);
  return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBlock(block) {
  const text = escapeHtml(block.text);
  if (block.type === 'note') return `<p class="legal-note">${text}</p>`;
  if (block.type === 'strong') return `<p class="legal-strong">${text}</p>`;
  if (block.type === 'bullet') return `<p class="legal-bullet">${text}</p>`;
  return `<p>${text}</p>`;
}

function renderHeader() {
  return `<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="index.html" aria-label="华海农科 首页">
      <img src="assets/logo.jpg" alt="华海农科 logo" />
      <span class="brand-text"><span class="zh">华海农科</span><span class="en">HUAHAI AGRI-TECH</span></span>
    </a>
    <nav class="nav" aria-label="主导航">
      <a href="index.html" data-route="index.html">首页</a>
      <a href="about.html" data-route="about.html">关于我们</a>
      <a href="business.html" data-route="business.html">业务版图</a>
      <a href="technology.html" data-route="technology.html">技术引擎</a>
      <a href="industry.html" data-route="industry.html">产业生态</a>
      <a href="contact.html" data-route="contact.html" class="nav-cta">联系我们</a>
    </nav>
    <button class="nav-toggle" aria-label="切换菜单" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
  </div>
</header>`;
}

function renderFooter() {
  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="brand" href="index.html" style="margin-bottom: 16px;">
          <img src="assets/logo.jpg" alt="华海农科 logo" style="width:42px;height:42px;border-radius:50%;" />
          <span class="brand-text"><span class="zh">华海农科</span><span class="en">HUAHAI AGRI-TECH</span></span>
        </a>
        <p>深圳华海农业科技集团有限公司是深圳援疆企业，以 AI + 农业为核心，聚焦全产业链深耕，推动农业新质生产力发展。</p>
      </div>
      <div class="footer-col"><h4>公司</h4><ul>
        <li><a href="about.html">关于我们</a></li>
        <li><a href="business.html">业务版图</a></li>
        <li><a href="industry.html">产业生态</a></li>
      </ul></div>
      <div class="footer-col"><h4>技术</h4><ul>
        <li><a href="technology.html">技术引擎</a></li>
        <li><a href="technology.html#ai">AI 原生系统</a></li>
        <li><a href="technology.html#blockchain">区块链信用确权</a></li>
      </ul></div>
      <div class="footer-col"><h4>联系</h4><ul>
        <li><a href="contact.html">联系方式</a></li>
        <li><a href="tel:13923710623">13923710623</a></li>
        <li><a href="mailto:zengweifeng3@163.com">zengweifeng3@163.com</a></li>
      </ul></div>
    </div>
    <div class="footer-bottom">
      <div class="footer-legal">
        <div>© 2017-2026 深圳华海农业科技集团有限公司 版权所有</div>
        <div class="address">地址：深圳市龙岗区平湖街道白坭坑社区丹农路1号5#楼5RE2070</div>
      </div>
      <a class="icp-badge" href="privacy.html">隐私政策</a>
      <a class="icp-badge" href="terms.html">用户协议</a>
      <a class="icp-badge" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">粤ICP备2023047684号</a>
      <a class="icp-badge" href="https://beian.mps.gov.cn/#/query/webSearch?code=44030002012051" target="_blank" rel="noreferrer"><img src="assets/国徽.png" alt="国徽" style="height:14px;width:auto;">粤公网安备44030002012051号</a>
    </div>
  </div>
</footer>`;
}

function renderLegalPage(doc, kind) {
  const title = escapeHtml(doc.title);
  const description = `${doc.title}，由深圳华海农业科技集团有限公司发布。`;
  const sections = doc.sections
    .map((section) => `<section class="legal-section" id="${escapeHtml(section.id)}">
        <h2>${escapeHtml(section.title)}</h2>
        ${section.blocks.map(renderBlock).join('\n        ')}
      </section>`)
    .join('\n\n      ');
  const summary = doc.summary
    .map((item) => `<p>${escapeHtml(item)}</p>`)
    .join('\n          ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | 深圳华海农业科技集团有限公司</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="icon" type="image/jpeg" href="assets/logo.jpg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="assets/style.css" />
</head>
<body>

${renderHeader()}

<main>

<section class="page-hero">
  <div class="container">
    <div class="breadcrumb"><a href="index.html">首页</a> · ${kind === 'privacy' ? '隐私政策' : '用户协议'}</div>
    <h1>${title}</h1>
    <p class="intro">版本：${escapeHtml(doc.version)} · 发布日期：${escapeHtml(doc.publishedAt)} · 生效日期：${escapeHtml(doc.effectiveAt)}</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <article class="legal-document">
      <div class="legal-summary">
        ${summary}
      </div>

      ${sections}
    </article>
  </div>
</section>

</main>

${renderFooter()}

<script src="assets/script.js"></script>
</body>
</html>
`;
}

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

writeFileSync(`${HUAHAI_ROOT}/privacy.html`, renderLegalPage(privacy, 'privacy'));
writeFileSync(`${HUAHAI_ROOT}/terms.html`, renderLegalPage(terms, 'terms'));

for (const page of listHuahaiContentPages()) syncFooterLegalLinks(page);
