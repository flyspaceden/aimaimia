/**
 * 综合流程回归测试：抽奖 + 跨日认领 + 配额检查
 * 覆盖 docs/issues/app-tofix4.md 第三方测试 checklist 中"角色 A/B"涉及的核心边界。
 *
 * 不覆盖的场景：
 * - 未登录抽奖 IP/指纹三重限流（涉及 Redis 计数器，由集成测试覆盖）
 * - 支付回调链路（由 checkout-excluded-prize-cleanup.spec.ts 覆盖）
 */
import { BadRequestException } from '@nestjs/common';
import { LotteryService } from './lottery.service';
import { CartService } from '../cart/cart.service';
import { generateClaimToken } from '../../common/utils/claim-token.util';

const SECRET = 'dev-claim-secret-do-not-use-in-production';

function todayUtc8(): string {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function yesterdayUtc8(): string {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
function dayBeforeYesterdayUtc8(): string {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000 - 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// ---------------- LotteryService.draw ----------------
describe('LotteryService.draw — 已登录抽奖账户配额 + 奖品可用性', () => {
  function buildPhysicalPrize(overrides: Partial<any> = {}) {
    return {
      id: 'prize-physical',
      type: 'DISCOUNT_BUY',
      probability: 100,
      dailyLimit: null,
      totalLimit: null,
      wonCount: 0,
      expirationHours: 50,
      prizePrice: 1,
      originalPrice: 39,
      threshold: null,
      prizeQuantity: 1,
      sortOrder: 1,
      isActive: true,
      name: '1 元购',
      productId: 'product-1',
      skuId: 'sku-1',
      sku: {
        id: 'sku-1',
        status: 'ACTIVE',
        product: { id: 'product-1', status: 'ACTIVE' },
      },
      product: { id: 'product-1', status: 'ACTIVE' },
      ...overrides,
    };
  }

  function buildNoPrize() {
    return {
      id: 'prize-noprize',
      type: 'NO_PRIZE',
      probability: 100,
      dailyLimit: null,
      totalLimit: null,
      wonCount: 0,
      expirationHours: null,
      prizePrice: null,
      originalPrice: null,
      threshold: null,
      prizeQuantity: 1,
      sortOrder: 1,
      isActive: true,
      name: '谢谢参与',
      productId: null,
      skuId: null,
      sku: null,
      product: null,
    };
  }

  function createService(prizes: any[], todayCount: number) {
    const tx: any = {
      lotteryRecord: {
        count: jest.fn().mockResolvedValue(todayCount),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'lr-new',
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      lotteryPrize: {
        findMany: jest.fn().mockResolvedValue(prizes),
        findUnique: jest.fn().mockResolvedValue({ wonCount: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { create: jest.fn().mockResolvedValue({ id: 'ci-new' }) },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        lotteryEnabled: true,
        lotteryDailyChances: 1,
      }),
    };
    const config: any = {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : undefined)),
    };
    const redisCoord: any = {};
    const service = new LotteryService(prisma, bonusConfig, config, redisCoord);
    return { service, tx };
  }

  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0); // 固定选第一个 prize
  });
  afterEach(() => jest.restoreAllMocks());

  it('账户当天首次抽奖 → 成功创建 LotteryRecord', async () => {
    const { service, tx } = createService([buildPhysicalPrize()], 0);
    const result = await service.draw('user-A');
    expect(result.result).toBe('WON');
    expect(tx.lotteryRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-A', result: 'WON' }),
      }),
    );
  });

  it('账户当天已抽过 1 次 → 抛"今日抽奖次数已用完"', async () => {
    const { service } = createService([buildPhysicalPrize()], 1);
    await expect(service.draw('user-A')).rejects.toThrow('今日抽奖次数已用完');
  });

  it('抽中 NO_PRIZE → 创建 NO_PRIZE 记录，不入购物车', async () => {
    const { service, tx } = createService([buildNoPrize()], 0);
    const result = await service.draw('user-A');
    expect(result.result).toBe('NO_PRIZE');
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });

  it('抽中实物奖品但底层 SKU 下架 → 降级为 NO_PRIZE，不入购物车', async () => {
    const inactive = buildPhysicalPrize({
      sku: { id: 'sku-1', status: 'INACTIVE', product: { id: 'product-1', status: 'ACTIVE' } },
    });
    const { service, tx } = createService([inactive], 0);
    const result = await service.draw('user-A');
    expect(result.result).toBe('NO_PRIZE');
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });

  it('抽中实物奖品但 prize.isActive=false → 降级为 NO_PRIZE', async () => {
    const inactive = buildPhysicalPrize({ isActive: false });
    const { service, tx } = createService([inactive], 0);
    const result = await service.draw('user-A');
    expect(result.result).toBe('NO_PRIZE');
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });
});

