import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('SF style shipping pricing migrations', () => {
  const migrationPath = join(
    process.cwd(),
    'prisma/migrations/20260510180000_fix_sf_shipping_additional_fee/migration.sql',
  );
  const referenceBackfillPath = join(
    process.cwd(),
    'prisma/migrations/20260510170000_sf_style_shipping_pricing/data-backfill.sql',
  );

  it('ships a follow-up migration that fixes active zero additionalFee rules', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("'sr-002'");
    expect(sql).toContain("'sr-003'");
    expect(sql).toContain("'sr-004'");
    expect(sql).toMatch(/"additionalFee"\s*=\s*CASE/);
    expect(sql).toMatch(/"isActive"\s*=\s*true/);
    expect(sql).toMatch(/"additionalFee"\s+IS\s+NULL/i);
    expect(sql).toMatch(/"additionalFee"\s*=\s*0/);
  });

  it('keeps the reference backfill aligned with known seed continued-weight prices', () => {
    const sql = readFileSync(referenceBackfillPath, 'utf8');

    expect(sql).toContain("'sr-002'");
    expect(sql).toContain("'sr-003'");
    expect(sql).toContain("'sr-004'");
    expect(sql).toContain('THEN 1.3');
    expect(sql).toContain('THEN 5.1');
    expect(sql).toContain('THEN 7.1');
  });
});
