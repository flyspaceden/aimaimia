import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const CONFIRMATION = 'staging-miniapp-runtime-fixtures';
const DEFAULT_STAGING_DATABASE = 'testaimaimai';

export type RuntimeFixtureArgs = {
  action: 'create' | 'cleanup' | 'inspect';
  userId: string;
  buyerNo: string;
  confirm: string;
  expectedDatabase: string;
};

export type RuntimeFixtureIds = ReturnType<typeof buildRuntimeFixtureIds>;

export function databaseNameFromUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL 不是有效的 PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL 必须使用 PostgreSQL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '').trim());
  if (!database) throw new Error('DATABASE_URL 缺少数据库名');
  return database;
}

export function assertRuntimeFixtureEnvironment(input: {
  databaseUrl?: string;
  expectedDatabase?: string;
  allow?: string;
  confirm?: string;
  userId?: string;
  buyerNo?: string;
}): { databaseName: string; userId: string; buyerNo: string } {
  if (input.allow !== 'staging') {
    throw new Error('拒绝执行：必须显式设置 MINIAPP_RUNTIME_FIXTURE_ALLOW=staging');
  }
  if (input.confirm !== CONFIRMATION) {
    throw new Error(`拒绝执行：需要 --confirm=${CONFIRMATION}`);
  }
  const userId = input.userId?.trim() || '';
  const buyerNo = input.buyerNo?.trim().toUpperCase() || '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(userId)) {
    throw new Error('拒绝执行：必须传入明确的 --user-id');
  }
  if (!/^AIMM\d{14}$/.test(buyerNo)) {
    throw new Error('拒绝执行：--buyer-no 必须是 AIMM + 14 位数字');
  }
  const databaseName = databaseNameFromUrl(input.databaseUrl || '');
  const expectedDatabase = input.expectedDatabase?.trim() || DEFAULT_STAGING_DATABASE;
  if (databaseName !== expectedDatabase || expectedDatabase !== DEFAULT_STAGING_DATABASE) {
    throw new Error(`拒绝执行：只允许测试数据库 ${DEFAULT_STAGING_DATABASE}，当前为 ${databaseName}`);
  }
  return { databaseName, userId, buyerNo };
}

function shortHash(value: string, length = 10): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

export function buildRuntimeFixtureIds(userId: string) {
  const prefix = `wmp_rt_v1_${shortHash(userId)}`;
  return {
    prefix,
    address: `${prefix}_address`,
    invoiceProfile: `${prefix}_invoice_profile`,
    normalShareProfile: `${prefix}_normal_share`,
    captainProfile: `${prefix}_captain_profile`,
    scene: `${prefix}_scene`,
    activity: `${prefix}_activity`,
    activityTier: `${prefix}_activity_tier`,
    checkout: `${prefix}_checkout`,
    orders: {
      paid: `${prefix}_order_paid`,
      shipped: `${prefix}_order_shipped`,
      eligible: `${prefix}_order_eligible`,
      history: `${prefix}_order_history`,
    },
    orderItems: {
      paid: `${prefix}_item_paid`,
      shipped: `${prefix}_item_shipped`,
      eligible: `${prefix}_item_eligible`,
      history: `${prefix}_item_history`,
    },
    payments: {
      paid: `${prefix}_payment_paid`,
      shipped: `${prefix}_payment_shipped`,
      eligible: `${prefix}_payment_eligible`,
      history: `${prefix}_payment_history`,
    },
    histories: {
      paid: `${prefix}_history_paid`,
      shipped: `${prefix}_history_shipped`,
      eligible: `${prefix}_history_eligible`,
      history: `${prefix}_history_history`,
    },
    shipment: `${prefix}_shipment`,
    shipmentEvents: [
      `${prefix}_shipment_event_1`,
      `${prefix}_shipment_event_2`,
      `${prefix}_shipment_event_3`,
    ],
    afterSale: `${prefix}_after_sale`,
    afterSaleHistory: `${prefix}_after_sale_history`,
    invoice: `${prefix}_invoice`,
    invoiceHistory: `${prefix}_invoice_history`,
  } as const;
}

