import { Prisma } from '@prisma/client';
import { ShippingRuleImportService } from './shipping-rule-import.service';

const csvHeader =
  'name,regionCodes,fee,firstWeightKg,firstFee,additionalWeightKg,additionalFee,minChargeWeightKg,priority,minAmount,maxAmount,minWeight,maxWeight';

function csvRow(values: Array<string | number | null | undefined>) {
  return values
    .map((value) => {
      if (value === null || value === undefined) return '';
      const raw = String(value);
      return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    })
    .join(',');
}

function validCsvRow(overrides: Partial<Record<string, string | number>> = {}) {
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
