import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('digital asset v2 rules migration', () => {
  const migrationPath = join(
    process.cwd(),
    'prisma/migrations/20260617090000_digital_asset_v2_rules/migration.sql',
  );

  it('normalizes known seeded VIP package ids to the new price and seed-asset contract', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("'vpkg-001'");
    expect(sql).toContain("'vpkg-002'");
    expect(sql).toContain("'vpkg-003'");
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-001'[\s\S]*"price"\s*=\s*399/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-001'[\s\S]*"selfSeedAssetAmount"\s*=\s*1000/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-001'[\s\S]*"referralSeedAssetAmount"\s*=\s*2000/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-002'[\s\S]*"price"\s*=\s*699/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-002'[\s\S]*"selfSeedAssetAmount"\s*=\s*2000/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-002'[\s\S]*"referralSeedAssetAmount"\s*=\s*4000/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-003'[\s\S]*"price"\s*=\s*999/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-003'[\s\S]*"selfSeedAssetAmount"\s*=\s*3000/);
    expect(sql).toMatch(/"id"\s*=\s*'vpkg-003'[\s\S]*"referralSeedAssetAmount"\s*=\s*8000/);
  });

  it('keeps generic price-based backfills for non-seeded rows already on the new contract prices', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/WHERE\s+"price"\s*=\s*399/i);
    expect(sql).toMatch(/WHERE\s+"price"\s*=\s*699/i);
    expect(sql).toMatch(/WHERE\s+"price"\s*=\s*999/i);
  });
});
