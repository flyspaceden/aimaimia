import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(process.cwd(), 'src');

function filesUnder(root: string, suffix: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path, suffix) : path.endsWith(suffix) ? [path] : [];
  });
}

function sourceBundle(suffix: string): string {
  return filesUnder(srcRoot, suffix).map((path) => readFileSync(path, 'utf8')).join('\n');
}

describe('mini-program UI guardrails', () => {
  it('does not use single Chinese characters as cart, microphone or search controls', () => {
    const tsx = sourceBundle('.tsx');
    expect(tsx).not.toMatch(/>\s*购\s*</u);
    expect(tsx).not.toMatch(/>\s*声\s*</u);
    expect(tsx).not.toContain('>⌕<');
  });

  it('keeps engineering transport terms out of consumer-facing TSX copy', () => {
    const tsx = sourceBundle('.tsx');
    expect(tsx).not.toMatch(/后端|服务端|JSAPI|轮询服务端|支付回调|回调或主动查询/u);
  });

  it('keeps shared functional icons based on WXSS rather than platform emoji', () => {
    const component = readFileSync(join(srcRoot, 'components/functional-icon.tsx'), 'utf8');
    expect(component).toContain("'cart'");
    expect(component).toContain("'microphone'");
    expect(component).toContain("'search'");
    expect(component).not.toMatch(/[🛒🎤🔍👑💰]/u);
  });
});
