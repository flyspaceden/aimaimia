import { Prisma } from '@prisma/client';
import { ShippingRuleImportService } from './shipping-rule-import.service';

const csvHeader =
  'name,regionCodes,fee,firstWeightKg,firstFee,additionalWeightKg,additionalFee,minChargeWeightKg,priority,minAmount,maxAmount,minWeight,maxWeight,isActive';

function csvRow(values: Array<string | number | boolean | null | undefined>) {
  return values
    .map((value) => {
      if (value === null || value === undefined) return '';
      const raw = String(value);
      return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    })
    .join(',');
}

function validCsvRow(overrides: Partial<Record<string, string | number | boolean>> = {}) {
  const row = {
    name: '全国默认',
    regionCodes: '',
    fee: 9.1,
    firstWeightKg: 3,
    firstFee: 9.1,
    additionalWeightKg: 1,
    additionalFee: 1.3,
    minChargeWeightKg: 1,
    priority: 100,
    minAmount: '',
    maxAmount: '',
    minWeight: '',
    maxWeight: '',
    isActive: true,
    ...overrides,
  };

  return csvRow([
    row.name,
    row.regionCodes,
    row.fee,
    row.firstWeightKg,
    row.firstFee,
    row.additionalWeightKg,
    row.additionalFee,
    row.minChargeWeightKg,
    row.priority,
    row.minAmount,
    row.maxAmount,
    row.minWeight,
    row.maxWeight,
    row.isActive,
  ]);
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-001',
    name: '全国默认',
    regionCodes: [],
    minAmount: null,
    maxAmount: null,
    minWeight: null,
    maxWeight: null,
    fee: 9.1,
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

function createService(existingRules: any[] = []) {
  const tx = {
    shippingRule: {
      findMany: jest.fn().mockResolvedValue(existingRules),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeRule(data))),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeRule(data))),
      delete: jest.fn(),
    },
  };
  const prisma = {
    shippingRule: {
      findMany: jest.fn().mockResolvedValue(existingRules),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const cache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new ShippingRuleImportService(prisma as any, cache as any),
    prisma,
    tx,
    cache,
  };
}

