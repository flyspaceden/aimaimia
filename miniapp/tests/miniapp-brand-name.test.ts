import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(absolute);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [absolute]
      : [];
  });
}

describe('AI爱买买 mini-program naming', () => {
  it('uses the approved name in project metadata and navigation', () => {
    const project = JSON.parse(fs.readFileSync(path.resolve('project.config.json'), 'utf8')) as {
      projectname: string;
      description: string;
    };
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      description: string;
    };
    const appConfig = fs.readFileSync(path.resolve('src/app.config.ts'), 'utf8');
    const homeConfig = fs.readFileSync(path.resolve('src/pages/home/index.config.ts'), 'utf8');

    expect(project.projectname).toBe('AI爱买买');
    expect(project.description).toBe('AI爱买买买家微信小程序');
    expect(packageJson.description).toBe('AI爱买买买家微信小程序');
    expect(appConfig).toContain("navigationBarTitleText: 'AI爱买买'");
    expect(homeConfig).toContain("navigationBarTitleText: 'AI爱买买'");
  });

  it('does not leave the old unprefixed product name on consumer surfaces', () => {
    const srcRoot = path.resolve('src');
    const legacyDomainFile = path.resolve('src/packages/community/utils.ts');
    const files = [
      ...sourceFiles(srcRoot).filter((file) => file !== legacyDomainFile),
      path.resolve('README.md'),
      path.resolve('scripts/verify-weapp-artifact.mjs'),
    ];
    const stale = files.flatMap((file) => fs.readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => /(?<!AI)爱买买/.test(line)
        ? [`${path.relative(process.cwd(), file)}:${index + 1}`]
        : []));

    expect(stale).toEqual([]);
  });
});
