import { readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('delivery Prisma migration order', () => {
  it('runs the base delivery schema before incremental migrations', () => {
    const migrationsDir = join(__dirname, 'migrations');
    const migrations = readdirSync(migrationsDir)
      .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
      .sort();

    expect(migrations[0]).toBe('20260619010000_init_delivery');
  });
});
