import { ForbiddenException } from '@nestjs/common';
import { IndustryFundPaymentStatus, PrismaClient } from '@prisma/client';
import { IndustryFundQueryService } from './industry-fund-query.service';
import { FundQueryDto } from './fund-ledger.dto';

const integrationEnabled = process.env.FUND_LEDGER_INTEGRATION === '1';
const suite = integrationEnabled ? describe : describe.skip;

type QueryFixture = {
  userId: string;
  orderId: string;
  allocationId: string;
  companyId: string;
  companyName: string;
  accountId: string;
  accrualId: string;
  pendingPaymentId: string;
  reviewPaymentId: string;
  recoveryPaymentId: string;
  recoveryBankReference: string;
};

jest.setTimeout(30000);

suite('IndustryFundQueryService PostgreSQL read queries', () => {
  let db: PrismaClient;
  let query: IndustryFundQueryService;
  let fixture: QueryFixture;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fund_test')) throw new Error('仅允许隔离本机 fund_test 数据库');
    db = new PrismaClient();
    const prefix = `fund-query-it-${Date.now()}-${process.pid}`;
    const companyName = `${prefix}-company`;
    const recoveryBankReference = `${prefix}-recovery-bank`;

    const created = await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { id: `${prefix}-user` } });
      const order = await tx.order.create({
        data: {
          userId: user.id,
          status: 'RECEIVED',
          totalAmount: 100,
          goodsAmount: 100,
        },
      });
      const allocation = await tx.rewardAllocation.create({
        data: {
          triggerType: 'ORDER_RECEIVED',
          orderId: order.id,
          ruleType: 'NORMAL_TREE',
          ruleVersion: 'query-integration',
          meta: { source: 'query-integration' },
          idempotencyKey: `${prefix}-allocation`,
        },
      });
      const company = await tx.company.create({ data: { name: companyName, status: 'ACTIVE' } });
      const account = await tx.industryFundAccount.create({
        data: {
          companyId: company.id,
          frozenAmount: 2,
          payableAmount: 17,
          reservedAmount: 5,
          recoveryDue: 3,
          totalAccrued: 27,
        },
      });
      const accrual = await tx.industryFundAccrual.create({
        data: {
          accountId: account.id,
          companyId: company.id,
          allocationId: allocation.id,
          orderId: order.id,
          scheme: 'NORMAL_QUERY_INTEGRATION',
          profitBaseAmount: 100,
          companyShareAmount: 27,
          companyShareRatio: 1,
          industryFundRatio: 0.16,
          originalAmount: 3,
          recoveryDue: 3,
        },
      });
      const pending = await tx.industryFundPayment.create({
        data: {
          accountId: account.id,
          companyId: company.id,
          amount: 1,
          status: IndustryFundPaymentStatus.RESERVED,
          payeeName: companyName,
          bankAccount: '1234567890123456',
          bankName: '查询测试银行',
          reason: '查询测试待付款',
          idempotencyKey: `${prefix}-pending`,
        },
      });
      const review = await tx.industryFundPayment.create({
        data: {
          accountId: account.id,
          companyId: company.id,
          amount: 2,
          status: IndustryFundPaymentStatus.RESERVED,
          payeeName: companyName,
          bankAccount: '1234567890123456',
          bankName: '查询测试银行',
          reason: '查询测试待核实',
          needsReview: true,
          reviewReason: '查询测试需核实',
          idempotencyKey: `${prefix}-review`,
        },
      });
      const recovery = await tx.industryFundPayment.create({
        data: {
          accountId: account.id,
          companyId: company.id,
          amount: 3,
          status: IndustryFundPaymentStatus.PAID,
          payeeName: companyName,
          bankAccount: '1234567890123456',
          bankName: '查询测试银行',
          sourceAccountRef: `${prefix}-source-account`,
          bankReference: recoveryBankReference,
          actualPaidAt: new Date(),
          reason: '查询测试待追偿',
          idempotencyKey: `${prefix}-recovery`,
          items: { create: { accrualId: accrual.id, amount: 3, paidAmount: 3, recoveryDue: 3 } },
        },
      });
      return {
        userId: user.id,
        orderId: order.id,
        allocationId: allocation.id,
        companyId: company.id,
        companyName,
        accountId: account.id,
        accrualId: accrual.id,
        pendingPaymentId: pending.id,
        reviewPaymentId: review.id,
        recoveryPaymentId: recovery.id,
        recoveryBankReference,
      } satisfies QueryFixture;
    });
    fixture = created;
    query = new IndustryFundQueryService(db as never);
  });

  afterAll(async () => {
    if (!db || !fixture) {
      await db?.$disconnect();
      return;
    }
    await db.$transaction(async tx => {
      await tx.industryFundPaymentItem.deleteMany({ where: { paymentId: { in: [fixture.pendingPaymentId, fixture.reviewPaymentId, fixture.recoveryPaymentId] } } });
      await tx.industryFundPayment.deleteMany({ where: { id: { in: [fixture.pendingPaymentId, fixture.reviewPaymentId, fixture.recoveryPaymentId] } } });
      await tx.industryFundAccrual.delete({ where: { id: fixture.accrualId } });
      await tx.industryFundAccount.delete({ where: { id: fixture.accountId } });
      await tx.rewardAllocation.delete({ where: { id: fixture.allocationId } });
      await tx.order.delete({ where: { id: fixture.orderId } });
      await tx.company.delete({ where: { id: fixture.companyId } });
      await tx.user.delete({ where: { id: fixture.userId } });
    });
    await db.$disconnect();
  });

  it('returns company view rows and a summary calculated over the same filtered snapshot', async () => {
    const available = await query.companies(Object.assign(new FundQueryDto(), {
      page: 1,
      pageSize: 20,
      search: fixture.companyName,
      view: 'available',
    }));
    expect(available.total).toBe(1);
    expect(available.items.map(item => item.id)).toEqual([fixture.companyId]);
    expect(available.summary).toEqual({ available: 17, frozen: 2, reserved: 5, recoverable: 3, count: 1 });

    const review = await query.companies(Object.assign(new FundQueryDto(), { companyId: fixture.companyId, view: 'review' }));
    expect(review.total).toBe(1);
    const recovery = await query.companies(Object.assign(new FundQueryDto(), { companyId: fixture.companyId, view: 'recovery' }));
    expect(recovery.total).toBe(1);
  });

  it('filters payment pending/review/recovery views and keeps exact bank-reference search permission-gated', async () => {
    const base = { companyId: fixture.companyId, page: 1, pageSize: 20 };
    const pending = await query.payments(Object.assign(new FundQueryDto(), { ...base, view: 'pending' }));
    expect(pending.items.map(item => item.id)).toEqual([fixture.pendingPaymentId]);
    expect(pending.summary).toEqual({ pendingCount: 1, reviewCount: 1, recoveryCount: 1 });

    const review = await query.payments(Object.assign(new FundQueryDto(), { ...base, view: 'review' }));
    expect(review.items.map(item => item.id)).toEqual([fixture.reviewPaymentId]);
    const recovery = await query.payments(Object.assign(new FundQueryDto(), { ...base, view: 'recovery' }));
    expect(recovery.items.map(item => item.id)).toEqual([fixture.recoveryPaymentId]);

    const byCompany = await query.payments(Object.assign(new FundQueryDto(), { ...base, search: fixture.companyName }));
    expect(byCompany.total).toBe(3);
    const byPaymentId = await query.payments(Object.assign(new FundQueryDto(), { search: fixture.recoveryPaymentId }));
    expect(byPaymentId.items.map(item => item.id)).toEqual([fixture.recoveryPaymentId]);
    const byBankReference = await query.payments(Object.assign(new FundQueryDto(), { ...base, bankReference: fixture.recoveryBankReference }), true);
    expect(byBankReference.items.map(item => item.id)).toEqual([fixture.recoveryPaymentId]);
    await expect(query.payments(Object.assign(new FundQueryDto(), { ...base, bankReference: fixture.recoveryBankReference }), false)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
