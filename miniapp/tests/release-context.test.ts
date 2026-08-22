import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('mini-program release source guard', () => {
  it('maps production to origin/main and staging to origin/staging', () => {
    const source = read('scripts/verify-release-context.mjs');

    expect(source).toContain("requestedBranch || 'staging'");
    expect(source).toContain("!['staging', 'staging-next'].includes(targetBranch)");
    expect(source).toContain("production 只允许从 main 生成正式产物");
    expect(source).toContain('const originRef = `origin/${targetBranch}`');
    expect(source).toContain('MINIAPP_RELEASE_CHANNEL=staging 或 production');
    expect(source).toContain('headFull !== originFull');
    expect(source).toContain('必须与 ${originRef} 完全一致');
    expect(source).not.toContain("merge-base', '--is-ancestor");
    expect(source).not.toContain("git(['fetch', '--quiet', 'origin', 'staging']");
  });

  it('exposes explicit channel commands and checks the matching pushed branch in CI', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const workflow = read('../.github/workflows/miniapp-ci.yml');

    expect(packageJson.scripts['verify:release-context:staging']).toContain(
      'MINIAPP_RELEASE_CHANNEL=staging',
    );
    expect(packageJson.scripts['verify:release-context:production']).toContain(
      'MINIAPP_RELEASE_CHANNEL=production',
    );
    expect(workflow).toContain("(github.event_name == 'push' && github.ref == 'refs/heads/main')");
    expect(workflow).toContain("github.ref == 'refs/heads/staging-next'");
    expect(workflow).toContain("inputs.environment == 'production'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("inputs.environment == 'staging'");
    expect(workflow).toContain("github.ref == 'refs/heads/staging'");
    expect(workflow).toContain('MINIAPP_RELEASE_BRANCH: ${{ github.ref_name }}');
    expect(workflow).toContain('build-production:');
    expect(workflow).toContain('MINIAPP_RELEASE_CHANNEL: production');
    expect(workflow).toContain('build-staging:');
    expect(workflow).toContain('MINIAPP_RELEASE_CHANNEL: staging');
    expect(workflow).not.toContain('matrix.environment');
  });
});
