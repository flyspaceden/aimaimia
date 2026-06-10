import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

function escapeMarkdown(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderBlock(block) {
  const text = escapeMarkdown(block.text);
  if (block.type === 'note') return `> ${text}`;
  if (block.type === 'strong') return `**${text}**`;
  if (block.type === 'bullet') return `- ${text}`;
  return text;
}

function renderDocument(doc) {
  const summary = doc.summary.map((item) => `- ${escapeMarkdown(item)}`).join('\n');
  const sections = doc.sections
    .map((section) => {
      const blocks = section.blocks.map(renderBlock).join('\n\n');
      return `## ${escapeMarkdown(section.title)}\n\n${blocks}`;
    })
    .join('\n\n');

  return `# ${escapeMarkdown(doc.title)}\n\n> 版本 ${escapeMarkdown(doc.version)} ｜ 发布日期 ${escapeMarkdown(doc.publishedAt)} ｜ 生效日期 ${escapeMarkdown(doc.effectiveAt)}\n\n## 要点摘要\n\n${summary}\n\n${sections}`;
}

const privacy = readLegalDocument('src/content/legal/privacyPolicy.ts', 'PRIVACY_POLICY');
const terms = readLegalDocument('src/content/legal/termsOfService.ts', 'TERMS_OF_SERVICE');

const markdown = `# 爱买买 App 法律文本审核稿

> **本文件用途**：将买家 App 内嵌的《隐私政策》《用户协议》原文导出为 Markdown，方便发给法律顾问审核。
> **来源（权威原文）**：\`src/content/legal/privacyPolicy.ts\` / \`src/content/legal/termsOfService.ts\`（本文件由脚本原样导出，请以源文件为准，审核结论改回源文件）。
> **当前状态**：隐私政策已补充剪贴板读取披露（CB08），公司主体信息与联系方式已填实；正式上线前仍应经法律顾问审核。
> **请审核人重点关注**：① 剪贴板读取披露是否满足应用商店审核要求；② 分润奖励 / 消费积分相关条款是否合规；③ 账号注销与数据保留期条款；④ 第三方信息共享清单（支付/物流/短信等）。

${renderDocument(privacy)}

\\newpage

${renderDocument(terms)}
`;

process.stdout.write(markdown);
