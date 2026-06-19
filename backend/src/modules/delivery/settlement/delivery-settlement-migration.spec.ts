import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Task 11 settlement uniqueness migration', () => {
  it('blocks duplicate suborder settlements instead of deleting or rewriting financial history', () => {
    const migrationPath = resolve(
      __dirname,
      '../../../../prisma-delivery/migrations/20260619103000_task11_delivery_settlement_unique_suborder/migration.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('RAISE EXCEPTION');
    expect(sql).toContain('resolve duplicate DeliverySettlement rows manually');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "DeliverySettlement_subOrderId_key" ON "DeliverySettlement"("subOrderId")',
    );
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"DeliverySettlement"/);
    expect(sql).not.toMatch(/UPDATE\s+"DeliveryAuditLog"/);
  });
});
