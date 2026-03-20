/**
 * 种子数据：镜像前端 src/mocks/ 中的 Mock 数据
 * 确保后端 API 返回与前端 Mock 完全一致的数据
 *
 * 适配 Phase 1/2 新 Schema（60+ 模型，9 大域）
 *
 * 运行：npx prisma db seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始填充种子数据...');

  // D21 兼容：库存允许为负（支付后建单场景容忍超卖），清理历史 CHECK 约束
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductSKU"
    DROP CONSTRAINT IF EXISTS chk_product_sku_stock_non_negative;
  `);
  console.log('✅ ProductSKU 非负库存 CHECK 约束已清理（支持 D21 超卖容忍）');

  // M12: 添加 VipProgress.unlockedLevel 范围约束（0-15，VIP 最多收取 15 层）
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_vip_progress_unlocked_level'
      ) THEN
        ALTER TABLE "VipProgress" ADD CONSTRAINT chk_vip_progress_unlocked_level CHECK ("unlockedLevel" >= 0 AND "unlockedLevel" <= 15);
      END IF;
    END $$;
  `);
  console.log('✅ VipProgress CHECK(unlockedLevel 0-15) 约束已添加');

  // M04: 添加 RewardAccount.frozen >= 0 的 CHECK 约束（防止冻结余额变为负数）
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_reward_account_frozen_non_negative'
      ) THEN
        ALTER TABLE "RewardAccount" ADD CONSTRAINT chk_reward_account_frozen_non_negative CHECK (frozen >= 0);
      END IF;
    END $$;
  `);
  console.log('✅ RewardAccount CHECK(frozen >= 0) 约束已添加');

  // ============================================================
  // 用户（User + UserProfile + AuthIdentity）
  // ============================================================
  const demoUser = await prisma.user.upsert({
    where: { id: 'u-001' },
    update: {},
    create: {
      id: 'u-001',
      status: 'ACTIVE',
      profile: {
        create: {
          nickname: '林青禾',
          avatarUrl: 'https://placehold.co/200x200/png',
          level: '生长会员',
          levelProgress: 0.62,
          growthPoints: 620,
          nextLevelPoints: 1000,
          points: 280,
          city: '上海',
          interests: ['有机蔬菜', '蓝莓', '轻食'],
          avatarFrameType: 'vip',
          avatarFrameLabel: '丰收会员框',
        },
      },
      authIdentities: {
        create: {
          provider: 'PHONE',
          identifier: '13800138000',
          verified: true,
          meta: { passwordHash: await bcrypt.hash('123456', 10) },
        },
      },
    },
  });
  console.log(`✅ 用户已创建: u-001`);

  // 额外 mock 用户（供 Follow 使用）
  const extraUsers = [
    {
      id: 'u-002',
      phone: '13800138002',
      nickname: '江晴',
      city: '上海',
      interests: ['阳台种植', '轻食'],
    },
    {
      id: 'u-006',
      phone: '13800138006',
      nickname: '顾予夏',
      city: '上海',
      interests: ['轻食', '食谱'],
    },
  ];

  for (const u of extraUsers) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        status: 'ACTIVE',
        profile: {
          create: {
            nickname: u.nickname,
            avatarUrl: 'https://placehold.co/200x200/png',
            level: '新芽会员',
            city: u.city,
            interests: u.interests,
          },
        },
        authIdentities: {
          create: {
            provider: 'PHONE',
            identifier: u.phone,
            verified: true,
            meta: { passwordHash: await bcrypt.hash('123456', 10) },
          },
        },
      },
    });
  }
  console.log(`✅ ${extraUsers.length} 个额外用户已创建（供 Follow 使用）`);

  // ============================================================
  // 企业（Company + CompanyProfile）
  // ============================================================
  const companies = [
    {
      id: 'c-001',
      name: '澄源生态农业',
      address: { text: '云南·玉溪', lat: 24.351, lng: 102.543 },
      highlights: {
        cover: 'https://placehold.co/800x480/png',
        mainBusiness: '有机蔬菜与富硒粮油',
        badges: ['优选基地', '品质认证'],
        latestTestedAt: '2024-11-20',
        groupTargetSize: 30,
      },
    },
    {
      id: 'c-002',
      name: '青禾智慧农场',
      description: '位于江苏省苏州市吴中区的智慧农场，主营水培蔬菜和有机果蔬，支持企业采购。',
      address: { text: '江苏·苏州', lat: 31.298, lng: 120.585 },
      highlights: {
        cover: 'https://placehold.co/800x480/png',
        mainBusiness: '水培蔬菜、基地直供',
        badges: ['产地直供', '低碳种植'],
        latestTestedAt: '2024-12-02',
        groupTargetSize: 40,
      },
    },
    {
      id: 'c-003',
      name: '北纬蓝莓实验田',
      address: { text: '辽宁·大连', lat: 38.914, lng: 121.614 },
      highlights: {
        cover: 'https://placehold.co/800x480/png',
        mainBusiness: '蓝莓/果品深加工',
        badges: ['品质认证'],
        latestTestedAt: '2024-10-10',
        groupTargetSize: 25,
      },
    },
    {
      id: 'c-004',
      name: '云岭茶事研究社',
      address: { text: '福建·武夷', lat: 27.734, lng: 118.037 },
      highlights: {
        cover: 'https://placehold.co/800x480/png',
        mainBusiness: '茶饮/礼盒/产地直销',
        badges: ['优选基地'],
        latestTestedAt: '2024-09-01',
        groupTargetSize: 35,
      },
    },
  ];

  const companyContacts: Record<string, { name: string; phone: string }> = {
    'c-001': { name: '陈澄源', phone: '13800001001' },
    'c-002': { name: '李青禾', phone: '13800001002' },
    'c-003': { name: '张蓝莓', phone: '13800001003' },
    'c-004': { name: '王云岭', phone: '13800001004' },
  };

  for (const c of companies) {
    await prisma.company.upsert({
      where: { id: c.id },
      update: {
        description: c.description || null,
        contact: companyContacts[c.id] || null,
        servicePhone: companyContacts[c.id]?.phone || null,
      },
      create: {
        id: c.id,
        name: c.name,
        description: c.description || null,
        status: 'ACTIVE',
        address: c.address,
        contact: companyContacts[c.id] || null,
        servicePhone: companyContacts[c.id]?.phone || null,
        profile: {
          create: {
            highlights: c.highlights,
          },
        },
      },
    });
  }
  console.log(`✅ ${companies.length} 个企业已创建`);

  // ============================================================
  // 企业员工（CompanyStaff — 卖家系统）
  // 为每个企业创建 OWNER 用户，手机号与企业联系人一致
  // ============================================================
  const companyOwners = [
    { staffId: 'cs-001', userId: 'u-seller-001', companyId: 'c-001', phone: '13800001001', nickname: '陈澄源' },
    { staffId: 'cs-002', userId: 'u-seller-002', companyId: 'c-002', phone: '13800001002', nickname: '李青禾' },
    { staffId: 'cs-003', userId: 'u-seller-003', companyId: 'c-003', phone: '13800001003', nickname: '张蓝莓' },
    { staffId: 'cs-004', userId: 'u-seller-004', companyId: 'c-004', phone: '13800001004', nickname: '王云岭' },
  ];

  for (const owner of companyOwners) {
    // 创建卖家用户（与买家用户共用 User 表）
    await prisma.user.upsert({
      where: { id: owner.userId },
      update: {},
      create: {
        id: owner.userId,
        status: 'ACTIVE',
        profile: {
          create: {
            nickname: owner.nickname,
            avatarUrl: 'https://placehold.co/200x200/png',
            level: '新芽会员',
          },
        },
        authIdentities: {
          create: {
            provider: 'PHONE',
            identifier: owner.phone,
            verified: true,
            meta: { passwordHash: await bcrypt.hash('123456', 10) },
          },
        },
      },
    });

    // 创建企业员工关联（OWNER 角色）
    await prisma.companyStaff.upsert({
      where: { userId_companyId: { userId: owner.userId, companyId: owner.companyId } },
      update: {},
      create: {
        id: owner.staffId,
        userId: owner.userId,
        companyId: owner.companyId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
  }
  console.log(`✅ ${companyOwners.length} 个企业主（OWNER）已创建`);

  // ============================================================
  // 商品（Product + ProductMedia + ProductSKU + Tag/ProductTag）
  // ============================================================
  const products = [
    {
      id: 'p-001',
      title: '高山有机小番茄',
      basePrice: 19.8,
      cost: 9.9, // 成本价（约 50%）
      origin: { text: '云南·玉溪' },
      image: 'https://images.pexels.com/photos/2817549/pexels-photo-2817549.jpeg?auto=compress&cs=tinysrgb&w=600',
      tags: ['有机认证', '当季鲜采'],
      companyId: 'c-001',
      skuTitle: '1斤装',
      skuPrice: 19.8,
      skuCost: 9.9, // SKU 成本价
      stock: 100,
    },
    {
      id: 'p-002',
      title: '山泉水培生菜',
      basePrice: 12.5,
      cost: 6.0, // 成本价（约 48%）
      origin: { text: '江苏·苏州' },
      image: 'https://images.pexels.com/photos/4199758/pexels-photo-4199758.jpeg?auto=compress&cs=tinysrgb&w=600',
      tags: ['可信溯源'],
      companyId: 'c-002',
      skuTitle: '1份装',
      skuPrice: 12.5,
      skuCost: 6.0, // SKU 成本价
      stock: 200,
    },
    {
      id: 'p-003',
      title: '低温冷链蓝莓',
      basePrice: 58,
      cost: 27.0, // 成本价（约 47%）
      origin: { text: '辽宁·大连' },
      image: 'https://images.pexels.com/photos/1395958/pexels-photo-1395958.jpeg?auto=compress&cs=tinysrgb&w=600',
      tags: ['检测报告', '地理标志'],
      companyId: 'c-003',
      skuTitle: '1盒装',
      skuPrice: 58,
      skuCost: 27.0, // SKU 成本价
      stock: 50,
    },
    {
      id: 'p-004',
      title: '富硒胚芽米',
      basePrice: 39.9,
      cost: 18.0, // 成本价（约 45%）
      origin: { text: '黑龙江·五常' },
      image: 'https://images.pexels.com/photos/4110251/pexels-photo-4110251.jpeg?auto=compress&cs=tinysrgb&w=600',
      tags: ['地理标志'],
      companyId: 'c-001',
      skuTitle: '1袋装',
      skuPrice: 39.9,
      skuCost: 18.0, // SKU 成本价
      stock: 150,
    },
    {
      id: 'p-005',
      title: '有机绿茶礼盒',
      basePrice: 128,
      cost: 58.0, // 成本价（约 45%）
      origin: { text: '福建·武夷' },
      image: 'https://images.pexels.com/photos/8474087/pexels-photo-8474087.jpeg?auto=compress&cs=tinysrgb&w=600',
      tags: ['有机认证'],
      companyId: 'c-004',
      skuTitle: '1盒装',
      skuPrice: 128,
      skuCost: 58.0, // SKU 成本价
      stock: 80,
    },
    {
      id: 'p-006',
      title: '生态散养土鸡蛋',
      basePrice: 29.9,
      cost: 14.0, // 成本价（约 47%）
      origin: { text: '四川·雅安' },
      image: 'https://images.pexels.com/photos/2985167/pexels-photo-2985167.jpeg?auto=compress&cs=tinysrgb&w=600',
      tags: ['可信溯源'],
      companyId: 'c-002',
      skuTitle: '30枚装',
      skuPrice: 29.9,
      skuCost: 14.0, // SKU 成本价
      stock: 120,
    },
  ];

  // 先创建 Tag
  const allTagNames = [...new Set(products.flatMap((p) => p.tags))];
  for (const tagName of allTagNames) {
    await prisma.tag.upsert({
      where: { name: tagName },
      update: {},
      create: { name: tagName, type: 'PRODUCT' },
    });
  }
  console.log(`✅ ${allTagNames.length} 个标签已创建`);

  for (const p of products) {
    // 创建商品 + SKU + 媒体（含成本价，用于分润计算）
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        companyId: p.companyId,
        title: p.title,
        basePrice: p.basePrice,
        cost: p.cost, // 商品成本价
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        origin: p.origin,
        skus: {
          create: {
            id: `sku-${p.id}`,
            title: p.skuTitle,
            price: p.skuPrice,
            cost: p.skuCost, // SKU 成本价（分润优先使用 SKU 级别成本）
            stock: p.stock,
            status: 'ACTIVE',
          },
        },
        media: {
          create: {
            type: 'IMAGE',
            url: p.image,
            sortOrder: 0,
          },
        },
      },
    });
    // 如果商品已存在，更新其图片
    await prisma.productMedia.updateMany({ where: { productId: p.id }, data: { url: p.image } });

    // 创建 ProductTag 关联
    for (const tagName of p.tags) {
      const tag = await prisma.tag.findUnique({ where: { name: tagName } });
      if (tag) {
        await prisma.productTag.upsert({
          where: { productId_tagId: { productId: p.id, tagId: tag.id } },
          update: {},
          create: { productId: p.id, tagId: tag.id },
        });
      }
    }
  }
  console.log(`✅ ${products.length} 个商品已创建（含 SKU/媒体/标签）`);

  // ============================================================
  // 企业活动（CompanyActivity，替代旧 CompanyEvent）
  // ============================================================
  const today = new Date();
  const addDays = (base: Date, days: number) => {
    const next = new Date(base);
    next.setDate(base.getDate() + days);
    return next;
  };

  const makeStartAt = (base: Date, days: number, hours: number, minutes: number) => {
    const d = addDays(base, days);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  const makeEndAt = (base: Date, days: number, hours: number, minutes: number) => {
    const d = addDays(base, days);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  const companyActivities = [
    {
      id: 'e-001',
      companyId: 'c-001',
      title: '春季有机蔬菜基地参观',
      startAt: makeStartAt(today, 1, 9, 30),
      endAt: makeEndAt(today, 1, 11, 0),
      content: { type: 'visit', description: '安排基地讲解与采摘体验。', location: '云南·玉溪', capacity: 30, bookedCount: 12 },
    },
    {
      id: 'e-006',
      companyId: 'c-001',
      title: '基地讲解专场',
      startAt: makeStartAt(today, 1, 12, 30),
      endAt: makeEndAt(today, 1, 14, 0),
      content: { type: 'briefing', description: '聚焦种植标准与品控流程。', location: '云南·玉溪', capacity: 20, bookedCount: 18 },
    },
    {
      id: 'e-007',
      companyId: 'c-001',
      title: '富硒粮油品鉴活动',
      startAt: makeStartAt(today, 1, 15, 0),
      endAt: makeEndAt(today, 1, 16, 30),
      content: { type: 'activity', description: '体验低温压榨产品与搭配方案。', location: '云南·玉溪', capacity: 25, bookedCount: 25 },
    },
    {
      id: 'e-008',
      companyId: 'c-001',
      title: '产地直播连线',
      startAt: makeStartAt(today, 1, 17, 0),
      endAt: makeEndAt(today, 1, 18, 0),
      content: { type: 'live', description: '实时展示采收与分拣。', location: '云南·玉溪' },
    },
    {
      id: 'e-002',
      companyId: 'c-001',
      title: '富硒粮油生产流程展示',
      startAt: makeStartAt(today, 3, 10, 0),
      endAt: makeEndAt(today, 3, 11, 30),
      content: { type: 'activity', description: '展示低温压榨与品控流程。', location: '云南·玉溪', capacity: 30, bookedCount: 6 },
    },
    {
      id: 'e-003',
      companyId: 'c-002',
      title: '智慧温室讲解',
      startAt: makeStartAt(today, 2, 9, 0),
      endAt: makeEndAt(today, 2, 10, 30),
      content: { type: 'briefing', description: '讲解水培与环境控制系统。', location: '江苏·苏州', capacity: 18, bookedCount: 9 },
    },
    {
      id: 'e-009',
      companyId: 'c-002',
      title: '智慧温室直播',
      startAt: makeStartAt(today, 5, 14, 0),
      endAt: makeEndAt(today, 5, 15, 30),
      content: { type: 'live', description: '实时展示水培与环境控制。', location: '江苏·苏州' },
    },
    {
      id: 'e-004',
      companyId: 'c-003',
      title: '蓝莓加工车间参观',
      startAt: makeStartAt(today, 4, 10, 30),
      endAt: makeEndAt(today, 4, 12, 0),
      content: { type: 'visit', description: '介绍分拣、冷链与深加工流程。', location: '辽宁·大连', capacity: 24, bookedCount: 16 },
    },
    {
      id: 'e-005',
      companyId: 'c-004',
      title: '茶园采摘体验日',
      startAt: makeStartAt(today, 6, 9, 30),
      endAt: makeEndAt(today, 6, 11, 0),
      content: { type: 'activity', description: '体验手工采摘与初制流程。', location: '福建·武夷', capacity: 20, bookedCount: 7 },
    },
  ];

  for (const e of companyActivities) {
    await prisma.companyActivity.upsert({
      where: { id: e.id },
      update: {},
      create: e,
    });
  }
  console.log(`✅ ${companyActivities.length} 个企业活动已创建`);

  // ============================================================
  // 考察团（Group — 使用枚举状态）
  // ============================================================
  const groups = [
    {
      id: 'g-001',
      companyId: 'c-001',
      title: '澄源生态农业春季考察团',
      destination: '云南·玉溪',
      targetSize: 30,
      memberCount: 18,
      deadline: '2025-03-10',
      status: 'FORMING' as const,
    },
    {
      id: 'g-002',
      companyId: 'c-002',
      title: '青禾智慧农场合作团',
      destination: '江苏·苏州',
      targetSize: 40,
      memberCount: 32,
      deadline: '2025-03-12',
      status: 'FULL' as const,
    },
    {
      id: 'g-003',
      companyId: 'c-003',
      title: '北纬蓝莓研学团',
      destination: '辽宁·大连',
      targetSize: 25,
      memberCount: 25,
      deadline: '2025-03-08',
      status: 'INVITING' as const,
    },
  ];

  for (const g of groups) {
    await prisma.group.upsert({
      where: { id: g.id },
      update: {},
      create: g,
    });
  }
  console.log(`✅ ${groups.length} 个考察团已创建`);

  // ============================================================
  // 订单（Order + OrderItem — 使用新 Schema 结构）
  // ============================================================
  // 默认地址快照（用于所有演示订单）
  const defaultAddressSnapshot = {
    receiverName: '林青禾',
    phone: '13800138000',
    province: '云南省',
    city: '昆明市',
    district: '盘龙区',
    detail: '翠湖路 88 号农脉大厦 12 楼',
  };

  const ordersData = [
    {
      id: 'o-001',
      userId: 'u-001',
      status: 'PAID' as const,
      totalAmount: 64.6,
      goodsAmount: 64.6,
      paidAt: new Date('2026-01-18T15:00:00Z'),
      addressSnapshot: defaultAddressSnapshot,
      items: [
        {
          id: 'oi-001',
          skuId: 'sku-p-001',
          unitPrice: 19.8,
          quantity: 2,
          productSnapshot: { productId: 'p-001', title: '高山有机小番茄', image: 'https://placehold.co/600x600/png', price: 19.8 },
        },
        {
          id: 'oi-002',
          skuId: 'sku-p-002',
          unitPrice: 12.5,
          quantity: 2,
          productSnapshot: { productId: 'p-002', title: '山泉水培生菜', image: 'https://placehold.co/600x600/png', price: 12.5 },
        },
      ],
    },
    {
      id: 'o-002',
      userId: 'u-001',
      status: 'PAID' as const,
      totalAmount: 128,
      goodsAmount: 128,
      addressSnapshot: defaultAddressSnapshot,
      items: [
        {
          id: 'oi-003',
          skuId: 'sku-p-005',
          unitPrice: 128,
          quantity: 1,
          productSnapshot: { productId: 'p-005', title: '有机绿茶礼盒', image: 'https://placehold.co/600x600/png', price: 128 },
        },
      ],
    },
    {
      id: 'o-003',
      userId: 'u-001',
      status: 'SHIPPED' as const,
      totalAmount: 58,
      goodsAmount: 58,
      addressSnapshot: defaultAddressSnapshot,
      items: [
        {
          id: 'oi-004',
          skuId: 'sku-p-003',
          unitPrice: 58,
          quantity: 1,
          productSnapshot: { productId: 'p-003', title: '低温冷链蓝莓', image: 'https://placehold.co/600x600/png', price: 58 },
        },
      ],
    },
    {
      id: 'o-004',
      userId: 'u-001',
      status: 'RECEIVED' as const,
      totalAmount: 36,
      goodsAmount: 36,
      addressSnapshot: defaultAddressSnapshot,
      items: [
        {
          id: 'oi-005',
          skuId: 'sku-p-006',
          unitPrice: 36,
          quantity: 1,
          productSnapshot: { productId: 'p-006', title: '农场鸡蛋 30 枚', image: 'https://placehold.co/600x600/png', price: 36 },
        },
      ],
    },
  ];

  for (const order of ordersData) {
    const { items, ...orderData } = order;
    await prisma.order.upsert({
      where: { id: order.id },
      update: { addressSnapshot: orderData.addressSnapshot || undefined },
      create: {
        ...orderData,
        items: {
          create: items,
        },
      },
    });
  }
  console.log(`✅ ${ordersData.length} 个订单已创建`);

  // ============================================================
  // SD-1: 为 o-001(PAID) 添加 Payment 记录
  // ============================================================
  await prisma.payment.upsert({
    where: { merchantOrderNo: 'PAY-o-001' },
    update: {},
    create: {
      orderId: 'o-001',
      channel: 'WECHAT_PAY',
      scene: 'APP',
      amount: 64.6,
      status: 'PAID',
      merchantOrderNo: 'PAY-o-001',
      providerTxnId: 'WX-TXN-DEMO-001',
      paidAt: new Date('2026-01-18T15:00:00Z'),
    },
  });
  console.log('✅ o-001 Payment 记录已创建');

  // ============================================================
  // SD-2: 为 o-002(PAID) 添加 Payment 记录
  // ============================================================
  await prisma.payment.upsert({
    where: { merchantOrderNo: 'PAY-o-002' },
    update: {},
    create: {
      orderId: 'o-002',
      channel: 'WECHAT_PAY',
      scene: 'APP',
      amount: 128,
      status: 'PAID',
      merchantOrderNo: 'PAY-o-002',
      providerTxnId: 'WX-TXN-DEMO-002',
      paidAt: new Date('2026-01-20T10:30:00Z'),
    },
  });
  console.log('✅ o-002 Payment 记录已创建');

  // ============================================================
  // SD-3: 为 o-003(SHIPPED) 添加 Payment + Shipment 记录
  // ============================================================
  await prisma.payment.upsert({
    where: { merchantOrderNo: 'PAY-o-003' },
    update: {},
    create: {
      orderId: 'o-003',
      channel: 'ALIPAY',
      scene: 'APP',
      amount: 58,
      status: 'PAID',
      merchantOrderNo: 'PAY-o-003',
      providerTxnId: 'ALI-TXN-DEMO-003',
      paidAt: new Date('2026-01-22T14:00:00Z'),
    },
  });
  await prisma.shipment.upsert({
    where: { orderId_companyId: { orderId: 'o-003', companyId: 'c-003' } },
    update: {},
    create: {
      orderId: 'o-003',
      companyId: 'c-003',
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      trackingNo: 'SF1234567890',
      status: 'IN_TRANSIT',
      shippedAt: new Date('2026-01-23T09:00:00Z'),
    },
  });
  // 设置自动确认收货时间（发货后 7 天）
  await prisma.order.update({
    where: { id: 'o-003' },
    data: { autoReceiveAt: new Date('2026-01-30T09:00:00Z') },
  });
  console.log('✅ o-003 Payment + Shipment 记录已创建');

  // ============================================================
  // SD-8: 为 u-001 添加地址 + 购物车种子数据
  // ============================================================
  await prisma.address.upsert({
    where: { id: 'addr-001' },
    update: {},
    create: {
      id: 'addr-001',
      userId: 'u-001',
      recipientName: '林青禾',
      phone: '13800138000',
      regionCode: '310115',
      regionText: '上海市浦东新区',
      detail: '张江高科技园区碧波路690号',
      isDefault: true,
    },
  });
  await prisma.address.upsert({
    where: { id: 'addr-002' },
    update: {},
    create: {
      id: 'addr-002',
      userId: 'u-001',
      recipientName: '林青禾',
      phone: '13800138000',
      regionCode: '310104',
      regionText: '上海市徐汇区',
      detail: '漕河泾开发区虹梅路2007号',
      isDefault: false,
    },
  });
  console.log('✅ u-001 地址已创建（2 条）');

  const u001Cart = await prisma.cart.upsert({
    where: { userId: 'u-001' },
    update: {},
    create: { userId: 'u-001' },
  });
  // 先清除旧购物车项，再创建
  await prisma.cartItem.deleteMany({ where: { cartId: u001Cart.id } });
  await prisma.cartItem.createMany({
    data: [
      { cartId: u001Cart.id, skuId: 'sku-p-004', quantity: 1 },
      { cartId: u001Cart.id, skuId: 'sku-p-006', quantity: 2 },
    ],
  });
  console.log('✅ u-001 购物车已创建（2 个商品）');

  // 售后记录通过 OrderStatusHistory
  await prisma.orderStatusHistory.create({
    data: {
      orderId: 'o-004',
      fromStatus: 'RECEIVED',
      toStatus: 'REFUNDED',
      reason: '商品破损',
      meta: {
        afterSaleNote: '收到后包装有明显破损，鸡蛋有裂痕',
        timeline: [
          { status: 'applying', title: '提交申请', time: '2024-11-20 10:00' },
          { status: 'reviewing', title: '平台审核', time: '2024-11-21 09:30' },
        ],
      },
    },
  });
  console.log('✅ 售后记录已创建');

  // ============================================================
  // 预约（Booking — 使用枚举状态，activityId 替代 eventId）
  // ============================================================
  const bookings = [
    {
      id: 'b-001',
      userId: 'u-001',
      companyId: 'c-001',
      activityId: 'e-001',
      date: '2025-03-12',
      headcount: 6,
      identity: 'consumer',
      note: '希望安排采摘体验',
      contactName: '王雨',
      contactPhone: '13800001234',
      status: 'PENDING' as const,
    },
    {
      id: 'b-002',
      userId: 'u-001',
      companyId: 'c-002',
      activityId: 'e-003',
      date: '2025-03-15',
      headcount: 12,
      identity: 'buyer',
      note: '关注长期供货合作',
      contactName: '赵峰',
      contactPhone: '13900005678',
      status: 'APPROVED' as const,
      reviewedAt: new Date('2025-03-02T12:10:00Z'),
    },
    {
      id: 'b-003',
      userId: 'u-001',
      companyId: 'c-003',
      activityId: 'e-004',
      date: '2025-03-18',
      headcount: 20,
      identity: 'student',
      note: '研学活动，需要讲解',
      contactName: '刘晨',
      contactPhone: '13700004567',
      status: 'INVITED' as const,
      reviewedAt: new Date('2025-03-03T09:00:00Z'),
      groupId: 'g-003',
    },
    {
      id: 'b-004',
      userId: 'u-001',
      companyId: 'c-004',
      activityId: 'e-005',
      date: '2025-03-22',
      headcount: 4,
      identity: 'media',
      note: '需要拍摄素材',
      contactName: '陈然',
      contactPhone: '13600007890',
      status: 'REJECTED' as const,
      reviewedAt: new Date('2025-03-03T12:00:00Z'),
      auditNote: '当前接待已满，请改期',
    },
    {
      id: 'b-005',
      userId: 'u-001',
      companyId: 'c-002',
      activityId: 'e-003',
      date: '2025-03-15',
      headcount: 8,
      identity: 'investor',
      note: '计划考察基地与产能',
      contactName: '周一',
      contactPhone: '13500009900',
      status: 'JOINED' as const,
      reviewedAt: new Date('2025-03-04T09:30:00Z'),
      groupId: 'g-002',
    },
  ];

  for (const b of bookings) {
    await prisma.booking.upsert({
      where: { id: b.id },
      update: {},
      create: b,
    });
  }
  console.log(`✅ ${bookings.length} 个预约已创建`);

  // ============================================================
  // 关注关系（Follow — followedType 使用枚举）
  // ============================================================
  const follows = [
    { id: 'f-001', followerId: 'u-001', followedId: 'u-002', followedType: 'USER' as const },
    { id: 'f-002', followerId: 'u-001', followedId: 'c-004', followedType: 'COMPANY' as const },
    { id: 'f-003', followerId: 'u-001', followedId: 'c-002', followedType: 'COMPANY' as const },
  ];

  for (const f of follows) {
    await prisma.follow.upsert({
      where: { id: f.id },
      update: {},
      create: f,
    });
  }
  console.log(`✅ ${follows.length} 条关注关系已创建`);

  // ============================================================
  // 任务（Task — 结构未变）
  // ============================================================
  const tasks = [
    {
      id: 'task-001',
      title: '完成首次签到',
      rewardLabel: '+5 积分',
      rewardPoints: 5,
      targetRoute: '/me/check-in',
    },
    {
      id: 'task-002',
      title: '浏览 3 个企业主页',
      rewardLabel: '+10 积分 +5 成长值',
      rewardPoints: 10,
      rewardGrowth: 5,
      targetRoute: '/(tabs)/museum',
    },
    {
      id: 'task-003',
      title: '完成首次下单',
      rewardLabel: '+20 积分 +10 成长值',
      rewardPoints: 20,
      rewardGrowth: 10,
      targetRoute: '/(tabs)/home',
    },
  ];

  for (const t of tasks) {
    await prisma.task.upsert({
      where: { id: t.id },
      update: {},
      create: t,
    });
  }
  console.log(`✅ ${tasks.length} 个任务已创建`);

  // 1 条任务完成记录（用户已完成首次签到）
  await prisma.taskCompletion.upsert({
    where: { userId_taskId: { userId: 'u-001', taskId: 'task-001' } },
    update: {},
    create: {
      userId: 'u-001',
      taskId: 'task-001',
    },
  });
  console.log('✅ 1 条任务完成记录已创建');

  // ============================================================
  // 签到记录（模拟连续 3 天签到）
  // ============================================================
  const formatDate = (d: Date) => d.toISOString().slice(0, 10);
  const checkInDates = [
    formatDate(addDays(today, -3)),
    formatDate(addDays(today, -2)),
    formatDate(addDays(today, -1)),
  ];

  for (const date of checkInDates) {
    await prisma.checkIn.upsert({
      where: { userId_date: { userId: 'u-001', date } },
      update: {},
      create: {
        userId: 'u-001',
        date,
      },
    });
  }
  console.log(`✅ ${checkInDates.length} 条签到记录已创建`);

  // ============================================================
  // 消息（InboxMessage — 结构未变）
  // ============================================================
  const inboxMessages = [
    {
      id: 'msg-001',
      userId: 'u-001',
      category: 'system',
      type: 'order',
      title: '订单发货通知',
      content: '您的订单 o-003 已发货，预计 12-06 送达',
      unread: true,
      target: { route: '/orders/o-003' },
    },
    {
      id: 'msg-002',
      userId: 'u-001',
      category: 'system',
      type: 'booking',
      title: '预约审核通过',
      content: '您的预约 b-002 已通过审核，请关注后续组团通知',
      unread: true,
      target: { route: '/me/bookings' },
    },
    {
      id: 'msg-003',
      userId: 'u-001',
      category: 'interaction',
      type: 'like',
      title: '江晴 赞了你的评论',
      content: '在"高山有机小番茄"商品页的评论获得了一个赞',
      unread: false,
      target: { route: '/product/p-001' },
    },
    {
      id: 'msg-004',
      userId: 'u-001',
      category: 'interaction',
      type: 'comment',
      title: '顾予夏 回复了你',
      content: '"这个蓝莓确实不错，冷链到家还很新鲜！"',
      unread: true,
      target: { route: '/product/p-003' },
    },
    {
      id: 'msg-005',
      userId: 'u-001',
      category: 'system',
      type: 'group',
      title: '考察团成团通知',
      content: '北纬蓝莓研学团已达到目标人数，等待确认出发',
      unread: false,
      target: { route: '/me/bookings' },
    },
  ];

  for (const m of inboxMessages) {
    await prisma.inboxMessage.upsert({
      where: { id: m.id },
      update: {},
      create: m,
    });
  }
  console.log(`✅ ${inboxMessages.length} 条消息已创建`);

  // AI 快捷指令已从 Schema 中移除（前端常量/配置管理）

  // ============================================================
  // 管理后台种子数据
  // ============================================================

  // --- 权限定义 ---
  const permissions = [
    { code: 'dashboard:read', module: 'dashboard', action: 'read', description: '查看仪表盘' },
    { code: 'users:read', module: 'users', action: 'read', description: '查看用户列表' },
    { code: 'users:create', module: 'users', action: 'create', description: '创建用户' },
    { code: 'users:update', module: 'users', action: 'update', description: '编辑用户' },
    { code: 'users:ban', module: 'users', action: 'ban', description: '禁用用户' },
    { code: 'products:read', module: 'products', action: 'read', description: '查看商品列表' },
    { code: 'products:create', module: 'products', action: 'create', description: '创建商品' },
    { code: 'products:update', module: 'products', action: 'update', description: '编辑商品' },
    { code: 'products:delete', module: 'products', action: 'delete', description: '删除商品' },
    { code: 'products:audit', module: 'products', action: 'audit', description: '审核商品' },
    { code: 'orders:read', module: 'orders', action: 'read', description: '查看订单列表' },
    { code: 'orders:ship', module: 'orders', action: 'ship', description: '订单发货' },
    { code: 'orders:refund', module: 'orders', action: 'refund', description: '订单退款' },
    { code: 'orders:cancel', module: 'orders', action: 'cancel', description: '取消订单' },
    { code: 'invoices:read', module: 'invoices', action: 'read', description: '查看发票列表' },
    { code: 'invoices:issue', module: 'invoices', action: 'issue', description: '开票/标记失败' },
    { code: 'companies:read', module: 'companies', action: 'read', description: '查看企业列表' },
    { code: 'companies:update', module: 'companies', action: 'update', description: '编辑企业' },
    { code: 'companies:audit', module: 'companies', action: 'audit', description: '审核企业' },
    { code: 'bonus:read', module: 'bonus', action: 'read', description: '查看会员/奖励' },
    { code: 'bonus:approve_withdraw', module: 'bonus', action: 'approve_withdraw', description: '审批提现' },
    { code: 'bonus:adjust', module: 'bonus', action: 'adjust', description: '调整奖励' },
    { code: 'coupon:read', module: 'coupon', action: 'read', description: '查看红包活动与记录' },
    { code: 'coupon:manage', module: 'coupon', action: 'manage', description: '管理红包活动与发放' },
    { code: 'trace:read', module: 'trace', action: 'read', description: '查看溯源信息' },
    { code: 'trace:create', module: 'trace', action: 'create', description: '创建溯源批次' },
    { code: 'trace:update', module: 'trace', action: 'update', description: '编辑溯源批次' },
    { code: 'trace:delete', module: 'trace', action: 'delete', description: '删除溯源批次' },
    { code: 'config:read', module: 'config', action: 'read', description: '查看系统配置' },
    { code: 'config:update', module: 'config', action: 'update', description: '修改系统配置' },
    { code: 'admin_users:read', module: 'admin_users', action: 'read', description: '查看管理员列表' },
    { code: 'admin_users:create', module: 'admin_users', action: 'create', description: '创建管理员' },
    { code: 'admin_users:update', module: 'admin_users', action: 'update', description: '编辑管理员' },
    { code: 'admin_users:delete', module: 'admin_users', action: 'delete', description: '删除管理员' },
    { code: 'admin_roles:read', module: 'admin_roles', action: 'read', description: '查看角色列表' },
    { code: 'admin_roles:create', module: 'admin_roles', action: 'create', description: '创建角色' },
    { code: 'admin_roles:update', module: 'admin_roles', action: 'update', description: '编辑角色' },
    { code: 'admin_roles:delete', module: 'admin_roles', action: 'delete', description: '删除角色' },
    { code: 'audit:read', module: 'audit', action: 'read', description: '查看审计日志' },
    { code: 'audit:rollback', module: 'audit', action: 'rollback', description: '回滚操作' },
    { code: 'lottery:read', module: 'lottery', action: 'read', description: '抽奖管理-查看' },
    { code: 'lottery:create', module: 'lottery', action: 'create', description: '抽奖管理-创建' },
    { code: 'lottery:update', module: 'lottery', action: 'update', description: '抽奖管理-编辑' },
    { code: 'lottery:delete', module: 'lottery', action: 'delete', description: '抽奖管理-删除' },
    { code: 'reward_products:read', module: 'reward_products', action: 'read', description: '奖励商品-查看' },
    { code: 'reward_products:create', module: 'reward_products', action: 'create', description: '奖励商品-创建' },
    { code: 'reward_products:update', module: 'reward_products', action: 'update', description: '奖励商品-编辑' },
    { code: 'reward_products:delete', module: 'reward_products', action: 'delete', description: '奖励商品-删除' },
    { code: 'vip_gift:read', module: 'vip_gift', action: 'read', description: 'VIP赠品方案-查看' },
    { code: 'vip_gift:create', module: 'vip_gift', action: 'create', description: 'VIP赠品方案-创建' },
    { code: 'vip_gift:update', module: 'vip_gift', action: 'update', description: 'VIP赠品方案-编辑' },
    { code: 'shipping:read', module: 'shipping', action: 'read', description: '运费规则-查看' },
    { code: 'shipping:create', module: 'shipping', action: 'create', description: '运费规则-创建' },
    { code: 'shipping:update', module: 'shipping', action: 'update', description: '运费规则-编辑' },
    { code: 'shipping:delete', module: 'shipping', action: 'delete', description: '运费规则-删除' },
    { code: 'replacements:read', module: 'replacements', action: 'read', description: '换货管理-查看' },
    { code: 'replacements:arbitrate', module: 'replacements', action: 'arbitrate', description: '换货管理-仲裁' },
    { code: 'categories:read', module: 'categories', action: 'read', description: '分类管理-查看' },
    { code: 'categories:manage', module: 'categories', action: 'manage', description: '分类管理-增删改' },
  ];

  const permissionRecords: Record<string, string> = {};
  for (const p of permissions) {
    const record = await prisma.adminPermission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
    permissionRecords[p.code] = record.id;
  }
  console.log(`✅ ${permissions.length} 个权限定义已创建`);

  // --- 默认角色 ---
  // 超级管理员
  const superAdminRole = await prisma.adminRole.upsert({
    where: { name: '超级管理员' },
    update: {},
    create: {
      name: '超级管理员',
      description: '拥有所有权限，系统角色不可删除',
      isSystem: true,
    },
  });
  // 超级管理员拥有全部权限
  for (const [code, permId] of Object.entries(permissionRecords)) {
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: permId } },
      update: {},
      create: { roleId: superAdminRole.id, permissionId: permId },
    });
  }

  // 经理（大部分读写，无 admin_users/admin_roles 管理权限）
  const managerRole = await prisma.adminRole.upsert({
    where: { name: '经理' },
    update: {},
    create: {
      name: '经理',
      description: '大部分业务操作权限，无管理员和角色管理权限',
      isSystem: true,
    },
  });
  const managerPermissions = permissions
    .filter((p) => !p.module.startsWith('admin_'))
    .map((p) => p.code);
  for (const code of managerPermissions) {
    const permId = permissionRecords[code];
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: managerRole.id, permissionId: permId } },
      update: {},
      create: { roleId: managerRole.id, permissionId: permId },
    });
  }

  // 员工（大部分只读 + products:update）
  const staffRole = await prisma.adminRole.upsert({
    where: { name: '员工' },
    update: {},
    create: {
      name: '员工',
      description: '只读访问 + 商品编辑权限',
      isSystem: true,
    },
  });
  const staffPermissions = [
    'dashboard:read',
    'users:read',
    'products:read',
    'products:update',
    'orders:read',
    'companies:read',
    'bonus:read',
    'trace:read',
    'config:read',
    'audit:read',
  ];
  for (const code of staffPermissions) {
    const permId = permissionRecords[code];
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: staffRole.id, permissionId: permId } },
      update: {},
      create: { roleId: staffRole.id, permissionId: permId },
    });
  }
  console.log('✅ 3 个默认角色已创建（超级管理员/经理/员工）');

  // --- 超级管理员账号 ---
  const superAdminPassword = await bcrypt.hash('admin123456', 10);
  const superAdmin = await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: superAdminPassword,
      realName: '系统管理员',
      status: 'ACTIVE',
    },
  });
  // 关联超级管理员角色
  await prisma.adminUserRole.upsert({
    where: { adminUserId_roleId: { adminUserId: superAdmin.id, roleId: superAdminRole.id } },
    update: {},
    create: { adminUserId: superAdmin.id, roleId: superAdminRole.id },
  });
  console.log('✅ 超级管理员账号已创建（admin / admin123456）');

  // ============================================================
  // 平台系统用户（用于平台分润账户的外键关联）
  // ============================================================
  await prisma.user.upsert({
    where: { id: 'PLATFORM' },
    update: {},
    create: {
      id: 'PLATFORM',
      status: 'ACTIVE',
      profile: {
        create: {
          nickname: '农脉平台',
          avatarUrl: null,
          level: '系统',
        },
      },
    },
  });
  console.log('✅ 平台系统用户已创建（PLATFORM）');

  // ============================================================
  // 平台公司（用于奖励商品，如抽奖奖品）
  // ============================================================
  await prisma.company.upsert({
    where: { id: 'PLATFORM_COMPANY' },
    update: { name: '农脉app', isPlatform: true },
    create: {
      id: 'PLATFORM_COMPANY',
      name: '农脉app',
      isPlatform: true,
      status: 'ACTIVE',
      address: { text: '平台自营', lat: 0, lng: 0 },
      profile: {
        create: {
          highlights: {
            cover: 'https://placehold.co/800x480/png',
            mainBusiness: '奖励商品、抽奖奖品',
            badges: ['平台自营', '品质保障'],
          },
        },
      },
    },
  });
  console.log('✅ 平台公司已创建（PLATFORM_COMPANY）');

  // ============================================================
  // 普通用户树根节点（单棵树，单个平台系统根节点）
  // ============================================================
  await prisma.normalTreeNode.upsert({
    where: { id: 'NORMAL_ROOT' },
    update: {},
    create: {
      id: 'NORMAL_ROOT',
      rootId: 'NORMAL_ROOT',
      userId: null, // 系统根节点
      parentId: null,
      level: 0,
      position: 0,
      childrenCount: 0,
    },
  });
  console.log('✅ 普通用户树根节点已创建（NORMAL_ROOT）');

  // ============================================================
  // 分润系统配置（RuleConfig）
  // ============================================================
  const ruleConfigs = [
    { key: 'VIP_PLATFORM_PERCENT', value: 0.50, desc: 'VIP利润-平台分成比例' },
    { key: 'VIP_REWARD_PERCENT', value: 0.30, desc: 'VIP利润-奖励池比例' },
    { key: 'VIP_INDUSTRY_FUND_PERCENT', value: 0.10, desc: 'VIP利润-产业基金(卖家)比例' },
    { key: 'VIP_CHARITY_PERCENT', value: 0.02, desc: 'VIP利润-慈善基金比例' },
    { key: 'VIP_TECH_PERCENT', value: 0.02, desc: 'VIP利润-科技基金比例' },
    { key: 'VIP_RESERVE_PERCENT', value: 0.06, desc: 'VIP利润-备用金比例' },
    { key: 'NORMAL_BROADCAST_X', value: 20, desc: '@deprecated 普通广播每次分配订单数（已废弃）' },
    { key: 'VIP_MIN_AMOUNT', value: 100.0, desc: 'VIP 有效消费最低金额（元）' },
    { key: 'VIP_MAX_LAYERS', value: 15, desc: 'VIP 最多收取层数' },
    { key: 'VIP_BRANCH_FACTOR', value: 3, desc: '三叉树分叉数' },
    { key: 'VIP_PRICE', value: 399.0, desc: 'VIP 礼包价格（元）' },
    { key: 'VIP_REFERRAL_BONUS', value: 50.0, desc: 'VIP 推荐奖励金额（元）' },
    { key: 'BUCKET_RANGES', value: [[0, 10], [10, 50], [50, 100], [100, 500], [500, null]], desc: '@deprecated 普通桶金额区间（已废弃）' },
    { key: 'AUTO_CONFIRM_DAYS', value: 7, desc: '自动确认收货天数' },
    // --- 普通用户系统配置（NORMAL_* 前缀，与VIP完全独立） ---
    { key: 'NORMAL_BRANCH_FACTOR', value: 3, desc: '普通树叉数' },
    { key: 'NORMAL_MAX_LAYERS', value: 15, desc: '普通树最大分配层数' },
    { key: 'NORMAL_FREEZE_DAYS', value: 30, desc: '普通树冻结奖励过期天数' },
    { key: 'NORMAL_PLATFORM_PERCENT', value: 0.50, desc: '普通用户利润-平台分成比例' },
    { key: 'NORMAL_REWARD_PERCENT', value: 0.16, desc: '普通用户利润-奖励分成比例' },
    { key: 'NORMAL_INDUSTRY_FUND_PERCENT', value: 0.16, desc: '普通用户利润-产业基金(卖家)比例' },
    { key: 'NORMAL_CHARITY_PERCENT', value: 0.08, desc: '普通用户利润-慈善基金比例' },
    { key: 'NORMAL_TECH_PERCENT', value: 0.08, desc: '普通用户利润-科技基金比例' },
    { key: 'NORMAL_RESERVE_PERCENT', value: 0.02, desc: '普通用户利润-备用金比例' },
    // --- VIP冻结过期（新增，原VIP系统无此机制） ---
    { key: 'VIP_FREEZE_DAYS', value: 30, desc: 'VIP冻结奖励过期天数' },
    // --- 定价系统 ---
    { key: 'MARKUP_RATE', value: 1.30, desc: '卖家商品加价率（售价=成本×此值）' },
    // --- 运费系统 ---
    { key: 'DEFAULT_SHIPPING_FEE', value: 8.0, desc: '无匹配规则时的默认运费' },
    // --- 抽奖系统 ---
    { key: 'LOTTERY_ENABLED', value: true, desc: '抽奖功能开关' },
    { key: 'LOTTERY_DAILY_CHANCES', value: 1, desc: '每日抽奖次数' },
    // --- F5: 奖励过期可配置 ---
    { key: 'VIP_REWARD_EXPIRY_DAYS', value: 30, desc: 'VIP用户奖励有效期（天）' },
    { key: 'NORMAL_REWARD_EXPIRY_DAYS', value: 30, desc: '普通用户奖励有效期（天）' },
  ];

  for (const rc of ruleConfigs) {
    await prisma.ruleConfig.upsert({
      where: { key: rc.key },
      update: {},
      create: { key: rc.key, value: { value: rc.value, description: rc.desc } },
    });
  }
  console.log(`✅ ${ruleConfigs.length} 条分润配置已创建`);

  // 创建初始配置版本快照
  const allConfigs = await prisma.ruleConfig.findMany();
  const configSnapshot: Record<string, any> = {};
  for (const c of allConfigs) {
    configSnapshot[c.key] = c.value;
  }
  await prisma.ruleVersion.upsert({
    where: { version: 'initial' },
    update: {},
    create: {
      version: 'initial',
      snapshot: configSnapshot,
      changeNote: '系统初始化默认配置',
    },
  });
  console.log('✅ 初始配置版本快照已创建');

  // ============================================================
  // 分润系统演示数据
  // ============================================================

  // 1. 创建 VIP 三叉树根节点 A1-A3（演示用，实际需要 A1-A10）
  for (let i = 1; i <= 3; i++) {
    await prisma.vipTreeNode.upsert({
      where: { id: `sys-a${i}` },
      update: {},
      create: {
        id: `sys-a${i}`,
        rootId: `A${i}`,
        userId: null,
        level: 0,
        position: 0,
        childrenCount: i === 1 ? 1 : 0, // A1 下有 1 个直接子节点（u-001）
      },
    });
  }
  console.log('✅ VIP 三叉树根节点 A1-A3 已创建');

  // 2. 为 u-001 创建会员资料（VIP）
  await prisma.memberProfile.upsert({
    where: { userId: 'u-001' },
    update: {
      tier: 'VIP',
      referralCode: 'LQHE2025',
      vipPurchasedAt: new Date('2025-12-01'),
      vipNodeId: 'vip-node-u001',
      normalEligible: true,
    },
    create: {
      userId: 'u-001',
      tier: 'VIP',
      referralCode: 'LQHE2025',
      vipPurchasedAt: new Date('2025-12-01'),
      vipNodeId: 'vip-node-u001',
      normalEligible: true,
    },
  });

  // u-001 的 VIP 三叉树节点（在 A1 下）
  await prisma.vipTreeNode.upsert({
    where: { id: 'vip-node-u001' },
    update: {},
    create: {
      id: 'vip-node-u001',
      rootId: 'A1',
      userId: 'u-001',
      parentId: 'sys-a1',
      level: 1,
      position: 0,
      childrenCount: 0,
    },
  });

  // u-001 VIP 进度
  await prisma.vipProgress.upsert({
    where: { userId: 'u-001' },
    update: {},
    create: {
      userId: 'u-001',
      selfPurchaseCount: 3,
      unlockedLevel: 3,
    },
  });

  // 3. u-002 为普通会员
  await prisma.memberProfile.upsert({
    where: { userId: 'u-002' },
    update: {
      tier: 'NORMAL',
      referralCode: 'JQ2025AB',
      normalEligible: true,
    },
    create: {
      userId: 'u-002',
      tier: 'NORMAL',
      referralCode: 'JQ2025AB',
      normalEligible: true,
    },
  });

  // 4. u-006 为 VIP 会员（由 u-001 邀请）
  await prisma.memberProfile.upsert({
    where: { userId: 'u-006' },
    update: {
      tier: 'VIP',
      referralCode: 'GYXIA025',
      inviterUserId: 'u-001',
      vipPurchasedAt: new Date('2026-01-15'),
      vipNodeId: 'vip-node-u006',
      normalEligible: true,
    },
    create: {
      userId: 'u-006',
      tier: 'VIP',
      referralCode: 'GYXIA025',
      inviterUserId: 'u-001',
      vipPurchasedAt: new Date('2026-01-15'),
      vipNodeId: 'vip-node-u006',
      normalEligible: true,
    },
  });

  // u-006 的 VIP 三叉树节点（在 u-001 下）
  await prisma.vipTreeNode.upsert({
    where: { id: 'vip-node-u006' },
    update: {},
    create: {
      id: 'vip-node-u006',
      rootId: 'A1',
      userId: 'u-006',
      parentId: 'vip-node-u001',
      level: 2,
      position: 0,
      childrenCount: 0,
    },
  });

  // u-006 VIP 进度
  await prisma.vipProgress.upsert({
    where: { userId: 'u-006' },
    update: {},
    create: {
      userId: 'u-006',
      selfPurchaseCount: 1,
      unlockedLevel: 1,
    },
  });

  // u-001 的 childrenCount 需要包含 u-006
  await prisma.vipTreeNode.update({
    where: { id: 'vip-node-u001' },
    data: { childrenCount: 1 },
  });

  console.log('✅ VIP 会员（u-001, u-006）+ 树节点已创建');

  // ====== VIP 奖励树演示数据扩充 ======
  // 创建更多用户 + 树节点，让奖励树页面有足够的可视化内容
  // 树结构（三叉树，A1 根下）：
  //   A1 (系统根, L0)
  //   └── u-001 林青禾 (L1)
  //       ├── u-006 顾予夏 (L2)
  //       │   ├── u-101 陈思远 (L3)
  //       │   ├── u-102 王雨桐 (L3)
  //       │   └── u-103 赵小禾 (L3)
  //       ├── u-104 孙悦然 (L2)
  //       │   └── u-107 周晨曦 (L3)
  //       └── u-105 刘芳菲 (L2)
  //           ├── u-108 吴思涵 (L3)
  //           └── u-109 郑雅琪 (L3)
  //   A1 根的第二个子节点：
  //   └── u-106 黄若萱 (L1)

  const vipDemoUsers = [
    { id: 'u-101', phone: '13800138101', nickname: '陈思远', city: '杭州', interests: ['有机', '果蔬'] },
    { id: 'u-102', phone: '13800138102', nickname: '王雨桐', city: '南京', interests: ['茶叶', '轻食'] },
    { id: 'u-103', phone: '13800138103', nickname: '赵小禾', city: '成都', interests: ['蓝莓', '果干'] },
    { id: 'u-104', phone: '13800138104', nickname: '孙悦然', city: '上海', interests: ['有机蔬菜'] },
    { id: 'u-105', phone: '13800138105', nickname: '刘芳菲', city: '深圳', interests: ['轻食', '蜂蜜'] },
    { id: 'u-106', phone: '13800138106', nickname: '黄若萱', city: '北京', interests: ['茶叶', '坚果'] },
    { id: 'u-107', phone: '13800138107', nickname: '周晨曦', city: '广州', interests: ['果蔬'] },
    { id: 'u-108', phone: '13800138108', nickname: '吴思涵', city: '武汉', interests: ['蓝莓', '蜂蜜'] },
    { id: 'u-109', phone: '13800138109', nickname: '郑雅琪', city: '长沙', interests: ['有机', '轻食'] },
  ];

  for (const u of vipDemoUsers) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        status: u.id === 'u-103' ? 'BANNED' : 'ACTIVE', // u-103 被冻结
        profile: {
          create: {
            nickname: u.nickname,
            avatarUrl: 'https://placehold.co/200x200/png',
            level: '新芽会员',
            city: u.city,
            interests: u.interests,
          },
        },
        authIdentities: {
          create: {
            provider: 'PHONE',
            identifier: u.phone,
            verified: true,
            meta: { passwordHash: await bcrypt.hash('123456', 10) },
          },
        },
      },
    });
  }
  console.log(`✅ ${vipDemoUsers.length} 个 VIP 演示用户已创建`);

  // VIP 树节点
  const vipTreeDemoNodes = [
    // u-006 的三个子节点 (L3)
    { id: 'vip-node-u101', rootId: 'A1', userId: 'u-101', parentId: 'vip-node-u006', level: 3, position: 0 },
    { id: 'vip-node-u102', rootId: 'A1', userId: 'u-102', parentId: 'vip-node-u006', level: 3, position: 1 },
    { id: 'vip-node-u103', rootId: 'A1', userId: 'u-103', parentId: 'vip-node-u006', level: 3, position: 2 },
    // u-001 的第二个子节点 (L2)
    { id: 'vip-node-u104', rootId: 'A1', userId: 'u-104', parentId: 'vip-node-u001', level: 2, position: 1 },
    // u-001 的第三个子节点 (L2)
    { id: 'vip-node-u105', rootId: 'A1', userId: 'u-105', parentId: 'vip-node-u001', level: 2, position: 2 },
    // A1 根的第二个子节点 (L1)
    { id: 'vip-node-u106', rootId: 'A1', userId: 'u-106', parentId: 'sys-a1', level: 1, position: 1 },
    // u-104 的子节点 (L3)
    { id: 'vip-node-u107', rootId: 'A1', userId: 'u-107', parentId: 'vip-node-u104', level: 3, position: 0 },
    // u-105 的子节点 (L3)
    { id: 'vip-node-u108', rootId: 'A1', userId: 'u-108', parentId: 'vip-node-u105', level: 3, position: 0 },
    { id: 'vip-node-u109', rootId: 'A1', userId: 'u-109', parentId: 'vip-node-u105', level: 3, position: 1 },
  ];

  for (const n of vipTreeDemoNodes) {
    await prisma.vipTreeNode.upsert({
      where: { id: n.id },
      update: {},
      create: { ...n, childrenCount: 0 },
    });
  }

  // 更新 childrenCount
  await prisma.vipTreeNode.update({ where: { id: 'vip-node-u001' }, data: { childrenCount: 3 } }); // u-006, u-104, u-105
  await prisma.vipTreeNode.update({ where: { id: 'vip-node-u006' }, data: { childrenCount: 3 } }); // u-101, u-102, u-103
  await prisma.vipTreeNode.update({ where: { id: 'vip-node-u104' }, data: { childrenCount: 1 } }); // u-107
  await prisma.vipTreeNode.update({ where: { id: 'vip-node-u105' }, data: { childrenCount: 2 } }); // u-108, u-109
  await prisma.vipTreeNode.update({ where: { id: 'sys-a1' }, data: { childrenCount: 2 } });          // u-001, u-106

  // 会员资料 + VIP 进度
  const vipMembers = [
    { userId: 'u-101', nodeId: 'vip-node-u101', code: 'CSY2026A', purchases: 5, level: 5 },
    { userId: 'u-102', nodeId: 'vip-node-u102', code: 'WYT2026B', purchases: 2, level: 2 },
    { userId: 'u-103', nodeId: 'vip-node-u103', code: 'ZXH2026C', purchases: 0, level: 0 },  // 冻结 + 0购买 = frozen
    { userId: 'u-104', nodeId: 'vip-node-u104', code: 'SYR2026D', purchases: 4, level: 4 },
    { userId: 'u-105', nodeId: 'vip-node-u105', code: 'LFF2026E', purchases: 3, level: 3 },
    { userId: 'u-106', nodeId: 'vip-node-u106', code: 'HRX2026F', purchases: 1, level: 1 },
    { userId: 'u-107', nodeId: 'vip-node-u107', code: 'ZCX2026G', purchases: 0, level: 0 },  // silent
    { userId: 'u-108', nodeId: 'vip-node-u108', code: 'WSH2026H', purchases: 2, level: 2 },
    { userId: 'u-109', nodeId: 'vip-node-u109', code: 'ZYQ2026I', purchases: 1, level: 1 },
  ];

  for (const m of vipMembers) {
    await prisma.memberProfile.upsert({
      where: { userId: m.userId },
      update: { tier: 'VIP', vipNodeId: m.nodeId },
      create: {
        userId: m.userId,
        tier: 'VIP',
        referralCode: m.code,
        vipPurchasedAt: new Date('2026-01-20'),
        vipNodeId: m.nodeId,
        normalEligible: true,
      },
    });
    await prisma.vipProgress.upsert({
      where: { userId: m.userId },
      update: {},
      create: {
        userId: m.userId,
        selfPurchaseCount: m.purchases,
        unlockedLevel: m.level,
      },
    });
  }

  // 为部分演示用户创建奖励账户（有收入数据）
  const demoAccounts = [
    { userId: 'u-101', balance: 45.20, frozen: 0 },
    { userId: 'u-102', balance: 12.80, frozen: 0 },
    { userId: 'u-103', balance: 0, frozen: 25.00 },   // 冻结
    { userId: 'u-104', balance: 38.60, frozen: 5.00 },
    { userId: 'u-105', balance: 22.10, frozen: 0 },
    { userId: 'u-106', balance: 8.50, frozen: 0 },
    { userId: 'u-108', balance: 15.30, frozen: 0 },
  ];

  for (const a of demoAccounts) {
    await prisma.rewardAccount.upsert({
      where: { userId_type: { userId: a.userId, type: 'VIP_REWARD' } },
      update: { balance: a.balance, frozen: a.frozen },
      create: { userId: a.userId, type: 'VIP_REWARD', balance: a.balance, frozen: a.frozen },
    });
  }

  // 为演示用户创建一些 reward ledger 记录（让 totalEarned 有数据）
  const demoLedgers = [
    { userId: 'u-101', accountUserId: 'u-101', amount: 45.20 },
    { userId: 'u-102', accountUserId: 'u-102', amount: 12.80 },
    { userId: 'u-104', accountUserId: 'u-104', amount: 43.60 },
    { userId: 'u-105', accountUserId: 'u-105', amount: 22.10 },
    { userId: 'u-106', accountUserId: 'u-106', amount: 8.50 },
    { userId: 'u-108', accountUserId: 'u-108', amount: 15.30 },
  ];

  for (const l of demoLedgers) {
    const account = await prisma.rewardAccount.findUnique({
      where: { userId_type: { userId: l.accountUserId, type: 'VIP_REWARD' } },
    });
    if (account) {
      await prisma.rewardLedger.create({
        data: {
          accountId: account.id,
          userId: l.userId,
          entryType: 'RELEASE',
          amount: l.amount,
          status: 'AVAILABLE',
          refType: 'ORDER',
          refId: `demo-order-${l.userId}`,
          meta: { scheme: 'VIP_UPSTREAM', note: '演示数据' },
        },
      });
    }
  }

  console.log('✅ VIP 奖励树演示数据扩充完成（9 个新节点 + 账户 + 流水）');

  // 5. 创建奖励账户和演示流水
  // balance=68.50 可用，frozen=62.30（其中 12.30 VIP 冻结 + 50 提现冻结）
  const u001Account = await prisma.rewardAccount.upsert({
    where: { userId_type: { userId: 'u-001', type: 'VIP_REWARD' } },
    update: { balance: 68.50, frozen: 62.30 },
    create: { userId: 'u-001', type: 'VIP_REWARD', balance: 68.50, frozen: 62.30 },
  });

  const u002Account = await prisma.rewardAccount.upsert({
    where: { userId_type: { userId: 'u-002', type: 'VIP_REWARD' } },
    update: { balance: 5.20, frozen: 0 },
    create: { userId: 'u-002', type: 'VIP_REWARD', balance: 5.20, frozen: 0 },
  });

  // 平台账户（原有）
  for (const type of ['PLATFORM_PROFIT', 'FUND_POOL', 'POINTS'] as const) {
    const bal = type === 'PLATFORM_PROFIT' ? 185.50 : type === 'FUND_POOL' ? 5.01 : 10.02;
    await prisma.rewardAccount.upsert({
      where: { userId_type: { userId: 'PLATFORM', type } },
      update: { balance: bal },
      create: { userId: 'PLATFORM', type, balance: bal },
    });
  }

  // 平台账户（新增：普通用户系统六分账户）
  for (const type of ['INDUSTRY_FUND', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND', 'NORMAL_REWARD'] as const) {
    await prisma.rewardAccount.upsert({
      where: { userId_type: { userId: 'PLATFORM', type } },
      update: {},
      create: { userId: 'PLATFORM', type, balance: 0 },
    });
  }
  console.log('✅ 奖励账户（u-001/u-002/PLATFORM + 新增六分账户）已创建');

  // 6. 演示 RewardAllocation + Ledger
  const demoAllocation = await prisma.rewardAllocation.upsert({
    where: { idempotencyKey: 'DEMO:SEED:001' },
    update: {},
    create: {
      triggerType: 'ORDER_RECEIVED',
      ruleType: 'VIP_UPSTREAM',
      ruleVersion: 'initial',
      meta: { demo: true, note: '种子数据演示分配' },
      idempotencyKey: 'DEMO:SEED:001',
    },
  });

  // 先清除该 allocation 下的旧流水，再重建（确保幂等）
  await prisma.rewardLedger.deleteMany({
    where: { allocationId: demoAllocation.id },
  });
  await prisma.rewardLedger.createMany({
    data: [
      {
        allocationId: demoAllocation.id,
        accountId: u001Account.id,
        userId: 'u-001',
        entryType: 'RELEASE',
        amount: 30.00,
        status: 'AVAILABLE',
        refType: 'ORDER',
        meta: { scheme: 'VIP_UPSTREAM', demo: true },
      },
      {
        allocationId: demoAllocation.id,
        accountId: u001Account.id,
        userId: 'u-001',
        entryType: 'FREEZE',
        amount: 12.30,
        status: 'FROZEN',
        refType: 'ORDER',
        meta: { scheme: 'VIP_UPSTREAM', requiredLevel: 4, demo: true },
      },
      {
        allocationId: demoAllocation.id,
        accountId: u002Account.id,
        userId: 'u-002',
        entryType: 'RELEASE',
        amount: 5.20,
        status: 'AVAILABLE',
        refType: 'ORDER',
        meta: { scheme: 'NORMAL_BROADCAST', demo: true },
      },
    ],
  });
  console.log('✅ 演示分润记录（RewardAllocation + Ledger）已创建');

  // 7. 演示提现申请
  await prisma.withdrawRequest.upsert({
    where: { id: 'wd-demo-001' },
    update: {},
    create: {
      id: 'wd-demo-001',
      userId: 'u-001',
      amount: 50.00,
      channel: 'WECHAT',
      status: 'REQUESTED',
      accountSnapshot: { name: '林**', account: '****8000' },
    },
  });
  await prisma.withdrawRequest.upsert({
    where: { id: 'wd-demo-002' },
    update: {},
    create: {
      id: 'wd-demo-002',
      userId: 'u-002',
      amount: 10.00,
      channel: 'ALIPAY',
      status: 'APPROVED',
      accountSnapshot: { name: '江*', account: '****8002' },
    },
  });
  console.log('✅ 演示提现申请已创建');

  // 8. 推荐关系
  await prisma.referralLink.upsert({
    where: { inviteeUserId: 'u-006' },
    update: {},
    create: {
      inviterUserId: 'u-001',
      inviteeUserId: 'u-006',
      codeUsed: 'LQHE2025',
      channel: 'WECHAT_QR',
    },
  });
  console.log('✅ 推荐关系（u-001 → u-006）已创建');

  // ============================================================
  // 9. 普通奖励滑动窗口 — 演示数据（多档位桶 + 队列订单 + 分配记录）
  // ============================================================

  // 清理旧的普通奖励演示数据（保证幂等）
  // 先清理 ledger（按 refId 直接清理 + 按 allocationId 清理），再清理 allocation
  await prisma.rewardLedger.deleteMany({
    where: { refId: { startsWith: 'bo-' } },
  });
  const oldAllocations = await prisma.rewardAllocation.findMany({
    where: { orderId: { startsWith: 'bo-' } },
    select: { id: true },
  });
  if (oldAllocations.length > 0) {
    await prisma.rewardAllocation.deleteMany({
      where: { id: { in: oldAllocations.map((a) => a.id) } },
    });
  }
  await prisma.normalQueueMember.deleteMany({
    where: { id: { startsWith: 'nqm-' } },
  });
  await prisma.orderItem.deleteMany({
    where: { orderId: { startsWith: 'bo-' } },
  });
  await prisma.order.deleteMany({
    where: { id: { startsWith: 'bo-' } },
  });
  console.log('🧹 旧的普通奖励演示数据已清理');

  // 创建演示订单（不同金额区间）
  const broadcastOrders = [
    // 0-10 桶
    { id: 'bo-001', userId: 'u-002',  amount: 5.80,   bucket: '0-10' },
    { id: 'bo-002', userId: 'u-101',  amount: 8.50,   bucket: '0-10' },
    { id: 'bo-003', userId: 'u-109',  amount: 3.20,   bucket: '0-10' },
    // 10-50 桶
    { id: 'bo-004', userId: 'u-001',  amount: 19.80,  bucket: '10-50' },
    { id: 'bo-005', userId: 'u-006',  amount: 36.00,  bucket: '10-50' },
    { id: 'bo-006', userId: 'u-102',  amount: 25.00,  bucket: '10-50' },
    { id: 'bo-007', userId: 'u-105',  amount: 42.50,  bucket: '10-50' },
    { id: 'bo-008', userId: 'u-108',  amount: 15.90,  bucket: '10-50' },
    // 50-100 桶（已有 o-003 ¥58，补充更多）
    { id: 'bo-009', userId: 'u-103',  amount: 68.00,  bucket: '50-100' },
    { id: 'bo-010', userId: 'u-104',  amount: 88.00,  bucket: '50-100' },
    { id: 'bo-011', userId: 'u-106',  amount: 55.50,  bucket: '50-100' },
    { id: 'bo-012', userId: 'u-002',  amount: 72.00,  bucket: '50-100' },
    // 100-500 桶
    { id: 'bo-013', userId: 'u-001',  amount: 128.00, bucket: '100-500' },
    { id: 'bo-014', userId: 'u-107',  amount: 256.00, bucket: '100-500' },
    { id: 'bo-015', userId: 'u-108',  amount: 199.00, bucket: '100-500' },
    { id: 'bo-016', userId: 'u-006',  amount: 388.00, bucket: '100-500' },
    { id: 'bo-017', userId: 'u-109',  amount: 150.00, bucket: '100-500' },
    { id: 'bo-018', userId: 'u-102',  amount: 320.00, bucket: '100-500' },
    // 500+ 桶
    { id: 'bo-019', userId: 'u-001',  amount: 588.00, bucket: '500-INF' },
    { id: 'bo-020', userId: 'u-104',  amount: 1280.00, bucket: '500-INF' },
    { id: 'bo-021', userId: 'u-106',  amount: 699.00, bucket: '500-INF' },
  ];

  // 创建演示订单
  for (const bo of broadcastOrders) {
    await prisma.order.upsert({
      where: { id: bo.id },
      update: {},
      create: {
        id: bo.id,
        userId: bo.userId,
        status: 'RECEIVED',
        totalAmount: bo.amount,
        goodsAmount: bo.amount,
        addressSnapshot: { name: '演示', phone: '13800000000', address: '演示地址' },
        items: {
          create: {
            id: `${bo.id}-item`,
            skuId: 'sku-p-001',
            unitPrice: bo.amount,
            quantity: 1,
            productSnapshot: { title: '演示商品', price: bo.amount },
          },
        },
      },
    });
  }
  console.log(`✅ ${broadcastOrders.length} 个普通奖励演示订单已创建`);

  // 创建桶
  const bucketKeys = ['0-10', '10-50', '50-100', '100-500', '500-INF'];
  const bucketMap = new Map<string, string>();
  for (const key of bucketKeys) {
    const bucket = await prisma.normalBucket.upsert({
      where: { bucketKey: key },
      update: {},
      create: { bucketKey: key, ruleVersion: 'initial' },
    });
    bucketMap.set(key, bucket.id);
  }
  console.log(`✅ ${bucketKeys.length} 个普通奖励桶已创建`);

  // 创建队列成员（将演示订单加入对应桶）
  const baseTime = new Date('2026-02-15T08:00:00Z');
  for (let i = 0; i < broadcastOrders.length; i++) {
    const bo = broadcastOrders[i];
    const bucketId = bucketMap.get(bo.bucket)!;
    const joinedAt = new Date(baseTime.getTime() + i * 3600 * 1000); // 每小时一笔
    await prisma.normalQueueMember.upsert({
      where: { id: `nqm-${bo.id}` },
      update: {},
      create: {
        id: `nqm-${bo.id}`,
        bucketId,
        userId: bo.userId,
        orderId: bo.id,
        joinedAt,
        active: true,
      },
    });
  }
  // 也把已有的 o-003 加入 50-100 桶
  const bucket50Id = bucketMap.get('50-100')!;
  await prisma.normalQueueMember.upsert({
    where: { id: 'nqm-o-003' },
    update: {},
    create: {
      id: 'nqm-o-003',
      bucketId: bucket50Id,
      userId: 'u-001',
      orderId: 'o-003',
      joinedAt: new Date('2026-02-17T06:00:00Z'),
      active: true,
    },
  });
  console.log('✅ 普通奖励队列成员已创建');

  // 创建分配记录（为部分订单生成 RewardAllocation + Ledger）
  // 从 broadcastOrders 建立 orderId → bucket 映射
  const orderBucketMap = new Map(broadcastOrders.map((bo) => [bo.id, bo.bucket]));
  const allocOrders = [
    { orderId: 'bo-013', amount: 128.00, reward: 17.40, beneficiaries: ['u-002', 'u-101', 'u-106'] },
    { orderId: 'bo-014', amount: 256.00, reward: 34.80, beneficiaries: ['u-001', 'u-107', 'u-109'] },
    { orderId: 'bo-015', amount: 199.00, reward: 27.06, beneficiaries: ['u-108', 'u-006', 'u-102'] },
    { orderId: 'bo-019', amount: 588.00, reward: 80.00, beneficiaries: ['u-104', 'u-106'] },
    { orderId: 'bo-009', amount: 68.00,  reward: 9.24,  beneficiaries: ['u-001', 'u-104'] },
    { orderId: 'bo-004', amount: 19.80,  reward: 2.69,  beneficiaries: ['u-002'] },
    { orderId: 'bo-001', amount: 5.80,   reward: 0.79,  beneficiaries: ['u-109'] },
  ];

  for (const ao of allocOrders) {
    const allocation = await prisma.rewardAllocation.upsert({
      where: { idempotencyKey: `ALLOC:ORDER_RECEIVED:${ao.orderId}:NORMAL_BROADCAST` },
      update: {},
      create: {
        triggerType: 'ORDER_RECEIVED',
        orderId: ao.orderId,
        ruleType: 'NORMAL_BROADCAST',
        ruleVersion: 'initial',
        meta: {
          profit: ao.amount * 0.4,
          rebateRatio: 0.5,
          rewardPool: ao.reward,
          windowSize: ao.beneficiaries.length,
        },
        idempotencyKey: `ALLOC:ORDER_RECEIVED:${ao.orderId}:NORMAL_BROADCAST`,
      },
    });

    const perAmount = parseFloat((ao.reward / ao.beneficiaries.length).toFixed(2));
    for (const userId of ao.beneficiaries) {
      const account = await prisma.rewardAccount.upsert({
        where: { userId_type: { userId, type: 'VIP_REWARD' } },
        update: {},
        create: { userId, type: 'VIP_REWARD', balance: 0, frozen: 0 },
      });
      // 避免重复创建：用 allocationId + userId 的组合查重
      const existing = await prisma.rewardLedger.findFirst({
        where: { allocationId: allocation.id, userId },
      });
      if (!existing) {
        await prisma.rewardLedger.create({
          data: {
            allocationId: allocation.id,
            accountId: account.id,
            userId,
            entryType: 'RELEASE',
            amount: perAmount,
            status: 'AVAILABLE',
            refType: 'ORDER',
            refId: ao.orderId,
            meta: {
              scheme: 'NORMAL_BROADCAST',
              bucketKey: orderBucketMap.get(ao.orderId) || '',
              sourceOrderId: ao.orderId,
              perAmount,
              windowSize: ao.beneficiaries.length,
            },
          },
        });
      }
    }
  }
  console.log('✅ 普通奖励分配记录已创建');

  // ============================================================
  // 更多买家用户（覆盖不同状态和测试场景）
  // ============================================================
  const moreBuyerUsers = [
    { id: 'u-003', phone: '13800138003', nickname: '张明', city: '北京', interests: ['粮油', '有机蔬菜'] as string[], status: 'ACTIVE' as const },
    { id: 'u-004', phone: '13800138004', nickname: '李婉清', city: '广州', interests: ['茶叶', '蜂蜜', '坚果'] as string[], status: 'ACTIVE' as const },
    { id: 'u-005', phone: '13800138005', nickname: '王子涛', city: '杭州', interests: ['蓝莓', '水果'] as string[], status: 'BANNED' as const },
    { id: 'u-007', phone: '13800138007', nickname: '赵美琪', city: '深圳', interests: ['有机', '轻食'] as string[], status: 'ACTIVE' as const },
    { id: 'u-008', phone: '13800138008', nickname: '钱志远', city: '成都', interests: ['茶叶', '蜂蜜'] as string[], status: 'ACTIVE' as const },
    { id: 'u-009', phone: '13800138009', nickname: '孙雅婷', city: '重庆', interests: ['蓝莓', '鸡蛋'] as string[], status: 'ACTIVE' as const },
    { id: 'u-010', phone: '13800138010', nickname: '周建国', city: '西安', interests: ['粮油', '大米'] as string[], status: 'ACTIVE' as const },
  ];
  for (const u of moreBuyerUsers) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        status: u.status,
        profile: {
          create: {
            nickname: u.nickname,
            avatarUrl: 'https://placehold.co/200x200/png',
            level: '新芽会员',
            city: u.city,
            interests: u.interests,
          },
        },
        authIdentities: {
          create: {
            provider: 'PHONE',
            identifier: u.phone,
            verified: true,
            meta: { passwordHash: await bcrypt.hash('123456', 10) },
          },
        },
      },
    });
  }
  console.log(`✅ ${moreBuyerUsers.length} 个新买家用户已创建`);

  // ============================================================
  // 更多管理员用户（经理 + 员工角色）
  // ============================================================
  const adminManager = await prisma.adminUser.upsert({
    where: { username: 'manager' },
    update: {},
    create: {
      username: 'manager',
      passwordHash: await bcrypt.hash('manager123', 10),
      realName: '张经理',
      status: 'ACTIVE',
      createdByAdminId: superAdmin.id,
    },
  });
  await prisma.adminUserRole.upsert({
    where: { adminUserId_roleId: { adminUserId: adminManager.id, roleId: managerRole.id } },
    update: {},
    create: { adminUserId: adminManager.id, roleId: managerRole.id },
  });

  const adminStaff = await prisma.adminUser.upsert({
    where: { username: 'staff' },
    update: {},
    create: {
      username: 'staff',
      passwordHash: await bcrypt.hash('staff123', 10),
      realName: '李员工',
      status: 'ACTIVE',
      createdByAdminId: superAdmin.id,
    },
  });
  await prisma.adminUserRole.upsert({
    where: { adminUserId_roleId: { adminUserId: adminStaff.id, roleId: staffRole.id } },
    update: {},
    create: { adminUserId: adminStaff.id, roleId: staffRole.id },
  });

  const disabledAdmin = await prisma.adminUser.upsert({
    where: { username: 'disabled_admin' },
    update: {},
    create: {
      username: 'disabled_admin',
      passwordHash: await bcrypt.hash('disabled123', 10),
      realName: '王已禁',
      status: 'DISABLED',
      createdByAdminId: superAdmin.id,
    },
  });
  await prisma.adminUserRole.upsert({
    where: { adminUserId_roleId: { adminUserId: disabledAdmin.id, roleId: staffRole.id } },
    update: {},
    create: { adminUserId: disabledAdmin.id, roleId: staffRole.id },
  });
  console.log('✅ 3 个额外管理员已创建（manager/staff/disabled_admin）');

  // ============================================================
  // 企业员工 — MANAGER + OPERATOR 角色
  // ============================================================
  const extraStaff = [
    { staffId: 'cs-005', userId: 'u-003', companyId: 'c-001', role: 'MANAGER' as const, phone: '13800138003', nickname: '张明' },
    { staffId: 'cs-006', userId: 'u-004', companyId: 'c-001', role: 'OPERATOR' as const, phone: '13800138004', nickname: '李婉清' },
    { staffId: 'cs-007', userId: 'u-007', companyId: 'c-002', role: 'MANAGER' as const, phone: '13800138007', nickname: '赵美琪' },
    { staffId: 'cs-008', userId: 'u-008', companyId: 'c-002', role: 'OPERATOR' as const, phone: '13800138008', nickname: '钱志远' },
    { staffId: 'cs-009', userId: 'u-009', companyId: 'c-003', role: 'OPERATOR' as const, phone: '13800138009', nickname: '孙雅婷' },
    { staffId: 'cs-010', userId: 'u-010', companyId: 'c-004', role: 'OPERATOR' as const, phone: '13800138010', nickname: '周建国' },
  ];
  for (const s of extraStaff) {
    await prisma.companyStaff.upsert({
      where: { userId_companyId: { userId: s.userId, companyId: s.companyId } },
      update: {},
      create: {
        id: s.staffId,
        userId: s.userId,
        companyId: s.companyId,
        role: s.role,
        status: 'ACTIVE',
      },
    });
  }
  console.log(`✅ ${extraStaff.length} 个企业员工（MANAGER/OPERATOR）已创建`);

  // ============================================================
  // 企业证件文档（CompanyDocument）
  // ============================================================
  const companyDocs = [
    { id: 'doc-001', companyId: 'c-001', type: 'LICENSE' as const, title: '营业执照', fileUrl: 'https://placehold.co/800x600/png', issuer: '云南省工商局', verifyStatus: 'VERIFIED' as const, verifyNote: '审核通过' },
    { id: 'doc-002', companyId: 'c-001', type: 'CERT' as const, title: '有机认证证书', fileUrl: 'https://placehold.co/800x600/png', issuer: '中国有机认证中心', verifyStatus: 'VERIFIED' as const },
    { id: 'doc-003', companyId: 'c-001', type: 'FOOD_PERMIT' as const, title: '食品经营许可证', fileUrl: 'https://placehold.co/800x600/png', issuer: '云南省食药监局', verifyStatus: 'VERIFIED' as const },
    { id: 'doc-004', companyId: 'c-002', type: 'LICENSE' as const, title: '营业执照', fileUrl: 'https://placehold.co/800x600/png', issuer: '江苏省工商局', verifyStatus: 'VERIFIED' as const },
    { id: 'doc-005', companyId: 'c-002', type: 'INSPECTION' as const, title: '农药残留检测报告', fileUrl: 'https://placehold.co/800x600/png', issuer: 'SGS检测机构', verifyStatus: 'PENDING' as const },
    { id: 'doc-006', companyId: 'c-003', type: 'LICENSE' as const, title: '营业执照', fileUrl: 'https://placehold.co/800x600/png', issuer: '辽宁省工商局', verifyStatus: 'VERIFIED' as const },
    { id: 'doc-007', companyId: 'c-003', type: 'FOOD_PERMIT' as const, title: '食品经营许可证', fileUrl: 'https://placehold.co/800x600/png', issuer: '辽宁省食药监局', verifyStatus: 'REJECTED' as const, verifyNote: '证件已过期，请重新上传' },
    { id: 'doc-008', companyId: 'c-004', type: 'LICENSE' as const, title: '营业执照', fileUrl: 'https://placehold.co/800x600/png', issuer: '福建省工商局', verifyStatus: 'VERIFIED' as const },
    { id: 'doc-009', companyId: 'c-004', type: 'CERT' as const, title: '地理标志产品证书', fileUrl: 'https://placehold.co/800x600/png', issuer: '国家知识产权局', verifyStatus: 'VERIFIED' as const },
    { id: 'doc-010', companyId: 'c-004', type: 'INSPECTION' as const, title: '茶叶质量检测报告', fileUrl: 'https://placehold.co/800x600/png', issuer: '中国茶叶检测中心', verifyStatus: 'PENDING' as const },
  ];
  for (const doc of companyDocs) {
    await prisma.companyDocument.upsert({
      where: { id: doc.id },
      update: {},
      create: {
        ...doc,
        issuedAt: new Date('2025-01-15'),
        expiresAt: new Date('2028-01-15'),
      },
    });
  }
  console.log(`✅ ${companyDocs.length} 个企业证件文档已创建`);

  // ============================================================
  // 商品分类（Category 树形结构）
  // ============================================================
  const categories = [
    { id: 'cat-fruit', name: '水果', path: '/水果', level: 1, parentId: null, sortOrder: 1 },
    { id: 'cat-fruit-berry', name: '浆果', path: '/水果/浆果', level: 2, parentId: 'cat-fruit', sortOrder: 1 },
    { id: 'cat-fruit-citrus', name: '柑橘', path: '/水果/柑橘', level: 2, parentId: 'cat-fruit', sortOrder: 2 },
    { id: 'cat-veg', name: '蔬菜', path: '/蔬菜', level: 1, parentId: null, sortOrder: 2 },
    { id: 'cat-veg-leaf', name: '叶菜', path: '/蔬菜/叶菜', level: 2, parentId: 'cat-veg', sortOrder: 1 },
    { id: 'cat-veg-root', name: '根茎', path: '/蔬菜/根茎', level: 2, parentId: 'cat-veg', sortOrder: 2 },
    { id: 'cat-grain', name: '粮油', path: '/粮油', level: 1, parentId: null, sortOrder: 3 },
    { id: 'cat-tea', name: '茶叶', path: '/茶叶', level: 1, parentId: null, sortOrder: 4 },
    { id: 'cat-egg', name: '禽蛋', path: '/禽蛋', level: 1, parentId: null, sortOrder: 5 },
    { id: 'cat-honey', name: '蜂蜜', path: '/蜂蜜', level: 1, parentId: null, sortOrder: 6 },
  ];
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: {},
      create: {
        id: cat.id,
        name: cat.name,
        path: cat.path,
        level: cat.level,
        parentId: cat.parentId,
        sortOrder: cat.sortOrder,
      },
    });
  }
  // 给已有商品分配分类
  await prisma.product.update({ where: { id: 'p-001' }, data: { categoryId: 'cat-veg' } });
  await prisma.product.update({ where: { id: 'p-002' }, data: { categoryId: 'cat-veg-leaf' } });
  await prisma.product.update({ where: { id: 'p-003' }, data: { categoryId: 'cat-fruit-berry' } });
  await prisma.product.update({ where: { id: 'p-004' }, data: { categoryId: 'cat-grain' } });
  await prisma.product.update({ where: { id: 'p-005' }, data: { categoryId: 'cat-tea' } });
  await prisma.product.update({ where: { id: 'p-006' }, data: { categoryId: 'cat-egg' } });
  console.log(`✅ ${categories.length} 个商品分类已创建`);

  // ============================================================
  // 更多商品（含多SKU、不同状态、奖励商品）
  // ============================================================
  const moreProductImages: Record<string, string> = {
    'p-007': 'https://images.pexels.com/photos/73640/pexels-photo-73640.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-008': 'https://images.pexels.com/photos/230477/pexels-photo-230477.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-009': 'https://images.pexels.com/photos/12559809/pexels-photo-12559809.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-010': 'https://images.pexels.com/photos/2775838/pexels-photo-2775838.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-011': 'https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-012': 'https://images.pexels.com/photos/4110251/pexels-photo-4110251.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-013': 'https://images.pexels.com/photos/4480158/pexels-photo-4480158.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-014': 'https://images.pexels.com/photos/7195272/pexels-photo-7195272.jpeg?auto=compress&cs=tinysrgb&w=600',
  };
  const moreProducts = [
    { id: 'p-007', companyId: 'c-001', title: '有机胡萝卜', basePrice: 8.8, cost: 4.0, categoryId: 'cat-veg-root', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '云南·玉溪' }, tags: ['有机认证'], skus: [
      { id: 'sku-p-007', title: '500g装', price: 8.8, cost: 4.0, stock: 300 },
      { id: 'sku-p-007-b', title: '1kg装', price: 15.8, cost: 7.5, stock: 200 },
    ]},
    { id: 'p-008', companyId: 'c-004', title: '武夷岩茶大红袍', basePrice: 268, cost: 120, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·武夷' }, tags: ['地理标志'], skus: [
      { id: 'sku-p-008-s', title: '50g品鉴装', price: 68, cost: 30, stock: 500 },
      { id: 'sku-p-008-m', title: '125g罐装', price: 168, cost: 75, stock: 200 },
      { id: 'sku-p-008-l', title: '250g礼盒装', price: 268, cost: 120, stock: 100 },
    ]},
    { id: 'p-009', companyId: 'c-003', title: '蓝莓干果', basePrice: 45, cost: 22, categoryId: 'cat-fruit-berry', status: 'DRAFT' as const, auditStatus: 'PENDING' as const, origin: { text: '辽宁·大连' }, tags: [], skus: [
      { id: 'sku-p-009', title: '200g装', price: 45, cost: 22, stock: 0 },
    ]},
    { id: 'p-010', companyId: 'c-002', title: '有机黄瓜', basePrice: 6.5, cost: 3.0, categoryId: 'cat-veg', status: 'INACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '江苏·苏州' }, tags: ['可信溯源'], skus: [
      { id: 'sku-p-010', title: '500g装', price: 6.5, cost: 3.0, stock: 50 },
    ]},
    { id: 'p-011', companyId: 'PLATFORM_COMPANY', title: '农脉精选白酒（抽奖）', basePrice: 299, cost: 80, categoryId: null, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '四川·宜宾' }, tags: [], skus: [
      { id: 'sku-p-011', title: '500ml瓶装', price: 299, cost: 80, stock: 50 },
    ]},
    { id: 'p-012', companyId: 'PLATFORM_COMPANY', title: '农脉特供东北大米（抽奖）', basePrice: 59.9, cost: 25, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·五常' }, tags: ['地理标志'], skus: [
      { id: 'sku-p-012', title: '5kg装', price: 59.9, cost: 25, stock: 100 },
    ]},
    { id: 'p-013', companyId: 'c-001', title: '生态蜂蜜', basePrice: 88, cost: 40, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '云南·西双版纳' }, tags: ['有机认证', '可信溯源'], skus: [
      { id: 'sku-p-013', title: '500g装', price: 88, cost: 40, stock: 80 },
    ]},
    { id: 'p-014', companyId: 'c-002', title: '有机菠菜', basePrice: 9.9, cost: 4.5, categoryId: 'cat-veg-leaf', status: 'ACTIVE' as const, auditStatus: 'REJECTED' as const, origin: { text: '江苏·苏州' }, tags: [], skus: [
      { id: 'sku-p-014', title: '300g装', price: 9.9, cost: 4.5, stock: 150 },
    ]},
  ];

  for (const p of moreProducts) {
    const { skus, tags, ...productData } = p;
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        ...productData,
        skus: {
          create: skus.map((s) => ({
            id: s.id,
            title: s.title,
            price: s.price,
            cost: s.cost,
            stock: s.stock,
            status: 'ACTIVE' as const,
          })),
        },
        media: {
          create: { type: 'IMAGE' as const, url: moreProductImages[p.id] || 'https://placehold.co/600x600/png', sortOrder: 0 },
        },
      },
    });
    // 如果商品已存在，更新其图片
    if (moreProductImages[p.id]) {
      await prisma.productMedia.updateMany({ where: { productId: p.id }, data: { url: moreProductImages[p.id] } });
    }
    // 关联标签
    for (const tagName of tags) {
      const tag = await prisma.tag.findUnique({ where: { name: tagName } });
      if (tag) {
        await prisma.productTag.upsert({
          where: { productId_tagId: { productId: p.id, tagId: tag.id } },
          update: {},
          create: { productId: p.id, tagId: tag.id },
        });
      }
    }
  }
  console.log(`✅ ${moreProducts.length} 个新商品已创建（含多SKU、奖励商品、不同状态）`);

  // ============================================================
  // VIP 赠品奖励商品（归属平台公司）
  // ============================================================
  const vipRewardProducts = [
    {
      id: 'p-vip-001',
      companyId: 'PLATFORM_COMPANY',
      title: '云南古树普洱茶饼·臻藏版',
      subtitle: '2020年春茶 357g 生茶饼',
      basePrice: 388.00,
      cost: 150.00,
      status: 'ACTIVE' as const,
      auditStatus: 'APPROVED' as const,
      origin: { text: '云南·西双版纳·易武' },
      skus: [
        { id: 'sku-vip-001a', title: '357g 生茶饼', price: 388.00, cost: 150.00, stock: 200 },
        { id: 'sku-vip-001b', title: '357g 熟茶饼', price: 368.00, cost: 140.00, stock: 150 },
      ],
    },
    {
      id: 'p-vip-002',
      companyId: 'PLATFORM_COMPANY',
      title: '五常有机稻花香大米礼盒',
      subtitle: '真空锁鲜 10kg 家庭装',
      basePrice: 198.00,
      cost: 85.00,
      status: 'ACTIVE' as const,
      auditStatus: 'APPROVED' as const,
      origin: { text: '黑龙江·五常' },
      skus: [
        { id: 'sku-vip-002a', title: '5kg精选装', price: 108.00, cost: 45.00, stock: 500 },
        { id: 'sku-vip-002b', title: '10kg家庭装', price: 198.00, cost: 85.00, stock: 300 },
      ],
    },
    {
      id: 'p-vip-003',
      companyId: 'PLATFORM_COMPANY',
      title: '新疆阿克苏冰糖心苹果',
      subtitle: '产地直发 精选特大果',
      basePrice: 128.00,
      cost: 55.00,
      status: 'ACTIVE' as const,
      auditStatus: 'APPROVED' as const,
      origin: { text: '新疆·阿克苏' },
      skus: [
        { id: 'sku-vip-003a', title: '5斤装（约12个）', price: 68.00, cost: 28.00, stock: 800 },
        { id: 'sku-vip-003b', title: '10斤装（约24个）', price: 128.00, cost: 55.00, stock: 400 },
      ],
    },
    {
      id: 'p-vip-004',
      companyId: 'PLATFORM_COMPANY',
      title: '赣南脐橙鲜果礼盒',
      subtitle: '当季现摘 甜度≥13° 精品果',
      basePrice: 88.00,
      cost: 35.00,
      status: 'ACTIVE' as const,
      auditStatus: 'APPROVED' as const,
      origin: { text: '江西·赣州' },
      skus: [
        { id: 'sku-vip-004', title: '10斤礼盒装', price: 88.00, cost: 35.00, stock: 600 },
      ],
    },
    {
      id: 'p-vip-005',
      companyId: 'PLATFORM_COMPANY',
      title: '贵州茅台镇酱香白酒',
      subtitle: '53度坤沙酒 500ml×2瓶礼盒',
      basePrice: 599.00,
      cost: 220.00,
      status: 'ACTIVE' as const,
      auditStatus: 'APPROVED' as const,
      origin: { text: '贵州·茅台镇' },
      skus: [
        { id: 'sku-vip-005a', title: '单瓶装 500ml', price: 328.00, cost: 120.00, stock: 300 },
        { id: 'sku-vip-005b', title: '双瓶礼盒装 500ml×2', price: 599.00, cost: 220.00, stock: 150 },
      ],
    },
    {
      id: 'p-vip-006',
      companyId: 'PLATFORM_COMPANY',
      title: '长白山野生椴树蜂蜜',
      subtitle: '原蜜结晶 无添加 1000g',
      basePrice: 168.00,
      cost: 70.00,
      status: 'ACTIVE' as const,
      auditStatus: 'APPROVED' as const,
      origin: { text: '吉林·长白山' },
      skus: [
        { id: 'sku-vip-006', title: '1000g玻璃瓶装', price: 168.00, cost: 70.00, stock: 400 },
      ],
    },
  ];

  for (const p of vipRewardProducts) {
    const { skus, ...productData } = p;
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        ...productData,
        skus: {
          create: skus.map((s) => ({
            id: s.id,
            title: s.title,
            price: s.price,
            cost: s.cost,
            stock: s.stock,
            status: 'ACTIVE' as const,
          })),
        },
        media: {
          create: { type: 'IMAGE' as const, url: 'https://placehold.co/600x600/png', sortOrder: 0 },
        },
      },
    });
  }
  console.log(`✅ ${vipRewardProducts.length} 个VIP赠品奖励商品已创建`);

  // ============================================================
  // VIP 赠品方案（VipGiftOption）
  // ============================================================
  const vipGiftOptions = [
    {
      id: 'vgo-001',
      title: '普洱茶饼·生茶',
      subtitle: '云南古树普洱 357g 生茶饼',
      coverMode: 'AUTO_GRID' as const,
      badge: '臻选',
      sortOrder: 0,
      status: 'ACTIVE' as const,
      items: [{ skuId: 'sku-vip-001a', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-002',
      title: '五常大米 10kg 家庭装',
      subtitle: '有机稻花香 真空锁鲜',
      coverMode: 'AUTO_GRID' as const,
      badge: '热销',
      sortOrder: 1,
      status: 'ACTIVE' as const,
      items: [{ skuId: 'sku-vip-002b', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-003',
      title: '阿克苏冰糖心苹果 10斤',
      subtitle: '新疆产地直发 特大果',
      coverMode: 'AUTO_GRID' as const,
      badge: '鲜品',
      sortOrder: 2,
      status: 'ACTIVE' as const,
      items: [{ skuId: 'sku-vip-003b', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-004',
      title: '赣南脐橙 10斤礼盒',
      subtitle: '当季甜橙 甜度≥13°',
      coverMode: 'AUTO_GRID' as const,
      badge: '应季',
      sortOrder: 3,
      status: 'ACTIVE' as const,
      items: [{ skuId: 'sku-vip-004', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-005',
      title: '茅台镇酱香白酒双瓶装',
      subtitle: '53度坤沙酒 500ml×2 礼盒',
      coverMode: 'AUTO_GRID' as const,
      badge: '尊享',
      sortOrder: 4,
      status: 'ACTIVE' as const,
      items: [{ skuId: 'sku-vip-005b', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-006',
      title: '长白山野生蜂蜜',
      subtitle: '椴树原蜜 无添加 1000g',
      coverMode: 'AUTO_GRID' as const,
      badge: null as string | null,
      sortOrder: 5,
      status: 'ACTIVE' as const,
      items: [{ skuId: 'sku-vip-006', quantity: 1, sortOrder: 0 }],
    },
    {
      id: 'vgo-007',
      title: '普洱茶饼·熟茶（已下架）',
      subtitle: '云南古树普洱 357g 熟茶饼',
      coverMode: 'AUTO_GRID' as const,
      badge: null as string | null,
      sortOrder: 99,
      status: 'INACTIVE' as const,
      items: [{ skuId: 'sku-vip-001b', quantity: 1, sortOrder: 0 }],
    },
  ];

  for (const vgo of vipGiftOptions) {
    const { items, ...optionData } = vgo;
    await prisma.vipGiftOption.upsert({
      where: { id: vgo.id },
      update: {},
      create: {
        ...optionData,
        items: {
          create: items,
        },
      },
    });
  }
  console.log(`✅ ${vipGiftOptions.length} 个VIP赠品方案已创建（${vipGiftOptions.filter(v => v.status === 'ACTIVE').length} 个上架，${vipGiftOptions.filter(v => v.status === 'INACTIVE').length} 个下架）`);

  // ============================================================
  // 库存流水（InventoryLedger）
  // ============================================================
  const inventoryLedgers = [
    { skuId: 'sku-p-001', type: 'IN' as const, qty: 100, refType: 'ADMIN', refId: 'init' },
    { skuId: 'sku-p-001', type: 'OUT' as const, qty: -3, refType: 'ORDER', refId: 'o-001' },
    { skuId: 'sku-p-002', type: 'IN' as const, qty: 200, refType: 'ADMIN', refId: 'init' },
    { skuId: 'sku-p-002', type: 'OUT' as const, qty: -2, refType: 'ORDER', refId: 'o-001' },
    { skuId: 'sku-p-003', type: 'IN' as const, qty: 50, refType: 'ADMIN', refId: 'init' },
    { skuId: 'sku-p-003', type: 'OUT' as const, qty: -1, refType: 'ORDER', refId: 'o-003' },
    { skuId: 'sku-p-005', type: 'IN' as const, qty: 80, refType: 'ADMIN', refId: 'init' },
    { skuId: 'sku-p-005', type: 'OUT' as const, qty: -1, refType: 'ORDER', refId: 'o-002' },
    { skuId: 'sku-p-006', type: 'IN' as const, qty: 120, refType: 'ADMIN', refId: 'init' },
    { skuId: 'sku-p-006', type: 'ADJUST' as const, qty: 10, refType: 'ADMIN', refId: 'adjust-001' },
  ];
  for (const il of inventoryLedgers) {
    await prisma.inventoryLedger.create({ data: il });
  }
  console.log(`✅ ${inventoryLedgers.length} 条库存流水已创建`);

  // ============================================================
  // 溯源数据（TraceBatch + TraceEvent + ProductTraceLink）
  // ============================================================
  const traceBatches = [
    { id: 'tb-001', companyId: 'c-001', batchCode: 'TB-2026-001', meta: { origin: '云南玉溪', farmingMethod: '有机种植', fertilizer: '有机肥', pesticide: '无农药' } },
    { id: 'tb-002', companyId: 'c-002', batchCode: 'TB-2026-002', meta: { origin: '江苏苏州', farmingMethod: '水培种植', environment: '智能温室', waterSource: '山泉水' } },
    { id: 'tb-003', companyId: 'c-003', batchCode: 'TB-2026-003', meta: { origin: '辽宁大连', farmingMethod: '露天种植', variety: '蓝丰', harvestSeason: '7-8月' } },
    { id: 'tb-004', companyId: 'c-004', batchCode: 'TB-2026-004', meta: { origin: '福建武夷', farmingMethod: '传统种植', variety: '大红袍', altitude: '800m' } },
    { id: 'tb-005', companyId: 'c-001', batchCode: 'TB-2026-005', meta: { origin: '黑龙江五常', farmingMethod: '稻田种植', variety: '稻花香2号' } },
  ];
  for (const tb of traceBatches) {
    await prisma.traceBatch.upsert({
      where: { id: tb.id },
      update: {},
      create: tb,
    });
  }

  const traceEvents = [
    { batchId: 'tb-001', type: 'FARMING' as const, data: { action: '播种', detail: '有机番茄种子播种', operator: '陈澄源' }, occurredAt: new Date('2025-12-01') },
    { batchId: 'tb-001', type: 'TESTING' as const, data: { action: '土壤检测', result: '合格', lab: '云南省农业检测中心' }, occurredAt: new Date('2025-12-15') },
    { batchId: 'tb-001', type: 'PROCESSING' as const, data: { action: '采摘分拣', detail: '人工采摘、自动分拣' }, occurredAt: new Date('2026-01-20') },
    { batchId: 'tb-001', type: 'PACKAGING' as const, data: { action: '包装', detail: '真空包装、冷链储存' }, occurredAt: new Date('2026-01-21') },
    { batchId: 'tb-002', type: 'FARMING' as const, data: { action: '移栽', detail: '水培系统移栽生菜苗' }, occurredAt: new Date('2025-11-15') },
    { batchId: 'tb-002', type: 'TESTING' as const, data: { action: '水质检测', result: '合格', ph: 6.8 }, occurredAt: new Date('2025-12-01') },
    { batchId: 'tb-002', type: 'WAREHOUSE' as const, data: { action: '入库', temperature: '2-8°C' }, occurredAt: new Date('2026-01-10') },
    { batchId: 'tb-003', type: 'FARMING' as const, data: { action: '施肥', detail: '有机液态肥' }, occurredAt: new Date('2025-06-15') },
    { batchId: 'tb-003', type: 'TESTING' as const, data: { action: '农残检测', result: '合格', standard: 'GB 2763' }, occurredAt: new Date('2025-08-01') },
    { batchId: 'tb-003', type: 'SHIPPING' as const, data: { action: '冷链发货', carrier: '顺丰冷运', temperature: '-18°C' }, occurredAt: new Date('2025-08-10') },
    { batchId: 'tb-004', type: 'FARMING' as const, data: { action: '采茶', detail: '春季头采' }, occurredAt: new Date('2025-04-10') },
    { batchId: 'tb-004', type: 'PROCESSING' as const, data: { action: '炭焙', detail: '传统炭焙工艺', duration: '12小时' }, occurredAt: new Date('2025-04-15') },
    { batchId: 'tb-005', type: 'FARMING' as const, data: { action: '插秧', detail: '机械化插秧' }, occurredAt: new Date('2025-05-20') },
    { batchId: 'tb-005', type: 'TESTING' as const, data: { action: '硒含量检测', result: '合格', seleniumContent: '0.35mg/kg' }, occurredAt: new Date('2025-10-01') },
    { batchId: 'tb-005', type: 'PROCESSING' as const, data: { action: '碾米', detail: '低温碾米保留胚芽' }, occurredAt: new Date('2025-10-15') },
  ];
  for (const te of traceEvents) {
    await prisma.traceEvent.create({ data: te });
  }

  const productTraceLinks = [
    { productId: 'p-001', batchId: 'tb-001', note: '2026年春季有机番茄批次' },
    { productId: 'p-002', batchId: 'tb-002', note: '2026年水培生菜批次' },
    { productId: 'p-003', batchId: 'tb-003', note: '2025年蓝莓批次' },
    { productId: 'p-005', batchId: 'tb-004', note: '2025年春茶批次' },
    { productId: 'p-004', batchId: 'tb-005', note: '2025年五常大米批次' },
  ];
  for (const ptl of productTraceLinks) {
    await prisma.productTraceLink.upsert({
      where: { productId_batchId: { productId: ptl.productId, batchId: ptl.batchId } },
      update: {},
      create: ptl,
    });
  }
  console.log(`✅ 溯源数据已创建（${traceBatches.length} 批次 + ${traceEvents.length} 事件 + ${productTraceLinks.length} 关联）`);

  // ============================================================
  // 更多地址
  // ============================================================
  const moreAddresses = [
    { id: 'addr-003', userId: 'u-002', recipientName: '江晴', phone: '13800138002', regionCode: '310115', regionText: '上海市浦东新区', detail: '世纪大道100号', isDefault: true },
    { id: 'addr-004', userId: 'u-003', recipientName: '张明', phone: '13800138003', regionCode: '110105', regionText: '北京市朝阳区', detail: '建国路93号院1号楼', isDefault: true },
    { id: 'addr-005', userId: 'u-003', recipientName: '张明（公司）', phone: '13800138003', regionCode: '110108', regionText: '北京市海淀区', detail: '中关村大街1号', isDefault: false },
    { id: 'addr-006', userId: 'u-004', recipientName: '李婉清', phone: '13800138004', regionCode: '440106', regionText: '广东省广州市天河区', detail: '天河路385号太古汇', isDefault: true },
    { id: 'addr-007', userId: 'u-007', recipientName: '赵美琪', phone: '13800138007', regionCode: '440305', regionText: '广东省深圳市南山区', detail: '科技园南路18号', isDefault: true },
    { id: 'addr-008', userId: 'u-008', recipientName: '钱志远', phone: '13800138008', regionCode: '510104', regionText: '四川省成都市锦江区', detail: '春熙路26号', isDefault: true },
  ];
  for (const addr of moreAddresses) {
    await prisma.address.upsert({
      where: { id: addr.id },
      update: {},
      create: addr,
    });
  }
  console.log(`✅ ${moreAddresses.length} 个新地址已创建`);

  // ============================================================
  // 更多购物车
  // ============================================================
  const u002Cart = await prisma.cart.upsert({ where: { userId: 'u-002' }, update: {}, create: { userId: 'u-002' } });
  await prisma.cartItem.deleteMany({ where: { cartId: u002Cart.id } });
  await prisma.cartItem.createMany({
    data: [
      { cartId: u002Cart.id, skuId: 'sku-p-001', quantity: 3 },
      { cartId: u002Cart.id, skuId: 'sku-p-003', quantity: 1 },
      { cartId: u002Cart.id, skuId: 'sku-p-013', quantity: 1 },
    ],
  });

  const u003Cart = await prisma.cart.upsert({ where: { userId: 'u-003' }, update: {}, create: { userId: 'u-003' } });
  await prisma.cartItem.deleteMany({ where: { cartId: u003Cart.id } });
  await prisma.cartItem.createMany({
    data: [
      { cartId: u003Cart.id, skuId: 'sku-p-008-m', quantity: 2 },
      { cartId: u003Cart.id, skuId: 'sku-p-004', quantity: 1 },
    ],
  });

  const u004Cart = await prisma.cart.upsert({ where: { userId: 'u-004' }, update: {}, create: { userId: 'u-004' } });
  await prisma.cartItem.deleteMany({ where: { cartId: u004Cart.id } });
  await prisma.cartItem.createMany({
    data: [
      { cartId: u004Cart.id, skuId: 'sku-p-005', quantity: 1 },
      { cartId: u004Cart.id, skuId: 'sku-p-007', quantity: 2 },
      { cartId: u004Cart.id, skuId: 'sku-p-008-s', quantity: 3 },
      { cartId: u004Cart.id, skuId: 'sku-p-013', quantity: 1 },
    ],
  });
  console.log('✅ 3 个用户购物车已创建');

  // ============================================================
  // 更多订单（覆盖所有状态）
  // ============================================================
  const moreOrders = [
    {
      id: 'o-005', userId: 'u-002', status: 'CANCELED' as const, totalAmount: 39.6, goodsAmount: 39.6,
      addressSnapshot: { receiverName: '江晴', phone: '13800138002', province: '上海市', city: '上海市', district: '浦东新区', detail: '世纪大道100号' },
      items: [
        { id: 'oi-010', skuId: 'sku-p-001', unitPrice: 19.8, quantity: 2, productSnapshot: { productId: 'p-001', title: '高山有机小番茄', image: 'https://placehold.co/600x600/png', price: 19.8 } },
      ],
    },
    {
      id: 'o-006', userId: 'u-003', status: 'PAID' as const, totalAmount: 168, goodsAmount: 168,
      paidAt: new Date('2026-02-20T10:00:00Z'),
      addressSnapshot: { receiverName: '张明', phone: '13800138003', province: '北京市', city: '北京市', district: '朝阳区', detail: '建国路93号院' },
      items: [
        { id: 'oi-011', skuId: 'sku-p-008-m', unitPrice: 168, quantity: 1, productSnapshot: { productId: 'p-008', title: '武夷岩茶大红袍 125g罐装', image: 'https://placehold.co/600x600/png', price: 168 } },
      ],
    },
    {
      id: 'o-007', userId: 'u-003', status: 'SHIPPED' as const, totalAmount: 97.5, goodsAmount: 97.5,
      paidAt: new Date('2026-02-18T14:00:00Z'),
      addressSnapshot: { receiverName: '张明', phone: '13800138003', province: '北京市', city: '北京市', district: '海淀区', detail: '中关村大街1号' },
      items: [
        { id: 'oi-012', skuId: 'sku-p-004', unitPrice: 39.9, quantity: 1, productSnapshot: { productId: 'p-004', title: '富硒胚芽米', image: 'https://placehold.co/600x600/png', price: 39.9 } },
        { id: 'oi-013', skuId: 'sku-p-003', unitPrice: 58, quantity: 1, productSnapshot: { productId: 'p-003', title: '低温冷链蓝莓', image: 'https://placehold.co/600x600/png', price: 58 } },
      ],
    },
    {
      id: 'o-008', userId: 'u-004', status: 'DELIVERED' as const, totalAmount: 128, goodsAmount: 128,
      paidAt: new Date('2026-02-15T09:00:00Z'),
      addressSnapshot: { receiverName: '李婉清', phone: '13800138004', province: '广东省', city: '广州市', district: '天河区', detail: '天河路385号' },
      items: [
        { id: 'oi-014', skuId: 'sku-p-005', unitPrice: 128, quantity: 1, productSnapshot: { productId: 'p-005', title: '有机绿茶礼盒', image: 'https://placehold.co/600x600/png', price: 128 } },
      ],
    },
    {
      id: 'o-009', userId: 'u-004', status: 'RECEIVED' as const, totalAmount: 55.5, goodsAmount: 55.5,
      paidAt: new Date('2026-02-10T11:00:00Z'), receivedAt: new Date('2026-02-17T16:00:00Z'),
      addressSnapshot: { receiverName: '李婉清', phone: '13800138004', province: '广东省', city: '广州市', district: '天河区', detail: '天河路385号' },
      items: [
        { id: 'oi-015', skuId: 'sku-p-007', unitPrice: 8.8, quantity: 3, productSnapshot: { productId: 'p-007', title: '有机胡萝卜 500g装', image: 'https://placehold.co/600x600/png', price: 8.8 } },
        { id: 'oi-016', skuId: 'sku-p-006', unitPrice: 29.9, quantity: 1, productSnapshot: { productId: 'p-006', title: '生态散养土鸡蛋', image: 'https://placehold.co/600x600/png', price: 29.9 } },
      ],
    },
    {
      id: 'o-010', userId: 'u-002', status: 'REFUNDED' as const, totalAmount: 88, goodsAmount: 88,
      paidAt: new Date('2026-02-08T16:00:00Z'),
      addressSnapshot: { receiverName: '江晴', phone: '13800138002', province: '上海市', city: '上海市', district: '浦东新区', detail: '世纪大道100号' },
      items: [
        { id: 'oi-017', skuId: 'sku-p-013', unitPrice: 88, quantity: 1, productSnapshot: { productId: 'p-013', title: '生态蜂蜜 500g装', image: 'https://placehold.co/600x600/png', price: 88 } },
      ],
    },
    {
      id: 'o-011', userId: 'u-007', status: 'PAID' as const, totalAmount: 352, goodsAmount: 352,
      paidAt: new Date('2026-03-01T08:30:00Z'),
      addressSnapshot: { receiverName: '赵美琪', phone: '13800138007', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路18号' },
      items: [
        { id: 'oi-018', skuId: 'sku-p-008-l', unitPrice: 268, quantity: 1, productSnapshot: { productId: 'p-008', title: '武夷岩茶大红袍 250g礼盒', image: 'https://placehold.co/600x600/png', price: 268 } },
        { id: 'oi-019', skuId: 'sku-p-007-b', unitPrice: 15.8, quantity: 2, productSnapshot: { productId: 'p-007', title: '有机胡萝卜 1kg装', image: 'https://placehold.co/600x600/png', price: 15.8 } },
        { id: 'oi-020', skuId: 'sku-p-001', unitPrice: 19.8, quantity: 1, productSnapshot: { productId: 'p-001', title: '高山有机小番茄', image: 'https://placehold.co/600x600/png', price: 19.8 } },
        { id: 'oi-021', skuId: 'sku-p-006', unitPrice: 29.9, quantity: 1, productSnapshot: { productId: 'p-006', title: '生态散养土鸡蛋', image: 'https://placehold.co/600x600/png', price: 29.9 } },
      ],
    },
    {
      id: 'o-012', userId: 'u-008', status: 'RECEIVED' as const, totalAmount: 176, goodsAmount: 176,
      paidAt: new Date('2026-02-25T13:00:00Z'), receivedAt: new Date('2026-03-03T10:00:00Z'),
      addressSnapshot: { receiverName: '钱志远', phone: '13800138008', province: '四川省', city: '成都市', district: '锦江区', detail: '春熙路26号' },
      items: [
        { id: 'oi-022', skuId: 'sku-p-005', unitPrice: 128, quantity: 1, productSnapshot: { productId: 'p-005', title: '有机绿茶礼盒', image: 'https://placehold.co/600x600/png', price: 128 } },
        { id: 'oi-023', skuId: 'sku-p-001', unitPrice: 19.8, quantity: 2, productSnapshot: { productId: 'p-001', title: '高山有机小番茄', image: 'https://placehold.co/600x600/png', price: 19.8 } },
        { id: 'oi-024', skuId: 'sku-p-007', unitPrice: 8.8, quantity: 1, productSnapshot: { productId: 'p-007', title: '有机胡萝卜 500g装', image: 'https://placehold.co/600x600/png', price: 8.8 } },
      ],
    },
    {
      id: 'o-013', userId: 'u-009', status: 'PAID' as const, totalAmount: 336, goodsAmount: 336,
      paidAt: new Date('2026-03-04T15:00:00Z'),
      addressSnapshot: { receiverName: '孙雅婷', phone: '13800138009', province: '重庆市', city: '重庆市', district: '渝中区', detail: '解放碑步行街1号' },
      items: [
        { id: 'oi-025', skuId: 'sku-p-008-m', unitPrice: 168, quantity: 2, productSnapshot: { productId: 'p-008', title: '武夷岩茶大红袍 125g罐装', image: 'https://placehold.co/600x600/png', price: 168 } },
      ],
    },
    {
      id: 'o-014', userId: 'u-010', status: 'SHIPPED' as const, totalAmount: 127.6, goodsAmount: 127.6,
      paidAt: new Date('2026-03-02T10:00:00Z'),
      addressSnapshot: { receiverName: '周建国', phone: '13800138010', province: '陕西省', city: '西安市', district: '雁塔区', detail: '大雁塔南路1号' },
      items: [
        { id: 'oi-026', skuId: 'sku-p-004', unitPrice: 39.9, quantity: 1, productSnapshot: { productId: 'p-004', title: '富硒胚芽米', image: 'https://placehold.co/600x600/png', price: 39.9 } },
        { id: 'oi-027', skuId: 'sku-p-013', unitPrice: 88, quantity: 1, productSnapshot: { productId: 'p-013', title: '生态蜂蜜 500g装', image: 'https://placehold.co/600x600/png', price: 88 } },
      ],
    },
  ];

  for (const order of moreOrders) {
    const { items, ...orderData } = order;
    await prisma.order.upsert({
      where: { id: order.id },
      update: {},
      create: {
        ...orderData,
        items: { create: items },
      },
    });
  }
  console.log(`✅ ${moreOrders.length} 个新订单已创建（覆盖所有状态）`);

  // ============================================================
  // 更多支付记录
  // ============================================================
  const morePayments = [
    { orderId: 'o-006', channel: 'WECHAT_PAY' as const, amount: 168, status: 'PAID' as const, merchantOrderNo: 'PAY-o-006', providerTxnId: 'WX-TXN-006', paidAt: new Date('2026-02-20T10:00:00Z') },
    { orderId: 'o-007', channel: 'ALIPAY' as const, amount: 97.5, status: 'PAID' as const, merchantOrderNo: 'PAY-o-007', providerTxnId: 'ALI-TXN-007', paidAt: new Date('2026-02-18T14:00:00Z') },
    { orderId: 'o-008', channel: 'WECHAT_PAY' as const, amount: 128, status: 'PAID' as const, merchantOrderNo: 'PAY-o-008', providerTxnId: 'WX-TXN-008', paidAt: new Date('2026-02-15T09:00:00Z') },
    { orderId: 'o-009', channel: 'ALIPAY' as const, amount: 55.5, status: 'PAID' as const, merchantOrderNo: 'PAY-o-009', providerTxnId: 'ALI-TXN-009', paidAt: new Date('2026-02-10T11:00:00Z') },
    { orderId: 'o-010', channel: 'WECHAT_PAY' as const, amount: 88, status: 'REFUNDED' as const, merchantOrderNo: 'PAY-o-010', providerTxnId: 'WX-TXN-010', paidAt: new Date('2026-02-08T16:00:00Z') },
    { orderId: 'o-011', channel: 'UNIONPAY' as const, amount: 352, status: 'PAID' as const, merchantOrderNo: 'PAY-o-011', providerTxnId: 'UP-TXN-011', paidAt: new Date('2026-03-01T08:30:00Z') },
    { orderId: 'o-012', channel: 'WECHAT_PAY' as const, amount: 176, status: 'PAID' as const, merchantOrderNo: 'PAY-o-012', providerTxnId: 'WX-TXN-012', paidAt: new Date('2026-02-25T13:00:00Z') },
    { orderId: 'o-013', channel: 'ALIPAY' as const, amount: 336, status: 'PAID' as const, merchantOrderNo: 'PAY-o-013', providerTxnId: 'ALI-TXN-013', paidAt: new Date('2026-03-04T15:00:00Z') },
    { orderId: 'o-014', channel: 'WECHAT_PAY' as const, amount: 127.6, status: 'PAID' as const, merchantOrderNo: 'PAY-o-014', providerTxnId: 'WX-TXN-014', paidAt: new Date('2026-03-02T10:00:00Z') },
  ];
  for (const pay of morePayments) {
    await prisma.payment.upsert({
      where: { merchantOrderNo: pay.merchantOrderNo },
      update: {},
      create: { ...pay, scene: 'APP' as const },
    });
  }
  console.log(`✅ ${morePayments.length} 条新支付记录已创建`);

  // ============================================================
  // 更多物流 + 物流事件
  // ============================================================
  await prisma.shipment.upsert({
    where: { orderId_companyId: { orderId: 'o-007', companyId: 'c-001' } },
    update: {},
    create: {
      orderId: 'o-007', companyId: 'c-001', carrierCode: 'ZTO', carrierName: '中通快递', trackingNo: 'ZTO9876543210',
      status: 'IN_TRANSIT', shippedAt: new Date('2026-02-19T10:00:00Z'),
    },
  });
  await prisma.shipment.upsert({
    where: { orderId_companyId: { orderId: 'o-007', companyId: 'c-003' } },
    update: {},
    create: {
      orderId: 'o-007', companyId: 'c-003', carrierCode: 'SF', carrierName: '顺丰速运', trackingNo: 'SF9876543210',
      status: 'INIT',
    },
  });
  await prisma.order.update({ where: { id: 'o-007' }, data: { autoReceiveAt: new Date('2026-02-26T10:00:00Z') } });

  await prisma.shipment.upsert({
    where: { orderId_companyId: { orderId: 'o-008', companyId: 'c-004' } },
    update: {},
    create: {
      orderId: 'o-008', companyId: 'c-004', carrierCode: 'SF', carrierName: '顺丰速运', trackingNo: 'SF5555555555',
      status: 'DELIVERED', shippedAt: new Date('2026-02-16T08:00:00Z'), deliveredAt: new Date('2026-02-18T14:00:00Z'),
    },
  });

  await prisma.shipment.upsert({
    where: { orderId_companyId: { orderId: 'o-014', companyId: 'c-001' } },
    update: {},
    create: {
      orderId: 'o-014', companyId: 'c-001', carrierCode: 'JDL', carrierName: '京东物流', trackingNo: 'JD1234567890',
      status: 'SHIPPED', shippedAt: new Date('2026-03-03T09:00:00Z'),
    },
  });

  // 物流追踪事件
  const shipmentForO003 = await prisma.shipment.findUnique({ where: { orderId_companyId: { orderId: 'o-003', companyId: 'c-003' } } });
  const shipmentForO008 = await prisma.shipment.findUnique({ where: { orderId_companyId: { orderId: 'o-008', companyId: 'c-004' } } });
  if (shipmentForO003) {
    await prisma.shipmentTrackingEvent.createMany({
      data: [
        { shipmentId: shipmentForO003.id, occurredAt: new Date('2026-01-23T09:00:00Z'), statusCode: 'PICKED_UP', message: '快递员已揽件', location: '云南省玉溪市' },
        { shipmentId: shipmentForO003.id, occurredAt: new Date('2026-01-23T18:00:00Z'), statusCode: 'IN_TRANSIT', message: '已到达玉溪转运中心', location: '云南省玉溪市' },
        { shipmentId: shipmentForO003.id, occurredAt: new Date('2026-01-24T12:00:00Z'), statusCode: 'IN_TRANSIT', message: '已到达昆明转运中心', location: '云南省昆明市' },
        { shipmentId: shipmentForO003.id, occurredAt: new Date('2026-01-25T06:00:00Z'), statusCode: 'IN_TRANSIT', message: '正在派送中', location: '云南省昆明市盘龙区' },
      ],
    });
  }
  if (shipmentForO008) {
    await prisma.shipmentTrackingEvent.createMany({
      data: [
        { shipmentId: shipmentForO008.id, occurredAt: new Date('2026-02-16T08:00:00Z'), statusCode: 'PICKED_UP', message: '快递员已揽件', location: '福建省武夷山市' },
        { shipmentId: shipmentForO008.id, occurredAt: new Date('2026-02-17T06:00:00Z'), statusCode: 'IN_TRANSIT', message: '已到达广州转运中心', location: '广东省广州市' },
        { shipmentId: shipmentForO008.id, occurredAt: new Date('2026-02-18T10:00:00Z'), statusCode: 'OUT_FOR_DELIVERY', message: '正在派送', location: '广东省广州市天河区' },
        { shipmentId: shipmentForO008.id, occurredAt: new Date('2026-02-18T14:00:00Z'), statusCode: 'DELIVERED', message: '已签收', location: '广东省广州市天河区天河路385号' },
      ],
    });
  }
  console.log('✅ 3 个新物流记录 + 追踪事件已创建');

  // ============================================================
  // 退款记录（Refund + RefundItem）
  // ============================================================
  await prisma.refund.upsert({
    where: { merchantRefundNo: 'REF-o-010' },
    update: {},
    create: {
      orderId: 'o-010', amount: 88, status: 'REFUNDED', reason: '蜂蜜结晶严重，疑似掺假',
      merchantRefundNo: 'REF-o-010', providerRefundId: 'WX-REF-010',
      items: {
        create: { orderItemId: 'oi-017', skuId: 'sku-p-013', quantity: 1, amount: 88 },
      },
    },
  });

  await prisma.refund.upsert({
    where: { merchantRefundNo: 'REF-o-005' },
    update: {},
    create: {
      orderId: 'o-005', amount: 39.6, status: 'REQUESTED', reason: '误操作下单，申请退款',
      merchantRefundNo: 'REF-o-005',
    },
  });

  await prisma.refund.upsert({
    where: { merchantRefundNo: 'REF-o-004-partial' },
    update: {},
    create: {
      orderId: 'o-004', amount: 18, status: 'APPROVED', reason: '部分商品质量问题',
      merchantRefundNo: 'REF-o-004-partial',
      items: {
        create: { orderItemId: 'oi-005', skuId: 'sku-p-006', quantity: 1, amount: 18 },
      },
    },
  });
  console.log('✅ 3 条退款记录已创建');

  // ============================================================
  // 订单状态历史（为新订单补充）
  // ============================================================
  const statusHistories = [
    { orderId: 'o-005', fromStatus: 'PAID', toStatus: 'CANCELED', reason: '用户主动取消' },
    { orderId: 'o-008', fromStatus: 'SHIPPED', toStatus: 'DELIVERED', reason: '快递已签收' },
    { orderId: 'o-009', fromStatus: 'DELIVERED', toStatus: 'RECEIVED', reason: '用户确认收货' },
    { orderId: 'o-010', fromStatus: 'PAID', toStatus: 'REFUNDED', reason: '退款完成' },
  ];
  for (const sh of statusHistories) {
    await prisma.orderStatusHistory.create({ data: sh });
  }
  console.log(`✅ ${statusHistories.length} 条订单状态历史已创建`);

  // ============================================================
  // 发票抬头 + 发票记录
  // ============================================================
  const invoiceProfiles = [
    { id: 'ip-001', userId: 'u-001', type: 'PERSONAL' as const, title: '林青禾', email: 'linqinghe@example.com', phone: '13800138000' },
    { id: 'ip-002', userId: 'u-003', type: 'COMPANY' as const, title: '北京智联科技有限公司', taxNo: '91110000MA12345X', email: 'finance@zhilian.com', address: '北京市海淀区中关村大街1号' },
    { id: 'ip-003', userId: 'u-004', type: 'PERSONAL' as const, title: '李婉清', email: 'liwanqing@example.com' },
    { id: 'ip-004', userId: 'u-007', type: 'COMPANY' as const, title: '深圳创新电子有限公司', taxNo: '91440300MA67890Y', email: 'invoice@cxdz.com', address: '深圳市南山区科技园南路18号' },
  ];
  for (const ip of invoiceProfiles) {
    await prisma.invoiceProfile.upsert({ where: { id: ip.id }, update: {}, create: ip });
  }

  const invoices = [
    { id: 'inv-001', orderId: 'o-004', profileSnapshot: { title: '林青禾', type: 'PERSONAL' }, status: 'ISSUED' as const, invoiceNo: 'INV-2026-0001', pdfUrl: 'https://placehold.co/800x1200/pdf', issuedAt: new Date('2026-01-25') },
    { id: 'inv-002', orderId: 'o-006', profileSnapshot: { title: '北京智联科技有限公司', type: 'COMPANY', taxNo: '91110000MA12345X' }, status: 'REQUESTED' as const },
    { id: 'inv-003', orderId: 'o-009', profileSnapshot: { title: '李婉清', type: 'PERSONAL' }, status: 'ISSUED' as const, invoiceNo: 'INV-2026-0003', pdfUrl: 'https://placehold.co/800x1200/pdf', issuedAt: new Date('2026-02-18') },
    { id: 'inv-004', orderId: 'o-012', profileSnapshot: { title: '钱志远', type: 'PERSONAL' }, status: 'FAILED' as const },
  ];
  for (const inv of invoices) {
    await prisma.invoice.upsert({ where: { id: inv.id }, update: {}, create: inv });
  }
  console.log(`✅ ${invoiceProfiles.length} 个发票抬头 + ${invoices.length} 张发票已创建`);

  // ============================================================
  // AI 会话演示数据
  // ============================================================
  const aiSession1 = await prisma.aiSession.create({
    data: {
      userId: 'u-001', page: 'HOME',
      context: { currentTab: 'home', cartItemCount: 2 },
      utterances: {
        create: [
          {
            transcript: '帮我找有机蔬菜', language: 'zh',
            intentResults: {
              create: {
                intent: 'SearchProduct', slots: { product: '有机蔬菜' }, confidence: 0.95,
                candidates: [{ id: 'p-001', title: '高山有机小番茄' }, { id: 'p-002', title: '山泉水培生菜' }],
                actionExecutions: {
                  create: { actionType: 'NAVIGATE', actionPayload: { route: '/search', query: '有机蔬菜' }, success: true },
                },
              },
            },
          },
          {
            transcript: '加两个番茄到购物车', language: 'zh',
            intentResults: {
              create: {
                intent: 'AddToCart', slots: { product: '番茄', qty: 2 }, confidence: 0.88,
                actionExecutions: {
                  create: { actionType: 'CALL_API', actionPayload: { api: 'cart/add', skuId: 'sku-p-001', qty: 2 }, requiresConfirmation: true, success: true, confirmedAt: new Date() },
                },
              },
            },
          },
        ],
      },
    },
  });

  const aiSession2 = await prisma.aiSession.create({
    data: {
      userId: 'u-003', page: 'PRODUCT_DETAIL',
      context: { productId: 'p-008', currentTab: 'detail' },
      utterances: {
        create: {
          transcript: '这个茶叶有几种规格', language: 'zh',
          intentResults: {
            create: {
              intent: 'ShowChoices', slots: { product: '茶叶', info: '规格' }, confidence: 0.92,
              candidates: [{ sku: '50g品鉴装', price: 68 }, { sku: '125g罐装', price: 168 }, { sku: '250g礼盒装', price: 268 }],
              actionExecutions: {
                create: { actionType: 'SHOW_CHOICES', actionPayload: { choices: ['50g品鉴装 ¥68', '125g罐装 ¥168', '250g礼盒装 ¥268'] }, success: true },
              },
            },
          },
        },
      },
    },
  });

  const aiSession3 = await prisma.aiSession.create({
    data: {
      userId: 'u-004', page: 'ORDER_LIST',
      context: { currentTab: 'orders' },
      utterances: {
        create: {
          transcript: '查看我最近的订单', language: 'zh',
          intentResults: {
            create: {
              intent: 'FilterOrder', slots: { orderStatus: 'all', timeRange: 'recent' }, confidence: 0.90,
              actionExecutions: {
                create: { actionType: 'NAVIGATE', actionPayload: { route: '/orders', filter: 'recent' }, success: true },
              },
            },
          },
        },
      },
    },
  });
  console.log('✅ 3 个 AI 会话 + 语音 + 意图已创建');

  // ============================================================
  // 抽奖奖池（LotteryPrize）+ 抽奖记录（LotteryRecord）
  // ============================================================
  const lotteryPrizes = [
    { id: 'lp-001', type: 'DISCOUNT_BUY' as const, name: '1元白酒', productId: 'p-011', skuId: 'sku-p-011', prizePrice: 1.0, threshold: null as number | null, prizeQuantity: 1, probability: 5, dailyLimit: 3, totalLimit: 50, wonCount: 8, expirationHours: 48, sortOrder: 0 },
    { id: 'lp-002', type: 'DISCOUNT_BUY' as const, name: '9.9元大米', productId: 'p-012', skuId: 'sku-p-012', prizePrice: 9.9, threshold: null as number | null, prizeQuantity: 1, probability: 10, dailyLimit: 5, totalLimit: 100, wonCount: 23, expirationHours: 48, sortOrder: 1 },
    { id: 'lp-003', type: 'THRESHOLD_GIFT' as const, name: '满88送蜂蜜', productId: 'p-013', skuId: 'sku-p-013', prizePrice: 0, threshold: 88 as number | null, prizeQuantity: 1, probability: 15, dailyLimit: 10, totalLimit: 200, wonCount: 45, expirationHours: 72, sortOrder: 2 },
    { id: 'lp-004', type: 'THRESHOLD_GIFT' as const, name: '满50送胡萝卜', productId: 'p-007', skuId: 'sku-p-007', prizePrice: 0, threshold: 50 as number | null, prizeQuantity: 1, probability: 20, dailyLimit: 15, totalLimit: 500, wonCount: 120, expirationHours: null as number | null, sortOrder: 3 },
    { id: 'lp-005', type: 'NO_PRIZE' as const, name: '谢谢参与', productId: null, skuId: null, prizePrice: null as number | null, threshold: null as number | null, prizeQuantity: 1, probability: 50, dailyLimit: null as number | null, totalLimit: null as number | null, wonCount: 0, expirationHours: null as number | null, sortOrder: 4 },
  ];
  for (const lp of lotteryPrizes) {
    await prisma.lotteryPrize.upsert({
      where: { id: lp.id },
      update: {},
      create: lp,
    });
  }

  const lotteryRecords = [
    { id: 'lr-001', userId: 'u-001', prizeId: 'lp-001', result: 'WON' as const, status: 'CONSUMED' as const, drawDate: '2026-02-20', meta: { prizeName: '1元白酒', prizePrice: 1.0 } },
    { id: 'lr-002', userId: 'u-002', prizeId: 'lp-002', result: 'WON' as const, status: 'IN_CART' as const, drawDate: '2026-03-01', meta: { prizeName: '9.9元大米', prizePrice: 9.9 } },
    { id: 'lr-003', userId: 'u-003', prizeId: 'lp-003', result: 'WON' as const, status: 'WON' as const, drawDate: '2026-03-04', meta: { prizeName: '满88送蜂蜜', threshold: 88 } },
    { id: 'lr-004', userId: 'u-004', prizeId: 'lp-005', result: 'NO_PRIZE' as const, status: 'WON' as const, drawDate: '2026-03-04', meta: { prizeName: '谢谢参与' } },
    { id: 'lr-005', userId: 'u-007', prizeId: 'lp-004', result: 'WON' as const, status: 'EXPIRED' as const, drawDate: '2026-02-15', meta: { prizeName: '满50送胡萝卜', threshold: 50 } },
    { id: 'lr-006', userId: 'u-008', prizeId: 'lp-002', result: 'WON' as const, status: 'CONSUMED' as const, drawDate: '2026-02-28', meta: { prizeName: '9.9元大米', prizePrice: 9.9 } },
    { id: 'lr-007', userId: 'u-001', prizeId: 'lp-004', result: 'WON' as const, status: 'IN_CART' as const, drawDate: '2026-03-05', meta: { prizeName: '满50送胡萝卜', threshold: 50 } },
    { id: 'lr-008', userId: 'u-009', prizeId: 'lp-001', result: 'WON' as const, status: 'WON' as const, drawDate: '2026-03-05', meta: { prizeName: '1元白酒', prizePrice: 1.0 } },
    { id: 'lr-009', userId: 'u-010', prizeId: 'lp-003', result: 'WON' as const, status: 'CONSUMED' as const, drawDate: '2026-02-25', meta: { prizeName: '满88送蜂蜜', threshold: 88 } },
    { id: 'lr-010', userId: 'u-006', prizeId: 'lp-005', result: 'NO_PRIZE' as const, status: 'WON' as const, drawDate: '2026-03-03', meta: { prizeName: '谢谢参与' } },
  ];
  for (const lr of lotteryRecords) {
    await prisma.lotteryRecord.upsert({
      where: { id: lr.id },
      update: {},
      create: lr,
    });
  }
  console.log(`✅ ${lotteryPrizes.length} 个抽奖奖品 + ${lotteryRecords.length} 条抽奖记录已创建`);

  // ============================================================
  // 运费规则（ShippingRule）
  // ============================================================
  const shippingRules = [
    { id: 'sr-001', name: '全国包邮（满99）', regionCodes: [] as string[], minAmount: 99, maxAmount: null as number | null, fee: 0, priority: 10, isActive: true },
    { id: 'sr-002', name: '全国标准运费', regionCodes: [] as string[], minAmount: null as number | null, maxAmount: 99 as number | null, fee: 8, priority: 5, isActive: true },
    { id: 'sr-003', name: '偏远地区加价（新疆）', regionCodes: ['650000'], minAmount: null as number | null, maxAmount: null as number | null, fee: 15, priority: 20, isActive: true },
    { id: 'sr-004', name: '偏远地区加价（西藏）', regionCodes: ['540000'], minAmount: null as number | null, maxAmount: null as number | null, fee: 20, priority: 20, isActive: true },
    { id: 'sr-005', name: '重量超额运费', regionCodes: [] as string[], minAmount: null as number | null, maxAmount: null as number | null, minWeight: 5000, maxWeight: null as number | null, fee: 12, priority: 15, isActive: true },
  ];
  for (const sr of shippingRules) {
    await prisma.shippingRule.upsert({
      where: { id: sr.id },
      update: {},
      create: sr,
    });
  }
  console.log(`✅ ${shippingRules.length} 条运费规则已创建`);

  // ============================================================
  // 换货请求（ReplacementRequest）
  // ============================================================
  const replacements = [
    {
      id: 'rr-001', orderId: 'o-004', userId: 'u-001', orderItemId: 'oi-005', reason: '鸡蛋收到时有3个碎裂',
      photos: ['https://placehold.co/400x300/png', 'https://placehold.co/400x300/png'],
      status: 'COMPLETED' as const, reviewNote: '确认包装问题，同意换货', reviewedAt: new Date('2026-01-22'),
      replacementShipmentId: 'SF-REPLACE-001',
    },
    {
      id: 'rr-002', orderId: 'o-009', userId: 'u-004', orderItemId: 'oi-016', reason: '鸡蛋新鲜度不达标',
      photos: ['https://placehold.co/400x300/png'],
      status: 'UNDER_REVIEW' as const,
    },
    {
      id: 'rr-003', orderId: 'o-012', userId: 'u-008', orderItemId: 'oi-024', reason: '胡萝卜有腐烂',
      photos: ['https://placehold.co/400x300/png', 'https://placehold.co/400x300/png', 'https://placehold.co/400x300/png'],
      status: 'APPROVED' as const, reviewNote: '已确认，安排补发', reviewedAt: new Date('2026-03-04'),
    },
    {
      id: 'rr-004', orderId: 'o-012', userId: 'u-008', orderItemId: 'oi-022', reason: '绿茶礼盒包装严重破损',
      photos: ['https://placehold.co/400x300/png'],
      status: 'REJECTED' as const, reviewNote: '经核实属运输途中正常磨损，建议联系快递理赔', reviewedAt: new Date('2026-03-04'),
    },
    {
      id: 'rr-005', orderId: 'o-009', userId: 'u-004', orderItemId: 'oi-015', reason: '胡萝卜尺寸与描述不符',
      photos: ['https://placehold.co/400x300/png'],
      status: 'SHIPPED' as const, reviewNote: '同意换货', reviewedAt: new Date('2026-02-19'), replacementShipmentId: 'SF-REPLACE-002',
    },
  ];
  for (const rr of replacements) {
    await prisma.replacementRequest.upsert({
      where: { id: rr.id },
      update: {},
      create: rr,
    });
  }
  console.log(`✅ ${replacements.length} 条换货请求已创建`);

  // ============================================================
  // 平台红包活动（CouponCampaign）+ 实例 + 使用记录
  // ============================================================
  const couponCampaigns = [
    {
      id: 'cc-001', name: '新用户注册红包', description: '新用户注册即送10元无门槛红包',
      status: 'ACTIVE' as const, triggerType: 'REGISTER' as const, distributionMode: 'AUTO' as const,
      discountType: 'FIXED' as const, discountValue: 10, minOrderAmount: 0,
      totalQuota: 10000, issuedCount: 156, maxPerUser: 1, validDays: 30,
      startAt: new Date('2026-01-01'), endAt: new Date('2026-12-31'), createdBy: superAdmin.id,
    },
    {
      id: 'cc-002', name: '首单九折优惠', description: '首次下单享9折优惠，最高减50元',
      status: 'ACTIVE' as const, triggerType: 'FIRST_ORDER' as const, distributionMode: 'AUTO' as const,
      discountType: 'PERCENT' as const, discountValue: 10, maxDiscountAmount: 50, minOrderAmount: 30,
      totalQuota: 5000, issuedCount: 89, maxPerUser: 1, validDays: 14,
      startAt: new Date('2026-01-01'), endAt: new Date('2026-12-31'), createdBy: superAdmin.id,
    },
    {
      id: 'cc-003', name: '签到7天送5元', description: '连续签到7天自动发放5元红包',
      status: 'ACTIVE' as const, triggerType: 'CHECK_IN' as const, distributionMode: 'AUTO' as const,
      triggerConfig: { consecutiveDays: 7 },
      discountType: 'FIXED' as const, discountValue: 5, minOrderAmount: 20,
      totalQuota: 20000, issuedCount: 340, maxPerUser: 4, validDays: 7,
      startAt: new Date('2026-01-01'), endAt: new Date('2026-12-31'), createdBy: superAdmin.id,
    },
    {
      id: 'cc-004', name: '春节限时大促', description: '春节期间满200减30',
      status: 'ENDED' as const, triggerType: 'HOLIDAY' as const, distributionMode: 'CLAIM' as const,
      discountType: 'FIXED' as const, discountValue: 30, minOrderAmount: 200,
      totalQuota: 1000, issuedCount: 980, maxPerUser: 2, validDays: 0,
      startAt: new Date('2026-01-28'), endAt: new Date('2026-02-12'), createdBy: superAdmin.id,
    },
    {
      id: 'cc-005', name: '累计消费满500送20', description: '累计消费满500元自动发放20元红包',
      status: 'ACTIVE' as const, triggerType: 'CUMULATIVE_SPEND' as const, distributionMode: 'AUTO' as const,
      triggerConfig: { thresholdAmount: 500 },
      discountType: 'FIXED' as const, discountValue: 20, minOrderAmount: 50,
      totalQuota: 3000, issuedCount: 45, maxPerUser: 1, validDays: 30,
      startAt: new Date('2026-01-01'), endAt: new Date('2026-12-31'), createdBy: superAdmin.id,
    },
    {
      id: 'cc-006', name: '限时闪购红包', description: '限时领取，每人限1张',
      status: 'PAUSED' as const, triggerType: 'FLASH' as const, distributionMode: 'CLAIM' as const,
      discountType: 'FIXED' as const, discountValue: 15, minOrderAmount: 80,
      totalQuota: 500, issuedCount: 200, maxPerUser: 1, validDays: 3,
      startAt: new Date('2026-03-01'), endAt: new Date('2026-03-07'), createdBy: superAdmin.id,
    },
    {
      id: 'cc-007', name: '手动发放VIP专享', description: '管理员手动发放给指定VIP用户',
      status: 'DRAFT' as const, triggerType: 'MANUAL' as const, distributionMode: 'MANUAL' as const,
      discountType: 'FIXED' as const, discountValue: 50, minOrderAmount: 100,
      totalQuota: 100, issuedCount: 0, maxPerUser: 1, validDays: 60,
      startAt: new Date('2026-04-01'), endAt: new Date('2026-06-30'), createdBy: superAdmin.id,
    },
  ];
  for (const cc of couponCampaigns) {
    await prisma.couponCampaign.upsert({
      where: { id: cc.id },
      update: {},
      create: cc,
    });
  }

  // 红包实例
  const couponInstances = [
    { id: 'ci-001', campaignId: 'cc-001', userId: 'u-001', status: 'USED' as const, discountType: 'FIXED' as const, discountValue: 10, minOrderAmount: 0, expiresAt: new Date('2026-02-01'), usedAt: new Date('2026-01-18'), usedOrderId: 'o-001', usedAmount: 10 },
    { id: 'ci-002', campaignId: 'cc-001', userId: 'u-002', status: 'AVAILABLE' as const, discountType: 'FIXED' as const, discountValue: 10, minOrderAmount: 0, expiresAt: new Date('2026-04-01') },
    { id: 'ci-003', campaignId: 'cc-001', userId: 'u-003', status: 'AVAILABLE' as const, discountType: 'FIXED' as const, discountValue: 10, minOrderAmount: 0, expiresAt: new Date('2026-04-15') },
    { id: 'ci-004', campaignId: 'cc-002', userId: 'u-001', status: 'USED' as const, discountType: 'PERCENT' as const, discountValue: 10, maxDiscountAmount: 50, minOrderAmount: 30, expiresAt: new Date('2026-02-15'), usedAt: new Date('2026-01-20'), usedOrderId: 'o-002', usedAmount: 12.8 },
    { id: 'ci-005', campaignId: 'cc-003', userId: 'u-001', status: 'EXPIRED' as const, discountType: 'FIXED' as const, discountValue: 5, minOrderAmount: 20, expiresAt: new Date('2026-02-10') },
    { id: 'ci-006', campaignId: 'cc-003', userId: 'u-004', status: 'AVAILABLE' as const, discountType: 'FIXED' as const, discountValue: 5, minOrderAmount: 20, expiresAt: new Date('2026-03-15') },
    { id: 'ci-007', campaignId: 'cc-004', userId: 'u-001', status: 'USED' as const, discountType: 'FIXED' as const, discountValue: 30, minOrderAmount: 200, expiresAt: new Date('2026-02-12'), usedAt: new Date('2026-02-05'), usedOrderId: 'o-001', usedAmount: 30 },
    { id: 'ci-008', campaignId: 'cc-004', userId: 'u-007', status: 'EXPIRED' as const, discountType: 'FIXED' as const, discountValue: 30, minOrderAmount: 200, expiresAt: new Date('2026-02-12') },
    { id: 'ci-009', campaignId: 'cc-005', userId: 'u-008', status: 'AVAILABLE' as const, discountType: 'FIXED' as const, discountValue: 20, minOrderAmount: 50, expiresAt: new Date('2026-04-01') },
    { id: 'ci-010', campaignId: 'cc-006', userId: 'u-002', status: 'RESERVED' as const, discountType: 'FIXED' as const, discountValue: 15, minOrderAmount: 80, expiresAt: new Date('2026-03-10') },
    { id: 'ci-011', campaignId: 'cc-001', userId: 'u-004', status: 'REVOKED' as const, discountType: 'FIXED' as const, discountValue: 10, minOrderAmount: 0, expiresAt: new Date('2026-03-01') },
    { id: 'ci-012', campaignId: 'cc-003', userId: 'u-007', status: 'AVAILABLE' as const, discountType: 'FIXED' as const, discountValue: 5, minOrderAmount: 20, expiresAt: new Date('2026-03-20') },
  ];
  for (const ci of couponInstances) {
    await prisma.couponInstance.upsert({
      where: { id: ci.id },
      update: {},
      create: ci,
    });
  }

  // 红包使用记录
  const couponUsageRecords = [
    { id: 'cur-001', couponInstanceId: 'ci-001', orderId: 'o-001', discountAmount: 10 },
    { id: 'cur-002', couponInstanceId: 'ci-004', orderId: 'o-002', discountAmount: 12.8 },
    { id: 'cur-003', couponInstanceId: 'ci-007', orderId: 'o-001', discountAmount: 30 },
  ];
  for (const cur of couponUsageRecords) {
    await prisma.couponUsageRecord.upsert({
      where: { id: cur.id },
      update: {},
      create: cur,
    });
  }

  // 红包触发事件日志
  const couponTriggerEvents = [
    { userId: 'u-001', triggerType: 'REGISTER' as const, eventKey: 'REG:u-001', context: { source: 'phone' } },
    { userId: 'u-002', triggerType: 'REGISTER' as const, eventKey: 'REG:u-002', context: { source: 'phone' } },
    { userId: 'u-003', triggerType: 'REGISTER' as const, eventKey: 'REG:u-003', context: { source: 'phone' } },
    { userId: 'u-001', triggerType: 'FIRST_ORDER' as const, eventKey: 'FIRST:u-001', context: { orderId: 'o-001' } },
    { userId: 'u-001', triggerType: 'CHECK_IN' as const, eventKey: 'CHECKIN:u-001:2026-02-01', context: { consecutiveDays: 7 } },
    { userId: 'u-004', triggerType: 'CHECK_IN' as const, eventKey: 'CHECKIN:u-004:2026-03-05', context: { consecutiveDays: 7 } },
    { userId: 'u-008', triggerType: 'CUMULATIVE_SPEND' as const, eventKey: 'SPEND500:u-008', context: { totalSpend: 520 } },
  ];
  for (const cte of couponTriggerEvents) {
    await prisma.couponTriggerEvent.upsert({
      where: { userId_triggerType_eventKey: { userId: cte.userId, triggerType: cte.triggerType, eventKey: cte.eventKey } },
      update: {},
      create: cte,
    });
  }
  console.log(`✅ ${couponCampaigns.length} 个红包活动 + ${couponInstances.length} 个实例 + ${couponUsageRecords.length} 条使用记录 + ${couponTriggerEvents.length} 条触发事件已创建`);

  // ============================================================
  // 审核任务（ReviewTask）
  // ============================================================
  const reviewTasks = [
    { id: 'rt-001', targetType: 'COMPANY' as const, targetId: 'c-001', status: 'APPROVED' as const, reviewerAdminId: superAdmin.id, reason: '资质完整，审核通过' },
    { id: 'rt-002', targetType: 'COMPANY' as const, targetId: 'c-002', status: 'APPROVED' as const, reviewerAdminId: superAdmin.id, reason: '审核通过' },
    { id: 'rt-003', targetType: 'PRODUCT' as const, targetId: 'p-009', status: 'PENDING' as const },
    { id: 'rt-004', targetType: 'PRODUCT' as const, targetId: 'p-014', status: 'REJECTED' as const, reviewerAdminId: adminManager.id, reason: '商品图片不清晰，请重新上传' },
    { id: 'rt-005', targetType: 'DOCUMENT' as const, targetId: 'doc-005', status: 'PENDING' as const },
    { id: 'rt-006', targetType: 'DOCUMENT' as const, targetId: 'doc-007', status: 'REJECTED' as const, reviewerAdminId: superAdmin.id, reason: '证件已过期' },
    { id: 'rt-007', targetType: 'WITHDRAW' as const, targetId: 'wd-demo-001', status: 'PENDING' as const },
    { id: 'rt-008', targetType: 'WITHDRAW' as const, targetId: 'wd-demo-002', status: 'APPROVED' as const, reviewerAdminId: superAdmin.id, reason: '审核通过' },
    { id: 'rt-009', targetType: 'PRODUCT' as const, targetId: 'p-001', status: 'APPROVED' as const, reviewerAdminId: superAdmin.id, reason: '商品信息完整' },
    { id: 'rt-010', targetType: 'TRACE' as const, targetId: 'tb-001', status: 'APPROVED' as const, reviewerAdminId: adminManager.id, reason: '溯源数据真实有效' },
  ];
  for (const rt of reviewTasks) {
    await prisma.reviewTask.upsert({
      where: { id: rt.id },
      update: {},
      create: rt,
    });
  }
  console.log(`✅ ${reviewTasks.length} 个审核任务已创建`);

  // ============================================================
  // 审计日志（AdminAuditLog）
  // ============================================================
  const auditLogs = [
    { adminUserId: superAdmin.id, action: 'LOGIN' as const, module: 'auth', summary: '管理员登录系统', ip: '192.168.1.100' },
    { adminUserId: superAdmin.id, action: 'APPROVE' as const, module: 'companies', targetType: 'Company', targetId: 'c-001', summary: '审核通过企业：澄源生态农业' },
    { adminUserId: superAdmin.id, action: 'APPROVE' as const, module: 'products', targetType: 'Product', targetId: 'p-001', summary: '审核通过商品：高山有机小番茄' },
    { adminUserId: adminManager.id, action: 'LOGIN' as const, module: 'auth', summary: '经理登录系统', ip: '192.168.1.101' },
    { adminUserId: adminManager.id, action: 'UPDATE' as const, module: 'products', targetType: 'Product', targetId: 'p-005', summary: '更新商品价格', before: { basePrice: 120 }, after: { basePrice: 128 } },
    { adminUserId: superAdmin.id, action: 'CONFIG_CHANGE' as const, module: 'config', summary: '更新运费规则配置', before: { DEFAULT_SHIPPING_FEE: 5 }, after: { DEFAULT_SHIPPING_FEE: 8 } },
    { adminUserId: superAdmin.id, action: 'CREATE' as const, module: 'admin_users', targetType: 'AdminUser', targetId: adminManager.id, summary: '创建管理员：张经理' },
    { adminUserId: superAdmin.id, action: 'APPROVE' as const, module: 'bonus', targetType: 'WithdrawRequest', targetId: 'wd-demo-002', summary: '审核通过提现申请' },
    { adminUserId: adminManager.id, action: 'REJECT' as const, module: 'products', targetType: 'Product', targetId: 'p-014', summary: '驳回商品：有机菠菜（图片不清晰）' },
    { adminUserId: superAdmin.id, action: 'STATUS_CHANGE' as const, module: 'users', targetType: 'User', targetId: 'u-005', summary: '封禁用户：王子涛', before: { status: 'ACTIVE' }, after: { status: 'BANNED' } },
  ];
  for (const log of auditLogs) {
    await prisma.adminAuditLog.create({ data: log });
  }
  console.log(`✅ ${auditLogs.length} 条审计日志已创建`);

  // ============================================================
  // 普通用户树节点 + 进度 + 有效消费记录
  // ============================================================
  const normalTreeNodes = [
    { id: 'nt-u002', rootId: 'ROOT', userId: 'u-002', parentId: 'NORMAL_ROOT', level: 1, position: 0, childrenCount: 2 },
    { id: 'nt-u003', rootId: 'ROOT', userId: 'u-003', parentId: 'NORMAL_ROOT', level: 1, position: 1, childrenCount: 1 },
    { id: 'nt-u004', rootId: 'ROOT', userId: 'u-004', parentId: 'NORMAL_ROOT', level: 1, position: 2, childrenCount: 0 },
    { id: 'nt-u007', rootId: 'ROOT', userId: 'u-007', parentId: 'nt-u002', level: 2, position: 0, childrenCount: 0 },
    { id: 'nt-u008', rootId: 'ROOT', userId: 'u-008', parentId: 'nt-u002', level: 2, position: 1, childrenCount: 0 },
    { id: 'nt-u009', rootId: 'ROOT', userId: 'u-009', parentId: 'nt-u003', level: 2, position: 0, childrenCount: 0 },
    { id: 'nt-u010', rootId: 'ROOT', userId: 'u-010', parentId: 'NORMAL_ROOT', level: 1, position: 3 as number, childrenCount: 0 },
  ];

  // 先更新根节点 childrenCount
  await prisma.normalTreeNode.update({ where: { id: 'NORMAL_ROOT' }, data: { childrenCount: 4 } });

  for (const nt of normalTreeNodes) {
    await prisma.normalTreeNode.upsert({
      where: { id: nt.id },
      update: {},
      create: nt,
    });
  }

  // 普通用户进度
  const normalProgresses = [
    { userId: 'u-002', selfPurchaseCount: 3, treeNodeId: 'nt-u002' },
    { userId: 'u-003', selfPurchaseCount: 2, treeNodeId: 'nt-u003' },
    { userId: 'u-004', selfPurchaseCount: 2, treeNodeId: 'nt-u004' },
    { userId: 'u-007', selfPurchaseCount: 1, treeNodeId: 'nt-u007' },
    { userId: 'u-008', selfPurchaseCount: 1, treeNodeId: 'nt-u008' },
    { userId: 'u-009', selfPurchaseCount: 1, treeNodeId: 'nt-u009' },
    { userId: 'u-010', selfPurchaseCount: 1, treeNodeId: 'nt-u010' },
  ];
  for (const np of normalProgresses) {
    await prisma.normalProgress.upsert({
      where: { userId: np.userId },
      update: {},
      create: np,
    });
  }

  // 普通用户有效消费记录
  const normalEligibleOrders = [
    { userId: 'u-004', orderId: 'o-008', amount: 128, effectiveIndex: 1 },
    { userId: 'u-004', orderId: 'o-009', amount: 55.5, effectiveIndex: 2 },
    { userId: 'u-007', orderId: 'o-011', amount: 352, effectiveIndex: 1 },
    { userId: 'u-008', orderId: 'o-012', amount: 176, effectiveIndex: 1 },
    { userId: 'u-009', orderId: 'o-013', amount: 336, effectiveIndex: 1 },
    { userId: 'u-010', orderId: 'o-014', amount: 127.6, effectiveIndex: 1 },
  ];
  for (const neo of normalEligibleOrders) {
    await prisma.normalEligibleOrder.upsert({
      where: { orderId: neo.orderId },
      update: {},
      create: neo,
    });
  }

  // 会员资料补充
  for (const uid of ['u-003', 'u-004', 'u-007', 'u-008', 'u-009', 'u-010']) {
    await prisma.memberProfile.upsert({
      where: { userId: uid },
      update: { normalEligible: true, normalTreeNodeId: normalTreeNodes.find(n => n.userId === uid)?.id },
      create: {
        userId: uid,
        tier: 'NORMAL',
        normalEligible: true,
        normalTreeNodeId: normalTreeNodes.find(n => n.userId === uid)?.id,
        normalJoinedAt: new Date('2026-02-01'),
      },
    });
  }

  // 新用户普通奖励账户
  for (const uid of ['u-003', 'u-004', 'u-007', 'u-008', 'u-009', 'u-010']) {
    await prisma.rewardAccount.upsert({
      where: { userId_type: { userId: uid, type: 'NORMAL_REWARD' } },
      update: {},
      create: { userId: uid, type: 'NORMAL_REWARD', balance: Math.random() * 30, frozen: 0 },
    });
  }
  console.log(`✅ 普通用户树（${normalTreeNodes.length} 节点）+ 进度 + 有效消费记录已创建`);

  // ============================================================
  // VIP 购买记录（VipPurchase）
  // ============================================================
  const vipPurchases = [
    { userId: 'u-001', amount: 399, status: 'PAID' as const },
    { userId: 'u-006', amount: 399, status: 'PAID' as const },
    { userId: 'u-101', amount: 399, status: 'PAID' as const },
    { userId: 'u-102', amount: 399, status: 'PAID' as const },
    { userId: 'u-103', amount: 399, status: 'REFUNDED' as const },
    { userId: 'u-104', amount: 399, status: 'PAID' as const },
    { userId: 'u-105', amount: 399, status: 'PAID' as const },
    { userId: 'u-106', amount: 399, status: 'PAID' as const },
    { userId: 'u-107', amount: 399, status: 'PAID' as const },
    { userId: 'u-108', amount: 399, status: 'PAID' as const },
    { userId: 'u-109', amount: 399, status: 'PAID' as const },
  ];
  for (const vp of vipPurchases) {
    const existing = await prisma.vipPurchase.findFirst({ where: { userId: vp.userId } });
    if (!existing) {
      await prisma.vipPurchase.create({ data: vp });
    }
  }
  console.log(`✅ ${vipPurchases.length} 条 VIP 购买记录已创建`);

  // ============================================================
  // 更多提现申请
  // ============================================================
  const moreWithdraws = [
    { id: 'wd-demo-003', userId: 'u-101', amount: 20, channel: 'WECHAT' as const, status: 'PAID' as const, accountSnapshot: { name: '陈**', account: '****8101' }, accountType: 'VIP_REWARD' },
    { id: 'wd-demo-004', userId: 'u-104', amount: 15, channel: 'ALIPAY' as const, status: 'REJECTED' as const, accountSnapshot: { name: '孙**', account: '****8104' }, accountType: 'VIP_REWARD' },
    { id: 'wd-demo-005', userId: 'u-007', amount: 8, channel: 'BANKCARD' as const, status: 'REQUESTED' as const, accountSnapshot: { name: '赵**', account: '****8007' }, accountType: 'NORMAL_REWARD' },
  ];
  for (const wd of moreWithdraws) {
    await prisma.withdrawRequest.upsert({
      where: { id: wd.id },
      update: {},
      create: wd,
    });
  }
  console.log(`✅ ${moreWithdraws.length} 条新提现申请已创建`);

  // ============================================================
  // 更多消息（给不同用户）
  // ============================================================
  const moreMessages = [
    { id: 'msg-006', userId: 'u-002', category: 'system', type: 'order', title: '订单取消成功', content: '您的订单 o-005 已取消', unread: false, target: { route: '/orders/o-005' } },
    { id: 'msg-007', userId: 'u-003', category: 'system', type: 'order', title: '订单已发货', content: '您的订单 o-007 已发货，中通快递 ZTO9876543210', unread: true, target: { route: '/orders/o-007' } },
    { id: 'msg-008', userId: 'u-004', category: 'system', type: 'order', title: '订单已签收', content: '您的订单 o-008 已签收，请确认收货', unread: true, target: { route: '/orders/o-008' } },
    { id: 'msg-009', userId: 'u-001', category: 'system', type: 'coupon', title: '您收到一张新红包', content: '签到满7天，获得5元红包！', unread: true, target: { route: '/me/coupons' } },
    { id: 'msg-010', userId: 'u-008', category: 'system', type: 'reward', title: '分润奖励到账', content: '您收到一笔普通分润奖励 ¥12.50', unread: true, target: { route: '/me/rewards' } },
    { id: 'msg-011', userId: 'u-007', category: 'system', type: 'lottery', title: '恭喜中奖', content: '您在今日抽奖中获得"满50送胡萝卜"', unread: false, target: { route: '/lottery' } },
    { id: 'msg-012', userId: 'u-004', category: 'interaction', type: 'comment', title: '新的评价回复', content: '卖家回复了您对"有机绿茶礼盒"的评价', unread: true, target: { route: '/product/p-005' } },
    { id: 'msg-013', userId: 'u-002', category: 'system', type: 'replacement', title: '换货申请已通过', content: '您的换货申请已通过，卖家将重新发货', unread: true, target: { route: '/orders/o-010' } },
  ];
  for (const m of moreMessages) {
    await prisma.inboxMessage.upsert({ where: { id: m.id }, update: {}, create: m });
  }
  console.log(`✅ ${moreMessages.length} 条新消息已创建`);

  // ============================================================
  // 更多签到记录（不同用户）
  // ============================================================
  for (const uid of ['u-002', 'u-003', 'u-004']) {
    for (let d = 1; d <= 5; d++) {
      const date = formatDate(addDays(today, -d));
      await prisma.checkIn.upsert({
        where: { userId_date: { userId: uid, date } },
        update: {},
        create: { userId: uid, date },
      });
    }
  }
  console.log('✅ 更多签到记录已创建（u-002/u-003/u-004 各5天）');

  // ============================================================
  // 更多关注关系
  // ============================================================
  const moreFollows = [
    { id: 'f-004', followerId: 'u-002', followedId: 'c-001', followedType: 'COMPANY' as const },
    { id: 'f-005', followerId: 'u-003', followedId: 'c-004', followedType: 'COMPANY' as const },
    { id: 'f-006', followerId: 'u-003', followedId: 'u-001', followedType: 'USER' as const },
    { id: 'f-007', followerId: 'u-004', followedId: 'c-001', followedType: 'COMPANY' as const },
    { id: 'f-008', followerId: 'u-004', followedId: 'c-003', followedType: 'COMPANY' as const },
    { id: 'f-009', followerId: 'u-007', followedId: 'u-002', followedType: 'USER' as const },
    { id: 'f-010', followerId: 'u-008', followedId: 'c-004', followedType: 'COMPANY' as const },
  ];
  for (const f of moreFollows) {
    await prisma.follow.upsert({ where: { id: f.id }, update: {}, create: f });
  }
  console.log(`✅ ${moreFollows.length} 条新关注关系已创建`);

  // ============================================================
  // 更多预约记录
  // ============================================================
  const moreBookings = [
    { id: 'b-006', userId: 'u-003', companyId: 'c-001', activityId: 'e-001', date: '2025-04-01', headcount: 10, identity: 'buyer', note: '团队采购考察', contactName: '张明', contactPhone: '13800138003', status: 'PENDING' as const },
    { id: 'b-007', userId: 'u-004', companyId: 'c-004', activityId: 'e-005', date: '2025-04-05', headcount: 3, identity: 'consumer', note: '家庭出游', contactName: '李婉清', contactPhone: '13800138004', status: 'APPROVED' as const, reviewedAt: new Date('2025-03-10') },
    { id: 'b-008', userId: 'u-007', companyId: 'c-003', activityId: 'e-004', date: '2025-04-10', headcount: 5, identity: 'investor', note: '投资考察', contactName: '赵美琪', contactPhone: '13800138007', status: 'PENDING' as const },
  ];
  for (const b of moreBookings) {
    await prisma.booking.upsert({ where: { id: b.id }, update: {}, create: b });
  }
  console.log(`✅ ${moreBookings.length} 条新预约已创建`);

  // ============================================================
  // P3 测试数据：新企业（含结构化地址 + AI 搜索资料）
  // ============================================================
  // 先创建 L1 父分类，再创建 L2 子分类（避免外键约束）
  const newCategoriesL1 = [
    { id: 'cat-seafood', name: '水产', path: '/水产', level: 1, parentId: null, sortOrder: 7 },
    { id: 'cat-dairy', name: '乳制品', path: '/乳制品', level: 1, parentId: null, sortOrder: 8 },
    { id: 'cat-meat', name: '肉禽', path: '/肉禽', level: 1, parentId: null, sortOrder: 9 },
  ];
  for (const cat of newCategoriesL1) {
    const existing = await prisma.category.findFirst({ where: { path: cat.path } });
    if (!existing) {
      await prisma.category.create({ data: cat });
    }
  }
  // 查找实际父分类 ID（可能是之前自动生成的 CUID）
  const seafoodParent = await prisma.category.findFirst({ where: { path: '/水产' } });
  const meatParent = await prisma.category.findFirst({ where: { path: '/肉禽' } });
  const newCategoriesL2 = [
    { id: 'cat-seafood-fish', name: '鱼类', path: '/水产/鱼类', level: 2, parentId: seafoodParent?.id ?? 'cat-seafood', sortOrder: 1 },
    { id: 'cat-seafood-shrimp', name: '虾蟹', path: '/水产/虾蟹', level: 2, parentId: seafoodParent?.id ?? 'cat-seafood', sortOrder: 2 },
    { id: 'cat-meat-poultry', name: '家禽', path: '/肉禽/家禽', level: 2, parentId: meatParent?.id ?? 'cat-meat', sortOrder: 1 },
  ];
  for (const cat of newCategoriesL2) {
    const existing = await prisma.category.findFirst({ where: { path: cat.path } });
    if (!existing) {
      await prisma.category.create({ data: cat });
    }
  }
  console.log(`✅ ${newCategoriesL1.length + newCategoriesL2.length} 个新分类已创建（水产/乳制品/肉禽）`);

  // 查找实际分类 ID（用于后续商品创建）
  const actualSeafoodId = seafoodParent?.id ?? (await prisma.category.findFirst({ where: { path: '/水产' } }))?.id ?? 'cat-seafood';
  const actualShrimpId = (await prisma.category.findFirst({ where: { path: '/水产/虾蟹' } }))?.id ?? 'cat-seafood-shrimp';

  // -- 新企业数据 --
  const newCompanies = [
    {
      id: 'c-005',
      name: '武汉鲜果合作社',
      shortName: '武汉鲜果',
      description: '湖北省优质水果种植合作社，主营蓝莓、草莓、柑橘等应季水果，拥有600亩有机种植基地，通过有机认证和绿色食品认证。',
      status: 'ACTIVE' as const,
      address: { province: '湖北省', city: '武汉市', district: '武昌区', postalCode: '430000', detail: '东湖路88号农贸大厦', text: '湖北省武汉市武昌区东湖路88号农贸大厦', lat: 30.566, lng: 114.341 },
      contact: { name: '刘鲜果', phone: '13800005001' },
      servicePhone: '13800005001',
      highlights: {
        cover: 'https://placehold.co/800x480/2E7D32/FFFFFF/png?text=武汉鲜果',
        companyType: 'cooperative',
        industryTags: ['水果'],
        productKeywords: ['蓝莓', '草莓', '柑橘'],
        productFeatures: ['有机', '可溯源'],
        certifications: ['有机认证', '绿色食品'],
        mainBusiness: '水果、蓝莓、草莓、柑橘',
        badges: ['有机', '可溯源', '有机认证', '绿色食品'],
        latestTestedAt: '2025-02-15',
        groupTargetSize: 25,
      },
    },
    {
      id: 'c-006',
      name: '东北黑土粮仓食品有限公司',
      shortName: '黑土粮仓',
      description: '坐落于黑龙江五常市核心产区，专注优质大米、杂粮种植加工。年产有机五常大米300吨，通过地理标志和有机认证双认证。',
      status: 'ACTIVE' as const,
      address: { province: '黑龙江省', city: '哈尔滨市', district: '五常市', postalCode: '150200', detail: '稻香路16号粮仓产业园', text: '黑龙江省哈尔滨市五常市稻香路16号粮仓产业园', lat: 44.93, lng: 127.17 },
      contact: { name: '赵粮仓', phone: '13800005002' },
      servicePhone: '13800005002',
      highlights: {
        cover: 'https://placehold.co/800x480/8D6E63/FFFFFF/png?text=黑土粮仓',
        companyType: 'company',
        industryTags: ['粮油'],
        productKeywords: ['五常大米', '有机大米', '杂粮', '黑米'],
        productFeatures: ['有机', '可溯源'],
        certifications: ['有机认证', '地理标志'],
        mainBusiness: '粮油、五常大米、有机大米、杂粮、黑米',
        badges: ['有机', '可溯源', '有机认证', '地理标志'],
        latestTestedAt: '2025-01-20',
        groupTargetSize: 40,
      },
    },
    {
      id: 'c-007',
      name: '闽南百花蜂蜜基地',
      shortName: '百花蜂蜜',
      description: '福建泉州百年养蜂世家，自有蜂场2000箱，主产荔枝蜜、龙眼蜜、百花蜜。全程可溯源，通过有机认证。',
      status: 'ACTIVE' as const,
      address: { province: '福建省', city: '泉州市', district: '南安市', postalCode: '362300', detail: '梅山镇蜂蜜产业园', text: '福建省泉州市南安市梅山镇蜂蜜产业园', lat: 24.96, lng: 118.39 },
      contact: { name: '陈百花', phone: '13800005003' },
      servicePhone: '13800005003',
      highlights: {
        cover: 'https://placehold.co/800x480/FFA000/FFFFFF/png?text=百花蜂蜜',
        companyType: 'base',
        industryTags: ['蜂蜜'],
        productKeywords: ['荔枝蜜', '龙眼蜜', '百花蜜', '蜂王浆'],
        productFeatures: ['有机', '可溯源'],
        certifications: ['有机认证'],
        mainBusiness: '蜂蜜、荔枝蜜、龙眼蜜、百花蜜、蜂王浆',
        badges: ['有机', '可溯源', '有机认证'],
        latestTestedAt: '2025-03-01',
        groupTargetSize: 20,
      },
    },
    {
      id: 'c-008',
      name: '青岛海鲜工厂直供',
      shortName: '青岛海鲜',
      description: '青岛崂山湾自有海鲜加工厂，日处理鲜活海产品5吨。主营大虾、海参、鲍鱼、扇贝，全程冷链运输，品质保证。',
      status: 'ACTIVE' as const,
      address: { province: '山东省', city: '青岛市', district: '崂山区', postalCode: '266100', detail: '沙子口海鲜加工区A栋', text: '山东省青岛市崂山区沙子口海鲜加工区A栋', lat: 36.10, lng: 120.47 },
      contact: { name: '孙海鲜', phone: '13800005004' },
      servicePhone: '13800005004',
      highlights: {
        cover: 'https://placehold.co/800x480/0277BD/FFFFFF/png?text=青岛海鲜',
        companyType: 'factory',
        industryTags: ['水产'],
        productKeywords: ['大虾', '海参', '鲍鱼', '扇贝'],
        productFeatures: ['冷链', '可溯源'],
        certifications: [],
        mainBusiness: '水产、大虾、海参、鲍鱼、扇贝',
        badges: ['冷链', '可溯源'],
        latestTestedAt: '2025-02-28',
        groupTargetSize: 30,
      },
    },
    {
      id: 'c-009',
      name: '草原牧歌乳业有限公司',
      shortName: '草原牧歌',
      description: '内蒙古锡林郭勒大草原天然牧场，自有奶牛3000头，日产鲜奶15吨。主营鲜牛奶、酸奶、奶酪，通过绿色食品认证。',
      status: 'PENDING' as const, // 未审核通过
      address: { province: '内蒙古自治区', city: '呼和浩特市', district: '赛罕区', postalCode: '010020', detail: '如意开发区乳业路1号', text: '内蒙古自治区呼和浩特市赛罕区如意开发区乳业路1号', lat: 40.84, lng: 111.75 },
      contact: { name: '巴特尔', phone: '13800005005' },
      servicePhone: '13800005005',
      highlights: {
        cover: 'https://placehold.co/800x480/4CAF50/FFFFFF/png?text=草原牧歌',
        companyType: 'company',
        industryTags: ['乳制品'],
        productKeywords: ['鲜牛奶', '酸奶', '奶酪', '牦牛奶'],
        productFeatures: ['有机', '冷链'],
        certifications: ['绿色食品'],
        mainBusiness: '乳制品、鲜牛奶、酸奶、奶酪、牦牛奶',
        badges: ['有机', '冷链', '绿色食品'],
        latestTestedAt: '2025-01-10',
        groupTargetSize: 50,
      },
    },
    {
      id: 'c-010',
      name: '茗山有机茶庄',
      shortName: '茗山茶庄',
      description: '浙江杭州西湖龙井核心产区，自有茶园200亩，世代制茶工艺。主营龙井、碧螺春、安吉白茶，通过有机认证和地理标志双认证。',
      status: 'ACTIVE' as const,
      address: { province: '浙江省', city: '杭州市', district: '西湖区', postalCode: '310000', detail: '龙井路168号茗山茶庄', text: '浙江省杭州市西湖区龙井路168号茗山茶庄', lat: 30.23, lng: 120.12 },
      contact: { name: '周茗山', phone: '13800005006' },
      servicePhone: '13800005006',
      highlights: {
        cover: 'https://placehold.co/800x480/33691E/FFFFFF/png?text=茗山茶庄',
        companyType: 'store',
        industryTags: ['茶叶'],
        productKeywords: ['龙井', '碧螺春', '安吉白茶', '西湖龙井'],
        productFeatures: ['有机', '可溯源'],
        certifications: ['有机认证', '地理标志'],
        mainBusiness: '茶叶、龙井、碧螺春、安吉白茶、西湖龙井',
        badges: ['有机', '可溯源', '有机认证', '地理标志'],
        latestTestedAt: '2025-03-05',
        groupTargetSize: 15,
      },
    },
  ];

  for (const c of newCompanies) {
    const { highlights, contact, ...companyData } = c;
    await prisma.company.upsert({
      where: { id: c.id },
      update: {},
      create: {
        ...companyData,
        contact,
        profile: {
          create: { highlights },
        },
      },
    });
  }
  console.log(`✅ ${newCompanies.length} 个新企业已创建（含结构化地址 + AI 搜索资料）`);

  // -- 新企业创始人用户 + OWNER 绑定 --
  const newOwners = [
    { staffId: 'cs-011', userId: 'u-seller-005', companyId: 'c-005', phone: '13800005001', nickname: '刘鲜果' },
    { staffId: 'cs-012', userId: 'u-seller-006', companyId: 'c-006', phone: '13800005002', nickname: '赵粮仓' },
    { staffId: 'cs-013', userId: 'u-seller-007', companyId: 'c-007', phone: '13800005003', nickname: '陈百花' },
    { staffId: 'cs-014', userId: 'u-seller-008', companyId: 'c-008', phone: '13800005004', nickname: '孙海鲜' },
    { staffId: 'cs-015', userId: 'u-seller-009', companyId: 'c-009', phone: '13800005005', nickname: '巴特尔' },
    { staffId: 'cs-016', userId: 'u-seller-010', companyId: 'c-010', phone: '13800005006', nickname: '周茗山' },
  ];

  for (const owner of newOwners) {
    await prisma.user.upsert({
      where: { id: owner.userId },
      update: {},
      create: {
        id: owner.userId,
        status: 'ACTIVE',
        profile: {
          create: {
            nickname: owner.nickname,
            avatarUrl: 'https://placehold.co/200x200/png',
            level: '新芽会员',
          },
        },
        authIdentities: {
          create: {
            provider: 'PHONE',
            identifier: owner.phone,
            verified: true,
            meta: { passwordHash: await bcrypt.hash('123456', 10) },
          },
        },
      },
    });
    await prisma.companyStaff.upsert({
      where: { userId_companyId: { userId: owner.userId, companyId: owner.companyId } },
      update: {},
      create: {
        id: owner.staffId,
        userId: owner.userId,
        companyId: owner.companyId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
  }
  console.log(`✅ ${newOwners.length} 个新企业创始人已创建`);

  // -- 为部分新企业添加 MANAGER --
  const newManagers = [
    { staffId: 'cs-017', userId: 'u-seller-011', companyId: 'c-005', phone: '13800005101', nickname: '王经理', invitedBy: 'u-seller-005' },
    { staffId: 'cs-018', userId: 'u-seller-012', companyId: 'c-008', phone: '13800005102', nickname: '李厂长', invitedBy: 'u-seller-008' },
  ];
  for (const mgr of newManagers) {
    await prisma.user.upsert({
      where: { id: mgr.userId },
      update: {},
      create: {
        id: mgr.userId,
        status: 'ACTIVE',
        profile: { create: { nickname: mgr.nickname, avatarUrl: 'https://placehold.co/200x200/png', level: '新芽会员' } },
        authIdentities: { create: { provider: 'PHONE', identifier: mgr.phone, verified: true, meta: { passwordHash: await bcrypt.hash('123456', 10) } } },
      },
    });
    await prisma.companyStaff.upsert({
      where: { userId_companyId: { userId: mgr.userId, companyId: mgr.companyId } },
      update: {},
      create: { id: mgr.staffId, userId: mgr.userId, companyId: mgr.companyId, role: 'MANAGER', status: 'ACTIVE', invitedBy: mgr.invitedBy },
    });
  }
  console.log(`✅ ${newManagers.length} 个新企业经理已创建`);

  // -- 新企业商品图片映射（Pexels 免费真实商品图片） --
  const productImages: Record<string, string> = {
    'p-015': 'https://images.pexels.com/photos/1395958/pexels-photo-1395958.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-016': 'https://images.pexels.com/photos/298696/pexels-photo-298696.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-017': 'https://images.pexels.com/photos/2247142/pexels-photo-2247142.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-018': 'https://images.pexels.com/photos/4110251/pexels-photo-4110251.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-019': 'https://images.pexels.com/photos/6732732/pexels-photo-6732732.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-020': 'https://images.pexels.com/photos/7421117/pexels-photo-7421117.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-021': 'https://images.pexels.com/photos/4480158/pexels-photo-4480158.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-022': 'https://images.pexels.com/photos/5634206/pexels-photo-5634206.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-023': 'https://images.pexels.com/photos/7473575/pexels-photo-7473575.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-024': 'https://images.pexels.com/photos/3649208/pexels-photo-3649208.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-025': 'https://images.pexels.com/photos/8824656/pexels-photo-8824656.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-026': 'https://images.pexels.com/photos/32863869/pexels-photo-32863869.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-027': 'https://images.pexels.com/photos/236010/pexels-photo-236010.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-028': 'https://images.pexels.com/photos/8892364/pexels-photo-8892364.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-029': 'https://images.pexels.com/photos/6660053/pexels-photo-6660053.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-030': 'https://images.pexels.com/photos/5975975/pexels-photo-5975975.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-031': 'https://images.pexels.com/photos/32908162/pexels-photo-32908162.jpeg?auto=compress&cs=tinysrgb&w=600',
    'p-032': 'https://images.pexels.com/photos/8474179/pexels-photo-8474179.jpeg?auto=compress&cs=tinysrgb&w=600',
  };

  // -- 新企业商品 --
  const newCompanyProducts = [
    // c-005 武汉鲜果合作社（水果）
    { id: 'p-015', companyId: 'c-005', title: '有机蓝莓鲜果', basePrice: 68, cost: 32, categoryId: 'cat-fruit-berry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '湖北·武汉' }, tags: ['有机认证'], skus: [
      { id: 'sku-p-015', title: '250g精品装', price: 68, cost: 32, stock: 120 },
      { id: 'sku-p-015-b', title: '500g家庭装', price: 118, cost: 58, stock: 80 },
    ]},
    { id: 'p-016', companyId: 'c-005', title: '红颜草莓', basePrice: 45, cost: 20, categoryId: 'cat-fruit-berry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '湖北·武汉' }, tags: ['当季鲜采'], skus: [
      { id: 'sku-p-016', title: '1斤装', price: 45, cost: 20, stock: 200 },
    ]},
    { id: 'p-017', companyId: 'c-005', title: '赣南脐橙', basePrice: 35, cost: 16, categoryId: 'cat-fruit-citrus', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '江西·赣州' }, tags: ['地理标志'], skus: [
      { id: 'sku-p-017', title: '5斤装', price: 35, cost: 16, stock: 300 },
      { id: 'sku-p-017-b', title: '10斤装', price: 58, cost: 28, stock: 150 },
    ]},

    // c-006 东北黑土粮仓（粮油）
    { id: 'p-018', companyId: 'c-006', title: '有机五常稻花香大米', basePrice: 89, cost: 40, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·五常' }, tags: ['有机认证', '地理标志'], skus: [
      { id: 'sku-p-018-s', title: '5kg装', price: 89, cost: 40, stock: 500 },
      { id: 'sku-p-018-l', title: '10kg装', price: 158, cost: 72, stock: 200 },
    ]},
    { id: 'p-019', companyId: 'c-006', title: '东北黑米', basePrice: 28, cost: 12, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·哈尔滨' }, tags: ['可信溯源'], skus: [
      { id: 'sku-p-019', title: '1kg装', price: 28, cost: 12, stock: 300 },
    ]},
    { id: 'p-020', companyId: 'c-006', title: '有机杂粮礼盒', basePrice: 168, cost: 75, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·五常' }, tags: ['有机认证'], skus: [
      { id: 'sku-p-020', title: '精选8种杂粮', price: 168, cost: 75, stock: 100 },
    ]},

    // c-007 闽南百花蜂蜜基地（蜂蜜）
    { id: 'p-021', companyId: 'c-007', title: '荔枝蜜', basePrice: 78, cost: 35, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·泉州' }, tags: ['有机认证'], skus: [
      { id: 'sku-p-021', title: '500g装', price: 78, cost: 35, stock: 150 },
    ]},
    { id: 'p-022', companyId: 'c-007', title: '龙眼蜜', basePrice: 88, cost: 40, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·泉州' }, tags: ['有机认证', '可信溯源'], skus: [
      { id: 'sku-p-022', title: '500g装', price: 88, cost: 40, stock: 120 },
    ]},
    { id: 'p-023', companyId: 'c-007', title: '蜂王浆', basePrice: 198, cost: 90, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·泉州' }, tags: ['有机认证'], skus: [
      { id: 'sku-p-023', title: '250g瓶装', price: 198, cost: 90, stock: 50 },
    ]},

    // c-008 青岛海鲜工厂（水产）
    { id: 'p-024', companyId: 'c-008', title: '鲜活大虾', basePrice: 128, cost: 60, categoryId: actualShrimpId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·青岛' }, tags: ['检测报告'], skus: [
      { id: 'sku-p-024', title: '1kg装', price: 128, cost: 60, stock: 80 },
      { id: 'sku-p-024-b', title: '2kg装', price: 238, cost: 112, stock: 40 },
    ]},
    { id: 'p-025', companyId: 'c-008', title: '即食海参', basePrice: 388, cost: 180, categoryId: actualSeafoodId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·青岛' }, tags: ['检测报告'], skus: [
      { id: 'sku-p-025', title: '500g装（10头）', price: 388, cost: 180, stock: 30 },
    ]},
    { id: 'p-026', companyId: 'c-008', title: '冷冻扇贝肉', basePrice: 58, cost: 26, categoryId: actualSeafoodId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·青岛' }, tags: [], skus: [
      { id: 'sku-p-026', title: '500g装', price: 58, cost: 26, stock: 200 },
    ]},

    // c-009 草原牧歌乳业（乳制品） — PENDING 状态公司
    { id: 'p-027', companyId: 'c-009', title: '鲜牛奶', basePrice: 15, cost: 7, categoryId: 'cat-dairy', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·呼和浩特' }, tags: [], skus: [
      { id: 'sku-p-027', title: '1L装', price: 15, cost: 7, stock: 500 },
    ]},
    { id: 'p-028', companyId: 'c-009', title: '草原酸奶', basePrice: 25, cost: 11, categoryId: 'cat-dairy', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·呼和浩特' }, tags: [], skus: [
      { id: 'sku-p-028', title: '6杯装', price: 25, cost: 11, stock: 300 },
    ]},
    { id: 'p-029', companyId: 'c-009', title: '手工奶酪', basePrice: 68, cost: 30, categoryId: 'cat-dairy', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·锡林郭勒' }, tags: [], skus: [
      { id: 'sku-p-029', title: '200g装', price: 68, cost: 30, stock: 80 },
    ]},

    // c-010 茗山有机茶庄（茶叶）
    { id: 'p-030', companyId: 'c-010', title: '明前西湖龙井', basePrice: 358, cost: 160, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '浙江·杭州' }, tags: ['有机认证', '地理标志'], skus: [
      { id: 'sku-p-030-s', title: '50g品鉴装', price: 98, cost: 42, stock: 200 },
      { id: 'sku-p-030-m', title: '125g罐装', price: 228, cost: 100, stock: 100 },
      { id: 'sku-p-030-l', title: '250g礼盒装', price: 358, cost: 160, stock: 50 },
    ]},
    { id: 'p-031', companyId: 'c-010', title: '安吉白茶', basePrice: 198, cost: 88, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '浙江·安吉' }, tags: ['有机认证'], skus: [
      { id: 'sku-p-031', title: '100g装', price: 198, cost: 88, stock: 80 },
    ]},
    { id: 'p-032', companyId: 'c-010', title: '碧螺春', basePrice: 268, cost: 120, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '江苏·苏州' }, tags: ['地理标志'], skus: [
      { id: 'sku-p-032', title: '125g罐装', price: 268, cost: 120, stock: 60 },
    ]},
  ];

  for (const p of newCompanyProducts) {
    const { skus, tags, ...productData } = p;
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        ...productData,
        skus: {
          create: skus.map((s) => ({
            id: s.id,
            title: s.title,
            price: s.price,
            cost: s.cost,
            stock: s.stock,
            status: 'ACTIVE' as const,
          })),
        },
        media: {
          create: { type: 'IMAGE' as const, url: productImages[p.id] || 'https://placehold.co/600x600/png', sortOrder: 0 },
        },
      },
    });
    // 如果商品已存在，更新其图片
    if (productImages[p.id]) {
      await prisma.productMedia.updateMany({
        where: { productId: p.id },
        data: { url: productImages[p.id] },
      });
    }
    for (const tagName of tags) {
      const tag = await prisma.tag.findUnique({ where: { name: tagName } });
      if (tag) {
        await prisma.productTag.upsert({
          where: { productId_tagId: { productId: p.id, tagId: tag.id } },
          update: {},
          create: { productId: p.id, tagId: tag.id },
        });
      }
    }
  }
  console.log(`✅ ${newCompanyProducts.length} 个新商品已创建（6 家新企业，覆盖水果/粮油/蜂蜜/水产/乳制品/茶叶）`);

  // -- 为所有非平台公司各补充 5 个商品（覆盖更多分类） --
  const actualSeafoodCatId = (await prisma.category.findFirst({ where: { path: '/水产' } }))?.id ?? 'cat-seafood';
  const actualShrimpCatId = (await prisma.category.findFirst({ where: { path: '/水产/虾蟹' } }))?.id ?? 'cat-seafood-shrimp';
  const actualFishCatId = (await prisma.category.findFirst({ where: { path: '/水产/鱼类' } }))?.id ?? 'cat-seafood-fish';

  const extraProducts = [
    // c-001 澄源生态农业
    { id: 'p-033', companyId: 'c-001', title: '有机番茄', basePrice: 18, cost: 8, categoryId: 'cat-veg', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '浙江·杭州' }, tags: ['有机认证'], image: 'https://images.pexels.com/photos/1327838/pexels-photo-1327838.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-033', title: '2斤装', price: 18, cost: 8, stock: 300 },
    ]},
    { id: 'p-034', companyId: 'c-001', title: '紫薯', basePrice: 15, cost: 6, categoryId: 'cat-veg-root', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '浙江·杭州' }, tags: [], image: 'https://images.pexels.com/photos/9956725/pexels-photo-9956725.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-034', title: '3斤装', price: 15, cost: 6, stock: 250 },
    ]},
    { id: 'p-035', companyId: 'c-001', title: '土蜂蜜', basePrice: 98, cost: 45, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '浙江·临安' }, tags: ['可信溯源'], image: 'https://images.pexels.com/photos/5634206/pexels-photo-5634206.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-035', title: '500g装', price: 98, cost: 45, stock: 100 },
    ]},
    { id: 'p-036', companyId: 'c-001', title: '散养柴鸡', basePrice: 88, cost: 40, categoryId: 'cat-meat-poultry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '浙江·杭州' }, tags: ['可信溯源'], image: 'https://images.pexels.com/photos/13422436/pexels-photo-13422436.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-036', title: '整只约3斤', price: 88, cost: 40, stock: 60 },
    ]},
    { id: 'p-037', companyId: 'c-001', title: '有机糙米', basePrice: 32, cost: 14, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '浙江·杭州' }, tags: ['有机认证'], image: 'https://images.pexels.com/photos/6103071/pexels-photo-6103071.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-037', title: '2.5kg装', price: 32, cost: 14, stock: 200 },
    ]},

    // c-002 青禾智慧农场
    { id: 'p-038', companyId: 'c-002', title: '水培生菜', basePrice: 12, cost: 5, categoryId: 'cat-veg-leaf', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '四川·成都' }, tags: [], image: 'https://images.pexels.com/photos/4199758/pexels-photo-4199758.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-038', title: '200g/盒', price: 12, cost: 5, stock: 500 },
    ]},
    { id: 'p-039', companyId: 'c-002', title: '有机胡萝卜', basePrice: 10, cost: 4, categoryId: 'cat-veg-root', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '四川·成都' }, tags: ['有机认证'], image: 'https://images.pexels.com/photos/73640/pexels-photo-73640.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-039', title: '1斤装', price: 10, cost: 4, stock: 400 },
    ]},
    { id: 'p-040', companyId: 'c-002', title: '圣女果', basePrice: 22, cost: 10, categoryId: 'cat-veg', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '四川·攀枝花' }, tags: ['当季鲜采'], image: 'https://images.pexels.com/photos/2817549/pexels-photo-2817549.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-040', title: '1斤装', price: 22, cost: 10, stock: 350 },
    ]},
    { id: 'p-041', companyId: 'c-002', title: '鲜糯玉米', basePrice: 25, cost: 10, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '四川·雅安' }, tags: [], image: 'https://images.pexels.com/photos/1353865/pexels-photo-1353865.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-041', title: '6根装', price: 25, cost: 10, stock: 200 },
    ]},
    { id: 'p-042', companyId: 'c-002', title: '新鲜鹌鹑蛋', basePrice: 18, cost: 8, categoryId: 'cat-egg', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '四川·雅安' }, tags: ['可信溯源'], image: 'https://images.pexels.com/photos/4110228/pexels-photo-4110228.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-042', title: '30枚装', price: 18, cost: 8, stock: 300 },
    ]},

    // c-003 北纬蓝莓实验田
    { id: 'p-043', companyId: 'c-003', title: '蓝莓果酱', basePrice: 48, cost: 20, categoryId: 'cat-fruit-berry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '辽宁·丹东' }, tags: [], image: 'https://images.pexels.com/photos/5720778/pexels-photo-5720778.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-043', title: '280g瓶装', price: 48, cost: 20, stock: 150 },
    ]},
    { id: 'p-044', companyId: 'c-003', title: '蓝莓干', basePrice: 58, cost: 25, categoryId: 'cat-fruit-berry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '辽宁·丹东' }, tags: [], image: 'https://images.pexels.com/photos/2539170/pexels-photo-2539170.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-044', title: '200g袋装', price: 58, cost: 25, stock: 200 },
    ]},
    { id: 'p-045', companyId: 'c-003', title: '新鲜树莓', basePrice: 78, cost: 35, categoryId: 'cat-fruit-berry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '辽宁·丹东' }, tags: ['当季鲜采'], image: 'https://images.pexels.com/photos/918328/pexels-photo-918328.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-045', title: '250g精品盒', price: 78, cost: 35, stock: 80 },
    ]},
    { id: 'p-046', companyId: 'c-003', title: '蔓越莓干', basePrice: 42, cost: 18, categoryId: 'cat-fruit-berry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '辽宁·丹东' }, tags: [], image: 'https://images.pexels.com/photos/10804065/pexels-photo-10804065.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-046', title: '200g袋装', price: 42, cost: 18, stock: 250 },
    ]},
    { id: 'p-047', companyId: 'c-003', title: '新鲜黑莓', basePrice: 88, cost: 40, categoryId: 'cat-fruit-berry', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '辽宁·丹东' }, tags: ['当季鲜采'], image: 'https://images.pexels.com/photos/1172783/pexels-photo-1172783.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-047', title: '250g精品盒', price: 88, cost: 40, stock: 60 },
    ]},

    // c-004 云岭茶事研究社
    { id: 'p-048', companyId: 'c-004', title: '铁观音', basePrice: 188, cost: 85, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·安溪' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/515210/pexels-photo-515210.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-048', title: '100g罐装', price: 188, cost: 85, stock: 100 },
    ]},
    { id: 'p-049', companyId: 'c-004', title: '云南普洱茶饼', basePrice: 268, cost: 120, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '云南·普洱' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/8474179/pexels-photo-8474179.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-049', title: '357g茶饼', price: 268, cost: 120, stock: 80 },
    ]},
    { id: 'p-050', companyId: 'c-004', title: '茉莉花茶', basePrice: 128, cost: 55, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·福州' }, tags: [], image: 'https://images.pexels.com/photos/8479555/pexels-photo-8479555.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-050', title: '100g袋装', price: 128, cost: 55, stock: 150 },
    ]},
    { id: 'p-051', companyId: 'c-004', title: '金骏眉红茶', basePrice: 388, cost: 175, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·武夷山' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/6545369/pexels-photo-6545369.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-051', title: '50g精品罐', price: 388, cost: 175, stock: 40 },
    ]},
    { id: 'p-052', companyId: 'c-004', title: '大红袍', basePrice: 328, cost: 150, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·武夷山' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/230477/pexels-photo-230477.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-052', title: '100g礼盒装', price: 328, cost: 150, stock: 60 },
    ]},

    // c-005 武汉鲜果合作社
    { id: 'p-053', companyId: 'c-005', title: '水蜜桃', basePrice: 48, cost: 22, categoryId: 'cat-fruit', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '湖北·武汉' }, tags: ['当季鲜采'], image: 'https://images.pexels.com/photos/6157041/pexels-photo-6157041.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-053', title: '4个装（约2斤）', price: 48, cost: 22, stock: 150 },
    ]},
    { id: 'p-054', companyId: 'c-005', title: '红提葡萄', basePrice: 38, cost: 16, categoryId: 'cat-fruit', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '湖北·宜昌' }, tags: [], image: 'https://images.pexels.com/photos/1098529/pexels-photo-1098529.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-054', title: '2斤装', price: 38, cost: 16, stock: 200 },
    ]},
    { id: 'p-055', companyId: 'c-005', title: '猕猴桃', basePrice: 42, cost: 18, categoryId: 'cat-fruit', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '湖北·宜昌' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/14083854/pexels-photo-14083854.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-055', title: '6个装', price: 42, cost: 18, stock: 180 },
    ]},
    { id: 'p-056', companyId: 'c-005', title: '红心火龙果', basePrice: 55, cost: 25, categoryId: 'cat-fruit', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '广西·南宁' }, tags: [], image: 'https://images.pexels.com/photos/18916473/pexels-photo-18916473.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-056', title: '3个装（约3斤）', price: 55, cost: 25, stock: 120 },
    ]},
    { id: 'p-057', companyId: 'c-005', title: '金煌芒果', basePrice: 45, cost: 20, categoryId: 'cat-fruit', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '海南·三亚' }, tags: ['当季鲜采'], image: 'https://images.pexels.com/photos/8476605/pexels-photo-8476605.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-057', title: '5斤装', price: 45, cost: 20, stock: 200 },
    ]},

    // c-006 东北黑土粮仓
    { id: 'p-058', companyId: 'c-006', title: '东北玉米面', basePrice: 16, cost: 7, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·哈尔滨' }, tags: [], image: 'https://images.pexels.com/photos/6316526/pexels-photo-6316526.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-058', title: '2.5kg装', price: 16, cost: 7, stock: 400 },
    ]},
    { id: 'p-059', companyId: 'c-006', title: '东北红小豆', basePrice: 22, cost: 9, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·哈尔滨' }, tags: [], image: 'https://images.pexels.com/photos/1313643/pexels-photo-1313643.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-059', title: '1kg装', price: 22, cost: 9, stock: 350 },
    ]},
    { id: 'p-060', companyId: 'c-006', title: '绿豆', basePrice: 18, cost: 7, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·哈尔滨' }, tags: [], image: 'https://images.pexels.com/photos/5843559/pexels-photo-5843559.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-060', title: '1kg装', price: 18, cost: 7, stock: 400 },
    ]},
    { id: 'p-061', companyId: 'c-006', title: '有机黄豆', basePrice: 20, cost: 8, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·五常' }, tags: ['有机认证'], image: 'https://images.pexels.com/photos/4518616/pexels-photo-4518616.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-061', title: '1kg装', price: 20, cost: 8, stock: 300 },
    ]},
    { id: 'p-062', companyId: 'c-006', title: '荞麦面条', basePrice: 15, cost: 6, categoryId: 'cat-grain', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '黑龙江·哈尔滨' }, tags: [], image: 'https://images.pexels.com/photos/4518665/pexels-photo-4518665.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-062', title: '500g装', price: 15, cost: 6, stock: 500 },
    ]},

    // c-007 闽南百花蜂蜜基地
    { id: 'p-063', companyId: 'c-007', title: '百花蜜', basePrice: 68, cost: 30, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·泉州' }, tags: ['有机认证'], image: 'https://images.pexels.com/photos/4480158/pexels-photo-4480158.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-063', title: '500g装', price: 68, cost: 30, stock: 200 },
    ]},
    { id: 'p-064', companyId: 'c-007', title: '天然蜂花粉', basePrice: 128, cost: 55, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·泉州' }, tags: [], image: 'https://images.pexels.com/photos/1046207/pexels-photo-1046207.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-064', title: '250g瓶装', price: 128, cost: 55, stock: 80 },
    ]},
    { id: 'p-065', companyId: 'c-007', title: '纯天然蜂蜡', basePrice: 45, cost: 18, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·泉州' }, tags: [], image: 'https://images.pexels.com/photos/3194327/pexels-photo-3194327.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-065', title: '200g块', price: 45, cost: 18, stock: 100 },
    ]},
    { id: 'p-066', companyId: 'c-007', title: '枇杷蜜', basePrice: 108, cost: 48, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·莆田' }, tags: ['有机认证'], image: 'https://images.pexels.com/photos/7936722/pexels-photo-7936722.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-066', title: '500g装', price: 108, cost: 48, stock: 100 },
    ]},
    { id: 'p-067', companyId: 'c-007', title: '蜂巢蜜', basePrice: 158, cost: 70, categoryId: 'cat-honey', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '福建·泉州' }, tags: ['可信溯源'], image: 'https://images.pexels.com/photos/1406954/pexels-photo-1406954.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-067', title: '350g盒装', price: 158, cost: 70, stock: 60 },
    ]},

    // c-008 青岛海鲜工厂直供
    { id: 'p-068', companyId: 'c-008', title: '冷冻带鱼段', basePrice: 45, cost: 20, categoryId: actualFishCatId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·青岛' }, tags: [], image: 'https://images.pexels.com/photos/3796761/pexels-photo-3796761.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-068', title: '1kg装', price: 45, cost: 20, stock: 200 },
    ]},
    { id: 'p-069', companyId: 'c-008', title: '鲜冻鲍鱼', basePrice: 198, cost: 90, categoryId: actualSeafoodCatId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·青岛' }, tags: ['检测报告'], image: 'https://images.pexels.com/photos/4571250/pexels-photo-4571250.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-069', title: '10头装', price: 198, cost: 90, stock: 50 },
    ]},
    { id: 'p-070', companyId: 'c-008', title: '乳山生蚝', basePrice: 88, cost: 38, categoryId: actualSeafoodCatId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·威海' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/6953375/pexels-photo-6953375.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-070', title: '5斤装（约15个）', price: 88, cost: 38, stock: 100 },
    ]},
    { id: 'p-071', companyId: 'c-008', title: '干海带结', basePrice: 22, cost: 9, categoryId: actualSeafoodCatId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·青岛' }, tags: [], image: 'https://images.pexels.com/photos/9323344/pexels-photo-9323344.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-071', title: '500g装', price: 22, cost: 9, stock: 500 },
    ]},
    { id: 'p-072', companyId: 'c-008', title: '鲜冻鱿鱼', basePrice: 52, cost: 22, categoryId: actualSeafoodCatId, status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '山东·青岛' }, tags: [], image: 'https://images.pexels.com/photos/2433979/pexels-photo-2433979.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-072', title: '1kg装', price: 52, cost: 22, stock: 150 },
    ]},

    // c-009 草原牧歌乳业
    { id: 'p-073', companyId: 'c-009', title: '草原黄油', basePrice: 38, cost: 16, categoryId: 'cat-dairy', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·呼和浩特' }, tags: [], image: 'https://images.pexels.com/photos/8188934/pexels-photo-8188934.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-073', title: '200g块', price: 38, cost: 16, stock: 200 },
    ]},
    { id: 'p-074', companyId: 'c-009', title: '内蒙奶片', basePrice: 28, cost: 12, categoryId: 'cat-dairy', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·锡林郭勒' }, tags: [], image: 'https://images.pexels.com/photos/236010/pexels-photo-236010.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-074', title: '250g袋装', price: 28, cost: 12, stock: 300 },
    ]},
    { id: 'p-075', companyId: 'c-009', title: '手撕牛肉干', basePrice: 68, cost: 30, categoryId: 'cat-meat', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·锡林郭勒' }, tags: ['可信溯源'], image: 'https://images.pexels.com/photos/4110378/pexels-photo-4110378.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-075', title: '250g装', price: 68, cost: 30, stock: 150 },
    ]},
    { id: 'p-076', companyId: 'c-009', title: '草原羊肉卷', basePrice: 78, cost: 35, categoryId: 'cat-meat', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·锡林郭勒' }, tags: [], image: 'https://images.pexels.com/photos/1903936/pexels-photo-1903936.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-076', title: '500g装', price: 78, cost: 35, stock: 100 },
    ]},
    { id: 'p-077', companyId: 'c-009', title: '风干牛肉', basePrice: 88, cost: 40, categoryId: 'cat-meat', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '内蒙古·锡林郭勒' }, tags: ['可信溯源'], image: 'https://images.pexels.com/photos/618775/pexels-photo-618775.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-077', title: '200g装', price: 88, cost: 40, stock: 80 },
    ]},

    // c-010 茗山有机茶庄
    { id: 'p-078', companyId: 'c-010', title: '黄山毛峰', basePrice: 218, cost: 95, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '安徽·黄山' }, tags: ['有机认证', '地理标志'], image: 'https://images.pexels.com/photos/6870857/pexels-photo-6870857.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-078', title: '100g罐装', price: 218, cost: 95, stock: 80 },
    ]},
    { id: 'p-079', companyId: 'c-010', title: '六安瓜片', basePrice: 258, cost: 115, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '安徽·六安' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/5672690/pexels-photo-5672690.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-079', title: '100g罐装', price: 258, cost: 115, stock: 60 },
    ]},
    { id: 'p-080', companyId: 'c-010', title: '信阳毛尖', basePrice: 198, cost: 88, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '河南·信阳' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/11669658/pexels-photo-11669658.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-080', title: '100g袋装', price: 198, cost: 88, stock: 100 },
    ]},
    { id: 'p-081', companyId: 'c-010', title: '太平猴魁', basePrice: 388, cost: 175, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '安徽·黄山' }, tags: ['有机认证', '地理标志'], image: 'https://images.pexels.com/photos/32908162/pexels-photo-32908162.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-081', title: '50g精品罐', price: 388, cost: 175, stock: 40 },
    ]},
    { id: 'p-082', companyId: 'c-010', title: '祁门红茶', basePrice: 168, cost: 75, categoryId: 'cat-tea', status: 'ACTIVE' as const, auditStatus: 'APPROVED' as const, origin: { text: '安徽·祁门' }, tags: ['地理标志'], image: 'https://images.pexels.com/photos/12078902/pexels-photo-12078902.jpeg?auto=compress&cs=tinysrgb&w=600', skus: [
      { id: 'sku-p-082', title: '100g罐装', price: 168, cost: 75, stock: 90 },
    ]},
  ];

  for (const p of extraProducts) {
    const { skus, tags, image, ...productData } = p;
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        ...productData,
        skus: {
          create: skus.map((s: any) => ({
            id: s.id,
            title: s.title,
            price: s.price,
            cost: s.cost,
            stock: s.stock,
            status: 'ACTIVE' as const,
          })),
        },
        media: {
          create: { type: 'IMAGE' as const, url: image, sortOrder: 0 },
        },
      },
    });
    // 如果商品已存在，更新其图片
    await prisma.productMedia.updateMany({
      where: { productId: p.id },
      data: { url: image },
    });
    for (const tagName of tags) {
      const tag = await prisma.tag.findUnique({ where: { name: tagName } });
      if (tag) {
        await prisma.productTag.upsert({
          where: { productId_tagId: { productId: p.id, tagId: tag.id } },
          update: {},
          create: { productId: p.id, tagId: tag.id },
        });
      }
    }
  }
  console.log(`✅ ${extraProducts.length} 个补充商品已创建（10 家公司各 5 个，覆盖全分类）`);

  // -- 为部分商品补充多规格 SKU（每家公司 1-2 个商品，2-4 个规格） --
  const multiSkuProducts: { productId: string; skus: { id: string; title: string; price: number; cost: number; stock: number }[] }[] = [
    // c-001: 富硒胚芽米 → 3 规格
    { productId: 'p-004', skus: [
      { id: 'sku-p-004-b', title: '5kg家庭装', price: 69.9, cost: 32, stock: 100 },
      { id: 'sku-p-004-c', title: '10kg实惠装', price: 119, cost: 56, stock: 50 },
    ]},
    // c-001: 土蜂蜜 → 3 规格
    { productId: 'p-035', skus: [
      { id: 'sku-p-035-b', title: '250g尝鲜装', price: 55, cost: 25, stock: 200 },
      { id: 'sku-p-035-c', title: '1000g大瓶装', price: 178, cost: 82, stock: 60 },
    ]},

    // c-002: 生态散养土鸡蛋 → 3 规格
    { productId: 'p-006', skus: [
      { id: 'sku-p-006-b', title: '15枚装', price: 16.8, cost: 7.5, stock: 200 },
      { id: 'sku-p-006-c', title: '50枚装', price: 45, cost: 21, stock: 80 },
    ]},

    // c-003: 低温冷链蓝莓 → 3 规格
    { productId: 'p-003', skus: [
      { id: 'sku-p-003-b', title: '125g尝鲜装', price: 32, cost: 15, stock: 150 },
      { id: 'sku-p-003-c', title: '500g家庭装', price: 98, cost: 48, stock: 40 },
    ]},
    // c-003: 蓝莓果酱 → 2 规格
    { productId: 'p-043', skus: [
      { id: 'sku-p-043-b', title: '500g大瓶装', price: 78, cost: 35, stock: 80 },
    ]},

    // c-004: 铁观音 → 4 规格
    { productId: 'p-048', skus: [
      { id: 'sku-p-048-s', title: '50g品鉴装', price: 98, cost: 42, stock: 200 },
      { id: 'sku-p-048-l', title: '250g礼盒装', price: 388, cost: 175, stock: 50 },
      { id: 'sku-p-048-xl', title: '500g铁罐装', price: 688, cost: 310, stock: 30 },
    ]},

    // c-005: 水蜜桃 → 3 规格
    { productId: 'p-053', skus: [
      { id: 'sku-p-053-b', title: '8个装（约4斤）', price: 88, cost: 40, stock: 100 },
      { id: 'sku-p-053-c', title: '12个装（约6斤）', price: 118, cost: 55, stock: 60 },
    ]},
    // c-005: 猕猴桃 → 3 规格
    { productId: 'p-055', skus: [
      { id: 'sku-p-055-b', title: '12个装', price: 75, cost: 32, stock: 120 },
      { id: 'sku-p-055-c', title: '24个礼盒装', price: 138, cost: 60, stock: 50 },
    ]},

    // c-006: 东北黑米 → 3 规格
    { productId: 'p-019', skus: [
      { id: 'sku-p-019-b', title: '2.5kg装', price: 58, cost: 25, stock: 150 },
      { id: 'sku-p-019-c', title: '5kg装', price: 98, cost: 45, stock: 80 },
    ]},

    // c-007: 荔枝蜜 → 3 规格
    { productId: 'p-021', skus: [
      { id: 'sku-p-021-s', title: '250g尝鲜装', price: 42, cost: 18, stock: 300 },
      { id: 'sku-p-021-l', title: '1000g家庭装', price: 138, cost: 62, stock: 80 },
    ]},
    // c-007: 蜂巢蜜 → 2 规格
    { productId: 'p-067', skus: [
      { id: 'sku-p-067-b', title: '500g豪华盒装', price: 218, cost: 98, stock: 30 },
    ]},

    // c-008: 鲜冻鲍鱼 → 3 规格
    { productId: 'p-069', skus: [
      { id: 'sku-p-069-s', title: '6头装', price: 128, cost: 58, stock: 100 },
      { id: 'sku-p-069-l', title: '20头礼盒装', price: 358, cost: 165, stock: 25 },
    ]},
    // c-008: 乳山生蚝 → 3 规格
    { productId: 'p-070', skus: [
      { id: 'sku-p-070-b', title: '10斤装（约30个）', price: 158, cost: 70, stock: 60 },
      { id: 'sku-p-070-c', title: '20斤整箱', price: 288, cost: 130, stock: 30 },
    ]},

    // c-009: 手撕牛肉干 → 4 规格
    { productId: 'p-075', skus: [
      { id: 'sku-p-075-s', title: '100g尝鲜装', price: 32, cost: 14, stock: 300 },
      { id: 'sku-p-075-l', title: '500g家庭装', price: 118, cost: 52, stock: 80 },
      { id: 'sku-p-075-xl', title: '1kg礼盒装', price: 198, cost: 90, stock: 40 },
    ]},

    // c-010: 黄山毛峰 → 3 规格
    { productId: 'p-078', skus: [
      { id: 'sku-p-078-s', title: '50g品鉴装', price: 118, cost: 50, stock: 150 },
      { id: 'sku-p-078-l', title: '250g礼盒装', price: 488, cost: 220, stock: 40 },
    ]},
    // c-010: 祁门红茶 → 3 规格
    { productId: 'p-082', skus: [
      { id: 'sku-p-082-s', title: '50g品鉴装', price: 88, cost: 38, stock: 150 },
      { id: 'sku-p-082-l', title: '200g礼盒装', price: 298, cost: 135, stock: 50 },
    ]},
  ];

  let skuAddedCount = 0;
  for (const item of multiSkuProducts) {
    for (const sku of item.skus) {
      await prisma.productSKU.upsert({
        where: { id: sku.id },
        update: {},
        create: {
          id: sku.id,
          productId: item.productId,
          title: sku.title,
          price: sku.price,
          cost: sku.cost,
          stock: sku.stock,
          status: 'ACTIVE' as const,
        },
      });
      skuAddedCount++;
    }
  }
  console.log(`✅ ${skuAddedCount} 个额外规格已添加（${multiSkuProducts.length} 个商品增加多规格）`);

  // -- 同时为旧企业补充 AI 搜索资料到 highlights --
  const oldCompanyAiProfiles: Record<string, Record<string, any>> = {
    'c-001': {
      companyType: 'farm',
      industryTags: ['蔬菜', '粮油', '蜂蜜'],
      productKeywords: ['有机蔬菜', '富硒粮油', '蜂蜜'],
      productFeatures: ['有机', '可溯源'],
      certifications: ['有机认证'],
      mainBusiness: '蔬菜、粮油、蜂蜜、有机蔬菜、富硒粮油',
      badges: ['有机', '可溯源', '有机认证'],
    },
    'c-002': {
      companyType: 'farm',
      industryTags: ['蔬菜'],
      productKeywords: ['水培蔬菜', '有机黄瓜', '生菜'],
      productFeatures: ['有机', '可溯源'],
      certifications: [],
      mainBusiness: '蔬菜、水培蔬菜、有机黄瓜、生菜',
      badges: ['有机', '可溯源'],
    },
    'c-003': {
      companyType: 'base',
      industryTags: ['水果'],
      productKeywords: ['蓝莓', '蓝莓干'],
      productFeatures: ['冷链', '可溯源'],
      certifications: ['地理标志'],
      mainBusiness: '水果、蓝莓、蓝莓干',
      badges: ['冷链', '可溯源', '地理标志'],
    },
    'c-004': {
      companyType: 'cooperative',
      industryTags: ['茶叶'],
      productKeywords: ['大红袍', '岩茶', '茶礼盒'],
      productFeatures: ['有机'],
      certifications: ['有机认证', '地理标志'],
      mainBusiness: '茶叶、大红袍、岩茶、茶礼盒',
      badges: ['有机', '有机认证', '地理标志'],
    },
  };

  for (const [companyId, aiFields] of Object.entries(oldCompanyAiProfiles)) {
    const profile = await prisma.companyProfile.findUnique({ where: { companyId } });
    if (profile) {
      const existing = (profile.highlights as Record<string, any>) ?? {};
      await prisma.companyProfile.update({
        where: { companyId },
        data: { highlights: { ...existing, ...aiFields } },
      });
    }
  }
  console.log('✅ 4 个旧企业已补充 AI 搜索资料');

  // -- 为旧企业补充结构化地址 --
  const oldCompanyAddresses: Record<string, any> = {
    'c-001': { province: '云南省', city: '玉溪市', district: '红塔区', text: '云南省玉溪市红塔区', lat: 24.351, lng: 102.543 },
    'c-002': { province: '江苏省', city: '苏州市', district: '吴中区', text: '江苏省苏州市吴中区', lat: 31.298, lng: 120.585 },
    'c-003': { province: '辽宁省', city: '大连市', district: '甘井子区', text: '辽宁省大连市甘井子区', lat: 38.914, lng: 121.614 },
    'c-004': { province: '福建省', city: '南平市', district: '武夷山市', text: '福建省南平市武夷山市', lat: 27.734, lng: 118.037 },
  };
  for (const [companyId, address] of Object.entries(oldCompanyAddresses)) {
    await prisma.company.update({ where: { id: companyId }, data: { address } });
  }
  console.log('✅ 4 个旧企业地址已升级为结构化格式');

  console.log('🌾 种子数据填充完成！');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
