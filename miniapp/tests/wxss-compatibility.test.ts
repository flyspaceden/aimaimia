import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function scssFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return scssFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.scss') ? [absolute] : [];
  });
}

describe('WeChat WXSS compatibility', () => {
  it('keeps Han characters out of CSS selectors', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const invalid = scssFiles(srcRoot).flatMap((file) => {
      const content = fs.readFileSync(file, 'utf8');
      return content.split('\n').flatMap((line, index) => {
        const selector = line.split('{', 1)[0];
        return /[\u3400-\u9fff]/u.test(selector)
          ? [`${path.relative(process.cwd(), file)}:${index + 1} ${selector.trim()}`]
          : [];
      });
    });
    expect(invalid).toEqual([]);
  });
});
