import { readFileSync , globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TAB_BAR_PAGES = [
  '/pages/home/index',
  '/pages/products/index',
  '/pages/me/index',
] as const;

describe('WeChat navigation contracts', () => {
  it('only opens tabBar pages with switchTab', () => {
    const sourceFiles = globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() });
    const violations: string[] = [];

    for (const relativePath of sourceFiles) {
      const source = readFileSync(relativePath, 'utf8');
      for (const page of TAB_BAR_PAGES) {
        const invalidCall = new RegExp(`Taro\\.(?:navigateTo|redirectTo)\\(\\{\\s*url:\\s*['\"]${page}['\"]`, 'g');
        if (invalidCall.test(source)) violations.push(`${relativePath}: ${page}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('never sends PATCH because wx.request does not support it', () => {
    const sourceFiles = globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() });
    const source = sourceFiles.map((relativePath) => readFileSync(relativePath, 'utf8')).join('\n');
    expect(source).not.toMatch(/ApiClient\.patch|request<[^>]*>\([^)]*method:\s*['"]PATCH|request\(['"]PATCH/);
  });
});
