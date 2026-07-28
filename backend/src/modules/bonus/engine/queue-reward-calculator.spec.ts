import { QueueRewardCalculator } from './queue-reward-calculator';

describe('QueueRewardCalculator', () => {
  const calculator = new QueueRewardCalculator();

  describe('大单完整单元拆分', () => {
    it.each([
      [8000, 1],
      [19900, 1],
      [20000, 1],
      [20100, 1],
      [39900, 1],
      [40000, 2],
      [45000, 2],
      [59900, 2],
      [60000, 3],
    ])('%i分产生%i个位置', (eligiblePaidCents, expected) => {
      expect(calculator.calculateUnitCount(eligiblePaidCents, 20000, 100)).toBe(
        expected,
      );
    });

    it('450元只产生两个位置，奖励池不因拆分放大', () => {
      expect(
        calculator.splitIntoUnitBudgets({
          eligiblePaidCents: 45000,
          profitCents: 15000,
          rewardPoolCents: 1500,
          splitUnitCents: 20000,
          maxUnitCount: 100,
        }),
      ).toEqual([
        { unitIndex: 0, profitCents: 7500, rewardPoolCents: 750 },
        { unitIndex: 1, profitCents: 7500, rewardPoolCents: 750 },
      ]);
    });

    it('最后一个单元承接分币尾差', () => {
      expect(
        calculator.splitIntoUnitBudgets({
          eligiblePaidCents: 60000,
          profitCents: 10000,
          rewardPoolCents: 1000,
          splitUnitCents: 20000,
          maxUnitCount: 100,
        }),
      ).toEqual([
        { unitIndex: 0, profitCents: 3333, rewardPoolCents: 333 },
        { unitIndex: 1, profitCents: 3333, rewardPoolCents: 333 },
        { unitIndex: 2, profitCents: 3334, rewardPoolCents: 334 },
      ]);
    });

    it('达到单笔订单位置上限后不再继续扩张', () => {
      expect(calculator.calculateUnitCount(6_000_000, 100, 100)).toBe(100);
      expect(
        calculator.splitIntoUnitBudgets({
          eligiblePaidCents: 6_000_000,
          profitCents: 1_000_000,
          rewardPoolCents: 100_000,
          splitUnitCents: 100,
          maxUnitCount: 100,
        }),
      ).toHaveLength(100);
    });
  });

  describe('平均分配', () => {
    it('暖场期按实际存在的位置分完整奖励池', () => {
      const result = calculator.distribute({
        rewardPoolCents: 1000,
        mode: 'AVERAGE',
        randomSeed: 'order-b:0',
        recipients: [
          {
            positionId: 'position-a',
            capGroupId: 'order-a',
            remainingCapCents: 10000,
          },
        ],
      });

      expect(result).toMatchObject({
        distributedCents: 1000,
        platformRetainedCents: 0,
      });
      expect(result.items).toEqual([
        expect.objectContaining({
          positionId: 'position-a',
          amountCents: 1000,
        }),
      ]);
    });

    it('最大余数与轮换顺序决定不足1分乘人数时的实际红包', () => {
      const recipients = ['a', 'b', 'c', 'd'].map((id) => ({
        positionId: id,
        capGroupId: `order-${id}`,
        remainingCapCents: 100,
      }));

      const first = calculator.distribute({
        rewardPoolCents: 2,
        mode: 'AVERAGE',
        randomSeed: 'tiny',
        rotationOffset: 0,
        recipients,
      });
      const rotated = calculator.distribute({
        rewardPoolCents: 2,
        mode: 'AVERAGE',
        randomSeed: 'tiny',
        rotationOffset: 1,
        recipients,
      });

      expect(first.items.map((item) => item.positionId)).toEqual(['a', 'b']);
      expect(rotated.items.map((item) => item.positionId)).toEqual(['b', 'c']);
      expect(first.tailRecipientPositionIds).toEqual(['a', 'b']);
      expect(rotated.tailRecipientPositionIds).toEqual(['b', 'c']);
      expect(first.items.every((item) => item.amountCents === 1)).toBe(true);
      expect(first.items).toHaveLength(2);
    });
  });

  describe('共享封顶与平台留存', () => {
    it('同一物理订单的两个位置共享剩余领取上限', () => {
      const result = calculator.distribute({
        rewardPoolCents: 1600,
        mode: 'AVERAGE',
        randomSeed: 'shared-cap',
        recipients: [
          {
            positionId: 'g1',
            capGroupId: 'order-g',
            remainingCapCents: 1000,
          },
          {
            positionId: 'g2',
            capGroupId: 'order-g',
            remainingCapCents: 1000,
          },
        ],
      });

      expect(result.distributedCents).toBe(1000);
      expect(result.platformRetainedCents).toBe(600);
      expect(
        result.items.reduce((sum, item) => sum + item.amountCents, 0),
      ).toBe(1000);
    });

    it('临近封顶的溢出重新分给其他未封顶订单', () => {
      const result = calculator.distribute({
        rewardPoolCents: 1000,
        mode: 'AVERAGE',
        randomSeed: 'redistribute-cap',
        recipients: [
          {
            positionId: 'a',
            capGroupId: 'order-a',
            remainingCapCents: 100,
          },
          {
            positionId: 'b',
            capGroupId: 'order-b',
            remainingCapCents: 10000,
          },
          {
            positionId: 'c',
            capGroupId: 'order-c',
            remainingCapCents: 10000,
          },
          {
            positionId: 'd',
            capGroupId: 'order-d',
            remainingCapCents: 10000,
          },
        ],
      });

      expect(
        Object.fromEntries(
          result.items.map((item) => [item.positionId, item.amountCents]),
        ),
      ).toEqual({ a: 100, b: 300, c: 300, d: 300 });
      expect(result.platformRetainedCents).toBe(0);
    });

    it('无人或全部封顶时名义奖励池全部留在平台', () => {
      expect(
        calculator.distribute({
          rewardPoolCents: 1000,
          mode: 'AVERAGE',
          randomSeed: 'none',
          recipients: [],
        }),
      ).toEqual({
        items: [],
        distributedCents: 0,
        platformRetainedCents: 1000,
        tailRecipientPositionIds: [],
        randomSeed: 'none',
      });
    });
  });

  describe('正态随机', () => {
    it('相同种子可重放且金额严格守恒', () => {
      const input = {
        rewardPoolCents: 1000,
        mode: 'NORMAL_RANDOM' as const,
        randomSeed: 'order-x:unit-0',
        randomConfig: {
          stddev: 0.25,
          minFactor: 1,
          maxFactor: 1,
        },
        recipients: ['a', 'b', 'c', 'd'].map((id) => ({
          positionId: id,
          capGroupId: `order-${id}`,
          remainingCapCents: 10000,
        })),
      };

      const first = calculator.distribute(input);
      const replay = calculator.distribute(input);

      expect(replay).toEqual(first);
      expect(first.distributedCents + first.platformRetainedCents).toBe(1000);
      expect(first.items.every((item) => item.amountCents > 0)).toBe(true);
      expect(first.items.every((item) => item.clampedWeight === 1)).toBe(true);
      expect(
        first.items.reduce((sum, item) => sum + item.normalizedWeight, 0),
      ).toBeCloseTo(1);
      expect(
        first.items.some(
          (item) => item.preClampWeight !== item.clampedWeight,
        ),
      ).toBe(true);
    });
  });

  describe('参数保护', () => {
    it('拒绝非整数分和非法随机参数', () => {
      expect(() => calculator.calculateUnitCount(100.5, 20000, 100)).toThrow(
        'eligiblePaidCents',
      );
      expect(() =>
        calculator.distribute({
          rewardPoolCents: 100,
          mode: 'NORMAL_RANDOM',
          randomSeed: 'invalid',
          randomConfig: {
            stddev: -1,
            minFactor: 0.5,
            maxFactor: 1.5,
          },
          recipients: [
            {
              positionId: 'a',
              capGroupId: 'order-a',
              remainingCapCents: 100,
            },
          ],
        }),
      ).toThrow('正态随机参数不合法');
    });

    it.each([
      {
        stddev: Number.NaN,
        minFactor: 0.5,
        maxFactor: 1.5,
      },
      {
        stddev: Number.POSITIVE_INFINITY,
        minFactor: 0.5,
        maxFactor: 1.5,
      },
      {
        stddev: 0.25,
        minFactor: Number.NaN,
        maxFactor: 1.5,
      },
      {
        stddev: 0.25,
        minFactor: 0.5,
        maxFactor: Number.POSITIVE_INFINITY,
      },
    ])('拒绝 NaN/Infinity 随机参数 %#', (randomConfig) => {
      expect(() =>
        calculator.distribute({
          rewardPoolCents: 100,
          mode: 'NORMAL_RANDOM',
          randomSeed: 'invalid-non-finite',
          randomConfig,
          recipients: [
            {
              positionId: 'a',
              capGroupId: 'order-a',
              remainingCapCents: 100,
            },
          ],
        }),
      ).toThrow('正态随机参数不合法');
    });

    it('拒绝同一共享封顶组传入不同剩余额度', () => {
      expect(() =>
        calculator.distribute({
          rewardPoolCents: 100,
          mode: 'AVERAGE',
          randomSeed: 'bad-cap',
          recipients: [
            {
              positionId: 'a',
              capGroupId: 'same-order',
              remainingCapCents: 100,
            },
            {
              positionId: 'b',
              capGroupId: 'same-order',
              remainingCapCents: 99,
            },
          ],
        }),
      ).toThrow('剩余额度不一致');
    });
  });
});
