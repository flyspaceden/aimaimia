import { PrismaClient } from '@prisma/client';
import { ProfitSafetyService } from './profit-safety.service';
import { ProfitSafetyValidator } from './profit-safety-validator';

const databaseUrl = process.env.PROFIT_SAFETY_POSTGRES_TEST_URL
  ?? process.env.NORMAL_TREE_POSTGRES_TEST_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('ProfitSafetyService PostgreSQL advisory lock concurrency', () => {
  let firstPrisma: PrismaClient;
  let secondPrisma: PrismaClient;
  const markerKey = `PROFIT_SAFETY_LOCK_TEST_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    firstPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
    secondPrisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await Promise.all([firstPrisma.$connect(), secondPrisma.$connect()]);
    await firstPrisma.ruleConfig.create({
      data: { key: markerKey, value: { value: 0 } },
    });
  });

  afterAll(async () => {
    if (!firstPrisma || !secondPrisma) return;
    await firstPrisma.ruleConfig.deleteMany({ where: { key: markerKey } });
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
});
