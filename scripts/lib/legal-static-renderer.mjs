import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function readLegalDocument(filePath, exportName) {
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
  if (block.type === 'note') return `<p class="note">${text}</p>`;
  if (block.type === 'strong') return `<p class="strong-box">${text}</p>`;
  if (block.type === 'bullet') {
    return `<p class="bullet-row"><span class="bullet-dot">•</span><span>${text}</span></p>`;
  }
  return `<p class="body-text">${text}</p>`;
}

function routeTitle(kind) {
  const titles = {
    privacy: '隐私政策',
    terms: '用户协议',
    'delivery-terms': '配送服务条款',
    'delivery-privacy': '配送隐私政策',
    'delivery-seller-agreement': '配送中心商家协议',
  };
  return titles[kind] ?? '法律文本';
}

export function renderLegalPage(doc, kind) {
  const title = escapeHtml(doc.title);
  const screenTitle = escapeHtml(routeTitle(kind));
  const summary = doc.summary
    .map((line) => `<p class="body-text">${escapeHtml(line)}</p>`)
    .join('\n          ');
  const sections = doc.sections
    .map(
      (section) => `<section class="document-section" id="${escapeHtml(section.id)}">
        <h3>${escapeHtml(section.title)}</h3>
        <div class="section-card card">
          ${section.blocks.map(renderBlock).join('\n          ')}
        </div>
      </section>`,
    )
    .join('\n\n      ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${screenTitle}</title>
  <meta name="description" content="${title}，版本 ${escapeHtml(doc.version)}，生效日期 ${escapeHtml(doc.effectiveAt)}。" />
  <style>
    :root {
      color-scheme: light;
      --bg: #f7faf8;
      --surface: #ffffff;
      --text-primary: #1f2933;
      --text-secondary: #506070;
      --text-tertiary: #7a8794;
      --brand-primary: #0f7a4b;
      --brand-light: #eaf7ef;
      --border: #d7e2dc;
      --shadow: 0 8px 24px rgba(15, 81, 50, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
      letter-spacing: 0;
    }
    .app-screen {
      min-height: 100vh;
      background: var(--bg);
    }
    .app-header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 48px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .app-header h1 {
      margin: 0;
      font-size: 17px;
      line-height: 24px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .app-scroll {
      width: min(100%, 720px);
      margin: 0 auto;
      padding: 20px 16px 40px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow);
    }
    .document-header-card {
      padding: 16px;
    }
    .document-header-card h2 {
      margin: 0;
      font-size: 22px;
      line-height: 30px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .meta {
      margin: 4px 0 0;
      font-size: 12px;
      line-height: 18px;
      color: var(--text-tertiary);
    }
    .summary-card {
      margin-top: 12px;
      padding: 14px;
      background: rgba(15, 122, 75, 0.04);
      border-color: rgba(15, 122, 75, 0.16);
    }
    .document-section {
      margin-top: 18px;
    }
    .document-section h3 {
      margin: 0;
      font-size: 18px;
      line-height: 26px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .section-card {
      margin-top: 8px;
      padding: 14px;
    }
    .body-text,
    .note,
    .strong-box,
    .bullet-row {
      margin: 8px 0 0;
      font-size: 14px;
      line-height: 22px;
      color: var(--text-secondary);
    }
    .body-text:first-child,
    .note:first-child,
    .strong-box:first-child,
    .bullet-row:first-child {
      margin-top: 0;
    }
    .body-text,
    .note,
    .strong-box,
    .bullet-row span:last-child {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .note {
      margin-top: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .strong-box {
      padding: 10px;
      border-left: 3px solid var(--brand-primary);
      border-radius: 8px;
      background: var(--brand-light);
      font-weight: 600;
      color: var(--text-primary);
    }
    .bullet-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .bullet-row span:last-child {
      min-width: 0;
    }
    .bullet-dot {
      flex: 0 0 auto;
      color: var(--brand-primary);
      font-weight: 700;
    }
    @media (min-width: 768px) {
      .app-header { height: 56px; }
      .app-scroll { padding-top: 28px; }
    }
  </style>
</head>
<body>
  <div class="app-screen" data-legal-format="app-legal-v1">
    <header class="app-header">
      <h1>${screenTitle}</h1>
    </header>
    <main class="app-scroll">
      <section class="document-header-card card">
        <h2>${title}</h2>
        <p class="meta">版本 ${escapeHtml(doc.version)} · 发布日期 ${escapeHtml(doc.publishedAt)} · 生效日期 ${escapeHtml(doc.effectiveAt)}</p>
      </section>

      <section class="summary-card card">
          ${summary}
      </section>

      ${sections}
    </main>
  </div>
</body>
</html>
`;
}
