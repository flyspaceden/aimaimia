import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const distRoot = path.resolve(projectRoot, 'dist');

assert.equal(packageJson.name, '@aimai/buyer-miniapp', '只能清理微信小程序工程的生成产物');
assert.equal(path.dirname(distRoot), projectRoot, 'dist 必须直属于微信小程序工程');
assert.equal(path.basename(distRoot), 'dist', '只允许清理 miniapp/dist');

fs.rmSync(distRoot, { recursive: true, force: true });
console.log('已清理旧微信小程序 dist 产物');