describe('ShippingRuleImportService', () => {
  it('includes isActive with true default in CSV template', () => {
    const { service } = createService([]);
    const template = service.getCsvTemplate();

    expect(template.split('\n')[0]).toBe(csvHeader);
    expect(template.split('\n')[1].split(',').at(-1)).toBe('true');
  });

  it('parses CSV quoted fields containing commas', async () => {
    const existing = makeRule({ id: 'rule-comma', name: '华东,特价' });
    const { service } = createService([existing]);
    const payload = `${csvHeader}\n${validCsvRow({ name: '华东,特价', firstFee: 10 })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.toUpdate).toBe(1);
    expect(result.toCreate).toBe(0);
  });

  it('parses pipe-delimited regionCodes into an array', async () => {
    const { service, tx } = createService([]);
    const payload = `${csvHeader}\n${validCsvRow({
      name: '华南四省',
      regionCodes: '35|43|45|36',
    })}`;

    await service.importRules({ format: 'csv', payload, dryRun: false });

    expect(tx.shippingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '华南四省',
        regionCodes: ['35', '43', '45', '36'],
      }),
    });
  });

  it('does not write any rows when one row is invalid', async () => {
    const { service, prisma, tx, cache } = createService([]);
    const payload = [
      csvHeader,
      validCsvRow({ name: '有效规则' }),
      validCsvRow({ name: '', firstFee: 0 }),
    ].join('\n');

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, message: expect.any(String) }),
      ]),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shippingRule.create).not.toHaveBeenCalled();
    expect(tx.shippingRule.update).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('collects CSV field count errors by row and keeps checking other rows', async () => {
    const { service, prisma, tx, cache } = createService([]);
    const payload = [
      csvHeader,
      validCsvRow({ name: '有效规则一' }),
      '字段数量错误,9.1',
      validCsvRow({ name: '', firstFee: 0 }),
    ].join('\n');

    const dryRunResult = await service.importRules({
      format: 'csv',
      payload,
      dryRun: true,
    });

    expect(dryRunResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 3,
          message: expect.stringContaining('字段数量错误'),
        }),
        expect.objectContaining({ row: 4, message: expect.any(String) }),
      ]),
    );

    const persistResult = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(persistResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3 }),
        expect.objectContaining({ row: 4 }),
      ]),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shippingRule.create).not.toHaveBeenCalled();
    expect(tx.shippingRule.update).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('returns dry-run create, update, and unchanged counts', async () => {
    const existingSame = makeRule({ id: 'same', name: '不变规则' });
    const existingChanged = makeRule({
      id: 'changed',
      name: '变更规则',
      firstFee: 8,
    });
    const { service, prisma } = createService([existingSame, existingChanged]);
    const payload = JSON.stringify([
      {
        name: '新增规则',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: 100,
      },
      {
        name: '变更规则',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: 100,
      },
      {
        name: '不变规则',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: 100,
      },
    ]);

    const result = await service.importRules({
      format: 'json',
      payload,
      dryRun: true,
    });

    expect(result).toMatchObject({
      toCreate: 1,
      toUpdate: 1,
      unchanged: 1,
      errors: [],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('collects JSON non-object row errors and keeps valid later rows in dry-run stats', async () => {
    const { service, prisma, tx, cache } = createService([]);
    const payload = JSON.stringify([
      {
        name: '新增规则一',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: 100,
      },
      null,
      ['not-an-object'],
      {
        name: '新增规则二',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: 100,
      },
    ]);

    const dryRunResult = await service.importRules({
      format: 'json',
      payload,
      dryRun: true,
    });

    expect(dryRunResult).toMatchObject({
      toCreate: 2,
      toUpdate: 0,
      unchanged: 0,
    });
    expect(dryRunResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          message: expect.stringContaining('必须为对象'),
        }),
        expect.objectContaining({
          row: 3,
          message: expect.stringContaining('必须为对象'),
        }),
      ]),
    );

    const persistResult = await service.importRules({
      format: 'json',
      payload,
      dryRun: false,
    });

    expect(persistResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2 }),
        expect.objectContaining({ row: 3 }),
      ]),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shippingRule.create).not.toHaveBeenCalled();
    expect(tx.shippingRule.update).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('accepts JSON isActive false in dry-run and persists it on create', async () => {
    const { service, prisma, tx } = createService([]);
    const payload = JSON.stringify([
      {
        name: '停用规则',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: 100,
        isActive: false,
      },
    ]);

    const dryRunResult = await service.importRules({
      format: 'json',
      payload,
      dryRun: true,
    });

    expect(dryRunResult).toMatchObject({
      toCreate: 1,
      errors: [],
      created: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();

    const persistResult = await service.importRules({
      format: 'json',
      payload,
      dryRun: false,
    });

    expect(persistResult.errors).toEqual([]);
    expect(tx.shippingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '停用规则',
        isActive: false,
      }),
    });
  });

  it('parses CSV isActive aliases and rejects invalid values by row', async () => {
    const { service, prisma, tx } = createService([]);
    const payload = [
      csvHeader,
      validCsvRow({ name: '中文停用', isActive: '否' }),
      validCsvRow({ name: '数字停用', isActive: '0' }),
      validCsvRow({ name: '非法状态', isActive: 'maybe' }),
    ].join('\n');

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 4,
        message: expect.stringContaining('isActive'),
      }),
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shippingRule.create).not.toHaveBeenCalled();

    const dryRunResult = await service.importRules({
      format: 'csv',
      payload: [
        csvHeader,
        validCsvRow({ name: '中文停用', isActive: '否' }),
        validCsvRow({ name: '数字停用', isActive: '0' }),
      ].join('\n'),
      dryRun: true,
    });

    expect(dryRunResult.errors).toEqual([]);
    expect(dryRunResult.toCreate).toBe(2);

    const persistResult = await service.importRules({
      format: 'csv',
      payload: [
        csvHeader,
        validCsvRow({ name: '中文停用', isActive: '否' }),
        validCsvRow({ name: '数字停用', isActive: '0' }),
      ].join('\n'),
      dryRun: false,
    });

    expect(persistResult.errors).toEqual([]);
    expect(tx.shippingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '中文停用',
        isActive: false,
      }),
    });
    expect(tx.shippingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '数字停用',
        isActive: false,
      }),
    });
  });

  it('counts existing rule as update when only isActive changed', async () => {
    const existing = makeRule({ id: 'active-change', name: '只改启用状态', isActive: true });
    const { service } = createService([existing]);
    const payload = JSON.stringify([
      {
        name: '只改启用状态',
        regionCodes: [],
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: 100,
        isActive: false,
      },
    ]);

    const result = await service.importRules({
      format: 'json',
      payload,
      dryRun: true,
    });

    expect(result).toMatchObject({
      toCreate: 0,
      toUpdate: 1,
      unchanged: 0,
      errors: [],
    });
  });

  it('returns row error and skips writes when database has duplicate existing names', async () => {
    const existingRules = [
      makeRule({ id: 'duplicate-001', name: '重复规则' }),
      makeRule({ id: 'duplicate-002', name: '重复规则' }),
    ];
    const { service, prisma, tx, cache } = createService(existingRules);
    const payload = `${csvHeader}\n${validCsvRow({ name: '重复规则', firstFee: 10 })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 2,
        message: expect.stringContaining('数据库存在多个同名运费规则'),
      }),
    ]);
    expect(prisma.shippingRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shippingRule.create).not.toHaveBeenCalled();
    expect(tx.shippingRule.update).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('does not reset omitted JSON optional fields when updating an existing rule', async () => {
    const existing = makeRule({
      id: 'json-patch',
      name: 'JSON Patch',
      regionCodes: ['31'],
      priority: 7,
      minAmount: 100,
      maxAmount: 500,
      minWeight: 1000,
      maxWeight: 5000,
      isActive: false,
      firstFee: 8,
    });
    const { service, tx } = createService([existing]);
    const payload = JSON.stringify([
      {
        name: 'JSON Patch',
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 10,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
      },
    ]);

    const result = await service.importRules({
      format: 'json',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([]);
    const updateArgs = tx.shippingRule.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'json-patch' });
    expect(updateArgs.data).toEqual(expect.objectContaining({ firstFee: 10 }));
    expect(updateArgs.data).not.toHaveProperty('priority');
    expect(updateArgs.data).not.toHaveProperty('minAmount');
    expect(updateArgs.data).not.toHaveProperty('maxAmount');
    expect(updateArgs.data).not.toHaveProperty('minWeight');
    expect(updateArgs.data).not.toHaveProperty('maxWeight');
    expect(updateArgs.data).not.toHaveProperty('isActive');
    expect(updateArgs.data).not.toHaveProperty('regionCodes');
  });

  it('does not reset blank or null JSON optional fields when updating an existing rule', async () => {
    const existing = makeRule({
      id: 'json-blank-null-patch',
      name: 'JSON Blank Null Patch',
      regionCodes: ['31', '32'],
      priority: 9,
      minAmount: 100,
      maxAmount: 500,
      minWeight: 1000,
      maxWeight: 5000,
      isActive: false,
      firstFee: 8,
    });
    const { service, tx } = createService([existing]);
    const payload = JSON.stringify([
      {
        name: 'JSON Blank Null Patch',
        regionCodes: null,
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 10,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: '',
        minAmount: null,
        maxAmount: '',
        minWeight: null,
        maxWeight: '',
        isActive: '',
      },
    ]);

    const result = await service.importRules({
      format: 'json',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([]);
    const updateArgs = tx.shippingRule.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'json-blank-null-patch' });
    expect(updateArgs.data).toEqual({
      name: 'JSON Blank Null Patch',
      fee: 9.1,
      firstWeightKg: 3,
      firstFee: 10,
      additionalWeightKg: 1,
      additionalFee: 1.3,
      minChargeWeightKg: 1,
    });
  });

  it('creates with defaults when JSON optional fields are blank or null', async () => {
    const { service, tx } = createService([]);
    const payload = JSON.stringify([
      {
        name: 'JSON Blank Null Create',
        regionCodes: null,
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        priority: '',
        minAmount: null,
        maxAmount: '',
        minWeight: null,
        maxWeight: '',
        isActive: '',
      },
    ]);

    const result = await service.importRules({
      format: 'json',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([]);
    expect(tx.shippingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'JSON Blank Null Create',
        regionCodes: [],
        priority: 0,
        minAmount: null,
        maxAmount: null,
        minWeight: null,
        maxWeight: null,
        isActive: true,
      }),
    });
  });

  it('returns row error when JSON required fields are blank or null', async () => {
    const { service, prisma, tx, cache } = createService([]);
    const payload = JSON.stringify([
      {
        name: 'JSON Required Blank',
        fee: '',
        firstWeightKg: 3,
        firstFee: null,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
      },
    ]);

    const result = await service.importRules({
      format: 'json',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 1,
        message: expect.stringContaining('fee 不能为空'),
      }),
    ]);
    expect(result.errors[0].message).toContain('firstFee 不能为空');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shippingRule.create).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('does not reset blank CSV optional cells when updating an existing rule', async () => {
    const existing = makeRule({
      id: 'csv-patch',
      name: 'CSV Patch',
      regionCodes: ['31'],
      priority: 9,
      minAmount: 100,
      maxAmount: 500,
      minWeight: 1000,
      maxWeight: 5000,
      isActive: false,
      firstFee: 8,
    });
    const { service, tx } = createService([existing]);
    const payload = `${csvHeader}\n${validCsvRow({
      name: 'CSV Patch',
      firstFee: 10,
      priority: '',
      minAmount: '',
      maxAmount: '',
      minWeight: '',
      maxWeight: '',
      isActive: '',
    })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([]);
    const updateArgs = tx.shippingRule.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'csv-patch' });
    expect(updateArgs.data).toEqual(expect.objectContaining({ firstFee: 10 }));
    expect(updateArgs.data).not.toHaveProperty('priority');
    expect(updateArgs.data).not.toHaveProperty('minAmount');
    expect(updateArgs.data).not.toHaveProperty('maxAmount');
    expect(updateArgs.data).not.toHaveProperty('minWeight');
    expect(updateArgs.data).not.toHaveProperty('maxWeight');
    expect(updateArgs.data).not.toHaveProperty('isActive');
    expect(updateArgs.data).not.toHaveProperty('regionCodes');
  });

  it('updates regionCodes when CSV regionCodes cell is non-blank', async () => {
    const existing = makeRule({
      id: 'csv-region-update',
      name: 'CSV Region Update',
      regionCodes: ['31'],
      firstFee: 8,
    });
    const { service, tx } = createService([existing]);
    const payload = `${csvHeader}\n${validCsvRow({
      name: 'CSV Region Update',
      regionCodes: '35|43',
      firstFee: 10,
    })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([]);
    const updateArgs = tx.shippingRule.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'csv-region-update' });
    expect(updateArgs.data).toEqual(expect.objectContaining({
      firstFee: 10,
      regionCodes: ['35', '43'],
    }));
  });

  it('creates nationwide rule when CSV regionCodes cell is blank', async () => {
    const { service, tx } = createService([]);
    const payload = `${csvHeader}\n${validCsvRow({
      name: 'CSV Blank Region Create',
      regionCodes: '',
    })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([]);
    expect(tx.shippingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'CSV Blank Region Create',
        regionCodes: [],
      }),
    });
  });

  it('counts existing rule as update when JSON explicitly changes only isActive', async () => {
    const existing = makeRule({
      id: 'explicit-active-change',
      name: '显式停用',
      isActive: true,
    });
    const { service } = createService([existing]);
    const payload = JSON.stringify([
      {
        name: '显式停用',
        fee: 9.1,
        firstWeightKg: 3,
        firstFee: 9.1,
        additionalWeightKg: 1,
        additionalFee: 1.3,
        minChargeWeightKg: 1,
        isActive: false,
      },
    ]);

    const result = await service.importRules({
      format: 'json',
      payload,
      dryRun: true,
    });

    expect(result).toMatchObject({
      toCreate: 0,
      toUpdate: 1,
      unchanged: 0,
      errors: [],
    });
  });

  it('returns row error for decimal priority and skips writes', async () => {
    const { service, prisma, tx, cache } = createService([]);
    const payload = `${csvHeader}\n${validCsvRow({
      name: '小数优先级',
      priority: 1.5,
    })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 2,
        message: expect.stringContaining('priority 必须为整数'),
      }),
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shippingRule.create).not.toHaveBeenCalled();
    expect(tx.shippingRule.update).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('re-prepares inside Serializable transaction before persisting', async () => {
    const { service, prisma, tx } = createService([]);
    const payload = `${csvHeader}\n${validCsvRow({ name: '事务内新增' })}`;

    await service.importRules({ format: 'csv', payload, dryRun: false });

    expect(prisma.shippingRule.findMany).toHaveBeenCalledTimes(1);
    expect(tx.shippingRule.findMany).toHaveBeenCalledTimes(1);
    expect(tx.shippingRule.create).toHaveBeenCalledTimes(1);
  });

  it('returns transaction prepare errors and skips writes when duplicate names appear inside transaction', async () => {
    const { service, tx, cache } = createService([]);
    tx.shippingRule.findMany.mockResolvedValueOnce([
      makeRule({ id: 'tx-duplicate-001', name: '事务内重复' }),
      makeRule({ id: 'tx-duplicate-002', name: '事务内重复' }),
    ]);
    const payload = `${csvHeader}\n${validCsvRow({ name: '事务内重复' })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 2,
        message: expect.stringContaining('数据库存在多个同名运费规则'),
      }),
    ]);
    expect(tx.shippingRule.create).not.toHaveBeenCalled();
    expect(tx.shippingRule.update).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('invalidates cache once after persisting changes', async () => {
    const { service, cache } = createService([]);
    const payload = `${csvHeader}\n${validCsvRow({ name: '新增规则' })}`;

    const result = await service.importRules({
      format: 'csv',
      payload,
      dryRun: false,
    });

    expect(result.created).toBe(1);
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
  });

  it('does not delete records missing from import payload', async () => {
    const existing = makeRule({ id: 'missing', name: '文件中没有的规则' });
    const { service, prisma, tx } = createService([existing]);
    const payload = `${csvHeader}\n${validCsvRow({ name: '新增规则' })}`;

    await service.importRules({ format: 'csv', payload, dryRun: false });

    expect(prisma.shippingRule.delete).not.toHaveBeenCalled();
    expect(tx.shippingRule.delete).not.toHaveBeenCalled();
  });

  it('uses Serializable isolation for persistence transaction', async () => {
    const { service, prisma } = createService([]);
    const payload = `${csvHeader}\n${validCsvRow({ name: '新增规则' })}`;

    await service.importRules({ format: 'csv', payload, dryRun: false });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});