function argValue(name: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

export function parseRuntimeFixtureArgs(): RuntimeFixtureArgs {
  const action = (argValue('action') || 'inspect') as RuntimeFixtureArgs['action'];
  if (!['create', 'cleanup', 'inspect'].includes(action)) {
    throw new Error('--action 只支持 create / cleanup / inspect');
  }
  return {
    action,
    userId: argValue('user-id'),
    buyerNo: argValue('buyer-no'),
    confirm: argValue('confirm'),
    expectedDatabase: argValue('expected-database') || DEFAULT_STAGING_DATABASE,
  };
}

async function assertTargetUser(prisma: PrismaClient, userId: string, buyerNo: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, buyerNo: true, status: true, deletionExecutedAt: true },
  });
  if (!user || user.buyerNo !== buyerNo || user.status !== 'ACTIVE' || user.deletionExecutedAt) {
    throw new Error('目标用户不存在、买家编号不匹配或账号不可用；未写入任何数据');
  }
  return user;
}

async function selectFixtureProduct(prisma: PrismaClient) {
  const product = await prisma.product.findFirst({
    where: {
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      type: 'SIMPLE',
      skus: { some: { status: 'ACTIVE', stock: { gt: 0 } } },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      company: { select: { id: true, name: true, shortName: true } },
      media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
      skus: { where: { status: 'ACTIVE', stock: { gt: 0 } }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  });
  const sku = product?.skus[0];
  if (!product || !sku) {
    throw new Error('测试环境没有可用的已审核普通商品/SKU；未写入任何数据');
  }
  return { product, sku };
}

async function cleanupFixtures(prisma: PrismaClient, ids: RuntimeFixtureIds) {
  const orderIds = Object.values(ids.orders);
  await prisma.$transaction(async (tx) => {
    await tx.miniProgramScene.deleteMany({ where: { id: ids.scene } });
    await tx.checkoutSession.deleteMany({ where: { id: ids.checkout } });
    await tx.groupBuyTier.deleteMany({ where: { id: ids.activityTier } });
    await tx.groupBuyActivity.deleteMany({ where: { id: ids.activity } });
    await tx.invoiceStatusHistory.deleteMany({ where: { id: ids.invoiceHistory } });
    await tx.invoice.deleteMany({ where: { id: ids.invoice } });
    await tx.afterSaleStatusHistory.deleteMany({ where: { id: ids.afterSaleHistory } });
    await tx.afterSaleRequest.deleteMany({ where: { id: ids.afterSale } });
    await tx.shipmentTrackingEvent.deleteMany({ where: { id: { in: [...ids.shipmentEvents] } } });
    await tx.shipment.deleteMany({ where: { id: ids.shipment } });
    await tx.payment.deleteMany({ where: { id: { in: Object.values(ids.payments) } } });
    await tx.orderStatusHistory.deleteMany({ where: { id: { in: Object.values(ids.histories) } } });
    await tx.orderItem.deleteMany({ where: { id: { in: Object.values(ids.orderItems) } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.invoiceProfile.deleteMany({ where: { id: ids.invoiceProfile } });
    await tx.address.deleteMany({ where: { id: ids.address } });
    await tx.captainProfile.deleteMany({ where: { id: ids.captainProfile } });
    await tx.normalShareProfile.deleteMany({ where: { id: ids.normalShareProfile } });
  }, { timeout: 30_000 });
}

async function inspectFixtures(prisma: PrismaClient, ids: RuntimeFixtureIds) {
  const [
    addresses,
    invoiceProfiles,
    normalShareProfiles,
    captainProfiles,
    orders,
    orderItems,
    orderHistories,
    payments,
    shipments,
    shipmentEvents,
    checkouts,
    activities,
    activityTiers,
    afterSales,
    afterSaleHistories,
    invoices,
    invoiceHistories,
    scenes,
  ] = await Promise.all([
    prisma.address.count({ where: { id: ids.address } }),
    prisma.invoiceProfile.count({ where: { id: ids.invoiceProfile } }),
    prisma.normalShareProfile.count({ where: { id: ids.normalShareProfile } }),
    prisma.captainProfile.count({ where: { id: ids.captainProfile } }),
    prisma.order.count({ where: { id: { in: Object.values(ids.orders) } } }),
    prisma.orderItem.count({ where: { id: { in: Object.values(ids.orderItems) } } }),
    prisma.orderStatusHistory.count({ where: { id: { in: Object.values(ids.histories) } } }),
    prisma.payment.count({ where: { id: { in: Object.values(ids.payments) } } }),
    prisma.shipment.count({ where: { id: ids.shipment } }),
    prisma.shipmentTrackingEvent.count({ where: { id: { in: [...ids.shipmentEvents] } } }),
    prisma.checkoutSession.count({ where: { id: ids.checkout } }),
    prisma.groupBuyActivity.count({ where: { id: ids.activity } }),
    prisma.groupBuyTier.count({ where: { id: ids.activityTier } }),
    prisma.afterSaleRequest.count({ where: { id: ids.afterSale } }),
    prisma.afterSaleStatusHistory.count({ where: { id: ids.afterSaleHistory } }),
    prisma.invoice.count({ where: { id: ids.invoice } }),
    prisma.invoiceStatusHistory.count({ where: { id: ids.invoiceHistory } }),
    prisma.miniProgramScene.count({ where: { id: ids.scene } }),
  ]);
  return {
    addresses,
    invoiceProfiles,
    normalShareProfiles,
    captainProfiles,
    orders,
    orderItems,
    orderHistories,
    payments,
    shipments,
    shipmentEvents,
    checkouts,
    activities,
    activityTiers,
    afterSales,
    afterSaleHistories,
    invoices,
    invoiceHistories,
    scenes,
  };
}

async function createFixtures(prisma: PrismaClient, userId: string, ids: RuntimeFixtureIds) {
  const { product, sku } = await selectFixtureProduct(prisma);
  await cleanupFixtures(prisma, ids);

  const now = new Date();
  const hours = (value: number) => new Date(now.getTime() + value * 60 * 60_000);
  const days = (value: number) => new Date(now.getTime() + value * 24 * 60 * 60_000);
  const price = Number(Math.max(0.01, sku.price).toFixed(2));
  const companyName = product.company.shortName || product.company.name;
  const image = product.media[0]?.url || '';
  const addressSnapshot = {
    recipientName: '小程序验收员',
    phone: '13800000000',
    regionCode: '440305',
    regionText: '广东省/深圳市/南山区',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    detail: '验收测试路 1 号（非真实地址）',
  };
  const productSnapshot = {
    productId: product.id,
    title: `【小程序验收】${product.title}`,
    skuTitle: sku.title,
    image,
    companyId: product.companyId,
    companyName,
    productType: 'SIMPLE',
    bundleItems: [],
  };
  const orderDefinitions = [
    { key: 'paid', status: 'PAID', paidAt: hours(-2), deliveredAt: null, receivedAt: null, autoReceiveAt: days(7), returnWindowExpiresAt: null },
    { key: 'shipped', status: 'SHIPPED', paidAt: days(-2), deliveredAt: null, receivedAt: null, autoReceiveAt: days(5), returnWindowExpiresAt: null },
    { key: 'eligible', status: 'RECEIVED', paidAt: days(-3), deliveredAt: hours(-2), receivedAt: hours(-1), autoReceiveAt: hours(-1), returnWindowExpiresAt: days(7) },
    { key: 'history', status: 'RECEIVED', paidAt: days(-4), deliveredAt: days(-2), receivedAt: days(-1), autoReceiveAt: days(-1), returnWindowExpiresAt: days(6) },
  ] as const;

  const existingNormalProfile = await prisma.normalShareProfile.findUnique({ where: { userId } });
  const existingCaptainProfile = await prisma.captainProfile.findUnique({ where: { userId } });
  const normalCode = existingNormalProfile?.code || shortHash(`normal:${userId}`, 8).toUpperCase();
  const captainCode = existingCaptainProfile?.captainCode || `WMPRT${shortHash(`captain:${userId}`, 8).toUpperCase()}`;
  const sceneToken = `wmprt_${shortHash(`scene:${userId}`, 18)}`;

  await prisma.$transaction(async (tx) => {
    await tx.address.create({
      data: {
        id: ids.address,
        userId,
        recipientName: addressSnapshot.recipientName,
        phone: addressSnapshot.phone,
        regionCode: addressSnapshot.regionCode,
        regionText: '广东省深圳市南山区',
        detail: addressSnapshot.detail,
        isDefault: false,
      },
    });
    await tx.invoiceProfile.create({
      data: { id: ids.invoiceProfile, userId, type: 'PERSONAL', title: '小程序验收测试抬头', email: 'miniapp-runtime@example.invalid' },
    });
    if (!existingNormalProfile) {
      await tx.normalShareProfile.create({ data: { id: ids.normalShareProfile, userId, code: normalCode, status: 'ACTIVE' } });
    }
    if (!existingCaptainProfile) {
      await tx.captainProfile.create({
        data: {
          id: ids.captainProfile,
          userId,
          captainCode,
          displayName: '小程序验收团长',
          status: 'ACTIVE',
          approvedAt: now,
          statusReason: '小程序运行时验收临时数据',
          meta: { runtimeFixture: ids.prefix },
        },
      });
    }

    for (const definition of orderDefinitions) {
      const key = definition.key;
      await tx.order.create({
        data: {
          id: ids.orders[key],
          userId,
          status: definition.status,
          bizType: 'NORMAL_GOODS',
          addressSnapshot,
          totalAmount: price,
          goodsAmount: price,
          shippingFee: 0,
          discountAmount: 0,
          vipDiscountAmount: 0,
          totalCouponDiscount: 0,
          idempotencyKey: `${ids.prefix}:order:${key}`,
          buyerNote: `【小程序验收临时数据】${key}`,
          paidAt: definition.paidAt,
          deliveredAt: definition.deliveredAt,
          receivedAt: definition.receivedAt,
          autoReceiveAt: definition.autoReceiveAt,
          returnWindowExpiresAt: definition.returnWindowExpiresAt,
          items: {
            create: {
              id: ids.orderItems[key],
              skuId: sku.id,
              productSnapshot,
              unitPrice: price,
              quantity: 1,
              companyId: product.companyId,
              isPrize: false,
            },
          },
          statusHistory: {
            create: {
              id: ids.histories[key],
              fromStatus: 'PAID',
              toStatus: definition.status,
              reason: '小程序运行时验收临时数据',
              meta: { runtimeFixture: ids.prefix },
            },
          },
          payments: {
            create: {
              id: ids.payments[key],
              channel: 'WECHAT_PAY',
              scene: 'MINI_PROGRAM',
              amount: price,
              status: 'PAID',
              merchantOrderNo: `${ids.prefix}_${key}`,
              paidAt: definition.paidAt,
              requestPayload: { runtimeFixture: ids.prefix },
            },
          },
        },
      });
    }

    await tx.shipment.create({
      data: {
        id: ids.shipment,
        orderId: ids.orders.shipped,
        companyId: product.companyId,
        carrierCode: 'SF',
        carrierName: '顺丰速运（验收测试）',
        trackingNo: `WMP${shortHash(userId, 12).toUpperCase()}`,
        status: 'IN_TRANSIT',
        shippedAt: days(-1),
        receiverInfoSnapshot: addressSnapshot,
        rawCarrierPayload: { runtimeFixture: ids.prefix },
        trackingEvents: {
          create: [
            { id: ids.shipmentEvents[0], occurredAt: hours(-18), statusCode: 'PICKED_UP', message: '顺丰已收取快件（验收测试）', location: '深圳市' },
            { id: ids.shipmentEvents[1], occurredAt: hours(-8), statusCode: 'IN_TRANSIT', message: '快件运输中（验收测试）', location: '深圳转运中心' },
            { id: ids.shipmentEvents[2], occurredAt: hours(-1), statusCode: 'IN_TRANSIT', message: '快件已到达派送网点（验收测试）', location: '南山区' },
          ],
        },
      },
    });

    await tx.afterSaleRequest.create({
      data: {
        id: ids.afterSale,
        orderId: ids.orders.history,
        userId,
        orderItemId: ids.orderItems.history,
        afterSaleType: 'QUALITY_RETURN',
        reasonType: 'QUALITY_ISSUE',
        reason: '小程序验收测试售后记录',
        photos: [image || 'https://example.invalid/miniapp-runtime.png'],
        status: 'CANCELED',
        requiresReturn: false,
        returnShippingPayer: 'SELLER',
        refundAmount: price,
        statusHistory: {
          create: {
            id: ids.afterSaleHistory,
            fromStatus: 'REQUESTED',
            toStatus: 'CANCELED',
            reason: '小程序运行时验收临时数据',
            operatorType: 'BUYER',
            operatorId: userId,
            meta: { runtimeFixture: ids.prefix },
          },
        },
      },
    });

    await tx.invoice.create({
      data: {
        id: ids.invoice,
        orderId: ids.orders.history,
        profileSnapshot: { type: 'PERSONAL', title: '小程序验收测试抬头', email: 'miniapp-runtime@example.invalid' },
        status: 'CANCELED',
        canceledAt: now,
        provider: 'RUNTIME_FIXTURE',
        providerRaw: { runtimeFixture: ids.prefix },
        statusHistory: {
          create: {
            id: ids.invoiceHistory,
            fromStatus: 'REQUESTED',
            toStatus: 'CANCELED',
            reason: '小程序运行时验收临时数据',
            operatorId: userId,
            operatorType: 'BUYER',
            metadata: { runtimeFixture: ids.prefix },
          },
        },
      },
    });

    await tx.groupBuyActivity.create({
      data: {
        id: ids.activity,
        title: `【小程序验收临时】${product.title}`,
        description: '只用于微信小程序页面运行时巡检，完成后自动清理。',
        productId: product.id,
        skuId: sku.id,
        price,
        freeShipping: true,
        status: 'ACTIVE',
        startAt: hours(-1),
        endAt: hours(4),
        displayOrder: -999_999,
        ruleSummary: '验收测试数据，不可真实下单',
        tiers: { create: { id: ids.activityTier, sequence: 1, basisPoints: 1000, label: '验收档位' } },
      },
    });

    await tx.checkoutSession.create({
      data: {
        id: ids.checkout,
        userId,
        status: 'ACTIVE',
        bizType: 'GROUP_BUY',
        bizMeta: {
          groupBuyActivityId: ids.activity,
          groupBuyCodeId: null,
          referredByInstanceId: null,
          groupBuyPriceSnapshot: price,
          freeShippingSnapshot: true,
          shippingFeeSnapshot: 0,
          tierSnapshot: [{ sequence: 1, basisPoints: 1000, label: '验收档位' }],
          checkoutRequestFingerprint: `runtime-fixture:${ids.prefix}`,
          runtimeFixture: ids.prefix,
        },
        itemsSnapshot: [{ skuId: sku.id, productId: product.id, quantity: 1, unitPrice: price, companyId: product.companyId, productSnapshot }],
        addressSnapshot,
        expectedTotal: price,
        goodsAmount: price,
        shippingFee: 0,
        discountAmount: 0,
        groupBuyRebateDeductionAmount: 0,
        vipDiscountAmount: 0,
        merchantOrderNo: `${ids.prefix}_group_buy`,
        paymentChannel: 'WECHAT_PAY',
        paymentScene: 'MINI_PROGRAM',
        couponInstanceIds: [],
        totalCouponDiscount: 0,
        couponPerAmounts: [],
        idempotencyKey: `${ids.prefix}:checkout`,
        buyerNote: '【小程序验收临时数据】团购待支付',
        expiresAt: hours(4),
      },
    });

    const targetPath = `/packages/referral/landing/index?code=${normalCode}&kind=normal`;
    await tx.miniProgramScene.create({
      data: {
        id: ids.scene,
        token: sceneToken,
        ownerUserId: userId,
        kind: 'REFERRAL',
        payload: { code: normalCode, inviteKind: 'normal', runtimeFixture: ids.prefix },
        payloadHash: createHash('sha256').update(targetPath).digest('hex'),
        targetPath,
        expiresAt: hours(4),
      },
    });
  }, { timeout: 60_000 });

  return {
    version: 1,
    ownerUserId: userId,
    prefix: ids.prefix,
    product: { id: product.id, skuId: sku.id },
    activity: { id: ids.activity },
    pendingCheckout: { sessionId: ids.checkout },
    detailOrder: { id: ids.orders.shipped },
    trackingOrder: { id: ids.orders.shipped },
    receiverOrder: { id: ids.orders.paid },
    eligibleOrder: { id: ids.orders.eligible },
    afterSale: { id: ids.afterSale },
    invoice: { id: ids.invoice },
    referralCode: normalCode,
    referralKind: 'normal',
    captainCode,
    scene: sceneToken,
    expectedScenePath: '/packages/referral/landing/index',
  };
}

export async function runRuntimeFixtures() {
  const args = parseRuntimeFixtureArgs();
  const validated = assertRuntimeFixtureEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    expectedDatabase: args.expectedDatabase,
    allow: process.env.MINIAPP_RUNTIME_FIXTURE_ALLOW,
    confirm: args.confirm,
    userId: args.userId,
    buyerNo: args.buyerNo,
  });
  const prisma = new PrismaClient();
  const ids = buildRuntimeFixtureIds(validated.userId);
  try {
    await assertTargetUser(prisma, validated.userId, validated.buyerNo);
    if (args.action === 'cleanup') {
      await cleanupFixtures(prisma, ids);
      const state = await inspectFixtures(prisma, ids);
      console.log(`RUNTIME_FIXTURE_CLEANUP ${JSON.stringify(state)}`);
      return;
    }
    if (args.action === 'inspect') {
      console.log(`RUNTIME_FIXTURE_INSPECT ${JSON.stringify(await inspectFixtures(prisma, ids))}`);
      return;
    }
    const manifest = await createFixtures(prisma, validated.userId, ids);
    console.log(`RUNTIME_FIXTURE_MANIFEST ${JSON.stringify(manifest)}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runRuntimeFixtures().catch((error) => {
    console.error(`[miniapp-runtime-fixtures] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
