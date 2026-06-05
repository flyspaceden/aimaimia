import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import {
  AfterSaleStatus,
  AuthProvider,
  CheckoutSessionStatus,
  CompanyStaffRole,
  CompanyStaffStatus,
  CouponInstanceStatus,
  LotteryRecordStatus,
  PaymentStatus,
  Prisma,
  RewardEntryType,
  RewardLedgerStatus,
  SessionStatus,
  SmsPurpose,
  UserStatus,
  WithdrawStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { validate } from 'class-validator';
import { AccountDeletionConfirmMethod, ExecuteDeletionDto } from './dto/deletion.dto';
import { DeletionService } from './deletion.service';

const now = new Date('2026-06-04T16:00:00.000Z');
const userId = 'user-1';
const requestIp = '203.0.113.10';
const requestUserAgent = 'AimBuy/54.0 Android';

function phoneIdentity(identifier = '13800001234') {
  return {
    id: 'identity-phone',
    provider: AuthProvider.PHONE,
    identifier,
    appId: null,
    verified: true,
  };
}

function wechatIdentity(identifier = 'wx-openid-1234567890') {
  return {
    id: 'identity-wechat',
    provider: AuthProvider.WECHAT,
    identifier,
    appId: 'wx-app',
    verified: true,
  };
}

function makeTx(overrides: Record<string, any> = {}) {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        status: UserStatus.ACTIVE,
        deletionExecutedAt: null,
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: userId,
        status: UserStatus.ACTIVE,
        deletionExecutedAt: null,
        authIdentities: [phoneIdentity(), wechatIdentity()],
      }),
      update: jest.fn().mockResolvedValue({ id: userId }),
    },
    companyStaff: { count: jest.fn().mockResolvedValue(0) },
    checkoutSession: { count: jest.fn().mockResolvedValue(0) },
    payment: { count: jest.fn().mockResolvedValue(0) },
    paymentGroup: { count: jest.fn().mockResolvedValue(0) },
    withdrawRequest: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    userProfile: {
      findUnique: jest.fn().mockResolvedValue({ points: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    couponInstance: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    rewardAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    rewardLedger: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    lotteryRecord: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    order: { count: jest.fn().mockResolvedValue(0) },
    afterSaleRequest: { count: jest.fn().mockResolvedValue(0) },
    authIdentity: {
      findFirst: jest.fn().mockResolvedValue(phoneIdentity()),
    },
    smsOtp: {
      create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    address: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cart: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    follow: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    aiSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    inboxMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    taskCompletion: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    checkIn: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    loginEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    ...overrides,
  };
  tx.$transaction = jest.fn(async (cb: any, _options?: any) => cb(tx));
  return tx;
}

function makeService(overrides: {
  prisma?: any;
  config?: any;
  redis?: any;
  sms?: any;
} = {}) {
  const prisma = overrides.prisma ?? makeTx();
  const config = overrides.config ?? {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'SMS_MOCK') return 'true';
      if (key === 'NODE_ENV') return 'test';
      return fallback;
    }),
  };
  const redis = overrides.redis ?? {
    consumeFixedWindow: jest.fn().mockResolvedValue({ allowed: true, count: 1 }),
  };
  const sms = overrides.sms ?? {
    sendVerificationCode: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    config,
    redis,
    sms,
    service: new DeletionService(prisma, config, redis, sms),
  };
}

function executeDto(overrides: Partial<ExecuteDeletionDto> = {}): ExecuteDeletionDto {
  return {
    confirmationMethod: AccountDeletionConfirmMethod.WECHAT_MODAL,
    modalConfirmText: '确认注销',
    acknowledgedNotice: true,
    ...overrides,
  } as ExecuteDeletionDto;
}

function smsExecuteDto(code = '654321'): ExecuteDeletionDto {
  return executeDto({
    confirmationMethod: AccountDeletionConfirmMethod.SMS,
    smsCode: code,
    modalConfirmText: undefined,
  });
}

function mockWechatOnlyDeletion(prisma: any) {
  prisma.user.findUniqueOrThrow.mockResolvedValue({
    id: userId,
    status: UserStatus.ACTIVE,
    deletionExecutedAt: null,
    authIdentities: [wechatIdentity()],
  });
  prisma.authIdentity.findFirst.mockImplementation(({ where }: any) => {
    if (where.provider === AuthProvider.PHONE) return Promise.resolve(null);
    if (where.provider === AuthProvider.WECHAT) return Promise.resolve({ id: 'identity-wechat' });
    return Promise.resolve(null);
  });
}

