import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('direct referral config migration', () => {
  const migrationPath = join(
    process.cwd(),
    'prisma/migrations/20260705011000_direct_referral_config/migration.sql',
  );

  it('does not mutate existing normal ratio rows', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).not.toContain('platform_update');
    expect(sql).not.toMatch(/UPDATE\s+"RuleConfig"[\s\S]*NORMAL_PLATFORM_PERCENT/i);
  });

  it('inserts zero direct referral when any normal ratio row already exists', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/has_normal_ratio/i);
    expect(sql).toMatch(/CASE[\s\S]*WHEN\s+has_normal_ratio[\s\S]*THEN\s+0[\s\S]*ELSE\s+0\.01/i);
  });
});
