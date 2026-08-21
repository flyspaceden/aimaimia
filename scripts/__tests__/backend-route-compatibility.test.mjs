import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const sourceRoot = path.join(root, 'backend/src');
const baseline = JSON.parse(
  await readFile(new URL('./main-backend-route-baseline.json', import.meta.url), 'utf8'),
);

async function controllerFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(absolute);
    return entry.name.endsWith('.controller.ts') ? [absolute] : [];
  }));
  return nested.flat();
}

function normalizePart(value = '') {
  return value.replace(/^\/+|\/+$/g, '');
}

async function currentRoutes() {
  const routes = [];
  for (const file of await controllerFiles(sourceRoot)) {
    const source = await readFile(file, 'utf8');
    const controllerBlocks = source
      .split(/(?=@Controller\()/)
      .filter((block) => block.startsWith('@Controller('));
    assert.ok(controllerBlocks.length > 0, `Unparsed @Controller in ${path.relative(root, file)}`);
    for (const block of controllerBlocks) {
      const controller = block.match(/^@Controller\(\s*(['"`])([^'"`]+)\1\s*\)/m);
      assert.ok(controller, `Unparsed @Controller in ${path.relative(root, file)}`);
      const base = normalizePart(controller[2]);
      const method = /@(Get|Post|Put|Patch|Delete)\(\s*(?:(['"`])([^'"`]+)\2)?\s*\)/g;
      for (const match of block.matchAll(method)) {
        const subPath = normalizePart(match[3]);
        routes.push(`${match[1].toUpperCase()} /${[base, subPath].filter(Boolean).join('/')}`);
      }
    }
  }
  return new Set(routes);
}

const routes = await currentRoutes();

test('all origin/main backend HTTP routes remain available', () => {
  const missing = baseline.filter((route) => !routes.has(route));
  assert.deepEqual(missing, []);
});

test('mini-program routes are additive and independent Delivery routes are absent', () => {
  for (const route of [
    'POST /auth/oauth/wechat-miniapp',
    'POST /orders/checkout/mini-program',
    'POST /orders/vip-checkout/mini-program',
    'POST /group-buy/checkout/mini-program',
    'GET /orders/:id/pickup-pass',
    'GET /orders/pickup-points',
    'POST /mini-program/codes',
    'GET /mini-program/subscriptions/templates',
    'POST /seller/orders/:id/pickup/ready',
    'POST /seller/orders/:id/pickup/verify',
    'POST /admin/pickup-points',
  ]) {
    assert.ok(routes.has(route), `Required additive route missing: ${route}`);
  }

  for (const route of routes) {
    assert.doesNotMatch(route, /(^|\/)delivery(?:\/|$)|delivery-admin|delivery-seller/i);
  }
});
