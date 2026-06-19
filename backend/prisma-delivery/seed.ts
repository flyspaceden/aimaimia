import * as bcrypt from 'bcrypt';
import {
  DeliveryAdminUserStatus,
  DeliveryAuthProvider,
  DeliveryCategoryStatus,
  DeliveryConfigScope,
  DeliveryInventoryLedgerType,
  DeliveryManifestVersionStatus,
  DeliveryMerchantApplicationStatus,
  DeliveryMerchantStatus,
  DeliveryPriceRuleScope,
  DeliveryPriceRuleType,
  DeliveryProductAuditStatus,
  DeliveryProductStatus,
  DeliverySellerStaffRole,
  DeliverySellerStaffStatus,
  DeliveryShippingCalcType,
  DeliveryShippingRuleStatus,
  DeliveryUnitFieldType,
  DeliveryUnitStatus,
  DeliveryUserStatus,
  Prisma,
  PrismaClient,
} from '../src/generated/delivery-client';
import { DELIVERY_MANIFEST_TEMPLATES } from '../src/modules/delivery/manifests/delivery-manifest.definitions';

const prisma = new PrismaClient();

type DeliverySeedPrefix = 'PSYH' | 'PSSJ' | 'PSSP' | 'PSDD' | 'PSZDD' | 'PSZF' | 'PSQD';

const seedPassword = process.env.DELIVERY_SEED_PASSWORD ?? 'AimmDeliverySeed@2026!';
const seedPasswordRounds = Number(process.env.DELIVERY_SEED_BCRYPT_ROUNDS ?? '10');

const ids = {
  merchant: formatDeliverySeedId('PSSJ', 1),
  user: formatDeliverySeedId('PSYH', 1),
  unit: 'PSDW0000000000001',
  products: {
    rice: formatDeliverySeedId('PSSP', 1),
    apple: formatDeliverySeedId('PSSP', 2),
  },
};

function formatDeliverySeedId(prefix: DeliverySeedPrefix, value: number): string {
  return `${prefix}${String(value).padStart(17 - prefix.length, '0')}`;
}

async function ensureSequenceFloor(prefix: DeliverySeedPrefix, minimum: bigint): Promise<void> {
  const existing = await prisma.deliverySequence.findUnique({ where: { prefix } });
  if (!existing) {
    await prisma.deliverySequence.create({
      data: {
        id: prefix,
        prefix,
        currentValue: minimum,
      },
    });
    return;
  }

  if (existing.currentValue < minimum) {
    await prisma.deliverySequence.update({
      where: { prefix },
      data: { currentValue: minimum },
    });
  }
}

async function upsertAdminUser(input: {
  username: string;
  phone: string;
  realName: string;
  roleCodes: string[];
  permissions: Record<string, unknown>;
  passwordHash: string;
}) {
  return prisma.deliveryAdminUser.upsert({
    where: { username: input.username },
    create: {
      username: input.username,
      phone: input.phone,
      realName: input.realName,
      passwordHash: input.passwordHash,
      roleCodes: input.roleCodes,
      permissions: input.permissions as Prisma.InputJsonValue,
      status: DeliveryAdminUserStatus.ACTIVE,
    },
    update: {
      phone: input.phone,
      realName: input.realName,
      passwordHash: input.passwordHash,
      roleCodes: input.roleCodes,
      permissions: input.permissions as Prisma.InputJsonValue,
      status: DeliveryAdminUserStatus.ACTIVE,
    },
  });
}