async function mockSmsDeletion(prisma: any, code = '654321') {
  prisma.user.findUniqueOrThrow.mockResolvedValue({
    id: userId,
    status: UserStatus.ACTIVE,
    deletionExecutedAt: null,
    authIdentities: [phoneIdentity(), wechatIdentity()],
  });
  prisma.authIdentity.findFirst.mockImplementation(({ where }: any) => {
    if (where.provider === AuthProvider.PHONE) return Promise.resolve(phoneIdentity());
    if (where.provider === AuthProvider.WECHAT) return Promise.resolve({ id: 'identity-wechat' });
    return Promise.resolve(null);
  });
  prisma.smsOtp.findMany.mockResolvedValue([
    {
      id: 'otp-1',
      phone: '13800001234',
      purpose: SmsPurpose.DELETION,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(now.getTime() + 60_000),
      usedAt: null,
    },
  ]);
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Prisma transaction error', {
    code,
    clientVersion: 'test-client',
  });
}

async function expectAccountDeletionBlocked(
  promise: Promise<unknown>,
  expectedBlocker: Record<string, unknown>,
) {
  try {
    await promise;
    throw new Error('Expected ACCOUNT_DELETION_BLOCKED conflict');
  } catch (err) {
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'ACCOUNT_DELETION_BLOCKED',
      blockers: [expect.objectContaining(expectedBlocker)],
    });
  }
}

describe('DeletionService.preview blockers', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns USER_NOT_ACTIVE for a non-active account', async () => {
    const prisma = makeTx();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.BANNED,
      deletionExecutedAt: null,
    });
    const { service } = makeService({ prisma });

    const result = await service.preview(userId);

    expect(result.canDelete).toBe(false);
    expect(result.blockers).toContainEqual({
      code: 'USER_NOT_ACTIVE',
      message: '账号状态不支持注销',
      count: 1,
    });
  });

  it('returns IS_COMPANY_OWNER for an active merchant owner', async () => {
    const prisma = makeTx();
    prisma.companyStaff.count.mockResolvedValue(1);
    const { service } = makeService({ prisma });

    const result = await service.preview(userId);

    expect(result.blockers).toContainEqual({
      code: 'IS_COMPANY_OWNER',
      message: '您是企业创始人，请先转让或注销企业',
      count: 1,
    });
    expect(prisma.companyStaff.count).toHaveBeenCalledWith({
      where: { userId, role: CompanyStaffRole.OWNER, status: CompanyStaffStatus.ACTIVE },
    });
  });

  it('returns ACTIVE_CHECKOUT_EXISTS for an active checkout', async () => {
    const prisma = makeTx();
    prisma.checkoutSession.count.mockResolvedValue(2);
    const { service } = makeService({ prisma });

    const result = await service.preview(userId);

    expect(result.blockers).toContainEqual({
      code: 'ACTIVE_CHECKOUT_EXISTS',
      message: '您有正在支付或确认中的订单，请先完成或取消',
      count: 2,
    });
    expect(prisma.checkoutSession.count).toHaveBeenCalledWith({
      where: {
        userId,
        status: { in: [CheckoutSessionStatus.ACTIVE, CheckoutSessionStatus.PAID] },
      },
    });
  });

  it('returns PENDING_PAYMENT_EXISTS for processing payment records', async () => {
    const prisma = makeTx();
    prisma.payment.count.mockResolvedValue(1);
    prisma.paymentGroup.count.mockResolvedValue(2);
    const { service } = makeService({ prisma });

    const result = await service.preview(userId);

    expect(result.blockers).toContainEqual({
      code: 'PENDING_PAYMENT_EXISTS',
      message: '您有支付处理中记录，请稍后再试',
      count: 3,
    });
    expect(prisma.payment.count).toHaveBeenCalledWith({
      where: {
        status: { in: [PaymentStatus.INIT, PaymentStatus.PENDING] },
        order: { userId },
      },
    });
    expect(prisma.paymentGroup.count).toHaveBeenCalledWith({
      where: { userId, status: { in: [PaymentStatus.INIT, PaymentStatus.PENDING] } },
    });
  });

  it('returns WITHDRAW_PROCESSING_EXISTS for a processing withdrawal', async () => {
    const prisma = makeTx();
    prisma.withdrawRequest.count.mockResolvedValue(1);
    const { service } = makeService({ prisma });

    const result = await service.preview(userId);

    expect(result.blockers).toContainEqual({
      code: 'WITHDRAW_PROCESSING_EXISTS',
      message: '您有提现处理中记录，请到账或失败后再注销',
      count: 1,
    });
    expect(prisma.withdrawRequest.count).toHaveBeenCalledWith({
      where: {
        userId,
        status: { in: [WithdrawStatus.REQUESTED, WithdrawStatus.PROCESSING, WithdrawStatus.APPROVED] },
      },
    });
  });

  it('returns WITHDRAW_PROCESSING_EXISTS for a requested withdrawal and keeps pending amount consistent', async () => {
    const prisma = makeTx();
    prisma.withdrawRequest.count.mockResolvedValue(1);
    prisma.withdrawRequest.aggregate.mockResolvedValue({ _sum: { amount: 25 } });
    const { service } = makeService({ prisma });

    const result = await service.preview(userId);

    expect(result.canDelete).toBe(false);
    expect(result.assets.pendingWithdrawAmount).toBe(25);
    expect(result.blockers).toContainEqual({
      code: 'WITHDRAW_PROCESSING_EXISTS',
      message: '您有提现处理中记录，请到账或失败后再注销',
      count: 1,
    });
  });

  it('returns paid orders and active after-sales in pending without blocking', async () => {
    const prisma = makeTx();
    prisma.order.count.mockResolvedValue(2);
    prisma.afterSaleRequest.count.mockResolvedValue(1);
    const { service } = makeService({ prisma });

    const result = await service.preview(userId);

    expect(result.canDelete).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.pending).toEqual({ paidOrders: 2, activeAfterSales: 1 });
    expect(prisma.afterSaleRequest.count).toHaveBeenCalledWith({
      where: {
        userId,
        status: {
          notIn: [
            AfterSaleStatus.REJECTED,
            AfterSaleStatus.REFUNDED,
            AfterSaleStatus.COMPLETED,
            AfterSaleStatus.CLOSED,
            AfterSaleStatus.CANCELED,
          ],
        },
      },
    });
  });
});

