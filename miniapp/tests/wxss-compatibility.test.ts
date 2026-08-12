import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function filesWithExtension(root: string, extension: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return filesWithExtension(absolute, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [absolute] : [];
  });
}

describe('WeChat WXSS compatibility', () => {
  it('keeps Han characters out of CSS selectors', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const invalid = filesWithExtension(srcRoot, '.scss').flatMap((file) => {
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

  it('removes the Taro ScrollView padding attribute that WebView rendering does not support', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const fixer = fs.readFileSync(path.resolve(process.cwd(), 'scripts/fix-weapp-template.mjs'), 'utf8');
    const verifier = fs.readFileSync(path.resolve(process.cwd(), 'scripts/verify-weapp-artifact.mjs'), 'utf8');
    const tsx = filesWithExtension(path.resolve(process.cwd(), 'src'), '.tsx')
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');

    expect(packageJson.scripts['build:staging']).toContain('node scripts/fix-weapp-template.mjs');
    expect(packageJson.scripts['build:production']).toContain('node scripts/fix-weapp-template.mjs');
    expect(fixer).toContain("const unsupportedPadding = ' padding=\"{{i.p12||[0,0,0,0]}}\"'");
    expect(fixer).toContain('fs.writeFileSync(baseTemplatePath, compatibleSource)');
    expect(verifier).toContain('/<scroll-view[^>]*\\spadding=/');
    expect(tsx).not.toMatch(/<ScrollView[^>]*\spadding=/su);
  });

  it('allows users to select and copy long legal text', () => {
    const legalPage = fs.readFileSync(
      path.resolve(process.cwd(), 'src/packages/account/account-legal/index.tsx'),
      'utf8',
    );
    const memberAgreement = fs.readFileSync(
      path.resolve(process.cwd(), 'src/packages/benefits/member-agreement/index.tsx'),
      'utf8',
    );

    expect(legalPage).toMatch(/account-legal-summary__text[^>]*userSelect/);
    expect(legalPage).toMatch(/blockClassName\(block\)[^>]*userSelect/);
    expect(memberAgreement).toMatch(/member-agreement-summary__text[^>]*userSelect/);
    expect(memberAgreement).toMatch(/blockClassName\(block\)[^>]*userSelect/);
  });
});