async function upsertPriceRule(input: {
  merchantId: string;
  minQuantity: number;
  maxQuantity: number | null;
  markupBps: number;
  priority: number;
  note: string;
}) {
  const existing = await prisma.deliveryPriceRule.findFirst({
    where: {
      scope: DeliveryPriceRuleScope.MERCHANT,
      ruleType: DeliveryPriceRuleType.MARKUP_RATE,
      merchantId: input.merchantId,
      productId: null,
      skuId: null,
      minQuantity: input.minQuantity,
      maxQuantity: input.maxQuantity,
    },
  });
  const data = {
    scope: DeliveryPriceRuleScope.MERCHANT,
    ruleType: DeliveryPriceRuleType.MARKUP_RATE,
    merchantId: input.merchantId,
    minQuantity: input.minQuantity,
    maxQuantity: input.maxQuantity,
    markupBps: input.markupBps,
    fixedPriceCents: null,
    priority: input.priority,
    isActive: true,
    note: input.note,
  };

  if (existing) {
    return prisma.deliveryPriceRule.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.deliveryPriceRule.create({ data });
}

async function upsertShippingRule(input: {
  merchantId: string;
  firstWeightGram: number;
  firstWeightPriceCents: number;
  additionalWeightGram: number;
  additionalWeightPriceCents: number;
  freeShippingThresholdCents: number;
  sortOrder: number;
}) {
  const existing = await prisma.deliveryShippingRule.findFirst({
    where: {
      merchantId: input.merchantId,
      sortOrder: input.sortOrder,
    },
  });
  const data = {
    merchantId: input.merchantId,
    status: DeliveryShippingRuleStatus.ACTIVE,
    calcType: DeliveryShippingCalcType.WEIGHT,
    firstWeightGram: input.firstWeightGram,
    firstWeightPriceCents: input.firstWeightPriceCents,
    additionalWeightGram: input.additionalWeightGram,
    additionalWeightPriceCents: input.additionalWeightPriceCents,
    freeShippingThresholdCents: input.freeShippingThresholdCents,
    minShippingFeeCents: 0,
    sortOrder: input.sortOrder,
  };

  if (existing) {
    return prisma.deliveryShippingRule.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.deliveryShippingRule.create({ data });
}

async function upsertMerchantApplication(input: {
  adminId: string;
  merchantId: string;
}) {
  const existing = await prisma.deliveryMerchantApplication.findFirst({
    where: {
      companyName: '深圳配送示范供应商有限公司',
      contactPhone: '13800001010',
    },
  });
  const data = {
    companyName: '深圳配送示范供应商有限公司',
    contactName: '配送商家负责人',
    contactPhone: '13800001010',
    email: 'delivery-seller@example.com',
    note: '配送中心 seed 商家申请，正式环境请替换为真实商家资料。',
    licenseFileUrl: null,
    status: DeliveryMerchantApplicationStatus.APPROVED,
    rejectReason: null,
    reviewedByAdminId: input.adminId,
    reviewedAt: new Date(),
    merchantId: input.merchantId,
  };

  if (existing) {
    return prisma.deliveryMerchantApplication.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.deliveryMerchantApplication.create({ data });
}

async function upsertAddress(input: {
  userId: string;
  unitId: string;
}) {
  const existing = await prisma.deliveryAddress.findFirst({
    where: {
      userId: input.userId,
      unitId: input.unitId,
      label: '配送默认地址',
    },
  });
  const data = {
    userId: input.userId,
    unitId: input.unitId,
    recipientName: '配送收货人',
    phone: '13900002020',
    provinceCode: '440000',
    provinceName: '广东省',
    cityCode: '440300',
    cityName: '深圳市',
    districtCode: '440307',
    districtName: '龙岗区',
    detailAddress: '平湖街道白坭坑社区丹农路1号5#楼',
    regionText: '广东省 深圳市 龙岗区',
    label: '配送默认地址',
    isDefault: true,
  };

  if (existing) {
    return prisma.deliveryAddress.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.deliveryAddress.create({ data });
}

async function upsertInventoryLedger(input: {
  skuId: string;
  quantity: number;
  afterStock: number;
}) {
  const existing = await prisma.deliveryInventoryLedger.findFirst({
    where: {
      skuId: input.skuId,
      refType: 'SEED',
      refId: 'delivery-system-task-19',
    },
  });
  const data = {
    skuId: input.skuId,
    type: DeliveryInventoryLedgerType.IN,
    quantity: input.quantity,
    beforeStock: 0,
    afterStock: input.afterStock,
    refType: 'SEED',
    refId: 'delivery-system-task-19',
    remark: '配送 seed 初始库存',
    createdByType: 'SYSTEM' as const,
    createdById: 'seed',
  };

  if (existing) {
    return prisma.deliveryInventoryLedger.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.deliveryInventoryLedger.create({ data });
}

async function seedManifestTemplates(adminId: string) {
  const results = [];
  for (const definition of Object.values(DELIVERY_MANIFEST_TEMPLATES)) {
    const config = { columns: definition.columns };
    const template = await prisma.deliveryManifestTemplate.upsert({
      where: {
        type_name: {
          type: definition.dbType,
          name: definition.name,
        },
      },
      create: {
        type: definition.dbType,
        name: definition.name,
        description: definition.description,
        config: config as Prisma.InputJsonValue,
        isDefault: true,
        isActive: true,
      },
      update: {
        description: definition.description,
        config: config as Prisma.InputJsonValue,
        isDefault: true,
        isActive: true,
      },
    });

    const version = await prisma.deliveryManifestVersion.upsert({
      where: {
        templateId_versionNo: {
          templateId: template.id,
          versionNo: 1,
        },
      },
      create: {
        templateId: template.id,
        versionNo: 1,
        status: DeliveryManifestVersionStatus.PUBLISHED,
        config: config as Prisma.InputJsonValue,
        createdByAdminId: adminId,
      },
      update: {
        status: DeliveryManifestVersionStatus.PUBLISHED,
        config: config as Prisma.InputJsonValue,
        createdByAdminId: adminId,
      },
    });

    results.push({ templateId: template.id, type: definition.apiType, versionId: version.id });
  }
  return results;
}

async function main(): Promise<void> {
  if (!Number.isInteger(seedPasswordRounds) || seedPasswordRounds < 4 || seedPasswordRounds > 15) {
    throw new Error('DELIVERY_SEED_BCRYPT_ROUNDS must be an integer between 4 and 15');
  }

  const passwordHash = await bcrypt.hash(seedPassword, seedPasswordRounds);

  await Promise.all([
    ensureSequenceFloor('PSYH', 1n),
    ensureSequenceFloor('PSSJ', 1n),
    ensureSequenceFloor('PSSP', 2n),
    ensureSequenceFloor('PSDD', 0n),
    ensureSequenceFloor('PSZDD', 0n),
    ensureSequenceFloor('PSZF', 0n),
    ensureSequenceFloor('PSQD', 0n),
  ]);

  const admins = await Promise.all([
    upsertAdminUser({
      username: 'delivery_super_admin',
      phone: '13800000001',
      realName: '配送超级管理员',
      roleCodes: ['SUPER_ADMIN'],
      permissions: { all: true },
      passwordHash,
    }),
    upsertAdminUser({
      username: 'delivery_operations',
      phone: '13800000002',
      realName: '配送运营',
      roleCodes: ['OPERATIONS'],
      permissions: { modules: ['dashboard', 'orders', 'products', 'merchants', 'manifests'] },
      passwordHash,
    }),
    upsertAdminUser({
      username: 'delivery_admin',
      phone: '13800000003',
      realName: '配送管理员',
      roleCodes: ['ADMIN'],
      permissions: { modules: ['users', 'merchants', 'orders', 'config'] },
      passwordHash,
    }),
    upsertAdminUser({
      username: 'delivery_finance',
      phone: '13800000004',
      realName: '配送财务',
      roleCodes: ['FINANCE'],
      permissions: { modules: ['settlements', 'manifests', 'orders'] },
      passwordHash,
    }),
    upsertAdminUser({
      username: 'delivery_customer_service',
      phone: '13800000005',
      realName: '配送客服',
      roleCodes: ['CUSTOMER_SERVICE'],
      permissions: { modules: ['customer-service', 'orders'] },
      passwordHash,
    }),
  ]);
  const superAdmin = admins[0];

  const merchant = await prisma.deliveryMerchant.upsert({
    where: { id: ids.merchant },
    create: {
      id: ids.merchant,
      name: '深圳配送示范供应商有限公司',
      shortName: '配送示范供应商',
      description: '配送业务 seed 商家，用于 staging 联调商品、订单、清单和结算流程。',
      contactName: '配送商家负责人',
      contactPhone: '13800001010',
      servicePhone: '0755-28509232',
      status: DeliveryMerchantStatus.ACTIVE,
      logoUrl: null,
      addressJson: {
        provinceName: '广东省',
        cityName: '深圳市',
        districtName: '龙岗区',
        detailAddress: '平湖街道白坭坑社区丹农路1号5#楼',
      } as Prisma.InputJsonValue,
      defaultMarkupBps: 1800,
    },
    update: {
      name: '深圳配送示范供应商有限公司',
      shortName: '配送示范供应商',
      description: '配送业务 seed 商家，用于 staging 联调商品、订单、清单和结算流程。',
      contactName: '配送商家负责人',
      contactPhone: '13800001010',
      servicePhone: '0755-28509232',
      status: DeliveryMerchantStatus.ACTIVE,
      addressJson: {
        provinceName: '广东省',
        cityName: '深圳市',
        districtName: '龙岗区',
        detailAddress: '平湖街道白坭坑社区丹农路1号5#楼',
      } as Prisma.InputJsonValue,
      defaultMarkupBps: 1800,
    },
  });

  const merchantApplication = await upsertMerchantApplication({
    adminId: superAdmin.id,
    merchantId: merchant.id,
  });

  const owner = await prisma.deliverySellerStaff.upsert({
    where: { username: 'delivery_seed_owner' },
    create: {
      merchantId: merchant.id,
      username: 'delivery_seed_owner',
      phone: '13800001011',
      realName: '配送中心 OWNER',
      passwordHash,
      role: DeliverySellerStaffRole.OWNER,
      permissionCodes: ['products:write', 'orders:write', 'finance:read', 'customer-service:write'],
      status: DeliverySellerStaffStatus.ACTIVE,
    },
    update: {
      merchantId: merchant.id,
      phone: '13800001011',
      realName: '配送中心 OWNER',
      passwordHash,
      role: DeliverySellerStaffRole.OWNER,
      permissionCodes: ['products:write', 'orders:write', 'finance:read', 'customer-service:write'],
      status: DeliverySellerStaffStatus.ACTIVE,
    },
  });

  const [freshCategory, stapleCategory, fruitCategory] = await Promise.all([
    prisma.deliveryCategory.upsert({
      where: { path: 'fresh' },
      create: {
        name: '生鲜食材',
        path: 'fresh',
        level: 1,
        sortOrder: 10,
        status: DeliveryCategoryStatus.ACTIVE,
      },
      update: {
        name: '生鲜食材',
        level: 1,
        sortOrder: 10,
        status: DeliveryCategoryStatus.ACTIVE,
      },
    }),
    prisma.deliveryCategory.upsert({
      where: { path: 'staple' },
      create: {
        name: '粮油米面',
        path: 'staple',
        level: 1,
        sortOrder: 20,
        status: DeliveryCategoryStatus.ACTIVE,
      },
      update: {
        name: '粮油米面',
        level: 1,
        sortOrder: 20,
        status: DeliveryCategoryStatus.ACTIVE,
      },
    }),
    prisma.deliveryCategory.upsert({
      where: { path: 'fresh/fruits' },
      create: {
        name: '水果',
        path: 'fresh/fruits',
        level: 2,
        sortOrder: 11,
        status: DeliveryCategoryStatus.ACTIVE,
      },
      update: {
        name: '水果',
        level: 2,
        sortOrder: 11,
        status: DeliveryCategoryStatus.ACTIVE,
      },
    }),
  ]);

  await prisma.deliveryCategory.update({
    where: { id: fruitCategory.id },
    data: { parentId: freshCategory.id },
  });

  const [boxUnit, bagUnit] = await Promise.all([
    prisma.deliveryProductUnit.upsert({
      where: { name: '箱' },
      create: { name: '箱', sortOrder: 10, isActive: true },
      update: { sortOrder: 10, isActive: true },
    }),
    prisma.deliveryProductUnit.upsert({
      where: { name: '袋' },
      create: { name: '袋', sortOrder: 20, isActive: true },
      update: { sortOrder: 20, isActive: true },
    }),
    prisma.deliveryProductUnit.upsert({
      where: { name: '件' },
      create: { name: '件', sortOrder: 30, isActive: true },
      update: { sortOrder: 30, isActive: true },
    }),
  ]);

  const riceProduct = await prisma.deliveryProduct.upsert({
    where: { id: ids.products.rice },
    create: {
      id: ids.products.rice,
      merchantId: merchant.id,
      categoryId: stapleCategory.id,
      productUnitId: bagUnit.id,
      createdByStaffId: owner.id,
      title: '配送示范五常大米',
      subtitle: '25kg/袋，适合单位食堂集中配送',
      description: '配送 seed 商品，用于测试批量下单、清单和配送中心履约。',
      detailRich: { blocks: ['产地示范数据，正式环境请替换为真实商品详情。'] } as Prisma.InputJsonValue,
      media: { coverUrl: null, images: [] } as Prisma.InputJsonValue,
      attributes: { origin: '黑龙江', storage: '阴凉干燥处' } as Prisma.InputJsonValue,
      searchKeywords: ['大米', '粮油', '单位配送'],
      unitName: '袋',
      status: DeliveryProductStatus.ACTIVE,
      auditStatus: DeliveryProductAuditStatus.APPROVED,
      auditNote: 'seed approved',
      submissionCount: 1,
      minOrderQuantity: 5,
      orderStepQuantity: 1,
    },
    update: {
      merchantId: merchant.id,
      categoryId: stapleCategory.id,
      productUnitId: bagUnit.id,
      createdByStaffId: owner.id,
      title: '配送示范五常大米',
      subtitle: '25kg/袋，适合单位食堂集中配送',
      description: '配送 seed 商品，用于测试批量下单、清单和配送中心履约。',
      detailRich: { blocks: ['产地示范数据，正式环境请替换为真实商品详情。'] } as Prisma.InputJsonValue,
      media: { coverUrl: null, images: [] } as Prisma.InputJsonValue,
      attributes: { origin: '黑龙江', storage: '阴凉干燥处' } as Prisma.InputJsonValue,
      searchKeywords: ['大米', '粮油', '单位配送'],
      unitName: '袋',
      status: DeliveryProductStatus.ACTIVE,
      auditStatus: DeliveryProductAuditStatus.APPROVED,
      auditNote: 'seed approved',
      submissionCount: 1,
      minOrderQuantity: 5,
      orderStepQuantity: 1,
    },
  });

  const appleProduct = await prisma.deliveryProduct.upsert({
    where: { id: ids.products.apple },
    create: {
      id: ids.products.apple,
      merchantId: merchant.id,
      categoryId: fruitCategory.id,
      productUnitId: boxUnit.id,
      createdByStaffId: owner.id,
      title: '配送示范苹果礼箱',
      subtitle: '10kg/箱，适合单位福利和活动配送',
      description: '配送 seed 商品，用于测试不同分类、SKU 和重量计费。',
      detailRich: { blocks: ['图片和详情为占位数据，正式环境请上传真实素材。'] } as Prisma.InputJsonValue,
      media: { coverUrl: null, images: [] } as Prisma.InputJsonValue,
      attributes: { origin: '陕西', grade: '一级果' } as Prisma.InputJsonValue,
      searchKeywords: ['苹果', '水果', '福利配送'],
      unitName: '箱',
      status: DeliveryProductStatus.ACTIVE,
      auditStatus: DeliveryProductAuditStatus.APPROVED,
      auditNote: 'seed approved',
      submissionCount: 1,
      minOrderQuantity: 3,
      orderStepQuantity: 1,
    },
    update: {
      merchantId: merchant.id,
      categoryId: fruitCategory.id,
      productUnitId: boxUnit.id,
      createdByStaffId: owner.id,
      title: '配送示范苹果礼箱',
      subtitle: '10kg/箱，适合单位福利和活动配送',
      description: '配送 seed 商品，用于测试不同分类、SKU 和重量计费。',
      detailRich: { blocks: ['图片和详情为占位数据，正式环境请上传真实素材。'] } as Prisma.InputJsonValue,
      media: { coverUrl: null, images: [] } as Prisma.InputJsonValue,
      attributes: { origin: '陕西', grade: '一级果' } as Prisma.InputJsonValue,
      searchKeywords: ['苹果', '水果', '福利配送'],
      unitName: '箱',
      status: DeliveryProductStatus.ACTIVE,
      auditStatus: DeliveryProductAuditStatus.APPROVED,
      auditNote: 'seed approved',
      submissionCount: 1,
      minOrderQuantity: 3,
      orderStepQuantity: 1,
    },
  });

  const [riceSku, appleSku] = await Promise.all([
    prisma.deliveryProductSku.upsert({
      where: { skuCode: 'SEED-RICE-25KG' },
      create: {
        productId: riceProduct.id,
        skuCode: 'SEED-RICE-25KG',
        title: '25kg/袋',
        imageUrl: null,
        supplyPriceCents: 13800,
        basePriceCents: 13800,
        fixedFinalPriceCents: null,
        stock: 300,
        minOrderQuantity: 5,
        orderStepQuantity: 1,
        weightGram: 25000,
        isActive: true,
      },
      update: {
        productId: riceProduct.id,
        title: '25kg/袋',
        imageUrl: null,
        supplyPriceCents: 13800,
        basePriceCents: 13800,
        fixedFinalPriceCents: null,
        stock: 300,
        minOrderQuantity: 5,
        orderStepQuantity: 1,
        weightGram: 25000,
        isActive: true,
      },
    }),
    prisma.deliveryProductSku.upsert({
      where: { skuCode: 'SEED-APPLE-10KG' },
      create: {
        productId: appleProduct.id,
        skuCode: 'SEED-APPLE-10KG',
        title: '10kg/箱',
        imageUrl: null,
        supplyPriceCents: 6800,
        basePriceCents: 6800,
        fixedFinalPriceCents: null,
        stock: 200,
        minOrderQuantity: 3,
        orderStepQuantity: 1,
        weightGram: 10000,
        isActive: true,
      },
      update: {
        productId: appleProduct.id,
        title: '10kg/箱',
        imageUrl: null,
        supplyPriceCents: 6800,
        basePriceCents: 6800,
        fixedFinalPriceCents: null,
        stock: 200,
        minOrderQuantity: 3,
        orderStepQuantity: 1,
        weightGram: 10000,
        isActive: true,
      },
    }),
  ]);

  await Promise.all([
    upsertInventoryLedger({ skuId: riceSku.id, quantity: 300, afterStock: 300 }),
    upsertInventoryLedger({ skuId: appleSku.id, quantity: 200, afterStock: 200 }),
  ]);

  const priceRules = await Promise.all([
    upsertPriceRule({
      merchantId: merchant.id,
      minQuantity: 1,
      maxQuantity: 49,
      markupBps: 1800,
      priority: 30,
      note: 'seed: 1-49 件商家默认 18% 加价',
    }),
    upsertPriceRule({
      merchantId: merchant.id,
      minQuantity: 50,
      maxQuantity: 199,
      markupBps: 1200,
      priority: 40,
      note: 'seed: 50-199 件商家阶梯 12% 加价',
    }),
    upsertPriceRule({
      merchantId: merchant.id,
      minQuantity: 200,
      maxQuantity: null,
      markupBps: 800,
      priority: 50,
      note: 'seed: 200 件以上商家阶梯 8% 加价',
    }),
  ]);

  const shippingRule = await upsertShippingRule({
    merchantId: merchant.id,
    firstWeightGram: 1000,
    firstWeightPriceCents: 1200,
    additionalWeightGram: 1000,
    additionalWeightPriceCents: 300,
    freeShippingThresholdCents: 500000,
    sortOrder: 10,
  });

  const buyer = await prisma.deliveryUser.upsert({
    where: { id: ids.user },
    create: {
      id: ids.user,
      phone: '13900002020',
      nickname: '配送测试用户',
      avatarUrl: null,
      status: DeliveryUserStatus.ACTIVE,
    },
    update: {
      phone: '13900002020',
      nickname: '配送测试用户',
      avatarUrl: null,
      status: DeliveryUserStatus.ACTIVE,
    },
  });

  await prisma.deliveryAuthIdentity.upsert({
    where: {
      provider_providerSubject: {
        provider: DeliveryAuthProvider.PHONE,
        providerSubject: '13900002020',
      },
    },
    create: {
      userId: buyer.id,
      provider: DeliveryAuthProvider.PHONE,
      providerSubject: '13900002020',
      phone: '13900002020',
    },
    update: {
      userId: buyer.id,
      phone: '13900002020',
    },
  });

  const deliveryUnit = await prisma.deliveryUnit.upsert({
    where: { id: ids.unit },
    create: {
      id: ids.unit,
      userId: buyer.id,
      name: '深圳测试配送单位',
      contactName: '配送单位联系人',
      contactPhone: '13900002020',
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
      districtCode: '440307',
      districtName: '龙岗区',
      detailAddress: '平湖街道白坭坑社区丹农路1号5#楼',
      extraFields: {
        department: '后勤采购部',
        receiverCount: 80,
        deliveryWindow: '工作日 09:00-17:00',
      } as Prisma.InputJsonValue,
      status: DeliveryUnitStatus.ACTIVE,
      remark: '配送 seed 单位',
    },
    update: {
      userId: buyer.id,
      name: '深圳测试配送单位',
      contactName: '配送单位联系人',
      contactPhone: '13900002020',
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
      districtCode: '440307',
      districtName: '龙岗区',
      detailAddress: '平湖街道白坭坑社区丹农路1号5#楼',
      extraFields: {
        department: '后勤采购部',
        receiverCount: 80,
        deliveryWindow: '工作日 09:00-17:00',
      } as Prisma.InputJsonValue,
      status: DeliveryUnitStatus.ACTIVE,
      remark: '配送 seed 单位',
      disabledReason: null,
    },
  });

  await prisma.deliveryUser.update({
    where: { id: buyer.id },
    data: { currentUnitId: deliveryUnit.id },
  });

  const address = await upsertAddress({
    userId: buyer.id,
    unitId: deliveryUnit.id,
  });

  const unitFieldConfigs = await Promise.all([
    prisma.deliveryUnitFieldConfig.upsert({
      where: { fieldKey: 'department' },
      create: {
        fieldKey: 'department',
        label: '部门/科室',
        fieldType: DeliveryUnitFieldType.TEXT,
        sortOrder: 60,
        placeholder: '请输入部门或科室',
        options: Prisma.JsonNull,
        isVisible: true,
        isRequired: false,
        showInApp: true,
        showInAdmin: true,
        includeInExport: true,
        includeInPdf: true,
        includeInExcel: true,
      },
      update: {
        label: '部门/科室',
        fieldType: DeliveryUnitFieldType.TEXT,
        sortOrder: 60,
        placeholder: '请输入部门或科室',
        options: Prisma.JsonNull,
        isVisible: true,
        isRequired: false,
        showInApp: true,
        showInAdmin: true,
        includeInExport: true,
        includeInPdf: true,
        includeInExcel: true,
      },
    }),
    prisma.deliveryUnitFieldConfig.upsert({
      where: { fieldKey: 'receiverCount' },
      create: {
        fieldKey: 'receiverCount',
        label: '配送人数',
        fieldType: DeliveryUnitFieldType.NUMBER,
        sortOrder: 70,
        placeholder: '请输入本次预计配送人数',
        options: Prisma.JsonNull,
        isVisible: true,
        isRequired: false,
        showInApp: true,
        showInAdmin: true,
        includeInExport: true,
        includeInPdf: false,
        includeInExcel: true,
      },
      update: {
        label: '配送人数',
        fieldType: DeliveryUnitFieldType.NUMBER,
        sortOrder: 70,
        placeholder: '请输入本次预计配送人数',
        options: Prisma.JsonNull,
        isVisible: true,
        isRequired: false,
        showInApp: true,
        showInAdmin: true,
        includeInExport: true,
        includeInPdf: false,
        includeInExcel: true,
      },
    }),
    prisma.deliveryUnitFieldConfig.upsert({
      where: { fieldKey: 'deliveryWindow' },
      create: {
        fieldKey: 'deliveryWindow',
        label: '配送时间段',
        fieldType: DeliveryUnitFieldType.SELECT,
        sortOrder: 80,
        placeholder: '请选择配送时间段',
        options: [
          { label: '工作日 09:00-12:00', value: 'weekday_morning' },
          { label: '工作日 14:00-17:00', value: 'weekday_afternoon' },
          { label: '周末 09:00-12:00', value: 'weekend_morning' },
        ] as Prisma.InputJsonValue,
        isVisible: true,
        isRequired: false,
        showInApp: true,
        showInAdmin: true,
        includeInExport: true,
        includeInPdf: true,
        includeInExcel: true,
      },
      update: {
        label: '配送时间段',
        fieldType: DeliveryUnitFieldType.SELECT,
        sortOrder: 80,
        placeholder: '请选择配送时间段',
        options: [
          { label: '工作日 09:00-12:00', value: 'weekday_morning' },
          { label: '工作日 14:00-17:00', value: 'weekday_afternoon' },
          { label: '周末 09:00-12:00', value: 'weekend_morning' },
        ] as Prisma.InputJsonValue,
        isVisible: true,
        isRequired: false,
        showInApp: true,
        showInAdmin: true,
        includeInExport: true,
        includeInPdf: true,
        includeInExcel: true,
      },
    }),
  ]);

  const manifestTemplates = await seedManifestTemplates(superAdmin.id);

  const configs = await Promise.all([
    prisma.deliveryConfig.upsert({
      where: { key: 'LOW_STOCK_DISPLAY_THRESHOLD' },
      create: {
        key: 'LOW_STOCK_DISPLAY_THRESHOLD',
        scope: DeliveryConfigScope.SYSTEM,
        value: { value: 10 } as Prisma.InputJsonValue,
        description: '配送商品低库存展示阈值',
      },
      update: {
        scope: DeliveryConfigScope.SYSTEM,
        value: { value: 10 } as Prisma.InputJsonValue,
        description: '配送商品低库存展示阈值',
      },
    }),
    prisma.deliveryConfig.upsert({
      where: { key: 'CUSTOMER_SERVICE_DEFAULTS' },
      create: {
        key: 'CUSTOMER_SERVICE_DEFAULTS',
        scope: DeliveryConfigScope.CUSTOMER_SERVICE,
        value: {
          serviceHours: '09:00-18:00',
          escalationMinutes: 30,
          quickQuestions: ['配送订单什么时候发货？', '配送清单在哪里下载？', '商品有破损怎么办？'],
          defaultReply: '您好，这里是 AI爱买买配送客服，请提供配送订单号或配送单位名称。',
        } as Prisma.InputJsonValue,
        description: '配送客服默认配置',
      },
      update: {
        scope: DeliveryConfigScope.CUSTOMER_SERVICE,
        value: {
          serviceHours: '09:00-18:00',
          escalationMinutes: 30,
          quickQuestions: ['配送订单什么时候发货？', '配送清单在哪里下载？', '商品有破损怎么办？'],
          defaultReply: '您好，这里是 AI爱买买配送客服，请提供配送订单号或配送单位名称。',
        } as Prisma.InputJsonValue,
        description: '配送客服默认配置',
      },
    }),
    prisma.deliveryConfig.upsert({
      where: { key: 'MANIFEST_CUSTOM_COLUMNS_ENABLED' },
      create: {
        key: 'MANIFEST_CUSTOM_COLUMNS_ENABLED',
        scope: DeliveryConfigScope.MANIFEST,
        value: { enabled: true } as Prisma.InputJsonValue,
        description: '配送清单允许后台配置列名、排序、显示状态和单笔自定义列',
      },
      update: {
        scope: DeliveryConfigScope.MANIFEST,
        value: { enabled: true } as Prisma.InputJsonValue,
        description: '配送清单允许后台配置列名、排序、显示状态和单笔自定义列',
      },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        message: 'Delivery seed completed',
        passwordSource: process.env.DELIVERY_SEED_PASSWORD ? 'DELIVERY_SEED_PASSWORD' : 'default seed password',
        admins: admins.map((admin) => ({
          id: admin.id,
          username: admin.username,
          roleCodes: admin.roleCodes,
        })),
        merchant: {
          id: merchant.id,
          applicationId: merchantApplication.id,
          ownerStaffId: owner.id,
          ownerUsername: owner.username,
        },
        categories: [freshCategory, stapleCategory, fruitCategory].map((category) => ({
          id: category.id,
          path: category.path,
        })),
        productUnits: [boxUnit, bagUnit].map((unit) => ({
          id: unit.id,
          name: unit.name,
        })),
        products: [
          { id: riceProduct.id, skuId: riceSku.id, skuCode: riceSku.skuCode },
          { id: appleProduct.id, skuId: appleSku.id, skuCode: appleSku.skuCode },
        ],
        buyer: {
          id: buyer.id,
          phone: buyer.phone,
          unitId: deliveryUnit.id,
          addressId: address.id,
        },
        rules: {
          priceRuleIds: priceRules.map((rule) => rule.id),
          shippingRuleId: shippingRule.id,
        },
        unitFieldConfigKeys: unitFieldConfigs.map((config) => config.fieldKey),
        manifestTemplates,
        configKeys: configs.map((config) => config.key),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