describe('DeletionService.execute', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-checks blockers after preview inside the Serializable transaction', async () => {
    const prisma = makeTx();
    prisma.companyStaff.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const { service } = makeService({ prisma });

    await expect(service.preview(userId)).resolves.toMatchObject({ canDelete: true });
    await expect(service.execute(userId, executeDto())).rejects.toThrow(ConflictException);

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('returns USER_NOT_ACTIVE blocker payload for an already deleted account', async () => {
    const prisma = makeTx();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.DELETED,
      deletionExecutedAt: now,
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: userId,
      status: UserStatus.DELETED,
      deletionExecutedAt: now,
      authIdentities: [phoneIdentity()],
    });
    const { service } = makeService({ prisma });

    await expectAccountDeletionBlocked(
      service.execute(userId, executeDto()),
      {
        code: 'USER_NOT_ACTIVE',
        message: '账号状态不支持注销',
        count: 1,
      },
    );

    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('returns USER_NOT_ACTIVE blocker payload for a non-active account', async () => {
    const prisma = makeTx();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.BANNED,
      deletionExecutedAt: null,
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: userId,
      status: UserStatus.BANNED,
      deletionExecutedAt: null,
      authIdentities: [phoneIdentity()],
    });
    const { service } = makeService({ prisma });

    await expectAccountDeletionBlocked(
      service.execute(userId, executeDto()),
      {
        code: 'USER_NOT_ACTIVE',
        message: '账号状态不支持注销',
        count: 1,
      },
    );

    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('returns USER_NOT_ACTIVE blocker payload for a missing account', async () => {
    const prisma = makeTx();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('No User found'));
    const { service } = makeService({ prisma });

    await expectAccountDeletionBlocked(
      service.execute(userId, executeDto()),
      {
        code: 'USER_NOT_ACTIVE',
        message: '账号状态不支持注销',
        count: 1,
      },
    );

    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('blocks execute when a requested withdrawal exists', async () => {
    const prisma = makeTx();
    prisma.withdrawRequest.count.mockResolvedValue(1);
    const { service } = makeService({ prisma });

    await expectAccountDeletionBlocked(
      service.execute(userId, executeDto()),
      {
        code: 'WITHDRAW_PROCESSING_EXISTS',
        message: '您有提现处理中记录，请到账或失败后再注销',
        count: 1,
      },
    );

    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a wrong SMS deletion code', async () => {
    const prisma = makeTx();
    prisma.smsOtp.findMany.mockResolvedValue([
      {
        id: 'otp-1',
        phone: '13800001234',
        purpose: SmsPurpose.DELETION,
        codeHash: await bcrypt.hash('123456', 10),
        expiresAt: new Date(now.getTime() + 60_000),
        usedAt: null,
      },
    ]);
    const { service } = makeService({ prisma });

    await expect(
      service.execute(userId, executeDto({
        confirmationMethod: AccountDeletionConfirmMethod.SMS,
        smsCode: '000000',
        modalConfirmText: undefined,
      })),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.smsOtp.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('accepts a valid SMS deletion code, consumes the OTP, and deletes the account', async () => {
    const prisma = makeTx();
    prisma.smsOtp.findMany.mockResolvedValue([
      {
        id: 'otp-1',
        phone: '13800001234',
        purpose: SmsPurpose.DELETION,
        codeHash: await bcrypt.hash('654321', 10),
        expiresAt: new Date(now.getTime() + 60_000),
        usedAt: null,
      },
    ]);
    const { service } = makeService({ prisma });

    const result = await service.execute(userId, executeDto({
      confirmationMethod: AccountDeletionConfirmMethod.SMS,
      smsCode: '654321',
      modalConfirmText: undefined,
    }));

    expect(result).toEqual({ ok: true, message: '账号已注销' });
    expect(prisma.smsOtp.updateMany).toHaveBeenCalledWith({
      where: { id: 'otp-1', usedAt: null },
      data: { usedAt: now },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        deletionExecutedAt: now,
        deletionConfirmMethod: AccountDeletionConfirmMethod.SMS,
      },
    });
  });

  it('rejects WeChat modal execution when no verified WeChat identity exists', async () => {
    const prisma = makeTx();
    prisma.authIdentity.findFirst.mockResolvedValue(null);
    const { service } = makeService({ prisma });

    await expect(service.execute(userId, executeDto())).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('rejects WeChat modal execution when the account has a verified phone identity', async () => {
    const prisma = makeTx();
    prisma.authIdentity.findFirst.mockImplementation(({ where }: any) => {
      if (where.provider === AuthProvider.PHONE) return Promise.resolve(phoneIdentity());
      if (where.provider === AuthProvider.WECHAT) return Promise.resolve({ id: 'identity-wechat' });
      return Promise.resolve(null);
    });
    const { service } = makeService({ prisma });

    await expect(service.execute(userId, executeDto())).rejects.toThrow(BadRequestException);
    expect(prisma.smsOtp.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('accepts the exact WeChat modal confirmation text', async () => {
    const prisma = makeTx();
    mockWechatOnlyDeletion(prisma);
    const { service } = makeService({ prisma });

    const result = await service.execute(userId, executeDto());

    expect(result).toEqual({ ok: true, message: '账号已注销' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        deletionExecutedAt: now,
        deletionConfirmMethod: AccountDeletionConfirmMethod.WECHAT_MODAL,
      },
    });
  });

  it('zeroes reward balances and voids unused coupons', async () => {
    const prisma = makeTx();
    mockWechatOnlyDeletion(prisma);
    prisma.rewardAccount.findMany.mockResolvedValue([
      { id: 'reward-vip', userId, type: 'VIP_REWARD', balance: 12, frozen: 3 },
      { id: 'reward-normal', userId, type: 'NORMAL_REWARD', balance: 4, frozen: 0 },
    ]);
    prisma.couponInstance.findMany.mockResolvedValue([{ id: 'coupon-1', status: CouponInstanceStatus.AVAILABLE }]);
    const { service } = makeService({ prisma });

    await service.execute(userId, executeDto());

    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { userId },
      data: { balance: 0, frozen: 0 },
    });
    expect(prisma.rewardLedger.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          accountId: 'reward-vip',
          userId,
          entryType: RewardEntryType.VOID,
          amount: 15,
          status: RewardLedgerStatus.VOIDED,
          meta: expect.objectContaining({ reason: 'ACCOUNT_DELETION' }),
        }),
        expect.objectContaining({
          accountId: 'reward-normal',
          amount: 4,
          status: RewardLedgerStatus.VOIDED,
        }),
      ],
    });
    expect(prisma.couponInstance.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        status: { in: [CouponInstanceStatus.AVAILABLE, CouponInstanceStatus.RESERVED] },
      },
      data: {
        status: CouponInstanceStatus.REVOKED,
        usedAt: null,
        usedOrderId: null,
        usedAmount: null,
      },
    });
  });

  it('voids existing reversible reward ledgers so cron/refund flows cannot revive assets after deletion', async () => {
    const prisma = makeTx();
    mockWechatOnlyDeletion(prisma);
    const { service } = makeService({ prisma });

    await service.execute(userId, executeDto());

    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        status: {
          in: [
            RewardLedgerStatus.AVAILABLE,
            RewardLedgerStatus.FROZEN,
            RewardLedgerStatus.RETURN_FROZEN,
          ],
        },
      },
      data: {
        status: RewardLedgerStatus.VOIDED,
        entryType: RewardEntryType.VOID,
      },
    });
  });

  it('rewrites phone and WeChat identity identifiers through a tombstone raw SQL update', async () => {
    const prisma = makeTx();
    await mockSmsDeletion(prisma);
    const { service } = makeService({ prisma });

    await service.execute(userId, smsExecuteDto());

    const sqlCalls = prisma.$executeRaw.mock.calls.map((call: any[]) => String(call[0]));
    expect(sqlCalls.some((sql: string) => sql.includes('UPDATE "AuthIdentity"'))).toBe(true);
    expect(sqlCalls.some((sql: string) => sql.includes("concat('deleted:', \"provider\""))).toBe(true);
    expect(prisma.$executeRaw.mock.calls.some((call: any[]) => call.includes(userId))).toBe(true);
  });

  it('writes the pre-cleanup snapshot into deletionMeta', async () => {
    const prisma = makeTx();
    mockWechatOnlyDeletion(prisma);
    prisma.userProfile.findUnique.mockResolvedValue({ points: 88 });
    prisma.rewardAccount.findMany.mockResolvedValue([
      { id: 'reward-vip', userId, type: 'VIP_REWARD', balance: 12, frozen: 3 },
    ]);
    prisma.couponInstance.findMany.mockResolvedValue([{ id: 'coupon-1', status: CouponInstanceStatus.AVAILABLE }]);
    prisma.lotteryRecord.findMany.mockResolvedValue([{ id: 'lottery-1', status: LotteryRecordStatus.WON }]);
    const { service } = makeService({ prisma });

    await service.execute(userId, executeDto());

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        deletionMeta: expect.objectContaining({
          action: 'ACCOUNT_DELETION',
          confirmationMethod: AccountDeletionConfirmMethod.WECHAT_MODAL,
          snapshot: expect.objectContaining({
            assets: expect.objectContaining({
              points: 88,
              coupons: 1,
              withdrawableRewards: 12,
              frozenRewards: 3,
              lotteryQuota: 1,
            }),
          }),
        }),
      },
    });
  });

  it('creates a deletion audit LoginEvent', async () => {
    const prisma = makeTx();
    await mockSmsDeletion(prisma);
    const { service } = makeService({ prisma });

    await service.execute(userId, smsExecuteDto());

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, expiresAt: now },
    });
    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        provider: AuthProvider.PHONE,
        success: true,
        phone: '138****1234',
        meta: expect.objectContaining({
          action: 'DELETION_EXECUTED',
          confirmationMethod: AccountDeletionConfirmMethod.SMS,
        }),
      }),
    });
  });

  it('writes IP and User-Agent into deletionMeta and LoginEvent evidence', async () => {
    const prisma = makeTx();
    mockWechatOnlyDeletion(prisma);
    const { service } = makeService({ prisma });

    await (service.execute as any)(userId, executeDto(), requestIp, requestUserAgent);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        deletionMeta: expect.objectContaining({
          ip: requestIp,
          userAgent: requestUserAgent,
        }),
      },
    });
    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        ip: requestIp,
        userAgent: requestUserAgent,
        meta: expect.objectContaining({
          action: 'DELETION_EXECUTED',
          ip: requestIp,
          userAgent: requestUserAgent,
        }),
      }),
    });
  });

  it('retries a Serializable transaction after Prisma P2034 and eventually succeeds', async () => {
    jest.useRealTimers();
    const prisma = makeTx();
    mockWechatOnlyDeletion(prisma);
    prisma.$transaction = jest
      .fn()
      .mockRejectedValueOnce(prismaError('P2034'))
      .mockImplementation(async (cb: any, _options?: any) => cb(prisma));
    const { service } = makeService({ prisma });

    await expect(service.execute(userId, executeDto())).resolves.toEqual({
      ok: true,
      message: '账号已注销',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        deletionExecutedAt: expect.any(Date),
        deletionConfirmMethod: AccountDeletionConfirmMethod.WECHAT_MODAL,
      },
    });
  });

  it('does not retry non-P2034 transaction errors', async () => {
    const prisma = makeTx();
    const error = prismaError('P2002');
    prisma.$transaction = jest.fn().mockRejectedValue(error);
    const { service } = makeService({ prisma });

    await expect(service.execute(userId, executeDto())).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects when acknowledgedNotice is not true even without relying on DTO validation', async () => {
    const prisma = makeTx();
    const { service } = makeService({ prisma });

    await expect(service.execute(userId, executeDto({
      acknowledgedNotice: false as true,
    }))).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('ExecuteDeletionDto validation', () => {
  it('requires acknowledgedNotice to be exactly true', async () => {
    const dto = Object.assign(new ExecuteDeletionDto(), {
      confirmationMethod: AccountDeletionConfirmMethod.WECHAT_MODAL,
      modalConfirmText: '确认注销',
      acknowledgedNotice: false,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'acknowledgedNotice')).toBe(true);
  });
});

describe('DeletionService.sendCode', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses deletion-scoped SMS OTP rate limiting and rejects blocked accounts before sending', async () => {
    const blocked = makeTx();
    blocked.companyStaff.count.mockResolvedValue(1);
    const blockedService = makeService({ prisma: blocked }).service;

    await expect(blockedService.sendCode(userId)).rejects.toThrow(ConflictException);
    expect(blocked.smsOtp.create).not.toHaveBeenCalled();

    const allowed = makeTx();
    const { service, redis } = makeService({ prisma: allowed });

    await expect(service.sendCode(userId)).resolves.toEqual({ ok: true });
    expect(redis.consumeFixedWindow).toHaveBeenCalledWith(
      expect.stringContaining('rl:otp:target:'),
      1,
      60,
    );
    expect(redis.consumeFixedWindow).toHaveBeenCalledWith(
      expect.stringContaining(':3600s'),
      5,
      3600,
    );
    expect(allowed.smsOtp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '13800001234',
        purpose: SmsPurpose.DELETION,
      }),
    });
  });

  it('rejects SMS sending when the account has no phone identity', async () => {
    const prisma = makeTx();
    prisma.authIdentity.findFirst.mockResolvedValue(null);
    const { service } = makeService({ prisma });

    await expect(service.sendCode(userId)).rejects.toThrow(BadRequestException);
  });

  it('surfaces deletion OTP rate-limit failures as HTTP exceptions', async () => {
    const prisma = makeTx();
    const { service } = makeService({
      prisma,
      redis: {
        consumeFixedWindow: jest.fn().mockResolvedValue({ allowed: false, count: 2 }),
      },
    });

    await expect(service.sendCode(userId)).rejects.toThrow(HttpException);
    expect(prisma.smsOtp.create).not.toHaveBeenCalled();
  });

  it('retries deletion OTP DB fallback when the Serializable transaction hits P2034', async () => {
    jest.useRealTimers();
    const prisma = makeTx();
    prisma.$transaction = jest
      .fn()
      .mockRejectedValueOnce(prismaError('P2034'))
      .mockImplementation(async (cb: any, _options?: any) => cb(prisma));
    const { service } = makeService({
      prisma,
      redis: { consumeFixedWindow: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.sendCode(userId)).resolves.toEqual({ ok: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.smsOtp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '13800001234',
        purpose: SmsPurpose.DELETION,
      }),
    });
  });

  it('does not retry non-P2034 deletion OTP DB fallback errors', async () => {
    const prisma = makeTx();
    const error = prismaError('P2002');
    prisma.$transaction = jest.fn().mockRejectedValue(error);
    const { service } = makeService({
      prisma,
      redis: { consumeFixedWindow: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.sendCode(userId)).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
