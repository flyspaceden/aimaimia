import { CheckoutService } from './checkout.service';
import { ConflictException } from '@nestjs/common';

/**
 * Fix 4：收紧 active session guard 测试
 *
 * 原版本用 `if (caught instanceof ConflictException)` 软断言，前置校验失败时只 console.warn
 * 让测试通过。这会掩盖防重锁实际未执行的问题。
 *
 * 这里把所有事务前的 prisma / 服务依赖 mock 全部补完整，让 service 真正进入 $transaction，
 * 触发 active session guard，强断言必须抛 ConflictException + code=PENDING_CHECKOUT_EXISTS。
 */
describe('CheckoutService active session guard', () => {
  it('throws ConflictException with PENDING_CHECKOUT_EXISTS when active session exists in transaction', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const activeSession = {
      id: 'existing-session',
      userId: 'user1',
      status: 'ACTIVE',
      expiresAt,
      idempotencyKey: 'old-key',
    };

    const validSku = {
      id: 's1',
      productId: 'p1',
      title: 'SKU 1',
      price: 50,
      cost: 30,
      stock: 100,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: 0,
      product: {
        id: 'p1',
        companyId: 'c1',
        title: 'P1',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        bizType: 'NORMAL_GOODS',
        shippingTemplateId: null,
        returnPolicy: 'INHERIT',
        media: [],
      },
    };

    const validAddress = {
      id: 'a1',
      userId: 'user1',
      regionText: '北京市/北京市/朝阳区',
      regionCode: 'CN-BJ-CY',
      recipientName: '张三',
      phone: '13800000000',
      detail: '街道一号',
    };

    const prisma: any = {
      // 幂等检查：未命中
      checkoutSession: { findFirst: async () => null },
      // SKU 查询：返回有效 SKU
      productSKU: { findMany: async () => [validSku] },
      // 用户购物车
      cart: { findUnique: async () => null },
      cartItem: { findMany: async () => [] },
      // 地址校验
      address: { findUnique: async () => validAddress },
      // VIP 节点：null → 不走 VIP 折扣分支，不需要 bonusConfig
      vipTreeNode: { findFirst: async () => null },
      // 运费计算需要 bonusConfig（见下面 service 注入），不再走这里
      shippingConfig: { findFirst: async () => null },
      memberProfile: { findUnique: async () => null },
      // 奖励校验（dto 没传 rewardId 不会调用，但补上以防）
      rewardLedger: { findFirst: async () => null, findUnique: async () => null },
      couponInstance: { findMany: async () => [] },
      // 平台公司查询（VIP 折扣路径才需要，但补上保险）
      company: { findMany: async () => [] },
      lotteryRecord: { findUnique: async () => null },
      // 事务内：guard 第一步 findFirst 返回 active session → 触发 ConflictException
      $transaction: async (cb: any) => {
        const tx = {
          checkoutSession: {
            findFirst: async (args: any) => {
              if (args?.where?.status === 'ACTIVE') return activeSession;
              return null;
            },
          },
          rewardLedger: { updateMany: async () => ({ count: 0 }) },
        };
        return cb(tx);
      },
    };

    // bonusConfig 用于 calculateShippingFee
    const bonusConfig: any = {
      getSystemConfig: async () => ({
        vipFreeShippingThreshold: 0, // 0 = 无条件免运费 → 直接返回 0
        normalFreeShippingThreshold: 0,
        defaultShippingFee: 0,
      }),
    };

    const svc = new CheckoutService(prisma, bonusConfig);

    let caught: any;
    try {
      await svc.checkout('user1', {
        items: [{ skuId: 's1', quantity: 1 }],
        addressId: 'a1',
        idempotencyKey: 'new-key',
      } as any);
    } catch (e) {
      caught = e;
    }

    // 强断言：必须真的抛 ConflictException + 必须是 PENDING_CHECKOUT_EXISTS code
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({ code: 'PENDING_CHECKOUT_EXISTS' });
    expect((caught as ConflictException).getStatus()).toBe(409);
  });

  it('does not block when no active session exists (guard passes through)', async () => {
    const prisma: any = {
      checkoutSession: { findFirst: async () => null },
      // 后续会查 productSKU，让其抛错以验证守卫已放行（事务前的校验阶段）
      productSKU: { findMany: async () => { throw new Error('REACHED_SKU_QUERY'); } },
      cart: { findUnique: async () => null },
      cartItem: { findMany: async () => [] },
    };
    const svc = new CheckoutService(prisma, {} as any);
    await expect(
      svc.checkout('user1', { items: [{ skuId: 's1', quantity: 1 }] } as any),
    ).rejects.toThrow('REACHED_SKU_QUERY');
  });

  /**
   * bizType 隔离：普通 checkout 的防重锁查询带 bizType: 'NORMAL_GOODS',
   * 只有 VIP_PACKAGE session 存在时不应被挡。
   *
   * 实现校验：在 tx.checkoutSession.findFirst 收到 args.where.bizType 时断言为 NORMAL_GOODS,
   * 并（仅当符合该过滤条件）才返回 active session；否则返回 null → guard 不抛 ConflictException。
   */
  it('does NOT block normal checkout when only VIP session exists (bizType isolation)', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const vipActiveSession = {
      id: 'existing-vip-session',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'VIP_PACKAGE',
      expiresAt,
      idempotencyKey: 'old-vip-key',
    };

    const validSku = {
      id: 's1', productId: 'p1', title: 'SKU 1', price: 50, cost: 30,
      stock: 100, status: 'ACTIVE', maxPerOrder: null, weightGram: 0,
      product: {
        id: 'p1', companyId: 'c1', title: 'P1', status: 'ACTIVE',
        auditStatus: 'APPROVED', bizType: 'NORMAL_GOODS', shippingTemplateId: null,
        returnPolicy: 'INHERIT', media: [],
      },
    };
    const validAddress = {
      id: 'a1', userId: 'user1', regionText: '北京市/北京市/朝阳区',
      regionCode: 'CN-BJ-CY', recipientName: '张三', phone: '13800000000', detail: '街道一号',
    };

    let bizTypeFilterSeen: string | undefined;
    const prisma: any = {
      checkoutSession: { findFirst: async () => null },
      productSKU: { findMany: async () => [validSku] },
      cart: { findUnique: async () => null },
      cartItem: { findMany: async () => [] },
      address: { findUnique: async () => validAddress },
      vipTreeNode: { findFirst: async () => null },
      shippingConfig: { findFirst: async () => null },
      memberProfile: { findUnique: async () => null },
      rewardLedger: { findFirst: async () => null, findUnique: async () => null },
      couponInstance: { findMany: async () => [] },
      company: { findMany: async () => [] },
      lotteryRecord: { findUnique: async () => null },
      $transaction: async (cb: any) => {
        const tx = {
          checkoutSession: {
            findFirst: async (args: any) => {
              bizTypeFilterSeen = args?.where?.bizType;
              // 普通 checkout 守卫只查 NORMAL_GOODS — 仅 VIP session 存在时返 null
              if (args?.where?.bizType === 'VIP_PACKAGE') return vipActiveSession;
              return null;
            },
          },
          rewardLedger: { updateMany: async () => ({ count: 0 }) },
          // 让事务在守卫之后某步抛 sentinel（确认 guard 已放行）
          productSKU: { update: async () => { throw new Error('REACHED_AFTER_GUARD'); } },
        };
        return cb(tx);
      },
    };
    const bonusConfig: any = {
      getSystemConfig: async () => ({
        vipFreeShippingThreshold: 0, normalFreeShippingThreshold: 0, defaultShippingFee: 0,
      }),
    };
    const svc = new CheckoutService(prisma, bonusConfig);

    let caught: any;
    try {
      await svc.checkout('user1', {
        items: [{ skuId: 's1', quantity: 1 }],
        addressId: 'a1',
        idempotencyKey: 'new-normal-key',
      } as any);
    } catch (e) {
      caught = e;
    }

    // 关键断言：
    // 1) 守卫查询带 bizType 过滤（NORMAL_GOODS），不会撞到 VIP active session
    expect(bizTypeFilterSeen).toBe('NORMAL_GOODS');
    // 2) 不抛 ConflictException（普通 checkout 不应被 VIP session 挡道）
    expect(caught).not.toBeInstanceOf(ConflictException);
  });

  /**
   * 反向：VIP checkout 的防重锁查询带 bizType: 'VIP_PACKAGE',
   * 只有普通 NORMAL_GOODS session 存在时不应被挡。
   */
  it('does NOT block VIP checkout when only normal session exists (bizType isolation)', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const normalActiveSession = {
      id: 'existing-normal-session',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'NORMAL_GOODS',
      expiresAt,
      idempotencyKey: 'old-normal-key',
    };

    const validAddress = {
      id: 'a1', userId: 'user1', regionText: '北京市/北京市/朝阳区',
      regionCode: 'CN-BJ-CY', recipientName: '张三', phone: '13800000000', detail: '街道一号',
    };
    const vipPackage = {
      id: 'pkg1', status: 'ACTIVE', price: 999, referralBonusRate: 0.1,
    };
    // VIP 礼包前置校验要求 sku.product.companyId === PLATFORM_COMPANY_ID
    // 真值见 backend/src/modules/bonus/engine/constants.ts: 'PLATFORM_COMPANY'
    const PLATFORM = 'PLATFORM_COMPANY';
    const giftOption = {
      id: 'gift1',
      packageId: 'pkg1',
      status: 'ACTIVE',
      title: 'VIP 大礼包',
      coverMode: 'GRID',
      coverUrl: null,
      badge: null,
      items: [
        {
          quantity: 1,
          sortOrder: 0,
          sku: {
            id: 's1',
            title: 'SKU 1',
            price: 999,
            stock: 100,
            status: 'ACTIVE',
            product: {
              id: 'p1',
              title: 'Gift 1',
              companyId: PLATFORM,
              status: 'ACTIVE',
              media: [],
            },
          },
        },
      ],
    };

    let bizTypeFilterSeen: string | undefined;
    const prisma: any = {
      checkoutSession: { findFirst: async () => null },
      vipPackage: { findUnique: async () => vipPackage },
      vipGiftOption: { findUnique: async () => giftOption },
      address: { findUnique: async () => validAddress },
      memberProfile: { findUnique: async () => null },
      $transaction: async (cb: any) => {
        const tx = {
          checkoutSession: {
            findFirst: async (args: any) => {
              bizTypeFilterSeen = args?.where?.bizType;
              // VIP checkout 守卫只查 VIP_PACKAGE — 仅普通 session 存在时返 null
              if (args?.where?.bizType === 'NORMAL_GOODS') return normalActiveSession;
              return null;
            },
          },
          memberProfile: { findUnique: async () => null },
          // 让事务在守卫之后某步抛 sentinel（确认 guard 已放行）
          vipGiftOption: { findUnique: async () => { throw new Error('REACHED_AFTER_VIP_GUARD'); } },
        };
        return cb(tx);
      },
    };
    const bonusConfig: any = {
      getSystemConfig: async () => ({
        vipFreeShippingThreshold: 0, normalFreeShippingThreshold: 0, defaultShippingFee: 0,
      }),
    };
    const svc = new CheckoutService(prisma, bonusConfig);

    let caught: any;
    try {
      await svc.checkoutVipPackage('user1', {
        packageId: 'pkg1',
        giftOptionId: 'gift1',
        addressId: 'a1',
        idempotencyKey: 'new-vip-key',
      } as any);
    } catch (e) {
      caught = e;
    }

    // 关键断言：
    // 1) 守卫查询带 bizType 过滤（VIP_PACKAGE），不会撞到普通 active session
    expect(bizTypeFilterSeen).toBe('VIP_PACKAGE');
    // 2) 不抛 ConflictException（VIP checkout 不应被普通 session 挡道）
    expect(caught).not.toBeInstanceOf(ConflictException);
  });
});
