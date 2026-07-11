import { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from '../captain/captain.constants';
import {
  PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS,
  ProfitSafetyService,
} from './profit-safety.service';
import { ProfitSafetyValidator } from './profit-safety-validator';

const databaseUrl = process.env.PROFIT_SAFETY_POSTGRES_TEST_URL
  ?? process.env.NORMAL_TREE_POSTGRES_TEST_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('ProfitSafetyService PostgreSQL advisory lock concurrency', () => {
  let firstPrisma: PrismaClient;
  let secondPrisma: PrismaClient;
  const markerKey = `PROFIT_SAFETY_LOCK_TEST_${process.pid}_${Date.now()}`;
  const originalRequiredConfigs = new Map<string, unknown>();

  const safeRequiredValues = Object.fromEntries(
    PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.map((key) => [key, `test:${key}`]),
  ) as Record<string, unknown>;

  Object.assign(safeRequiredValues, {
    MARKUP_RATE: 1.35,
    VIP_DISCOUNT_RATE: 0.95,
    VIP_REWARD_PERCENT: 0.2,
    VIP_DIRECT_REFERRAL_PERCENT: 0.05,
    VIP_INDUSTRY_FUND_PERCENT: 0.1,
    NORMAL_REWARD_PERCENT: 0.2,
    NORMAL_DIRECT_REFERRAL_PERCENT: 0.05,
    NORMAL_INDUSTRY_FUND_PERCENT: 0.1,
    CAPTAIN_SEAFOOD_CONFIG: DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
  });

  beforeAll(async () => {
    firstPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
    secondPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await Promise.all([firstPrisma.$connect(), secondPrisma.$connect()]);
    const existing = await firstPrisma.ruleConfig.findMany({
      where: { key: { in: [...PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS] } },
      select: { key: true, value: true },
    });
    for (const row of existing) originalRequiredConfigs.set(row.key, row.value);
    await Promise.all(PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.map((key) => (
      firstPrisma.ruleConfig.upsert({
        where: { key },
        update: { value: { value: safeRequiredValues[key] } as Prisma.InputJsonValue },
        create: { key, value: { value: safeRequiredValues[key] } as Prisma.InputJsonValue },
      })
    )));
    await firstPrisma.ruleConfig.create({
      data: { key: markerKey, value: { value: 0 } },
    });
  });

  afterAll(async () => {
    if (!firstPrisma || !secondPrisma) return;
    await firstPrisma.ruleConfig.deleteMany({ where: { key: markerKey } });
    await firstPrisma.ruleConfig.deleteMany({
      where: { key: { in: [...PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS] } },
    });
    await Promise.all([...originalRequiredConfigs.entries()].map(([key, value]) => (
      firstPrisma.ruleConfig.create({ data: { key, value: value as any } })
    )));
    await Promise.all([firstPrisma.$disconnect(), secondPrisma.$disconnect()]);
  });

  it('blocks the second transaction and retries it against state committed by the first', async () => {
    const firstService = new ProfitSafetyService(
      firstPrisma as any,
      new ProfitSafetyValidator(),
    );
    const secondService = new ProfitSafetyService(
      secondPrisma as any,
      new ProfitSafetyValidator(),
    );
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
    let secondEntered = false;

    const first = firstService.withSafetyLock(async (tx) => {
      await tx.ruleConfig.update({
        where: { key: markerKey },
        data: { value: { value: 1 } },
      });
      markFirstEntered();
      await holdFirst;
    });
    await firstEntered;

    const second = secondService.withSafetyLock(async (tx) => {
      secondEntered = true;
      const row = await tx.ruleConfig.findUniqueOrThrow({ where: { key: markerKey } });
      const observed = Number((row.value as { value: number }).value);
      await tx.ruleConfig.update({
        where: { key: markerKey },
        data: { value: { value: 2 } },
      });
      return observed;
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(secondEntered).toBe(false);

    releaseFirst();
    await first;
    await expect(second).resolves.toBe(1);
    await expect(firstPrisma.ruleConfig.findUniqueOrThrow({ where: { key: markerKey } }))
      .resolves.toMatchObject({ value: { value: 2 } });
  });

  it('creates an isComplete version whose snapshot matches the RuleConfig state committed by concurrent required-key writes', async () => {
    const firstService = new ProfitSafetyService(
      firstPrisma as any,
      new ProfitSafetyValidator(),
    );
    const secondService = new ProfitSafetyService(
      secondPrisma as any,
      new ProfitSafetyValidator(),
    );
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
    let secondEntered = false;

    const first = firstService.withRuleConfigUpdates({ WITHDRAW_TAX_RATE: 0.19 }, async (tx) => {
      await tx.ruleConfig.update({
        where: { key: 'WITHDRAW_TAX_RATE' },
        data: { value: { value: 0.19 } },
      });
      markFirstEntered();
      await holdFirst;
    });
    await firstEntered;

    const second = secondService.withRuleConfigUpdates({ WITHDRAW_MIN_AMOUNT: 11 }, async (tx) => {
      secondEntered = true;
      await tx.ruleConfig.update({
        where: { key: 'WITHDRAW_MIN_AMOUNT' },
        data: { value: { value: 11 } },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(secondEntered).toBe(false);

    releaseFirst();
    await first;
    const secondOutput = await second;
    const finalConfigs = await firstPrisma.ruleConfig.findMany({
      select: { key: true, value: true },
    });
    const finalSnapshot = Object.fromEntries(finalConfigs.map((row) => [
      row.key,
      (row.value as { value: unknown }).value,
    ]));

    expect(secondOutput.ruleVersion).toMatchObject({ isComplete: true });
    expect((secondOutput.ruleVersion as any).snapshot).toEqual(finalSnapshot);
    expect(finalSnapshot).toMatchObject({
      WITHDRAW_TAX_RATE: 0.19,
      WITHDRAW_MIN_AMOUNT: 11,
    });
  });
});
