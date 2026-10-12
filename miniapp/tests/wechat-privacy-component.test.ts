import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(file) && !file.endsWith('.test.ts') ? [file] : [];
  });
}

describe('WeChat native privacy authorization', () => {
  it('does not intercept native consent with an invisible app-level dialog', () => {
    // Taro App 同级视图无法渲染；注册监听会让微信停等不可见的同意按钮。
    const sources = sourceFiles(path.resolve('src'));
    const interceptors = sources.filter((file) =>
      /\bonNeedPrivacyAuthorization\s*\(/.test(readFileSync(file, 'utf8')),
    );
    expect(interceptors).toEqual([]);
  });
});
