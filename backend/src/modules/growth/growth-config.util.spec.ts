import {
  isGrowthEnabled,
  readGrowthConfigInt,
} from './growth-config.util';

describe('growth config utilities', () => {
  it('unwraps RuleConfig JSON objects written by seed and admin pages', async () => {
    const client: any = {
      ruleConfig: {
        findUnique: jest.fn(({ where }: any) => {
          const configs: Record<string, unknown> = {
            GROWTH_ENABLED: { value: true, description: '是否启用成长体系' },
            GROWTH_DAILY_POINTS_CAP: { value: 300, description: '每日积分上限' },
          };
          return Promise.resolve({ key: where.key, value: configs[where.key] });
        }),
      },
    };

    await expect(isGrowthEnabled(client)).resolves.toBe(true);
    await expect(readGrowthConfigInt(client, 'GROWTH_DAILY_POINTS_CAP', 0)).resolves.toBe(300);
  });
});
