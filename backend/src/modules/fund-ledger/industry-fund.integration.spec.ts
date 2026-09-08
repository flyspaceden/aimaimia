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
  const proof = '11111111-1111-4111-8111-111111111111';
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
    return payments.confirmPayment(id, { actualAmount: amount, paidAt: new Date().toISOString(), sourceAccountRef: 'test-bank', bankReference: key, proofKey: proof, idempotencyKey: key, confirmActualPayment: reviewed, reviewReason: reviewed ? '已核对测试银行支付结果' : undefined }, 'test-admin');
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
  it('释放→部分付款→整单冲回→实际回款，全程对账且回款重复幂等', async () => {
    const f = await fixture('lifecycle'); await release(f); await check(f.company.id);
    const payment = await reserve(f, `${prefix}-reserve`, 10); await check(f.company.id);
    await confirm(payment.id, `${prefix}-bank1`, 10); await check(f.company.id);
    await tx(t => core.reverseOrderInTransaction(t, f.order.id, 'AFTER_SALE_SUCCESS'));
    await check(f.company.id);
    const account = await db.industryFundAccount.findUniqueOrThrow({ where: { companyId: f.company.id } });
    expect(account).toMatchObject({ payableAmount: 0, recoveryDue: 10, totalReversed: 16, totalPaid: 10 });
    const request = { amount: 10, recoveredAt: new Date().toISOString(), bankReference: `${prefix}-recovery`, proofKey: proof, reason: '实际回款', idempotencyKey: `${prefix}-recover` };
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
    await payments.recordRecovery(paid.id, { amount: 10, recoveredAt: new Date().toISOString(), bankReference: `${prefix}-mixed-recovery-bank`, proofKey: proof, reason: '实际回款', idempotencyKey: `${prefix}-mixed-recover` }, 'admin');
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

});
