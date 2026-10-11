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
    const checks = read('../scripts/ci-frontend-checks.mjs');
    expect(workflow).toContain('miniapp-checks:');
    expect(workflow).toContain('CI_BUILD_ENVIRONMENT: ${{ inputs.environment }}');
    expect(workflow).toContain('--client miniapp');
    expect(checks).toContain("ref === 'refs/heads/main'");
    expect(checks).toContain("['refs/heads/staging', 'refs/heads/staging-next']");
    expect(checks).toContain("requested !== environment");
    expect(checks).toContain("MINIAPP_RELEASE_CHANNEL: environment");
    expect(checks).toContain("MINIAPP_RELEASE_BRANCH: process.env.GITHUB_REF_NAME");
    expect(checks).toContain("['run', 'verify:release-context']");
    expect(checks).toContain("buildSha !== mainTip");
    expect(workflow).not.toContain('matrix.environment');
  });
});
