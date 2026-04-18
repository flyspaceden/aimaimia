/**
 * ReturnPolicy（退货政策）全栈一致性测试
 *
 * 覆盖范围：
 *   1. 登录三端（买家、管理端、卖家端）
 *   2. 管理端分类 API — 检查 returnPolicy 字段
 *   3. 卖家端商品列表 — 检查 effectiveReturnPolicy 字段
 *   4. 管理端商品列表 — 检查 effectiveReturnPolicy 字段
 *   5. 买家端商品详情 — 检查是否返回 returnPolicy 信息
 *   6. 跨端一致性校验
 *   7. Prisma 直连数据库作为 ground truth 对比
 *   8. 通过卖家 API 修改商品 returnPolicy，验证反映结果
 *   9. resolveReturnPolicy 逻辑验证（INHERIT 链向上解析）
 *
 * 前置条件：
 *   1. 后端服务已启动（npm run start:dev）
 *   2. 数据库已有种子数据（npx prisma db seed）
 *   3. SMS_MOCK=true（开发环境固定验证码 123456）
 *
 * 运行方式：
 *   cd backend && npx ts-node test/return-policy-consistency.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const BASE = process.env.API_URL || 'http://localhost:3000/api/v1';
const prisma = new PrismaClient();

// ================================================================
// 统计
// ================================================================
let passed = 0;
let failed = 0;
const failures: string[] = [];
const findings: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} -- ${detail}` : label;
    failures.push(msg);
    console.log(`  [FAIL] ${label}${detail ? ' -- ' + detail : ''}`);
  }
}

function finding(msg: string) {
  findings.push(msg);
  console.log(`  [FINDING] ${msg}`);
}

// ================================================================
// HTTP 辅助 — 自动解包 { ok, data } wrapper
// ================================================================
async function http(
  method: string,
  path: string,
  body?: any,
  token?: string,
): Promise<{ status: number; data: any; raw: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = { rawText: text };
  }
  // 后端统一包装: { ok: true, data: <payload> } — 解包取 data
  const data = raw?.data !== undefined ? raw.data : raw;
  return { status: res.status, data, raw };
}

// ================================================================
// resolveReturnPolicy — 纯 Prisma ground truth
// ================================================================
async function resolveReturnPolicyDB(
  productId: string,
): Promise<'RETURNABLE' | 'NON_RETURNABLE'> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { returnPolicy: true, categoryId: true },
  });
  if (!product) return 'RETURNABLE';

  if (product.returnPolicy && product.returnPolicy !== 'INHERIT') {
    return product.returnPolicy as 'RETURNABLE' | 'NON_RETURNABLE';
  }

  let categoryId: string | null = product.categoryId;
  let depth = 0;
  while (categoryId && depth < 10) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { returnPolicy: true, parentId: true },
    });
    if (!category) break;
    if (category.returnPolicy && category.returnPolicy !== 'INHERIT') {
      return category.returnPolicy as 'RETURNABLE' | 'NON_RETURNABLE';
    }
    categoryId = category.parentId;
    depth++;
  }

  return 'RETURNABLE';
}

// ================================================================
// 辅助：直接通过 DB 创建 SMS OTP 以绕过 rate limit
// ================================================================
async function createSmsOtpDirectly(phone: string, code: string) {
  // 先清除旧的 OTP（避免冲突）
  await prisma.smsOtp.deleteMany({ where: { phone } });
  // 创建新 OTP，字段与 schema 一致: codeHash + purpose + expiresAt
  const codeHash = await bcrypt.hash(code, 10);
  await prisma.smsOtp.create({
    data: {
      phone,
      codeHash,
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 分钟过期
    },
  });
}

// ================================================================
// 主函数
// ================================================================
async function main() {
  console.log('\n========================================');
  console.log('ReturnPolicy 全栈一致性测试');
  console.log('========================================\n');

  // ----------------------------------------------------------
  // 1. 登录三端
  // ----------------------------------------------------------
  console.log('--- 1. 登录三端 ---');

  // 1a. 买家登录
  const buyerLogin = await http('POST', '/auth/login', {
    channel: 'phone',
    mode: 'password',
    phone: '13800138000',
    password: '123456',
  });
  const buyerToken = buyerLogin.data?.accessToken;
  assert('买家登录成功', buyerLogin.status === 200 || buyerLogin.status === 201, `status=${buyerLogin.status}`);
  assert('买家 token 存在', !!buyerToken);

  // 1b. 管理端登录
  const adminLogin = await http('POST', '/admin/auth/login', {
    username: 'admin',
    password: 'admin123456',
  });
  const adminToken = adminLogin.data?.accessToken;
  assert('管理端登录成功', adminLogin.status === 200 || adminLogin.status === 201, `status=${adminLogin.status}`);
  assert('管理端 token 存在', !!adminToken);

  // 1c. 卖家端登录（SMS 验证码方式）
  //     直接通过 DB 创建 OTP 以绕过 rate limit
  console.log('\n  卖家端: 通过 DB 直接创建 SMS OTP 绕过 rate limit...');
  const sellerPhone = '13800001001'; // 种子数据中 c-001 企业主
  const smsCode = '123456';
  await createSmsOtpDirectly(sellerPhone, smsCode);

  const sellerLogin = await http('POST', '/seller/auth/login', {
    phone: sellerPhone,
    code: smsCode,
  });
  const sellerToken = sellerLogin.data?.accessToken;
  assert('卖家端登录成功', sellerLogin.status === 200 || sellerLogin.status === 201, `status=${sellerLogin.status}, keys=${JSON.stringify(Object.keys(sellerLogin.data || {}))}`);
  assert('卖家端 token 存在', !!sellerToken);

  if (!adminToken) {
    console.log('\n管理端 token 缺失，无法继续。退出。');
    await prisma.$disconnect();
    process.exit(1);
  }

  // ----------------------------------------------------------
  // 2. 管理端分类数据
  // ----------------------------------------------------------
  console.log('\n--- 2. 管理端分类 API ---');
  const catRes = await http('GET', '/admin/categories', undefined, adminToken);
  assert('管理端分类 API 返回 200', catRes.status === 200, `status=${catRes.status}`);

  const categories: any[] = Array.isArray(catRes.data) ? catRes.data : [];
  assert('分类列表非空', categories.length > 0, `length=${categories.length}`);

  // 检查每个分类的 returnPolicy 字段
  console.log(`\n  分类总数: ${categories.length}`);
  const catMap = new Map<string, any>();
  for (const cat of categories) {
    catMap.set(cat.id, cat);
    const rp = cat.returnPolicy || '(undefined)';
    console.log(`    分类 ${cat.id} [${cat.name}] returnPolicy=${rp} parentId=${cat.parentId || 'null'}`);
  }

  // 统计 returnPolicy 分布
  const rpStats: Record<string, number> = {};
  for (const cat of categories) {
    const rp = cat.returnPolicy || 'INHERIT';
    rpStats[rp] = (rpStats[rp] || 0) + 1;
  }
  console.log(`\n  分类 returnPolicy 分布: ${JSON.stringify(rpStats)}`);

  // 验证 INHERIT 分类的链解析
  console.log('\n  验证 INHERIT 链解析:');
  for (const cat of categories) {
    if (cat.returnPolicy === 'INHERIT') {
      let resolved: string = 'INHERIT';
      let cur = cat;
      const chain = [cat.name];
      while (cur.parentId && resolved === 'INHERIT') {
        const parent = catMap.get(cur.parentId);
        if (!parent) { resolved = 'RETURNABLE (兜底)'; break; }
        chain.push(parent.name);
        resolved = parent.returnPolicy || 'INHERIT';
        cur = parent;
      }
      if (resolved === 'INHERIT') resolved = 'RETURNABLE (兜底)';
      console.log(`    ${cat.name}: INHERIT -> 链[${chain.join(' -> ')}] -> ${resolved}`);
    }
  }

  // 与数据库直连对比
  console.log('\n  与数据库 Category 表直连对比:');
  const dbCategories = await prisma.category.findMany();
  for (const dbCat of dbCategories) {
    const apiCat = catMap.get(dbCat.id);
    if (!apiCat) {
      finding(`数据库分类 ${dbCat.id} [${dbCat.name}] 在 API 响应中缺失`);
      continue;
    }
    const dbRP = dbCat.returnPolicy || 'INHERIT';
    const apiRP = apiCat.returnPolicy || 'INHERIT';
    assert(
      `分类 ${dbCat.name} DB=${dbRP} === API=${apiRP}`,
      dbRP === apiRP,
    );
  }

  // ----------------------------------------------------------
  // 3. 卖家端商品列表
  // ----------------------------------------------------------
  console.log('\n--- 3. 卖家端商品列表 ---');
  let sellerProducts: any[] = [];
  if (sellerToken) {
    const sellerProdRes = await http('GET', '/seller/products?pageSize=50', undefined, sellerToken);
    assert('卖家端商品列表返回 200', sellerProdRes.status === 200, `status=${sellerProdRes.status}`);
    sellerProducts = sellerProdRes.data?.items || [];
    console.log(`  卖家端商品总数: ${sellerProducts.length}`);

    for (const p of sellerProducts) {
      const hasEffective = p.effectiveReturnPolicy !== undefined;
      assert(
        `商品 ${p.id} [${p.title}] 有 effectiveReturnPolicy`,
        hasEffective,
        hasEffective ? `value=${p.effectiveReturnPolicy}` : 'MISSING',
      );
      if (hasEffective) {
        console.log(`    returnPolicy=${p.returnPolicy || 'INHERIT'} -> effective=${p.effectiveReturnPolicy}`);
      }
    }
  } else {
    finding('卖家端 token 缺失，跳过卖家端商品列表测试');
  }

  // ----------------------------------------------------------
  // 4. 管理端商品列表
  // ----------------------------------------------------------
  console.log('\n--- 4. 管理端商品列表 ---');
  const adminProdRes = await http('GET', '/admin/products?pageSize=50', undefined, adminToken);
  assert('管理端商品列表返回 200', adminProdRes.status === 200, `status=${adminProdRes.status}`);
  const adminProducts: any[] = adminProdRes.data?.items || [];
  console.log(`  管理端商品总数: ${adminProducts.length}`);

  for (const p of adminProducts) {
    const hasEffective = p.effectiveReturnPolicy !== undefined;
    assert(
      `管理端商品 ${p.id} [${p.title}] 有 effectiveReturnPolicy`,
      hasEffective,
      hasEffective ? `value=${p.effectiveReturnPolicy}` : 'MISSING',
    );
  }

  // ----------------------------------------------------------
  // 5. 买家端商品详情
  // ----------------------------------------------------------
  console.log('\n--- 5. 买家端商品详情 ---');
  // 从管理端列表取一些可访问的商品 ID（需 ACTIVE + APPROVED）
  const activeApproved = adminProducts.filter(
    (p: any) => p.status === 'ACTIVE' && p.auditStatus === 'APPROVED',
  );
  console.log(`  活跃已审核商品数: ${activeApproved.length}`);

  // 排除 isPlatform 的公司商品（买家端会 404）
  const buyerTestProducts = activeApproved.slice(0, 5);
  for (const ap of buyerTestProducts) {
    const detailRes = await http('GET', `/products/${ap.id}`, undefined, buyerToken);
    if (detailRes.status === 200) {
      const detail = detailRes.data;
      const hasRP = detail.returnPolicy !== undefined || detail.effectiveReturnPolicy !== undefined;
      if (hasRP) {
        console.log(`    商品 ${ap.id} 买家端: returnPolicy=${detail.returnPolicy}, effectiveReturnPolicy=${detail.effectiveReturnPolicy}`);
      } else {
        finding(`买家端商品详情 ${ap.id} [${ap.title}] 未返回 returnPolicy 或 effectiveReturnPolicy 字段`);
      }
    } else {
      console.log(`    商品 ${ap.id} 买家端 status=${detailRes.status}（可能是平台商品，跳过）`);
    }
  }

  // ----------------------------------------------------------
  // 6. 跨端一致性校验
  // ----------------------------------------------------------
  console.log('\n--- 6. 跨端一致性校验 ---');

  // 6a. 卖家端 vs 管理端 effectiveReturnPolicy
  if (sellerProducts.length > 0) {
    const adminProdMap = new Map(adminProducts.map((p: any) => [p.id, p]));
    let matchCount = 0;
    for (const sp of sellerProducts) {
      const ap = adminProdMap.get(sp.id);
      if (ap) {
        matchCount++;
        assert(
          `商品 ${sp.id} seller.effectiveReturnPolicy === admin.effectiveReturnPolicy`,
          sp.effectiveReturnPolicy === ap.effectiveReturnPolicy,
          `seller=${sp.effectiveReturnPolicy} vs admin=${ap.effectiveReturnPolicy}`,
        );
      }
    }
    console.log(`  共找到 ${matchCount} 个重叠商品进行跨端比对`);
  }

  // 6b. 与数据库 ground truth 对比
  console.log('\n  与 Prisma ground truth 对比:');
  const allDbProducts = await prisma.product.findMany({
    select: { id: true, title: true, returnPolicy: true, categoryId: true },
  });
  const dbProductMap = new Map(allDbProducts.map((p) => [p.id, p]));

  for (const ap of adminProducts) {
    const dbProd = dbProductMap.get(ap.id);
    if (!dbProd) continue;

    const expectedEffective = await resolveReturnPolicyDB(ap.id);
    assert(
      `商品 ${ap.id} [${(ap.title || '').slice(0, 10)}] 管理端=${ap.effectiveReturnPolicy} === DB解析=${expectedEffective}`,
      ap.effectiveReturnPolicy === expectedEffective,
      `admin=${ap.effectiveReturnPolicy}, dbResolved=${expectedEffective}`,
    );
  }

  if (sellerProducts.length > 0) {
    for (const sp of sellerProducts) {
      const expectedEffective = await resolveReturnPolicyDB(sp.id);
      assert(
        `商品 ${sp.id} [${(sp.title || '').slice(0, 10)}] 卖家端=${sp.effectiveReturnPolicy} === DB解析=${expectedEffective}`,
        sp.effectiveReturnPolicy === expectedEffective,
        `seller=${sp.effectiveReturnPolicy}, dbResolved=${expectedEffective}`,
      );
    }
  }

  // ----------------------------------------------------------
  // 7. 通过卖家 API 修改商品 returnPolicy
  // ----------------------------------------------------------
  console.log('\n--- 7. 卖家端修改 returnPolicy ---');
  if (sellerToken && sellerProducts.length > 0) {
    const testProduct = sellerProducts[0];
    const originalRP = testProduct.returnPolicy || 'INHERIT';
    console.log(`  测试商品: ${testProduct.id} [${testProduct.title}], 当前 returnPolicy=${originalRP}`);

    // 修改为 NON_RETURNABLE
    const updateRes = await http('PUT', `/seller/products/${testProduct.id}`, {
      returnPolicy: 'NON_RETURNABLE',
    }, sellerToken);
    assert(
      '卖家端修改 returnPolicy 为 NON_RETURNABLE 成功',
      updateRes.status === 200,
      `status=${updateRes.status}, data=${JSON.stringify(updateRes.data).slice(0, 300)}`,
    );

    // 验证卖家端列表
    const afterSellerRes = await http('GET', '/seller/products?pageSize=50', undefined, sellerToken);
    const afterSellerProd = (afterSellerRes.data?.items || []).find((p: any) => p.id === testProduct.id);
    if (afterSellerProd) {
      assert(
        '卖家端列表反映更新后 effectiveReturnPolicy=NON_RETURNABLE',
        afterSellerProd.effectiveReturnPolicy === 'NON_RETURNABLE',
        `actual=${afterSellerProd.effectiveReturnPolicy}`,
      );
      assert(
        '卖家端列表反映更新后 returnPolicy=NON_RETURNABLE',
        afterSellerProd.returnPolicy === 'NON_RETURNABLE',
        `actual=${afterSellerProd.returnPolicy}`,
      );
    } else {
      finding(`卖家端列表中找不到已修改商品 ${testProduct.id}`);
    }

    // 验证管理端列表
    const afterAdminRes = await http('GET', `/admin/products?pageSize=50`, undefined, adminToken);
    const afterAdminProd = (afterAdminRes.data?.items || []).find((p: any) => p.id === testProduct.id);
    if (afterAdminProd) {
      assert(
        '管理端列表反映更新后 effectiveReturnPolicy=NON_RETURNABLE',
        afterAdminProd.effectiveReturnPolicy === 'NON_RETURNABLE',
        `actual=${afterAdminProd.effectiveReturnPolicy}`,
      );
    } else {
      finding(`管理端列表中找不到已修改商品 ${testProduct.id}`);
    }

    // 验证数据库
    const dbAfter = await prisma.product.findUnique({
      where: { id: testProduct.id },
      select: { returnPolicy: true },
    });
    assert(
      'DB 反映更新后 returnPolicy=NON_RETURNABLE',
      dbAfter?.returnPolicy === 'NON_RETURNABLE',
      `actual=${dbAfter?.returnPolicy}`,
    );

    // 恢复原值
    console.log(`\n  恢复原始 returnPolicy=${originalRP}...`);
    await http('PUT', `/seller/products/${testProduct.id}`, {
      returnPolicy: originalRP,
    }, sellerToken);
    const dbRestored = await prisma.product.findUnique({
      where: { id: testProduct.id },
      select: { returnPolicy: true },
    });
    assert(
      `DB 恢复后 returnPolicy=${originalRP}`,
      dbRestored?.returnPolicy === originalRP,
      `actual=${dbRestored?.returnPolicy}`,
    );
  } else {
    finding('卖家端 token 缺失或无商品，跳过修改测试');
  }

  // ----------------------------------------------------------
  // 8. 管理端 DTO 缺失 returnPolicy 字段检查
  // ----------------------------------------------------------
  console.log('\n--- 8. 管理端修改 returnPolicy（预期被 whitelist 拦截） ---');
  if (adminProducts.length > 0) {
    const testProdId = adminProducts[0].id;
    const dbBefore = await prisma.product.findUnique({
      where: { id: testProdId },
      select: { returnPolicy: true },
    });
    const beforeRP = dbBefore?.returnPolicy;

    // 尝试通过管理端 API 修改 returnPolicy
    const adminUpdateRes = await http('PUT', `/admin/products/${testProdId}`, {
      returnPolicy: 'NON_RETURNABLE',
    }, adminToken);

    const dbAfterAdmin = await prisma.product.findUnique({
      where: { id: testProdId },
      select: { returnPolicy: true },
    });

    if (dbAfterAdmin?.returnPolicy === beforeRP) {
      finding(
        `管理端 AdminUpdateProductDto 缺少 returnPolicy 字段 ` +
        `(whitelist:true 会剥离未声明属性)。管理员无法通过商品编辑 API 修改退货政策。` +
        `PUT /admin/products/${testProdId} 发送 returnPolicy='NON_RETURNABLE' 后, DB 仍为 '${dbAfterAdmin?.returnPolicy}'`
      );
    } else {
      console.log(`  管理端成功修改 returnPolicy: ${beforeRP} -> ${dbAfterAdmin?.returnPolicy}`);
      // 恢复
      if (beforeRP) {
        await prisma.product.update({ where: { id: testProdId }, data: { returnPolicy: beforeRP as any } });
      }
    }
  }

  // ----------------------------------------------------------
  // 9. INHERIT 链深度解析测试
  // ----------------------------------------------------------
  console.log('\n--- 9. INHERIT 链深度解析 ---');
  // 统计所有商品的 returnPolicy 分布
  const productRPStats: Record<string, number> = {};
  for (const p of allDbProducts) {
    const rp = p.returnPolicy || 'INHERIT';
    productRPStats[rp] = (productRPStats[rp] || 0) + 1;
  }
  console.log(`  商品 returnPolicy 分布 (DB): ${JSON.stringify(productRPStats)}`);

  // 测试特殊场景：商品无 categoryId
  const noCatProducts = allDbProducts.filter((p) => !p.categoryId);
  if (noCatProducts.length > 0) {
    console.log(`\n  商品无分类 (categoryId=null): ${noCatProducts.length} 个`);
    for (const p of noCatProducts.slice(0, 3)) {
      const resolved = await resolveReturnPolicyDB(p.id);
      assert(
        `无分类商品 ${p.id} 解析为 RETURNABLE (兜底)`,
        resolved === 'RETURNABLE',
        `actual=${resolved}`,
      );
    }
  }

  // 测试二级分类的链解析
  const level2Categories = dbCategories.filter((c: any) => c.parentId !== null);
  console.log(`\n  二级分类数量: ${level2Categories.length}`);
  for (const cat of level2Categories) {
    const parent = dbCategories.find((c: any) => c.id === cat.parentId);
    console.log(`    ${cat.name} (${cat.returnPolicy}) -> 父: ${parent?.name || 'null'} (${parent?.returnPolicy || '?'})`);
  }

  // ----------------------------------------------------------
  // 10. 买家端分类 API 返回内容检查
  // ----------------------------------------------------------
  console.log('\n--- 10. 买家端分类 API ---');
  const buyerCatRes = await http('GET', '/products/categories', undefined, buyerToken);
  assert('买家端分类 API 返回 200', buyerCatRes.status === 200, `status=${buyerCatRes.status}`);
  const buyerCategories: any[] = Array.isArray(buyerCatRes.data) ? buyerCatRes.data : [];
  console.log(`  买家端分类数量: ${buyerCategories.length}`);
  if (buyerCategories.length > 0) {
    const sample = buyerCategories[0];
    const hasRP = sample.returnPolicy !== undefined;
    if (hasRP) {
      console.log(`  买家端分类包含 returnPolicy 字段: ${sample.returnPolicy}`);
    } else {
      finding('买家端分类 API 不返回 returnPolicy 字段（买家端可能不需要，但文档一致性需确认）');
    }
  }

  // ----------------------------------------------------------
  // 报告
  // ----------------------------------------------------------
  console.log('\n========================================');
  console.log('测试报告');
  console.log('========================================');
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  if (failures.length > 0) {
    console.log('\n失败项:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  if (findings.length > 0) {
    console.log(`\n发现 (${findings.length} 项):`);
    findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  console.log('\n========================================\n');

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('脚本异常:', err);
  await prisma.$disconnect();
  process.exit(2);
});
