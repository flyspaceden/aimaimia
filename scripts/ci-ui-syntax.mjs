import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let cachedCompiler;
function compiler() {
  if (cachedCompiler) return cachedCompiler;
  try { cachedCompiler = require('../miniapp/node_modules/typescript'); return cachedCompiler; } catch { /* CI may only need the parser. */ }
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('presentation parser is unavailable');
  const lock = JSON.parse(readFileSync(new URL('../miniapp/package-lock.json', import.meta.url), 'utf8'));
  const version = lock.packages?.['node_modules/typescript']?.version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version || '')) throw new Error('invalid locked parser version');
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-ui-parser-'));
  execFileSync('npm', ['install', '--prefix', root, '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--no-save', `typescript@${version}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  cachedCompiler = require(path.join(root, 'node_modules/typescript'));
  return cachedCompiler;
}

const readNames = new Set(['member', 'profile', 'hydrated', 'loggedIn']);
const readPaths = new Set(['member.tier', 'member.referralCode', 'profile.name', 'profile.avatar', 'profile.buyerNo']);
const displayProps = {
  View: ['className', 'style', 'hoverClass', 'aria-hidden', 'aria-label'],
  Text: ['className', 'style', 'aria-hidden', 'aria-label'],
  Image: ['className', 'style', 'mode', 'src'],
  SeafoodImage: ['className', 'style', 'mode', 'name'],
  FunctionalIcon: ['className', 'style', 'name'],
  ProfileAvatar: ['className', 'style', 'uri', 'name', 'frameType', 'size'],
  PageHeader: ['title', 'eyebrow'],
};

export function presentationSyntaxOnly(before, after) {
  const ts = compiler();
  const parse = (text) => ts.createSourceFile('display.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const oldFile = parse(before), newFile = parse(after);
  if (oldFile.parseDiagnostics.length || newFile.parseDiagnostics.length) return false;
  const fingerprint = (file) => {
    let derived = new Set();
    let shadowedBoolean = false;
    const pathOf = (node) => ts.isIdentifier(node) ? node.text
      : ts.isPropertyAccessExpression(node) ? `${pathOf(node.expression)}.${node.name.text}` : '';
    const read = (node, names = derived) => {
      if (!node) return true;
      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
      if (ts.isIdentifier(node)) return readNames.has(node.text) || names.has(node.text) || node.text === 'undefined';
      if (ts.isPropertyAccessExpression(node)) return readPaths.has(pathOf(node));
      if (ts.isParenthesizedExpression(node)) return read(node.expression, names);
      if (ts.isPrefixUnaryExpression(node)) return node.operator === ts.SyntaxKind.ExclamationToken && read(node.operand, names);
      if (ts.isBinaryExpression(node)) return [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind) && read(node.left, names) && read(node.right, names);
      if (ts.isConditionalExpression(node)) return read(node.condition, names) && read(node.whenTrue, names) && read(node.whenFalse, names);
      if (ts.isCallExpression(node)) return !shadowedBoolean && ts.isIdentifier(node.expression) && node.expression.text === 'Boolean' && node.arguments.length === 1 && read(node.arguments[0], names);
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true; // inner behavior is collected independently
      return false;
    };
    const walk = (node, fn) => { fn(node); ts.forEachChild(node, (child) => { walk(child, fn); }); };
    const readonlyValue = (node) => {
      if (!node || !read(node)) return false;
      let containsJsx = false;
      walk(node, (part) => { if (ts.isJsxElement(part) || ts.isJsxSelfClosingElement(part) || ts.isJsxFragment(part)) containsJsx = true; });
      return !containsJsx;
    };
    const tagOf = (node) => node.tagName?.getText(file) || '';
    const displayAttribute = (attr) => {
      if (!ts.isJsxAttribute(attr)) return false;
      const tag = tagOf(attr.parent.parent);
      if (!displayProps[tag]?.includes(attr.name.getText(file))) return false;
      if (!attr.initializer) return true;
      if (ts.isStringLiteral(attr.initializer)) return true;
      if (!ts.isJsxExpression(attr.initializer)) return false;
      const value = attr.initializer.expression;
      if (attr.name.getText(file) === 'style' && value && ts.isObjectLiteralExpression(value)) {
        return value.properties.every((p) => ts.isPropertyAssignment(p) && (ts.isStringLiteralLike(p.initializer) || ts.isNumericLiteral(p.initializer)));
      }
      return read(value);
    };
    const declarations = [];
    const declaredNames = new Map();
    walk(file, (node) => {
      // 只接受没有其他绑定/引用的全局 Boolean；默认 import、解构和命名空间别名也会被排除。
      if (ts.isIdentifier(node) && node.text === 'Boolean' && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) shadowedBoolean = true;
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isImportSpecifier(node)) && node.name && ts.isIdentifier(node.name)) {
        declaredNames.set(node.name.text, (declaredNames.get(node.name.text) || 0) + 1);
        if (node.name.text === 'Boolean') shadowedBoolean = true;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (node.parent.flags & ts.NodeFlags.Const)) declarations.push(node);
    });
    // Only readonly values used exclusively as presentation can be ignored.
    for (let i = 0; i < declarations.length; i++) {
      for (const node of declarations) if (declaredNames.get(node.name.text) === 1 && !node.parent.parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) && !/(?:token|password|secret|price|amount|stock|quantity|refund|payment|balance)/i.test(node.name.text) && readonlyValue(node.initializer)) derived.add(node.name.text);
    }
    let removed;
    do {
      removed = false;
      for (const name of [...derived]) {
        let safe = true;
        walk(file, (node) => {
          if (!ts.isIdentifier(node) || node.text !== name) return;
          const parent = node.parent;
          if ((ts.isVariableDeclaration(parent) && parent.name === node) || (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isJsxAttribute(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node)) return;
          let cursor = node;
          while (cursor && !ts.isJsxExpression(cursor) && !ts.isVariableDeclaration(cursor)) cursor = cursor.parent;
          if (cursor && ts.isVariableDeclaration(cursor) && ts.isIdentifier(cursor.name) && derived.has(cursor.name.text) && readonlyValue(cursor.initializer)) return;
          if (cursor && ts.isJsxExpression(cursor)) {
            if (ts.isJsxAttribute(cursor.parent) ? displayAttribute(cursor.parent) : read(cursor.expression)) return;
          }
          safe = false;
        });
        if (!safe) { derived.delete(name); removed = true; }
      }
    } while (removed);
    const signature = (node) => {
      if (!node) return null;
      if (ts.isVariableStatement(node) && node.declarationList.declarations.every((d) => ts.isIdentifier(d.name) && derived.has(d.name.text) && readonlyValue(d.initializer))) return null;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const props = (opening.attributes?.properties || []).flatMap((part) => {
          if (ts.isJsxSpreadAttribute(part)) return [['spread', signature(part.expression)]];
          if (!displayAttribute(part)) return [['prop', part.name.getText(file), signature(ts.isJsxExpression(part.initializer) ? part.initializer.expression : part.initializer)]];
          return [];
        });
        // 保留 JSX 祖先/子级关系，防止同一组事件经重新嵌套后改变冒泡行为。
        const children = (node.children || []).map(signature).filter((value) => value !== null);
        return ['presentation', tagOf(opening) || 'fragment', props, children];
      }
      if (ts.isJsxText(node)) return null;
      if (ts.isJsxExpression(node) && read(node.expression)) {
        const rendered = [];
        const collect = (part) => {
          if (ts.isJsxElement(part) || ts.isJsxSelfClosingElement(part) || ts.isJsxFragment(part)) { rendered.push(signature(part)); return; }
          ts.forEachChild(part, (child) => { collect(child); });
        };
        if (node.expression) collect(node.expression);
        return rendered.length ? ['display-expression', rendered] : null;
      }
      if (ts.isIdentifier(node)) return ['identifier', node.text];
      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.kind, node.text];
      const children = [];
      ts.forEachChild(node, (child) => { const value = signature(child); if (value !== null) children.push(value); });
      const semantics = [];
      if (ts.isVariableDeclarationList(node)) semantics.push(node.flags);
      if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) semantics.push(node.operator);
      if ('isTypeOnly' in node) semantics.push(node.isTypeOnly);
      return [node.kind, semantics, children];
    };
    return JSON.stringify(signature(file));
  };
  return fingerprint(oldFile) === fingerprint(newFile);
}
