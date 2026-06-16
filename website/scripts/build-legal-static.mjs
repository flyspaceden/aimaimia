import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDir, '..');
const publicRoot = resolve(websiteRoot, 'public');

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
  if (block.type === 'note') return `<h3>${text}</h3>`;
  if (block.type === 'strong') return `<p class="strong">${text}</p>`;
  if (block.type === 'bullet') return `<p class="bullet">${text}</p>`;
  return `<p>${text}</p>`;
}

function renderLegalPage(doc, kind) {
  const title = escapeHtml(doc.title);
  const summary = doc.summary.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n        ');
  const sections = doc.sections
    .map(
      (section) => `<section id="${escapeHtml(section.id)}">
        <h2>${escapeHtml(section.title)}</h2>
        ${section.blocks.map(renderBlock).join('\n        ')}
      </section>`,
    )
    .join('\n\n      ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — AI爱买买</title>
  <meta name="description" content="${title}，版本 ${escapeHtml(doc.version)}，生效日期 ${escapeHtml(doc.effectiveAt)}。" />
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif; color: #1f2933; background: #f7faf8; }
    header { background: #0f5132; color: white; padding: 48px 20px; }
    main { max-width: 960px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { margin: 0 0 12px; font-size: 32px; line-height: 1.2; }
    h2 { margin: 36px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #d7e2dc; font-size: 22px; }
    h3 { margin: 24px 0 12px; font-size: 17px; }
    p { line-height: 1.8; margin: 0 0 12px; }
    a { color: #0f7a4b; text-decoration: none; }
    section { background: white; border: 1px solid #d7e2dc; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
    .meta { opacity: .86; }
    .summary { background: white; border: 1px solid #d7e2dc; border-radius: 8px; padding: 24px; }
    .strong { border-left: 4px solid #0f7a4b; background: #eef8f1; padding: 12px 16px; font-weight: 600; }
    .bullet::before { content: "•"; color: #0f7a4b; font-weight: 700; margin-right: 8px; }
    footer { color: #65746d; border-top: 1px solid #d7e2dc; padding-top: 24px; margin-top: 36px; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <p class="meta">版本：${escapeHtml(doc.version)} · 发布日期：${escapeHtml(doc.publishedAt)} · 生效日期：${escapeHtml(doc.effectiveAt)}</p>
  </header>
  <main>
    <p><a href="/">返回 AI爱买买官网</a></p>
    <article>
      <div class="summary">
        ${summary}
      </div>
      ${sections}
    </article>
    <footer>
      <p>本文档由深圳华海农业科技集团有限公司发布。</p>
    </footer>
  </main>
</body>
</html>
`;
}

function writeStaticPage(route, html) {
  const dir = resolve(publicRoot, route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.html'), html);
  writeFileSync(resolve(publicRoot, `${route}.html`), html);
}

const privacy = readLegalDocument(resolve(websiteRoot, 'src/content/legal/privacyPolicy.ts'), 'PRIVACY_POLICY');
const terms = readLegalDocument(resolve(websiteRoot, 'src/content/legal/termsOfService.ts'), 'TERMS_OF_SERVICE');

writeStaticPage('privacy', renderLegalPage(privacy, 'privacy'));
writeStaticPage('terms', renderLegalPage(terms, 'terms'));
