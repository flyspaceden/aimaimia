import { readFileSync } from 'fs';
import { join } from 'path';

describe('GroupBuyReferral candidate sequence index', () => {
  const backendRoot = process.cwd();

  it('does not model candidateSequence as a global Prisma unique constraint', () => {
    const schema = readFileSync(join(backendRoot, 'prisma/schema.prisma'), 'utf8');

    expect(schema).not.toContain('@@unique([instanceId, candidateSequence])');
  });

  it('uses a partial unique index only for referral statuses that occupy a slot', () => {
    const migration = readFileSync(
      join(
        backendRoot,
        'prisma/migrations/20260623043000_group_buy_referral_active_sequence_partial_unique/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('DROP INDEX IF EXISTS "GroupBuyReferral_instanceId_candidateSequence_key"');
    expect(migration).toMatch(/WHERE[\s\S]*"status" IN \(/);
    expect(migration).toContain("'CANDIDATE'");
    expect(migration).toContain("'VALID'");
  });
});
