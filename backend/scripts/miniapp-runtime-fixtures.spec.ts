import {
  assertRuntimeFixtureEnvironment,
  buildRuntimeFixtureIds,
  databaseNameFromUrl,
  parseRuntimeFixtureArgs,
} from './miniapp-runtime-fixtures';

describe('miniapp runtime fixture safety', () => {
  it('extracts the exact database name', () => {
    expect(databaseNameFromUrl('postgresql://user:pass@127.0.0.1:5432/testaimaimai?schema=public')).toBe('testaimaimai');
  });

  it('rejects production and lookalike database names', () => {
    for (const database of ['aimaimai', 'testaimaimai_copy', 'prod_testaimaimai']) {
      expect(() => assertRuntimeFixtureEnvironment({
        databaseUrl: `postgresql://user:pass@localhost:5432/${database}`,
        expectedDatabase: 'testaimaimai',
        allow: 'staging',
        confirm: 'staging-miniapp-runtime-fixtures',
        userId: 'cmsn834hj0004t7ujed50l4t8',
        buyerNo: 'AIMM00000000000006',
      })).toThrow('只允许测试数据库');
    }
  });

  it('requires all three explicit safety gates', () => {
    const base = {
      databaseUrl: 'postgresql://user:pass@localhost:5432/testaimaimai',
      expectedDatabase: 'testaimaimai',
      allow: 'staging',
      confirm: 'staging-miniapp-runtime-fixtures',
      userId: 'cmsn834hj0004t7ujed50l4t8',
      buyerNo: 'AIMM00000000000006',
    };
    expect(() => assertRuntimeFixtureEnvironment({ ...base, allow: undefined })).toThrow('MINIAPP_RUNTIME_FIXTURE_ALLOW');
    expect(() => assertRuntimeFixtureEnvironment({ ...base, confirm: undefined })).toThrow('--confirm');
    expect(() => assertRuntimeFixtureEnvironment({ ...base, buyerNo: 'AIMM6' })).toThrow('--buyer-no');
  });

  it('builds stable, user-scoped cleanup identifiers', () => {
    const first = buildRuntimeFixtureIds('cmsn834hj0004t7ujed50l4t8');
    const again = buildRuntimeFixtureIds('cmsn834hj0004t7ujed50l4t8');
    const other = buildRuntimeFixtureIds('different-user-id');
    expect(first).toEqual(again);
    expect(first.prefix).not.toBe(other.prefix);
    expect(Object.values(first.orders)).toHaveLength(4);
    expect(new Set(Object.values(first.orders)).size).toBe(4);
  });

  it('rejects unsupported actions before connecting to a database', () => {
    const argv = process.argv;
    process.argv = ['node', 'script', '--action=drop-all'];
    try {
      expect(() => parseRuntimeFixtureArgs()).toThrow('create / cleanup / inspect');
    } finally {
      process.argv = argv;
    }
  });
});
