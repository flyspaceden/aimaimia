import { randomUUID } from 'crypto';
import { IndustryFundQueryService } from '../admin/fund-ledger/industry-fund-query.service';
import { FundQueryDto } from '../admin/fund-ledger/fund-ledger.dto';
import { Prisma, PrismaClient } from '@prisma/client';
import { IndustryFundService } from './industry-fund.service';
import { IndustryFundPaymentService } from '../admin/fund-ledger/industry-fund-payment.service';

// 显式 opt-in，且只允许隔离本机测试数据库。禁止对业务库运行。
const enabled = process.env.FUND_LEDGER_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;
suite('公司产业基金真实 PostgreSQL 事务', () => {
  let db: PrismaClient;
  let core: IndustryFundService;
  let payments: IndustryFundPaymentService;
  const prefix = `fund-it-${Date.now()}`;
  async function makeProof() {
    const id = randomUUID();
    await db.fundPrivateProof.create({ data: { id, adminId: 'test-admin', mimeType: 'application/pdf', content: Buffer.from('%PDF-local-fixture') } });
    return id;
  }
  const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fund_test')) throw new Error('只允许本机隔离 fund_test 数据库');
    db = new PrismaClient();
    core = new IndustryFundService(db as never);
    payments = new IndustryFundPaymentService(db as never, core);
    await db.user.create({ data: { id: prefix } });
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(label: string, amount = 16) {
    const company = await db.company.create({ data: { name: `${prefix}-${label}`, status: 'ACTIVE' } });
    const order = await db.order.create({ data: { userId: prefix, status: 'RECEIVED', goodsAmount: 130, totalAmount: 130, returnWindowExpiresAt: new Date(Date.now() - 60000) } });
    const allocation = await db.rewardAllocation.create({ data: { orderId: order.id, triggerType: 'ORDER_RECEIVED', ruleType: 'NORMAL_TREE', ruleVersion: 'test', meta: { profit: 100, configSnapshot: { normalIndustryFundPercent: .16 } }, idempotencyKey: `${prefix}-${label}` } });
    const result = await tx(t => core.accrueInTransaction(t, { orderId: order.id, allocationId: allocation.id, amount, companyProfitShares: { [company.id]: 1 }, scheme: 'NORMAL_PLATFORM_SPLIT' }));
    return { company, order, allocation, accrualId: result.accrualIds[0] };
  }
  async function release(f: Awaited<ReturnType<typeof fixture>>) {
    await tx(t => core.releaseAccrual(t, { accrualId: f.accrualId, idempotencyKey: `release:${f.accrualId}` }));
  }
  async function reserve(f: Awaited<ReturnType<typeof fixture>>, key: string, amount = 16) {
    return payments.createPayment({ companyId: f.company.id, amount, payeeName: f.company.name, bankAccount: '1234567890123456', bankName: '本地测试银行', reason: '测试登记', idempotencyKey: key }, 'test-admin');
  }
  async function confirm(id: string, key: string, amount = 16, reviewed = false) {
    return payments.confirmPayment(id, { actualAmount: amount, paidAt: new Date().toISOString(), sourceAccountRef: 'test-bank', bankReference: key, proofKey: await makeProof(), idempotencyKey: key, confirmActualPayment: reviewed, reviewReason: reviewed ? '已核对测试银行支付结果' : undefined }, 'test-admin');
  }
  async function check(companyId: string) { expect((await tx(t => core.reconcileAccount(t, companyId))).ok).toBe(true); }

  it('新计提不创建任何个人 Reward 账户，重复计提只记一次', async () => {
    const before = await db.rewardLedger.count();
    const f = await fixture('accrue');
    await tx(t => core.accrueInTransaction(t, { orderId: f.order.id, allocationId: f.allocation.id, amount: 16, companyProfitShares: { [f.company.id]: 1 }, scheme: 'NORMAL_PLATFORM_SPLIT' }));
    expect(await db.industryFundAccrual.count({ where: { allocationId: f.allocation.id } })).toBe(1);
    expect(await db.rewardLedger.count()).toBe(before);
    await check(f.company.id);
  });

  it('已核销自提订单在同一计提事务内即时可支付，重放不重复释放', async () => {
    const company = await db.company.create({ data: { name: `${prefix}-pickup-immediate`, status: 'ACTIVE' } });
    const now = new Date();
    const order = await db.order.create({
      data: {
        userId: prefix,
        status: 'RECEIVED',
        fulfillmentMode: 'PICKUP',
        goodsAmount: 130,
        totalAmount: 130,
        receivedAt: now,
        deliveredAt: now,
        returnWindowExpiresAt: now,
      },
    });
    const point = await db.pickupPoint.create({
      data: {
        companyId: company.id,
        name: `${prefix}-pickup-point`,
        contactName: '测试员',
        contactPhone: '13800000000',
        regionCode: '330100',
        regionText: '测试地区',
        detail: '测试地址',
        businessHours: '09:00-18:00',
      },
    });
    await db.pickupFulfillment.create({
      data: {
        orderId: order.id,
        pickupPointId: point.id,
        status: 'PICKED_UP',
        pickupPointSnapshot: { id: point.id, name: point.name },
        recipientSnapshot: { name: '测试收货人', phone: '13800000000' },
        pickupCodeDigest: 'a'.repeat(64),
        pickupTokenDigest: 'b'.repeat(64),
        pickupCredentialEncrypted: { version: 1, ciphertext: 'fixture' },
        pickedUpAt: now,
      },
    });
    const allocation = await db.rewardAllocation.create({
      data: {
        orderId: order.id,
        triggerType: 'ORDER_RECEIVED',
        ruleType: 'NORMAL_TREE',
        ruleVersion: 'test',
        meta: { profit: 100, configSnapshot: { normalIndustryFundPercent: 0.16 } },
        idempotencyKey: `${prefix}-pickup-immediate`,
      },
    });

    const input = {
      orderId: order.id,
      allocationId: allocation.id,
      amount: 16,
      companyProfitShares: { [company.id]: 1 },
      scheme: 'NORMAL_PLATFORM_SPLIT',
    };
    const first = await tx(t => core.accrueInTransaction(t, input));
    const second = await tx(t => core.accrueInTransaction(t, input));

    expect(second).toEqual(first);
    const accrual = await db.industryFundAccrual.findUniqueOrThrow({ where: { id: first.accrualIds[0] } });
    const account = await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: company.id } });
    const ledgers = await db.industryFundLedger.findMany({ where: { accrualId: accrual.id }, orderBy: { sequence: 'asc' } });
    expect(accrual).toMatchObject({ frozenAmount: 0, payableAmount: 16, originalAmount: 16 });
    expect(account).toMatchObject({ frozenAmount: 0, payableAmount: 16, totalAccrued: 16 });
    expect(ledgers.map((ledger) => ledger.eventType)).toEqual(['ACCRUAL', 'RELEASE']);
    await check(company.id);
  });

  it('释放→部分付款→整单冲回→实际回款，全程对账且回款重复幂等', async () => {
    const f = await fixture('lifecycle'); await release(f); await check(f.company.id);
    const payment = await reserve(f, `${prefix}-reserve`, 10); await check(f.company.id);
    await confirm(payment.id, `${prefix}-bank1`, 10); await check(f.company.id);
    await tx(t => core.reverseOrderInTransaction(t, f.order.id, 'AFTER_SALE_SUCCESS'));
    await check(f.company.id);
    const account = await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } });
    expect(account).toMatchObject({ payableAmount: 0, recoveryDue: 10, totalReversed: 16, totalPaid: 10 });
    const request = { amount: 10, recoveredAt: new Date().toISOString(), bankReference: `${prefix}-recovery`, proofKey: await makeProof(), reason: '实际回款', idempotencyKey: `${prefix}-recover` };
    await payments.recordRecovery(payment.id, request, 'admin');
    await payments.recordRecovery(payment.id, request, 'admin');
    await check(f.company.id);
    expect((await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } })).recoveryDue).toBe(0);
  });
  it('并发预留不能超支，重复请求返回同一单', async () => {
    const f = await fixture('concurrent'); await release(f);
    const results = await Promise.allSettled([reserve(f, `${prefix}-race-a`, 12), reserve(f, `${prefix}-race-b`, 12)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const account = await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } });
    expect(account.reservedAmount).toBe(12); expect(account.payableAmount).toBe(4); await check(f.company.id);
  });
  it('待核实预留：取消会冲回，明确核实已付款则记支付和追偿', async () => {
    const f = await fixture('pending'); await release(f); const p = await reserve(f, `${prefix}-pending`);
    await tx(t => core.reverseOrderInTransaction(t, f.order.id, 'AFTER_SALE_SUCCESS'));
    await check(f.company.id);
    await expect(confirm(p.id, `${prefix}-pending-bank`)).rejects.toThrow();
    await confirm(p.id, `${prefix}-pending-bank`, 16, true); await check(f.company.id);
    expect((await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } })).recoveryDue).toBe(16);
    const g = await fixture('pending-cancel'); await release(g); const q = await reserve(g, `${prefix}-pending-cancel`);
    await tx(t => core.reverseOrderInTransaction(t, g.order.id, 'AFTER_SALE_SUCCESS'));
    await payments.cancelPayment(q.id, { reason: '已核实未实际付款', idempotencyKey: `${prefix}-cancel` }, 'admin'); await check(g.company.id);
    expect((await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: g.company.id } })).totalReversed).toBe(16);
  });
  it('错误付款登记冲正恢复应付，禁止账户名称不符', async () => {
    const f = await fixture('reverse'); await release(f);
    await expect(payments.createPayment({ companyId: f.company.id, amount: 16, payeeName: '个人账户', bankAccount: '1234567890123', bankName: '银行', reason: 'test', idempotencyKey: `${prefix}-bad-payee` }, 'admin')).rejects.toThrow();
    const p = await reserve(f, `${prefix}-reverse-reserve`); await confirm(p.id, `${prefix}-reverse-bank`);
    await payments.reversePayment(p.id, { reason: '核实为错误登记，未真实支付', idempotencyKey: `${prefix}-reverse-entry` }, 'admin'); await check(f.company.id);
    expect((await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } })).payableAmount).toBe(16);
  });
  it('活跃售后阻止释放和付款', async () => {
    const f = await fixture('aftersale');
    await db.afterSaleRequest.create({ data: { orderId: f.order.id, userId: prefix, afterSaleType: 'NO_REASON_RETURN', reason: '测试', photos: [], status: 'REQUESTED' } });
    await expect(release(f)).rejects.toThrow();
    await check(f.company.id);
  });
  it('部分已支付已回款后取消剩余预留，不重复形成追偿', async () => {
    const f = await fixture('mixed'); await release(f);
    const paid = await reserve(f, `${prefix}-mixed-paid`, 10);
    await confirm(paid.id, `${prefix}-mixed-bank`, 10);
    const reserved = await reserve(f, `${prefix}-mixed-reserved`, 6);
    await tx(t => core.reverseOrderInTransaction(t, f.order.id, 'AFTER_SALE_SUCCESS'));
    await payments.recordRecovery(paid.id, { amount: 10, recoveredAt: new Date().toISOString(), bankReference: `${prefix}-mixed-recovery-bank`, proofKey: await makeProof(), reason: '实际回款', idempotencyKey: `${prefix}-mixed-recover` }, 'admin');
    await payments.cancelPayment(reserved.id, { reason: '余款核实未支付', idempotencyKey: `${prefix}-mixed-cancel` }, 'admin');
    await check(f.company.id);
    expect(await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } })).toMatchObject({ recoveryDue: 0, totalReversed: 16, totalPaid: 10, totalRecovered: 10, payableAmount: 0 });
  });
  it('同一请求编号换收款资料或跨操作复用，返回409且余额不变', async () => {
    const f = await fixture('fingerprint'); await release(f);
    const key = `${prefix}-fingerprint`;
    const p = await reserve(f, key);
    await expect(payments.createPayment({ companyId: f.company.id, amount: 16, payeeName: f.company.name, bankAccount: '99999999999999', bankName: '其他银行', reason: '修改资料', idempotencyKey: key }, 'test-admin')).rejects.toMatchObject({ status: 409 });
    await expect(payments.cancelPayment(p.id, { reason: '取消', idempotencyKey: key }, 'test-admin')).rejects.toMatchObject({ status: 409 });
    await check(f.company.id);
    expect((await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } })).reservedAmount).toBe(16);
  });

  it('公司总账日期筛选不会随数据库会话时区偏移', async () => {
    const f = await fixture('utc-summary');
    const ledger = await db.industryFundLedger.findFirstOrThrow({ where: { accrualId: f.accrualId, eventType: 'ACCRUAL' } });
    const ny = { $transaction: (callback: (t: Prisma.TransactionClient) => Promise<unknown>) => tx(async t => {
      await t.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/New_York'"); return callback(t);
    }) };
    const reader = new IndustryFundQueryService(ny as never);
    const q = new FundQueryDto(); q.from = new Date(ledger.createdAt.getTime()-1).toISOString(); q.to = new Date(ledger.createdAt.getTime()+1).toISOString();
    const result = await reader.summary(q);
    expect(result.periodIncome).toBeGreaterThanOrEqual(16);
  });

  it('同一凭证不能跨付款单复用，失败不会核销预留', async () => {
    const a = await fixture('proof-a'); await release(a);
    const b = await fixture('proof-b'); await release(b);
    const pa = await reserve(a, `${prefix}-proof-a`);
    const pb = await reserve(b, `${prefix}-proof-b`);
    const proofKey = await makeProof();
    const body = { actualAmount: 16, paidAt: new Date().toISOString(), sourceAccountRef: 'local-test-bank', bankReference: `${prefix}-proof-bank-a`, proofKey, idempotencyKey: `${prefix}-proof-confirm-a` };
    await payments.confirmPayment(pa.id, body, 'admin');
    await expect(payments.confirmPayment(pb.id, { ...body, bankReference: `${prefix}-proof-bank-b`, idempotencyKey: `${prefix}-proof-confirm-b` }, 'admin')).rejects.toThrow('已用于其他');
    expect((await db.industryFundPayment.findUniqueOrThrow({ where: { id: pb.id } })).status).toBe('RESERVED');
    await check(b.company.id);
  });

  it('reads pending unassigned entries with typed status filters and their immutable audit events', async () => {
    const order = await db.order.create({ data: { userId: prefix, status: 'RECEIVED', goodsAmount: 100, totalAmount: 100 } });
    const query = new IndustryFundQueryService(db as never);
    const args = Object.assign(new FundQueryDto(), { orderId: order.id, status: 'PENDING' });
    expect((await query.unassigned(args)).total).toBe(0);
    const allocation = await db.rewardAllocation.create({ data: {
      orderId: order.id, triggerType: 'ORDER_RECEIVED', ruleType: 'NORMAL_TREE', ruleVersion: 'test',
      idempotencyKey: `${prefix}-unassigned-query`,
    } });
    const entry = await db.industryFundUnassignedEntry.create({ data: {
      allocationId: allocation.id, orderId: order.id, amount: 10, reversedAmount: 4,
      scheme: 'NORMAL_PLATFORM_SPLIT', profitBaseAmount: 100, reason: 'test unassigned query',
      idempotencyKey: `${prefix}-unassigned-entry`,
    } });
    const pending = await query.unassigned(args);
    expect(pending.total).toBe(1);
    expect(pending.items[0]).toEqual(expect.objectContaining({ id: entry.id, originalAmount: 10, amount: 6, status: 'PENDING' }));
    expect(pending.items[0].events).toEqual([expect.objectContaining({ reversedBefore: 0, reversedAfter: 4 })]);
    expect((await query.unassigned(Object.assign(new FundQueryDto(), { orderId: order.id, status: 'RESOLVED' }))).total).toBe(0);
    await db.industryFundUnassignedEntry.update({ where: { id: entry.id }, data: { reversedAmount: 10 } });
    expect((await query.unassigned(args)).total).toBe(0);
    const history = await query.unassigned(Object.assign(new FundQueryDto(), { orderId: order.id, status: 'ALL' }));
    expect(history.items[0]).toEqual(expect.objectContaining({ amount: 0, status: 'REVERSED' }));
    expect(history.items[0].events).toHaveLength(2);
  });

});
