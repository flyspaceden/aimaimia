import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EXCLUDED_APP_ROUTE_PREFIXES, PAGE_PARITY } from '@/features/page-parity';

function sourceRouteFiles(directory: string, repositoryRoot: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceRouteFiles(absolute, repositoryRoot);
    if (!entry.name.endsWith('.tsx') || entry.name.startsWith('_')) return [];
    return [path.relative(repositoryRoot, absolute).split(path.sep).join('/')];
  });
}

let registeredPages: string[] = [];

beforeAll(async () => {
  vi.stubGlobal('defineAppConfig', <T,>(config: T) => config);
  const config = (await import('../src/app.config')).default;
  registeredPages = [
    ...(config.pages || []),
    ...(config.subPackages || []).flatMap((pack) => (pack.pages || []).map((page) => `${pack.root}/${page}`)),
  ];
});

describe('App to mini program page parity manifest', () => {
  it('classifies every current App route exactly once or by the explicit delivery exclusion', () => {
    const repositoryRoot = path.resolve(process.cwd(), '..');
    const actual = sourceRouteFiles(path.join(repositoryRoot, 'app'), repositoryRoot);
    const classified = PAGE_PARITY.flatMap((group) => group.appFiles);
    const duplicates = classified.filter((file, index) => classified.indexOf(file) !== index);
    const unclassified = actual.filter((file) => !classified.includes(file)
      && !EXCLUDED_APP_ROUTE_PREFIXES.some((prefix) => file.startsWith(prefix)));
    const stale = classified.filter((file) => !actual.includes(file));
    expect(duplicates).toEqual([]);
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('registers every mapped mini page and keeps hidden App pages unregistered', () => {
    const required = PAGE_PARITY.flatMap((group) => group.miniPages);
    const missing = required.filter((page) => !registeredPages.includes(page));
    expect(missing).toEqual([]);
    expect(registeredPages).not.toContain('packages/ai/assistant/index');
    expect(registeredPages).not.toContain('packages/benefits/tasks/index');
    expect(registeredPages.some((page) => page.startsWith('packages/delivery/'))).toBe(false);
  });

  it('does not silently drop mapped pages from the filesystem', () => {
    const missingFiles = PAGE_PARITY.flatMap((group) => group.miniPages)
      .filter((page) => !fs.existsSync(path.resolve(process.cwd(), 'src', `${page}.tsx`)));
    expect(missingFiles).toEqual([]);
  });

  it('enables the matching WeChat page capability for every share hook', () => {
    const sourceRoot = path.resolve(process.cwd(), 'src');
    const pageFiles = sourceRouteFiles(sourceRoot, sourceRoot);
    const violations = pageFiles.flatMap((relativePage) => {
      const pagePath = path.join(sourceRoot, relativePage);
      const source = fs.readFileSync(pagePath, 'utf8');
      const requiredFlags = [
        ['useShareAppMessage', 'enableShareAppMessage'],
        ['useShareTimeline', 'enableShareTimeline'],
      ] as const;

      return requiredFlags.flatMap(([hook, flag]) => {
        if (!source.includes(hook)) return [];
        const configPath = pagePath.replace(/\.tsx$/, '.config.ts');
        const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
        const enabled = new RegExp(`${flag}\\s*:\\s*true`).test(config);
        return enabled ? [] : [`${relativePage}: missing ${flag}: true`];
      });
    });

    expect(violations).toEqual([]);
  });
});
