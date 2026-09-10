import { Prisma, PrismaClient } from '@prisma/client';
import { PlatformFundQueryService } from './platform-fund-query.service';
const suite = process.env.FUND_LEDGER_INTEGRATION === '1' ? describe : describe.skip;
suite('平台基金真实 PostgreSQL 审计与查询', () => {
  let db: PrismaClient; let query: PlatformFundQueryService; let accountId: string;
  const prefix = `platform-it-${Date.now()}`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fund_test')) throw new Error('仅允许本机 fund_test');
    db = new PrismaClient(); query = new PlatformFundQueryService(db as never);
    await db.user.upsert({ where: { id: 'PLATFORM' }, create: { id: 'PLATFORM' }, update: {} });
    const a = await db.rewardAccount.upsert({ where: { userId_type: { userId: 'PLATFORM', type: 'CHARITY_FUND' } }, create: { userId: 'PLATFORM', type: 'CHARITY_FUND' }, update: {} }); accountId = a.id;
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('一次计提同时显示金额、来源订单、分配证据及余额，不重复统计', async () => {
    const before = (await query.summary()).funds.find(f => f.fundType === 'CHARITY_FUND')!;
    await db.$transaction(async tx => {
      const allocation = await tx.rewardAllocation.create({ data: { triggerType: 'ORDER_RECEIVED', ruleType: 'NORMAL_TREE', ruleVersion: 'integration', idempotencyKey: prefix, meta: { profit: 100, configSnapshot: { normalCharityPercent: .08 } } } });
      await tx.rewardLedger.create({ data: { accountId, userId: 'PLATFORM', allocationId: allocation.id, entryType: 'RELEASE', status: 'AVAILABLE', amount: 8, refType: 'ORDER', refId: prefix, meta: { scheme: 'NORMAL_PLATFORM_SPLIT', accountType: 'CHARITY_FUND', sourceOrderId: prefix } } });
      await tx.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: 8 } } });
    });
    const after = (await query.summary()).funds.find(f => f.fundType === 'CHARITY_FUND')!;
    expect(after.currentBalance - before.currentBalance).toBeCloseTo(8,2);
    expect(after.periodIncome - before.periodIncome).toBeCloseTo(8,2);
    const list = await query.entries('CHARITY_FUND', { orderId: prefix });
    expect(list.items.some(r => r.orderId === prefix && r.amount === 8)).toBe(true);
    expect(list.items.filter(r => r.direction === 'CREDIT').reduce((s,r) => s+r.amount,0)).toBe(8);
  });
  it('余额 A→B→A→B 不会丢掉第三次变动，事务回滚不留下账本', async () => {
    const count = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "PlatformFundEvent" WHERE "accountId"=${accountId}`;
    await db.$transaction(async tx => {
      for(const delta of [1,-1,1]) await tx.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: delta } } });
    });
    const after = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "PlatformFundEvent" WHERE "accountId"=${accountId}`;
    expect(Number(after[0].n-count[0].n)).toBe(3);
    await expect(db.$transaction(async tx => { await tx.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: 99 } } }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    const final = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "PlatformFundEvent" WHERE "accountId"=${accountId}`;
    expect(final[0].n).toBe(after[0].n);
  });
  it('冻结转可用不是第二次收入，审计流水不可覆盖', async () => {
    await db.rewardAccount.update({ where: { id: accountId }, data: { frozen: { increment: 2 } } });
    const before = (await query.summary()).funds.find(f => f.fundType === 'CHARITY_FUND')!;
    await db.rewardAccount.update({ where: { id: accountId }, data: { frozen: { decrement: 2 }, balance: { increment: 2 } } });
    const after = (await query.summary()).funds.find(f => f.fundType === 'CHARITY_FUND')!;
    expect(after.periodIncome).toBe(before.periodIncome);
    expect(after.reconstructedTotal).toBeCloseTo(after.currentTotal,2);
    await expect(db.$executeRaw`UPDATE "PlatformFundEvent" SET "moneyDelta"=999 WHERE "accountId"=${accountId}`).rejects.toThrow();
  });

  it('只折叠相邻且金额相等的 ledger→account 变动，第二次 account 变动仍单独可见', async () => {
    const orderId = `${prefix}:adjacent-account-updates`;
    const ledgerId = `${prefix}:adjacent-ledger`;
    await db.$transaction(async tx => {
      await tx.rewardLedger.create({
        data: {
          id: ledgerId,
          accountId,
          userId: 'PLATFORM',
          entryType: 'RELEASE',
          status: 'AVAILABLE',
          amount: 3,
          refType: 'ORDER',
          refId: orderId,
          meta: { scheme: 'NORMAL_PLATFORM_SPLIT' },
          idempotencyKey: `${ledgerId}:key`,
        },
      });
      await tx.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: 3 } } });
      await tx.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: 2 } } });
    });
    const txRows = await db.$queryRaw<Array<{ transactionId: bigint }>>`
      SELECT DISTINCT "transactionId"
      FROM "PlatformFundEvent"
      WHERE "rewardLedgerId" = ${ledgerId}
    `;
    const transactionId = String(txRows[0].transactionId);
    const rows = (await query.entries('CHARITY_FUND', { page: 1, pageSize: 100 })).items
      .filter(row => row.metadata?.transactionId === transactionId);
    expect(rows.map(row => row.amount).sort()).toEqual([2, 3]);
    expect(rows.find(row => row.relatedEntryId === ledgerId)).toEqual(expect.objectContaining({ amount: 3, balanceAfter: expect.any(Number) }));
  });

  it('does not attribute an aggregate account delta to the last of multiple ledger rows', async () => {
    const orderOne = `${prefix}:aggregate-one`;
    const orderTwo = `${prefix}:aggregate-two`;
    const ledgerOne = `${prefix}:aggregate-ledger-one`;
    const ledgerTwo = `${prefix}:aggregate-ledger-two`;
    await db.$transaction(async tx => {
      await tx.rewardLedger.create({ data: { id: ledgerOne, accountId, userId: 'PLATFORM', entryType: 'RELEASE', status: 'AVAILABLE', amount: 2, refType: 'ORDER', refId: orderOne, meta: { scheme: 'NORMAL_PLATFORM_SPLIT' }, idempotencyKey: `${ledgerOne}:key` } });
      await tx.rewardLedger.create({ data: { id: ledgerTwo, accountId, userId: 'PLATFORM', entryType: 'RELEASE', status: 'AVAILABLE', amount: 3, refType: 'ORDER', refId: orderTwo, meta: { scheme: 'NORMAL_PLATFORM_SPLIT' }, idempotencyKey: `${ledgerTwo}:key` } });
      await tx.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: 5 } } });
    });
    const txRows = await db.$queryRaw<Array<{ transactionId: bigint }>>`
      SELECT DISTINCT "transactionId"
      FROM "PlatformFundEvent"
      WHERE "rewardLedgerId" IN (${ledgerOne}, ${ledgerTwo})
    `;
    const transactionId = String(txRows[0].transactionId);
    const rows = (await query.entries('CHARITY_FUND', { page: 1, pageSize: 100 })).items
      .filter(row => row.metadata?.transactionId === transactionId);
    expect(rows.filter(row => row.relatedEntryId === ledgerOne)[0]?.amount).toBe(0);
    expect(rows.filter(row => row.relatedEntryId === ledgerTwo)[0]?.amount).toBe(0);
    expect(rows.filter(row => row.source?.rewardLedgerId == null).map(row => row.amount)).toContain(5);
  });

  it('keeps account-before-ledger order explicit instead of inventing a pairing', async () => {
    const orderId = `${prefix}:account-before-ledger`;
    const ledgerId = `${prefix}:account-before-ledger-row`;
    await db.$transaction(async tx => {
      await tx.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: 4 } } });
      await tx.rewardLedger.create({ data: { id: ledgerId, accountId, userId: 'PLATFORM', entryType: 'RELEASE', status: 'AVAILABLE', amount: 4, refType: 'ORDER', refId: orderId, meta: { scheme: 'NORMAL_PLATFORM_SPLIT' }, idempotencyKey: `${ledgerId}:key` } });
    });
    const txRows = await db.$queryRaw<Array<{ transactionId: bigint }>>`
      SELECT DISTINCT "transactionId"
      FROM "PlatformFundEvent"
      WHERE "rewardLedgerId" = ${ledgerId}
    `;
    const transactionId = String(txRows[0].transactionId);
    const rows = (await query.entries('CHARITY_FUND', { page: 1, pageSize: 100 })).items
      .filter(row => row.metadata?.transactionId === transactionId);
    expect(rows.filter(row => row.relatedEntryId === ledgerId)[0]).toEqual(expect.objectContaining({ amount: 0, balanceAfter: null }));
    expect(rows.filter(row => row.source?.rewardLedgerId == null).map(row => row.amount)).toContain(4);
  });
  it('空的日期条件可查询，无效基金或倒置时间返回业务错误', async () => {
    await expect(query.summary()).resolves.toHaveProperty('funds');
    await expect(query.entries('INVALID', {})).rejects.toThrow('基金类型');
    await expect(query.summary({ from: '2026-09-09', to: '2026-09-01' })).rejects.toThrow('开始时间');
  });
  it('非 UTC 数据库会话仍将审计事件写为 UTC 时间', async () => {
    const ref = `${prefix}-utc-clock`;
    const started = Date.now();
    await db.$transaction(async t => {
      await t.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/New_York'");
      await t.rewardLedger.create({ data: { accountId, userId: 'PLATFORM', amount: 1, entryType: 'RELEASE', status: 'AVAILABLE', refType: 'ORDER', refId: ref } });
      await t.rewardAccount.update({ where: { id: accountId }, data: { balance: { increment: 1 } } });
    });
    const events = await db.$queryRaw<Array<{ occurredAt: Date }>>`SELECT "occurredAt" FROM "PlatformFundEvent" WHERE "refId"=${ref}`;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].occurredAt.getTime()).toBeGreaterThanOrEqual(started - 1000);
    expect(events[0].occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('拒绝平台基金账户的类型或身份迁移', async () => {
    await expect(db.rewardAccount.update({
      where: { id: accountId },
      data: { type: 'TECH_FUND' },
    })).rejects.toThrow('identity cannot change');
  });

});
