import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let cachedCompiler;
export function frontendCompiler() {
  if (cachedCompiler) return cachedCompiler;
  for (const location of ['../node_modules/typescript', '../miniapp/node_modules/typescript']) {
    try { cachedCompiler = require(location); return cachedCompiler; } catch { /* 使用已有的锁定依赖。 */ }
  }
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('frontend parser unavailable');
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const version = lock.packages?.['node_modules/typescript']?.version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version || '')) throw new Error('invalid parser version');
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-frontend-parser-'));
  execFileSync('npm', ['install', '--prefix', root, '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--no-save', `typescript@${version}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  cachedCompiler = require(path.join(root, 'node_modules/typescript'));
  return cachedCompiler;
}

const sensitive = /(?:auth|login|session|token|password|secret|consent|permission|privacy|security|price|amount|stock|quantity|inventory|refund|payment|checkout|reward|commission|balance|wallet|withdraw|order|cart|member|tier|coupon|bonus|queue|asset|delivery)/i;
const sensitiveDerived = /(?:auth|session|token|password|secret|consent|permission|price|amount|stock|quantity|inventory|refund|payment|checkout|reward|commission|balance|wallet|withdraw|order|cart|coupon|bonus|queue)/i;
const uiStateName = /(?:visible|expanded|collapsed|open|modal|dialog|panel|tooltip|activeTab|selectedTab)/i;
const primitives = new Set(['View', 'Text', 'Image', 'Button', 'Pressable', 'TouchableOpacity', 'ScrollView', 'Modal', 'TextInput', 'Input']);
const displayProps = new Set(['className', 'style', 'contentStyle', 'contentContainerStyle', 'title', 'subtitle', 'label', 'placeholder', 'accessibilityLabel', 'aria-label', 'aria-hidden', 'numberOfLines', 'allowFontScaling', 'maxFontSizeMultiplier', 'adjustsFontSizeToFit', 'minimumFontScale', 'color', 'size', 'mode', 'hoverClass']);
const uiEvents = new Set(['onClick', 'onPress', 'onClose', 'onDismiss', 'onRequestClose']);
const iconTags = new Set(['FunctionalIcon', 'MaterialCommunityIcons', 'Ionicons', 'SeafoodImage']);
const modelPaths = new Set(['member.tier', 'member.referralCode', 'profile.name', 'profile.avatar', 'profile.buyerNo']);
const modelNames = new Set(['member', 'profile', 'hydrated', 'loggedIn']);
const themeNames = new Set(['colors', 'spacing', 'radius', 'typography', 'shadow', 'gradients']);
const projectUi = {
  Screen: ['src/components', 'src/components/layout', 'src/components/layout/Screen'],
  AppHeader: ['src/components', 'src/components/layout', 'src/components/layout/AppHeader'],
  AppBottomSheet: ['src/components', 'src/components/overlay', 'src/components/overlay/AppBottomSheet'],
  FunctionalIcon: ['miniapp/src/components/functional-icon'],
  SeafoodImage: ['miniapp/src/components/SeafoodImage'],
  ProfileAvatar: ['miniapp/src/components/profile-avatar'],
};

export function presentationSyntaxOnly(before, after, { platform = 'miniapp', routes = [], tabRoutes = [], filePath = '' } = {}) {
  const ts = frontendCompiler();
  const parse = (text) => ts.createSourceFile('frontend.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const oldFile = parse(before), newFile = parse(after);
  if (oldFile.parseDiagnostics.length || newFile.parseDiagnostics.length) return false;
  const registered = new Set(routes);
  const tabs = new Set(tabRoutes);
  const fingerprint = (file) => {
    const walk = (node, fn) => { fn(node); ts.forEachChild(node, (child) => { walk(child, fn); }); };
    const pathOf = (node) => ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? `${pathOf(node.expression)}.${node.name.text}` : '';
    const bindings = new Map(), imports = new Map(), declarations = [];
    const addBinding = (name) => {
      if (ts.isIdentifier(name)) bindings.set(name.text, (bindings.get(name.text) || 0) + 1);
      else if (ts.isArrayBindingPattern(name) || ts.isObjectBindingPattern(name)) {
        for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(element.name);
      }
    };
    walk(file, (node) => {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) { if (node.name) addBinding(node.name); }
      if (ts.isVariableDeclaration(node) && node.initializer && (node.parent.flags & ts.NodeFlags.Const)) declarations.push(node);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const module = node.moduleSpecifier.text, clause = node.importClause;
        if (clause?.name) { addBinding(clause.name); imports.set(clause.name.text, { module, original: 'default' }); }
        const named = clause?.namedBindings;
        if (named && ts.isNamespaceImport(named)) { addBinding(named.name); imports.set(named.name.text, { module, original: '*' }); }
        if (named && ts.isNamedImports(named)) for (const element of named.elements) {
          addBinding(element.name); imports.set(element.name.text, { module, original: element.propertyName?.text || element.name.text });
        }
      }
    });
    const imported = (name, module, original) => bindings.get(name) === 1 && imports.get(name)?.module === module && imports.get(name)?.original === original;
    const projectTag = (name) => {
      const binding = imports.get(name);
      if (!filePath || bindings.get(name) !== 1 || binding?.original !== name || !projectUi[name]) return false;
      const module = binding.module;
      const resolved = module.startsWith('@/') && platform === 'miniapp' ? 'miniapp/src/' + module.slice(2) : module.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(filePath), module)) : '';
      return projectUi[name].includes(resolved.replace(/\.(?:ts|tsx)$/, ''));
    };
    let globalBoolean = !bindings.has('Boolean');
    walk(file, (node) => { if (ts.isIdentifier(node) && node.text === 'Boolean' && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) globalBoolean = false; });
    const states = new Map(), handlers = new Map(), controllers = new Map(), routerBindings = new Set();
    let derived = new Set();
    const read = (node, extra = new Set()) => {
      if (!node) return true;
      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
      if (ts.isIdentifier(node)) return extra.has(node.text) || states.has(node.text) || derived.has(node.text) || modelNames.has(node.text) || node.text === 'undefined';
      if (ts.isPropertyAccessExpression(node)) {
        const value = pathOf(node), root = value.split('.')[0];
        return modelPaths.has(value) || ((themeNames.has(root) || derived.has(root)) && !sensitive.test(value));
      }
      if (ts.isParenthesizedExpression(node)) return read(node.expression, extra);
      if (ts.isPrefixUnaryExpression(node)) return node.operator === ts.SyntaxKind.ExclamationToken && read(node.operand, extra);
      if (ts.isBinaryExpression(node)) return [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind) && read(node.left, extra) && read(node.right, extra);
      if (ts.isConditionalExpression(node)) return read(node.condition, extra) && read(node.whenTrue, extra) && read(node.whenFalse, extra);
      if (ts.isCallExpression(node)) return globalBoolean && ts.isIdentifier(node.expression) && node.expression.text === 'Boolean' && node.arguments.length === 1 && read(node.arguments[0], extra);
      if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => read(span.expression, extra));
      return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
    };
    const styleValue = (node) => {
      if (!node) return false;
      let jsx = false; walk(node, (part) => { if (ts.isJsxElement(part) || ts.isJsxSelfClosingElement(part) || ts.isJsxFragment(part)) jsx = true; });
      if (jsx) return false;
      if (ts.isObjectLiteralExpression(node)) return node.properties.every((p) => ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && styleValue(p.initializer));
      if (ts.isArrayLiteralExpression(node)) return node.elements.every(styleValue);
      if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator)) return ts.isNumericLiteral(node.operand);
      return read(node);
    };
    const readonlyValue = (node) => {
      if (!node) return false;
      if (ts.isCallExpression(node) && pathOf(node.expression) === 'StyleSheet.create' && imported('StyleSheet', 'react-native', 'StyleSheet')) return node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0]) && styleValue(node.arguments[0]);
      if (!read(node)) return false;
      let jsx = false; walk(node, (part) => { if (ts.isJsxElement(part) || ts.isJsxSelfClosingElement(part) || ts.isJsxFragment(part)) jsx = true; });
      return !jsx;
    };
    const isExported = (node) => node.parent.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const insideComponent = (node) => {
      let owner = node.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      if (!owner) return false;
      const name = owner.name && ts.isIdentifier(owner.name) ? owner.name.text : ts.isVariableDeclaration(owner.parent) && ts.isIdentifier(owner.parent.name) ? owner.parent.name.text : '';
      if (!(/^[A-Z]/.test(name) || ts.isExportAssignment(owner.parent)) || !owner.body || !ts.isBlock(owner.body) || node.parent.parent.parent !== owner.body) return false;
      const statement = node.parent.parent;
      let returned = false;
      const checkReturn = (part) => {
        if (ts.isFunctionLike(part)) return;
        if (ts.isReturnStatement(part)) returned = true;
        ts.forEachChild(part, checkReturn);
      };
      for (const previous of owner.body.statements) { if (previous === statement) break; checkReturn(previous); }
      return !returned;
    };
    for (const node of declarations) {
      if (!insideComponent(node) || !ts.isArrayBindingPattern(node.name) || node.name.elements.length !== 2 || !ts.isCallExpression(node.initializer) || isExported(node)) continue;
      const [value, setter] = node.name.elements;
      if (![value, setter].every((e) => ts.isBindingElement(e) && ts.isIdentifier(e.name) && !e.dotDotDotToken && !e.initializer)) continue;
      const name = value.name.text, setterName = setter.name.text, call = node.initializer;
      const reactState = (ts.isIdentifier(call.expression) && imported(call.expression.text, 'react', 'useState')) || (pathOf(call.expression) === 'React.useState' && imported('React', 'react', 'default'));
      const initial = call.arguments[0];
      const literal = initial && (ts.isStringLiteral(initial) || ts.isNumericLiteral(initial) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(initial.kind));
      if (reactState && call.arguments.length === 1 && literal && bindings.get(name) === 1 && bindings.get(setterName) === 1 && uiStateName.test(name) && !sensitive.test(name + setterName)) states.set(name, { setter: setterName, node });
    }
    const routeAction = (node) => {
      if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false;
      const action = pathOf(node.expression);
      let route;
      if (platform === 'app' && action === 'router.push' && (imported('router', 'expo-router', 'router') || routerBindings.has('router')) && ts.isStringLiteral(node.arguments[0])) route = node.arguments[0].text;
      if (platform === 'miniapp' && ['Taro.navigateTo', 'Taro.switchTab'].includes(action) && imported('Taro', '@tarojs/taro', 'default') && ts.isObjectLiteralExpression(node.arguments[0])) {
        const props = node.arguments[0].properties;
        if (props.length === 1 && ts.isPropertyAssignment(props[0]) && props[0].name.getText(file) === 'url' && ts.isStringLiteral(props[0].initializer)) route = props[0].initializer.text;
      }
      if (platform === 'miniapp' && route && (action === 'Taro.switchTab' ? !tabs.has(route) : tabs.has(route))) return false;
      return Boolean(route && route.startsWith('/') && !/[?\[\]{}]|\.\./.test(route) && !sensitive.test(route) && registered.has(route));
    };
    for (const node of declarations) {
      if (insideComponent(node) && ts.isIdentifier(node.name) && node.name.text === 'router' && bindings.get('router') === 1 && !isExported(node) && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && imported(node.initializer.expression.text, 'expo-router', 'useRouter') && node.initializer.arguments.length === 0) { controllers.set('router', node); routerBindings.add('router'); }
    }
    const action = (node) => {
      if (ts.isParenthesizedExpression(node)) return action(node.expression);
      if (ts.isBlock(node)) return node.statements.length > 0 && node.statements.every((s) => ts.isExpressionStatement(s) && action(s.expression));
      if (!ts.isCallExpression(node)) return false;
      if (routeAction(node)) return true;
      if (!ts.isIdentifier(node.expression) || node.arguments.length !== 1) return false;
      const state = [...states.values()].find((s) => s.setter === node.expression.text);
      if (!state) return false;
      const value = node.arguments[0];
      if (ts.isStringLiteral(value) || ts.isNumericLiteral(value) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(value.kind)) return true;
      if (!ts.isArrowFunction(value) || value.parameters.length !== 1 || !ts.isIdentifier(value.parameters[0].name) || value.modifiers?.length) return false;
      let jsx = false; walk(value.body, (part) => { if (ts.isJsxElement(part) || ts.isJsxSelfClosingElement(part) || ts.isJsxFragment(part)) jsx = true; });
      return !jsx && read(value.body, new Set([value.parameters[0].name.text]));
    };
    const arrowAction = (node) => ts.isArrowFunction(node) && !node.modifiers?.length && node.parameters.length === 0 && action(node.body);
    for (const node of declarations) if (ts.isIdentifier(node.name) && bindings.get(node.name.text) === 1 && !isExported(node) && arrowAction(node.initializer)) handlers.set(node.name.text, node);
    const tagOf = (node) => node.tagName?.getText(file) || '';
    const primitiveTag = (tag) => {
      if (projectTag(tag)) return true;
      const parts = tag.split('.'), root = parts[0], binding = imports.get(root);
      if (parts.length === 2 && primitives.has(parts[1]) && bindings.get(root) === 1 && ((binding?.module === 'react-native' && binding.original === '*') || (binding?.module === 'react-native-reanimated' && binding.original === 'default' && root === 'Animated'))) return true;
      return !bindings.has(tag) ? primitives.has(tag) : bindings.get(tag) === 1 && ['react-native', '@tarojs/components'].includes(imports.get(tag)?.module) && primitives.has(imports.get(tag)?.original);
    };
    const displayAttributeBase = (attr) => {
      if (!ts.isJsxAttribute(attr)) return false;
      const name = attr.name.getText(file), tag = tagOf(attr.parent.parent);
      const icon = iconTags.has(tag) && (projectTag(tag) || imported(tag, '@expo/vector-icons', tag) || !bindings.has(tag));
      if (!(displayProps.has(name) && (primitiveTag(tag) || icon)) && !(name === 'name' && icon) && !(name === 'visible' && tag === 'Modal' && primitiveTag(tag)) && !(name === 'open' && tag === 'AppBottomSheet' && projectTag(tag))) return false;
      if (!attr.initializer || ts.isStringLiteral(attr.initializer)) return true;
      if (!ts.isJsxExpression(attr.initializer)) return false;
      return /style$/i.test(name) ? styleValue(attr.initializer.expression) : readonlyValue(attr.initializer.expression);
    };
    const uiAttributeBase = (attr) => ts.isJsxAttribute(attr) && primitiveTag(tagOf(attr.parent.parent)) && uiEvents.has(attr.name.getText(file)) && ts.isJsxExpression(attr.initializer) && (
      (ts.isIdentifier(attr.initializer.expression) && handlers.has(attr.initializer.expression.text)) || (attr.initializer.expression && arrowAction(attr.initializer.expression))
    );
    const hasBusinessJsx = (node) => {
      let business = false;
      walk(node, (part) => {
        if ((ts.isJsxOpeningElement(part) || ts.isJsxSelfClosingElement(part)) && !primitiveTag(tagOf(part))) business = true;
        if (ts.isJsxSpreadAttribute(part) || ts.isJsxAttribute(part) && !displayAttributeBase(part) && !uiAttributeBase(part)) business = true;
      });
      return business;
    };
    const attributeOwner = (attr) => ts.isJsxOpeningElement(attr.parent.parent) ? attr.parent.parent.parent : attr.parent.parent;
    const controlAttributes = new Set(['visible', 'open', 'className', 'style', 'contentStyle', 'contentContainerStyle']);
    const displayAttribute = (attr) => displayAttributeBase(attr) && !(controlAttributes.has(attr.name.getText(file)) && hasBusinessJsx(attributeOwner(attr)));
    const uiAttribute = (attr) => uiAttributeBase(attr) && !(attributeOwner(attr).children || []).some(hasBusinessJsx);
    const declarationContains = (node, name) => { let found = false; walk(node.name, (part) => { if (ts.isIdentifier(part) && part.text === name) found = true; }); return found; };
    const usageSafe = (name, stateRole = false) => {
      let safe = true;
      walk(file, (node) => {
        if (!ts.isIdentifier(node) || node.text !== name) return;
        const parent = node.parent;
        if ((ts.isBindingElement(parent) && parent.name === node) || (ts.isVariableDeclaration(parent) && parent.name === node) || (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isJsxAttribute(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node)) return;
        let cursor = node;
        while (cursor && !ts.isJsxAttribute(cursor) && !ts.isJsxExpression(cursor) && !ts.isVariableDeclaration(cursor)) cursor = cursor.parent;
        if (cursor && ts.isVariableDeclaration(cursor)) {
          if (declarationContains(cursor, name)) return;
          if (ts.isIdentifier(cursor.name) && ((derived.has(cursor.name.text) && readonlyValue(cursor.initializer)) || (handlers.has(cursor.name.text) && arrowAction(cursor.initializer)))) return;
        }
        if (cursor && ts.isJsxExpression(cursor)) {
          if (ts.isJsxAttribute(cursor.parent)) {
            if (displayAttribute(cursor.parent) && (stateRole !== 'value' || !hasBusinessJsx(attributeOwner(cursor.parent))) || uiAttribute(cursor.parent)) return;
          }
          else if (stateRole !== true && read(cursor.expression) && !hasBusinessJsx(cursor.expression)) return;
        }
        safe = false;
      });
      return safe;
    };
    // 固定点收敛：任何被查询、effect、存储或业务回调使用的 UI 状态都不能被忽略。
    for (let i = 0; i <= declarations.length; i++) for (const node of declarations) {
      if (ts.isIdentifier(node.name) && bindings.get(node.name.text) === 1 && !isExported(node) && !sensitiveDerived.test(node.name.text) && readonlyValue(node.initializer)) derived.add(node.name.text);
    }
    let removed;
    do {
      removed = false;
      for (const [name, state] of [...states]) if (!usageSafe(name, 'value') || !usageSafe(state.setter, true)) { states.delete(name); removed = true; }
      for (const name of [...controllers.keys()]) if (!usageSafe(name, true)) { controllers.delete(name); removed = true; }
      for (const [name, node] of [...handlers]) if (!arrowAction(node.initializer) || !usageSafe(name, true)) { handlers.delete(name); removed = true; }
      for (const name of [...derived]) if (!usageSafe(name)) { derived.delete(name); removed = true; }
    } while (removed);
    const ignoredImport = (node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !node.importClause) return null;
      const module = node.moduleSpecifier.text, clause = node.importClause;
      if (clause.namedBindings && !ts.isNamedImports(clause.namedBindings)) return null;
      const allowed = (name) => module === 'react' ? name === 'useState' : module === 'react-native' ? primitives.has(name) || name === 'StyleSheet' : module === '@tarojs/components' ? primitives.has(name) : module === 'expo-router' ? ['router', 'useRouter'].includes(name) : false;
      const kept = (clause.namedBindings?.elements || []).filter((s) => s.propertyName || !allowed(s.name.text) && !projectTag(s.name.text)).map((s) => [s.propertyName?.text, s.name.text, s.isTypeOnly]);
      const defaultName = clause.name && !(module === 'react' && clause.name.text === 'React') ? clause.name.text : null;
      return [module, clause.isTypeOnly, defaultName, kept];
    };
    const signature = (node) => {
      if (!node) return null;
      const importValue = ignoredImport(node);
      if (importValue) return importValue[2] || importValue[3].length ? ['import', importValue] : null;
      if (ts.isVariableStatement(node) && node.declarationList.declarations.every((d) => (
        ts.isIdentifier(d.name) && ((derived.has(d.name.text) && readonlyValue(d.initializer)) || (handlers.has(d.name.text) && arrowAction(d.initializer)) || controllers.get(d.name.text) === d)
      ) || [...states.values()].some((s) => s.node === d))) return null;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const props = (opening.attributes?.properties || []).flatMap((p) => ts.isJsxSpreadAttribute(p) ? [['spread', signature(p.expression)]] : displayAttribute(p) || uiAttribute(p) ? [] : [['prop', p.name.getText(file), signature(ts.isJsxExpression(p.initializer) ? p.initializer.expression : p.initializer)]]);
        const children = (node.children || []).flatMap((child) => { const value = signature(child); return value === null ? [] : value?.[0] === 'ui' ? value[1] : [value]; });
        const tag = tagOf(opening);
        // 保留业务事件之间的祖先关系；纯展示容器与仅本地 UI 事件不重跑后端。
        return props.length || (tag && !primitiveTag(tag)) ? ['jsx', tag, props, children] : children.length ? ['ui', children] : null;
      }
      if (ts.isJsxText(node)) return null;
      if (ts.isJsxExpression(node) && read(node.expression)) {
        const rendered = [];
        const collect = (part) => {
          if (ts.isJsxElement(part) || ts.isJsxSelfClosingElement(part) || ts.isJsxFragment(part)) { const value = signature(part); if (value) rendered.push(...(value[0] === 'ui' ? value[1] : [value])); return; }
          ts.forEachChild(part, (child) => { collect(child); });
        };
        if (node.expression) collect(node.expression);
        return rendered.length ? ['guarded-ui', signature(node.expression)] : null;
      }
      if (ts.isIdentifier(node)) return ['identifier', node.text];
      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.kind, node.text];
      const children = []; ts.forEachChild(node, (child) => { const value = signature(child); if (value !== null) children.push(value); });
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

export function miniappRouteConfig(config) {
  const ts = frontendCompiler(), file = ts.createSourceFile('config.ts', config, ts.ScriptTarget.Latest, true);
  const result = [], tabRoutes = [];
  const properties = (node) => ts.isObjectLiteralExpression(node) ? node.properties.filter(ts.isPropertyAssignment) : [];
  const field = (node, name) => properties(node).find((p) => p.name.getText(file) === name)?.initializer;
  const strings = (node) => node && ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteral) ? node.elements.map((e) => e.text) : [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineAppConfig' && node.arguments.length === 1) {
      const configObject = node.arguments[0];
      result.push(...strings(field(configObject, 'pages')).map((name) => '/' + name));
      const tabList = field(field(configObject, 'tabBar') || configObject, 'list');
      if (tabList && ts.isArrayLiteralExpression(tabList)) for (const item of tabList.elements) {
        const pagePath = field(item, 'pagePath');
        if (pagePath && ts.isStringLiteral(pagePath)) tabRoutes.push('/' + pagePath.text);
      }
      const packages = field(configObject, 'subPackages');
      if (packages && ts.isArrayLiteralExpression(packages)) for (const item of packages.elements) {
        const root = field(item, 'root');
        if (root && ts.isStringLiteral(root)) result.push(...strings(field(item, 'pages')).map((name) => '/' + root.text + '/' + name));
      }
    }
    ts.forEachChild(node, visit);
  };
  if (!file.parseDiagnostics.length) visit(file);
  return { routes: result, tabRoutes };
}
export const miniappRoutes = (config) => miniappRouteConfig(config).routes;