// ---------------- CartService.mergeItems prize path ----------------
describe('CartService.mergePrizeItem — 跨日认领 + 账户配额', () => {
  function makeCartService(opts: {
    todayDrawCount: number;
    drawDateInPayload: string;
    prizeIsActive?: boolean;
    skuStatus?: string;
    productStatus?: string;
    redisClaimDataExists?: boolean;
    duplicateRecord?: boolean;
    invalidSignature?: boolean;
  }) {
    const claimData = {
      prizeId: 'prize-1',
      prizeType: 'DISCOUNT_BUY',
      prizePrice: 1,
      originalPrice: 39,
      skuId: 'sku-1',
      threshold: null,
      prizeQuantity: 1,
    };
    const redisGetSpy = jest
      .fn()
      .mockResolvedValue(opts.redisClaimDataExists === false ? null : JSON.stringify(claimData));
    const redisDelSpy = jest.fn().mockResolvedValue(undefined);
    const redisAcquireSpy = jest.fn().mockResolvedValue(true);
    const redisReleaseSpy = jest.fn().mockResolvedValue(undefined);

    const tx: any = {
      lotteryRecord: {
        count: jest.fn().mockResolvedValue(opts.todayDrawCount),
        findFirst: jest.fn().mockResolvedValue(opts.duplicateRecord ? { id: 'lr-existing' } : null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'lr-new',
          ...data,
        })),
      },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { create: jest.fn().mockResolvedValue({ id: 'ci-new' }) },
    };

    const prisma: any = {
      lotteryPrize: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'prize-1',
          name: '1 元购',
          type: 'DISCOUNT_BUY',
          isActive: opts.prizeIsActive ?? true,
          skuId: 'sku-1',
          productId: 'product-1',
          sku: {
            id: 'sku-1',
            status: opts.skuStatus ?? 'ACTIVE',
            product: { id: 'product-1', status: opts.productStatus ?? 'ACTIVE' },
          },
          product: { id: 'product-1', status: opts.productStatus ?? 'ACTIVE' },
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const config: any = {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : undefined)),
    };
    const redisCoord: any = {
      acquireLock: redisAcquireSpy,
      releaseLock: redisReleaseSpy,
      get: redisGetSpy,
      del: redisDelSpy,
    };
    const bonusConfig: any = {
      getSystemConfig: jest
        .fn()
        .mockResolvedValue({ lotteryEnabled: true, lotteryDailyChances: 1 }),
    };
    const service = new CartService(prisma, config, redisCoord, bonusConfig);
    jest.spyOn(service, 'getCart').mockResolvedValue({ id: 'cart-1', items: [] } as any);
    return { service, tx, redisDelSpy, redisReleaseSpy, prisma };
  }

  it('账户今天没抽过 + 凭证日期=今天 → 成功认领，加入购物车', async () => {
    const drawDate = todayUtc8();
    const token = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate, ts: Date.now() },
      SECRET,
    );
    const { service, tx } = makeCartService({ todayDrawCount: 0, drawDateInPayload: drawDate });

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: token } as any,
    ]);
    expect((result as any).mergeResults[0].status).toBe('MERGED');
    expect(tx.cartItem.create).toHaveBeenCalled();
  });

  it('账户今天已抽过 1 次 → 拒绝认领（REJECTED_ALREADY_DRAWN_TODAY）', async () => {
    const drawDate = todayUtc8();
    const token = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate, ts: Date.now() },
      SECRET,
    );
    const { service, tx } = makeCartService({ todayDrawCount: 1, drawDateInPayload: drawDate });

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: token } as any,
    ]);
    expect((result as any).mergeResults[0].status).toBe('REJECTED_ALREADY_DRAWN_TODAY');
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });

  it('凭证日期=昨天 + 账户今天没抽过 → 跨日认领成功', async () => {
    const drawDate = yesterdayUtc8();
    const token = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate, ts: Date.now() - 12 * 3600 * 1000 },
      SECRET,
    );
    const { service, tx } = makeCartService({ todayDrawCount: 0, drawDateInPayload: drawDate });

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: token } as any,
    ]);
    expect((result as any).mergeResults[0].status).toBe('MERGED');
    expect(tx.cartItem.create).toHaveBeenCalled();
  });

  it('凭证日期=前天 → 拒绝（REJECTED_TOKEN_EXPIRED）', async () => {
    const drawDate = dayBeforeYesterdayUtc8();
    const token = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate, ts: Date.now() - 48 * 3600 * 1000 },
      SECRET,
    );
    const { service } = makeCartService({ todayDrawCount: 0, drawDateInPayload: drawDate });

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: token } as any,
    ]);
    expect((result as any).mergeResults[0].status).toBe('REJECTED_TOKEN_EXPIRED');
  });

  it('凭证签名无效 → 拒绝（REJECTED_TOKEN_INVALID）', async () => {
    const { service } = makeCartService({ todayDrawCount: 0, drawDateInPayload: todayUtc8() });

    // 用错误 secret 签的 token
    const badToken = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate: todayUtc8(), ts: Date.now() },
      'wrong-secret',
    );

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: badToken } as any,
    ]);
    expect((result as any).mergeResults[0].status).toBe('REJECTED_TOKEN_INVALID');
  });

  it('Redis claim 数据已被消费 → 拒绝（claim_consumed）', async () => {
    const drawDate = todayUtc8();
    const token = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate, ts: Date.now() },
      SECRET,
    );
    const { service } = makeCartService({
      todayDrawCount: 0,
      drawDateInPayload: drawDate,
      redisClaimDataExists: false,
    });

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: token } as any,
    ]);
    expect((result as any).mergeResults[0].status).not.toBe('MERGED');
    // claim_consumed 错误文本不直接对应专用 status，落到 FAILED 或 REJECTED_TOKEN_USED
    expect(['REJECTED_TOKEN_USED', 'FAILED']).toContain(
      (result as any).mergeResults[0].status,
    );
  });

  it('SKU 已下架 → 拒绝（REJECTED_PRIZE_INACTIVE）+ Redis claim 被清理（防止重试）', async () => {
    const drawDate = todayUtc8();
    const token = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate, ts: Date.now() },
      SECRET,
    );
    const { service, redisDelSpy, redisReleaseSpy } = makeCartService({
      todayDrawCount: 0,
      drawDateInPayload: drawDate,
      skuStatus: 'INACTIVE',
    });

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: token } as any,
    ]);
    expect((result as any).mergeResults[0].status).toBe('REJECTED_PRIZE_INACTIVE');
    // BUG-F 修复后：del 应被调用清理 claim + lock
    expect(redisDelSpy).toHaveBeenCalled();
    // 不再走旧的 releaseLock-only 路径
    expect(redisReleaseSpy).not.toHaveBeenCalled();
  });

  it('同凭证重复认领（DB 级幂等） → 静默跳过，不报错', async () => {
    const drawDate = todayUtc8();
    const token = generateClaimToken(
      { fp: 'fp-1', prizeId: 'prize-1', drawDate, ts: Date.now() },
      SECRET,
    );
    const { service, tx } = makeCartService({
      todayDrawCount: 0,
      drawDateInPayload: drawDate,
      duplicateRecord: true, // 模拟 DB 已存在同 hash 的 LotteryRecord
    });

    const result = await service.mergeItems('user-A', [
      { skuId: 'sku-1', quantity: 1, isPrize: true, claimToken: token } as any,
    ]);
    // 幂等：跳过创建，不抛错；status 视作 MERGED 或类似成功类
    expect((result as any).mergeResults[0].status).toBe('MERGED');
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.lotteryRecord.create).not.toHaveBeenCalled();
  });
});
