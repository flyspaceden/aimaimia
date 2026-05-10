import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShippingRuleService } from './shipping-rule.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';

function makeRule(overrides: Record<string, any> = {}) {
  return {
    id: 'rule-001',
    name: '广东默认',
    regionCodes: ['440000'],
    minAmount: null,
    maxAmount: null,
    minWeight: null,
    maxWeight: null,
    fee: 0,
    firstWeightKg: 3,
    firstFee: 9.1,
    additionalWeightKg: 1,
    additionalFee: 1.3,
    minChargeWeightKg: 1,
    priority: 100,
    isActive: true,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

function createMocks(rules: any[] = []) {
  const prisma: any = {
    shippingRule: {
      findMany: jest.fn().mockResolvedValue(rules),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const bonusConfig = {
    getSystemConfig: jest.fn().mockResolvedValue({
      defaultShippingFee: 12,
    }),
  };

  const cache = {
    getActiveRules: jest.fn().mockResolvedValue(null),
    setActiveRules: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ShippingRuleService(
    prisma as any,
    bonusConfig as any,
    cache as any,
  );

  return { service, prisma, bonusConfig, cache };
}

describe('ShippingRuleService 运费计算引擎', () => {
  it('广东 3kg 内命中首重价', async () => {
    const { service } = createMocks([makeRule()]);

    const detail = await service.calculateShippingDetail(99, '440300', 3000);

    expect(detail).toMatchObject({
      fee: 9.1,
      matchedRuleId: 'rule-001',
      matchedRuleName: '广东默认',
      billingWeightKg: 3,
      fallbackUsed: false,
    });
    expect(detail.formula).toBe('9.1 = 9.1');
  });

  it('广东 4.2kg 按整数克计算为首重价 + 2 个续重', async () => {
    const { service } = createMocks([makeRule()]);

    const detail = await service.calculateShippingDetail(99, '440300', 4200);

    expect(detail.fee).toBe(11.7);
    expect(detail.billingWeightKg).toBe(4.2);
    expect(detail.formula).toBe(
      '9.1 + ceil((4200g - 3000g) / 1000g) * 1.3 = 11.7',
    );
  });

  it('同 priority 多条规则按 id 升序稳定命中', async () => {
    const { service } = createMocks([
      makeRule({ id: 'rule-b', name: 'B 规则' }),
      makeRule({ id: 'rule-a', name: 'A 规则' }),
    ]);

    const detail = await service.calculateShippingDetail(99, '440300', 3000);

    expect(detail.matchedRuleId).toBe('rule-a');
    expect(detail.matchedRuleName).toBe('A 规则');
  });

  it('全国 priority=100 高于广东 priority=50 时全国命中', async () => {
    const { service } = createMocks([
      makeRule({ id: 'gd', name: '广东规则', regionCodes: ['440000'], priority: 50 }),
      makeRule({ id: 'cn', name: '全国覆盖', regionCodes: [], priority: 100 }),
    ]);

    const detail = await service.calculateShippingDetail(99, '440300', 3000);

    expect(detail.matchedRuleId).toBe('cn');
    expect(detail.matchedRuleName).toBe('全国覆盖');
  });

  it('广东 priority=100 高于全国 priority=50 时广东命中', async () => {
    const { service } = createMocks([
      makeRule({ id: 'cn', name: '全国默认', regionCodes: [], priority: 50 }),
      makeRule({ id: 'gd', name: '广东覆盖', regionCodes: ['440000'], priority: 100 }),
    ]);

    const detail = await service.calculateShippingDetail(99, '440300', 3000);

    expect(detail.matchedRuleId).toBe('gd');
    expect(detail.matchedRuleName).toBe('广东覆盖');
  });

  it('含赠品 SKU 时使用调用方传入的合计重量计算', async () => {
    const { service } = createMocks([makeRule()]);

    const detail = await service.calculateShippingDetail(99, '440300', 5100);

    expect(detail.fee).toBe(13);
    expect(detail.billingWeightKg).toBe(5.1);
    expect(detail.formula).toBe(
      '9.1 + ceil((5100g - 3000g) / 1000g) * 1.3 = 13',
    );
  });

  it('无规则命中时返回默认运费并标记 fallbackUsed', async () => {
    const { service, bonusConfig } = createMocks([
      makeRule({ id: 'gd', regionCodes: ['440000'] }),
    ]);

    const detail = await service.calculateShippingDetail(99, '110000', 500);

    expect(detail).toMatchObject({
      fee: 12,
      matchedRuleId: null,
      matchedRuleName: null,
      billingWeightKg: 1,
      formula: 'fallback DEFAULT_SHIPPING_FEE = 12',
      fallbackUsed: true,
    });
    expect(bonusConfig.getSystemConfig).toHaveBeenCalledTimes(1);
  });

  it('缓存命中跳过 DB 查询', async () => {
    const { service, prisma, cache } = createMocks([]);
    cache.getActiveRules.mockResolvedValue([makeRule()]);

    const detail = await service.calculateShippingDetail(99, '440300', 3000);

    expect(detail.fee).toBe(9.1);
    expect(prisma.shippingRule.findMany).not.toHaveBeenCalled();
    expect(cache.setActiveRules).not.toHaveBeenCalled();
  });

  it('缓存 miss 查询 DB 并写入缓存', async () => {
    const { service, prisma, cache } = createMocks([makeRule()]);

    await service.calculateShippingDetail(99, '440300', 3000);

    expect(prisma.shippingRule.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
    expect(cache.setActiveRules).toHaveBeenCalledWith([makeRule()]);
  });

  it('事务内计算只使用 tx 查询且不读写共享缓存', async () => {
    const { service, prisma, cache } = createMocks([]);
    cache.getActiveRules.mockResolvedValue([makeRule({ id: 'cached-rule' })]);
    const tx: any = {
      shippingRule: {
        findMany: jest.fn().mockResolvedValue([
          makeRule({ id: 'tx-rule', name: '事务规则' }),
        ]),
      },
    };

    const detail = await service.calculateShippingDetail(
      99,
      '440300',
      3000,
      tx,
    );

    expect(detail.matchedRuleId).toBe('tx-rule');
    expect(prisma.shippingRule.findMany).not.toHaveBeenCalled();
    expect(cache.getActiveRules).not.toHaveBeenCalled();
    expect(cache.setActiveRules).not.toHaveBeenCalled();
    expect(tx.shippingRule.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
  });

  it('匹配规则的 additionalWeightKg 为 0 时抛出配置错误', async () => {
    const { service } = createMocks([
      makeRule({ name: '错误续重规则', additionalWeightKg: 0 }),
    ]);

    await expect(
      service.calculateShippingDetail(99, '440300', 4200),
    ).rejects.toThrow('运费规则「错误续重规则」配置无效');
  });

  it('匹配规则存在负数费用时抛出配置错误', async () => {
    const { service } = createMocks([
      makeRule({ name: '错误费用规则', additionalFee: -1 }),
    ]);

    await expect(
      service.calculateShippingDetail(99, '440300', 4200),
    ).rejects.toThrow('运费规则「错误费用规则」配置无效');
  });

  it('写操作后清空缓存', async () => {
    const { service, prisma, cache } = createMocks([]);
    const existing = makeRule();
    prisma.shippingRule.findUnique.mockResolvedValue(existing);
    prisma.shippingRule.update.mockResolvedValue({ ...existing, name: '更新后' });

    await service.update('rule-001', { name: '更新后' });

    expect(cache.invalidate).toHaveBeenCalledTimes(1);
  });

  it('create 直接调用时拒绝 additionalWeightKg 为 0 且不写 DB', async () => {
    const { service, prisma } = createMocks([]);

    await expect(
      service.create({
        name: '错误续重规则',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 0,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
      } as any),
    ).rejects.toThrow('运费规则「错误续重规则」配置无效');

    expect(prisma.shippingRule.create).not.toHaveBeenCalled();
  });

  it('update 直接调用时拒绝负数续重费用且不写 DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(makeRule());

    await expect(
      service.update('rule-001', { additionalFee: -1 } as any),
    ).rejects.toThrow('运费规则「广东默认」配置无效');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('deactivate invalid active rule does not validate formula and writes update', async () => {
    const { service, prisma, cache } = createMocks([]);
    const invalidRule = makeRule({ firstFee: 0, isActive: true });
    prisma.shippingRule.findUnique.mockResolvedValue(invalidRule);
    prisma.shippingRule.update.mockResolvedValue({ ...invalidRule, isActive: false });

    const result = await service.update('rule-001', { isActive: false } as any);

    expect(prisma.shippingRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-001' },
      data: { isActive: false },
    });
    expect(result.isActive).toBe(false);
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
  });

  it('deactivate active rule with existing invalid amount bounds writes status-only update', async () => {
    const { service, prisma, cache } = createMocks([]);
    const invalidRule = makeRule({
      minAmount: 100,
      maxAmount: 100,
      isActive: true,
    });
    prisma.shippingRule.findUnique.mockResolvedValue(invalidRule);
    prisma.shippingRule.update.mockResolvedValue({ ...invalidRule, isActive: false });

    const result = await service.update('rule-001', { isActive: false } as any);

    expect(prisma.shippingRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-001' },
      data: { isActive: false },
    });
    expect(result.isActive).toBe(false);
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
  });

  it('keeping active rule rejects existing invalid amount bounds and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(
      makeRule({ minAmount: 100, maxAmount: 100, isActive: true }),
    );

    await expect(
      service.update('rule-001', { name: '仍然启用' } as any),
    ).rejects.toThrow('金额下限必须小于上限');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('deactivate rejects explicitly provided invalid amount bounds and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(makeRule());

    await expect(
      service.update('rule-001', {
        isActive: false,
        minAmount: 100,
        maxAmount: 100,
      } as any),
    ).rejects.toThrow('金额下限必须小于上限');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('deactivate rejects partial amount update that makes effective bounds invalid and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(
      makeRule({ minAmount: 100, maxAmount: 200 }),
    );

    await expect(
      service.update('rule-001', { isActive: false, maxAmount: 50 } as any),
    ).rejects.toThrow('金额下限必须小于上限');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('deactivate rejects partial weight update that makes effective bounds invalid and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(
      makeRule({ minWeight: 1000, maxWeight: 2000 }),
    );

    await expect(
      service.update('rule-001', { isActive: false, maxWeight: 0.5 } as any),
    ).rejects.toThrow('重量下限必须小于上限');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('deactivate rejects explicitly provided negative fee and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(makeRule());

    await expect(
      service.update('rule-001', { isActive: false, fee: -1 } as any),
    ).rejects.toThrow('运费不能为负数');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('deactivate rejects explicitly provided invalid firstFee and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(makeRule());

    await expect(
      service.update('rule-001', { isActive: false, firstFee: -1 } as any),
    ).rejects.toThrow('运费规则「广东默认」配置无效');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('deactivate rejects explicitly provided invalid additionalWeightKg and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(makeRule());

    await expect(
      service.update('rule-001', {
        isActive: false,
        additionalWeightKg: 0,
      } as any),
    ).rejects.toThrow('运费规则「广东默认」配置无效');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('keeping invalid rule active still rejects and does not write DB', async () => {
    const { service, prisma } = createMocks([]);
    prisma.shippingRule.findUnique.mockResolvedValue(
      makeRule({ firstFee: 0, isActive: true }),
    );

    await expect(
      service.update('rule-001', { name: '仍然启用' } as any),
    ).rejects.toThrow('运费规则「仍然启用」配置无效');

    expect(prisma.shippingRule.update).not.toHaveBeenCalled();
  });

  it('partial update with existing valid formula still works', async () => {
    const { service, prisma } = createMocks([]);
    const existing = makeRule({ priority: 10 });
    prisma.shippingRule.findUnique.mockResolvedValue(existing);
    prisma.shippingRule.update.mockResolvedValue({ ...existing, priority: 20 });

    const result = await service.update('rule-001', { priority: 20 } as any);

    expect(prisma.shippingRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-001' },
      data: { priority: 20 },
    });
    expect(result.priority).toBe(20);
  });
});

describe('CreateShippingRuleDto 运费公式校验', () => {
  async function validateCreateDto(payload: Record<string, unknown>) {
    return validate(plainToInstance(CreateShippingRuleDto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  const validPayload = {
    name: '全国默认',
    regionCodes: [],
    fee: 9.1,
    firstWeightKg: 3,
    firstFee: 9.1,
    additionalWeightKg: 1,
    additionalFee: 1.3,
    minChargeWeightKg: 1,
  };

  it('拒绝 firstFee 为 0 的新建请求', async () => {
    const errors = await validateCreateDto({ ...validPayload, firstFee: 0 });

    expect(errors.some((error) => error.property === 'firstFee')).toBe(true);
  });

  it('接受完整有效的运费公式字段', async () => {
    const errors = await validateCreateDto(validPayload);

    expect(errors).toEqual([]);
  });
});
