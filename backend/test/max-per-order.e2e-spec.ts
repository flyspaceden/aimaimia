/**
 * SKU 单笔限购（maxPerOrder）集成测试
 *
 * 对运行中的后端服务发真实 HTTP 请求 + 用 Prisma 直连数据库设置测试数据
 * 测试购物车加购、改数量、结账三层校验的完整链路
 *
 * 前置条件：
 *   1. 后端服务已启动（npm run start:dev）
 *   2. 数据库已有种子数据（npx prisma db seed）
 *
 * 运行方式：
 *   cd backend && npx ts-node test/max-per-order.e2e-spec.ts
 */
import { PrismaClient } from '@prisma/client';

const BASE_URL = process.env.API_URL || 'http://localhost:3000/api/v1';
const prisma = new PrismaClient();

// 种子数据常量
const TEST_USER_PHONE = '13800138000';
const TEST_USER_PASSWORD = '123456';
const TEST_SKU_ID = 'sku-p-001'; // 高山有机小番茄 1斤装
const TEST_SKU_2_ID = 'sku-p-002'; // 山泉水培生菜 1份装
const TEST_ADDRESS_ID = 'addr-001';

let accessToken = '';
let passed = 0;
let failed = 0;
const failures: string[] = [];

// ================================================================
// HTTP 辅助函数
// ================================================================

async function http(
  method: string,
  path: string,
  body?: any,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

async function setMaxPerOrder(skuId: string, maxPerOrder: number | null) {
  await prisma.productSKU.update({
    where: { id: skuId },
    data: { maxPerOrder },
  });
}

async function clearCart() {
  await http('DELETE', '/cart');
}

async function addToCart(skuId: string, quantity: number) {
  return http('POST', '/cart/items', { skuId, quantity });
}

async function updateCartQty(skuId: string, quantity: number) {
  return http('PATCH', `/cart/items/${skuId}`, { quantity });
}

async function getCart() {
  return http('GET', '/cart');
}

async function getProduct(id: string) {
  return http('GET', `/products/${id}`);
}

async function checkout(items: { skuId: string; quantity: number }[]) {
  return http('POST', '/orders/checkout', {
    items,
    addressId: TEST_ADDRESS_ID,
    idempotencyKey: `test-${Date.now()}-${Math.random()}`,
  });
}

// ================================================================
// 测试框架
// ================================================================

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    const msg = err.message || String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ❌ ${name}`);
    console.log(`     ${msg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function assertContains(str: string, sub: string) {
  if (!str.includes(sub))
    throw new Error(`期望 "${str}" 包含 "${sub}"`);
}

function assertNotContains(str: string, sub: string) {
  if (str.includes(sub))
    throw new Error(`期望 "${str}" 不包含 "${sub}"`);
}

// ================================================================
// 测试用例
// ================================================================

async function runTests() {
  console.log('\n🔧 准备测试环境...');

  // 登录
  const loginRes = await http('POST', '/auth/login', {
    channel: 'phone',
    mode: 'password',
    phone: TEST_USER_PHONE,
    password: TEST_USER_PASSWORD,
  });
  assert(loginRes.status === 201, `登录失败: status=${loginRes.status} ${JSON.stringify(loginRes.data)}`);
  accessToken = loginRes.data.data.accessToken;
  assert(!!accessToken, '未获取到 accessToken');
  console.log('✅ 登录成功\n');

  // ========================
  // 一、购物车加购校验
  // ========================
  console.log('📦 一、购物车加购 — maxPerOrder 校验');

  await clearCart();
  await setMaxPerOrder(TEST_SKU_ID, 3);

  await test('限购 3 件，加购 1 件 → 应成功', async () => {
    await clearCart();
    const res = await addToCart(TEST_SKU_ID, 1);
    assert(res.status === 201, `期望 201, 实际 ${res.status}`);
    assert(res.data.ok === true, '响应 ok 不为 true');
  });

  await test('限购 3 件，加购 3 件 → 恰好达到限额，应成功', async () => {
    await clearCart();
    const res = await addToCart(TEST_SKU_ID, 3);
    assert(res.status === 201, `期望 201, 实际 ${res.status}`);
  });

  await test('限购 3 件，一次加购 4 件 → 应返回 400', async () => {
    await clearCart();
    const res = await addToCart(TEST_SKU_ID, 4);
    assert(res.status === 400, `期望 400, 实际 ${res.status}`);
    assertContains(res.data.error.message, '每单限购 3 件');
  });

  await test('限购 3 件，先加 2 件再加 2 件 → 第二次 400（累计超限）', async () => {
    await clearCart();
    const res1 = await addToCart(TEST_SKU_ID, 2);
    assert(res1.status === 201, `第一次加购失败: ${res1.status}`);
    const res2 = await addToCart(TEST_SKU_ID, 2);
    assert(res2.status === 400, `期望 400, 实际 ${res2.status}`);
    assertContains(res2.data.error.message, '每单限购 3 件');
    assertContains(res2.data.error.message, '购物车已有 2 件');
  });

  await test('限购 3 件，先加 2 件再加 1 件 → 恰好 3 件，应成功', async () => {
    await clearCart();
    await addToCart(TEST_SKU_ID, 2);
    const res = await addToCart(TEST_SKU_ID, 1);
    assert(res.status === 201, `期望 201, 实际 ${res.status}`);
  });

  // ========================
  // 二、购物车改数量校验
  // ========================
  console.log('\n📦 二、购物车改数量 — maxPerOrder 校验');

  await test('限购 5 件，改为 5 件 → 恰好达到限额，应成功', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, 5);
    await addToCart(TEST_SKU_ID, 1);
    const res = await updateCartQty(TEST_SKU_ID, 5);
    assert(res.status === 200, `期望 200, 实际 ${res.status}`);
  });

  await test('限购 5 件，改为 6 件 → 应返回 400', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, 5);
    await addToCart(TEST_SKU_ID, 1);
    const res = await updateCartQty(TEST_SKU_ID, 6);
    assert(res.status === 400, `期望 400, 实际 ${res.status}`);
    assertContains(res.data.error.message, '每单限购 5 件');
  });

  await test('限购 5 件，改为 3 件 → 低于限额，应成功', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, 5);
    await addToCart(TEST_SKU_ID, 1);
    const res = await updateCartQty(TEST_SKU_ID, 3);
    assert(res.status === 200, `期望 200, 实际 ${res.status}`);
  });

  // ========================
  // 三、无限制 (null)
  // ========================
  console.log('\n📦 三、maxPerOrder=null — 不限制');

  await test('无限制时，加购 50 件应成功（仅受库存约束）', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, null);
    const res = await addToCart(TEST_SKU_ID, 50);
    assert(res.status === 201, `期望 201, 实际 ${res.status}`);
  });

  await test('无限制时，改为 80 件应成功', async () => {
    const res = await updateCartQty(TEST_SKU_ID, 80);
    assert(res.status === 200, `期望 200, 实际 ${res.status}`);
  });

  // ========================
  // 四、购物车响应包含 maxPerOrder
  // ========================
  console.log('\n📦 四、购物车响应 — 包含 maxPerOrder');

  await test('有限购的 SKU，cart API 响应含 maxPerOrder=3', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, 3);
    await addToCart(TEST_SKU_ID, 1);
    const res = await getCart();
    assert(res.status === 200, `期望 200, 实际 ${res.status}`);
    const item = res.data.data.items.find((i: any) => i.skuId === TEST_SKU_ID);
    assert(!!item, '购物车中未找到 sku-p-001');
    assert(item.product.maxPerOrder === 3, `期望 maxPerOrder=3, 实际 ${item.product.maxPerOrder}`);
  });

  await test('无限购的 SKU，cart API 响应 maxPerOrder=null', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_2_ID, null);
    await addToCart(TEST_SKU_2_ID, 1);
    const res = await getCart();
    const item = res.data.data.items.find((i: any) => i.skuId === TEST_SKU_2_ID);
    assert(!!item, '购物车中未找到 sku-p-002');
    assert(item.product.maxPerOrder === null, `期望 maxPerOrder=null, 实际 ${item.product.maxPerOrder}`);
  });

  // ========================
  // 五、商品详情接口
  // ========================
  console.log('\n📦 五、商品详情 API — 返回 maxPerOrder');

  await test('有限购，详情接口 skus 中含 maxPerOrder=10', async () => {
    await setMaxPerOrder(TEST_SKU_ID, 10);
    const res = await getProduct('p-001');
    assert(res.status === 200, `期望 200, 实际 ${res.status}`);
    const sku = res.data.data.skus.find((s: any) => s.id === TEST_SKU_ID);
    assert(!!sku, '详情中未找到 sku-p-001');
    assert(sku.maxPerOrder === 10, `期望 maxPerOrder=10, 实际 ${sku.maxPerOrder}`);
  });

  await test('无限购，详情接口 skus 中 maxPerOrder=null', async () => {
    await setMaxPerOrder(TEST_SKU_ID, null);
    const res = await getProduct('p-001');
    const sku = res.data.data.skus.find((s: any) => s.id === TEST_SKU_ID);
    assert(!!sku, '详情中未找到 sku-p-001');
    assert(sku.maxPerOrder === null, `期望 null, 实际 ${sku.maxPerOrder}`);
  });

  // ========================
  // 六、结账兜底校验
  // ========================
  console.log('\n📦 六、结账 — maxPerOrder 兜底校验');

  await test('限购 2 件，结账 quantity=3 → 应返回 400 含"限购"', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, 2);
    const res = await checkout([{ skuId: TEST_SKU_ID, quantity: 3 }]);
    assert(res.status === 400, `期望 400, 实际 ${res.status}`);
    assertContains(res.data.error.message, '每单限购 2 件');
  });

  await test('限购 2 件，结账 quantity=2 → 不应因限购被拒', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, 2);
    const res = await checkout([{ skuId: TEST_SKU_ID, quantity: 2 }]);
    if (res.status === 400) {
      assertNotContains(res.data.error.message, '限购');
    }
    // 可能成功或因其他原因失败，但不是限购
  });

  await test('无限购，结账大数量不应因限购被拒', async () => {
    await clearCart();
    await setMaxPerOrder(TEST_SKU_ID, null);
    const res = await checkout([{ skuId: TEST_SKU_ID, quantity: 50 }]);
    if (res.status === 400) {
      assertNotContains(res.data.error.message, '限购');
    }
  });
}

// ================================================================
// 运行入口
// ================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  SKU 单笔限购 (maxPerOrder) 集成测试');
  console.log(`  服务地址: ${BASE_URL}`);
  console.log('═══════════════════════════════════════════════════');

  try {
    await runTests();
  } catch (err: any) {
    console.error('\n💥 测试运行异常:', err.message);
  }

  // 清理
  console.log('\n🧹 清理测试数据...');
  await setMaxPerOrder(TEST_SKU_ID, null);
  await setMaxPerOrder(TEST_SKU_2_ID, null);
  const cart = await prisma.cart.findFirst({ where: { userId: 'u-001' } });
  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }
  await prisma.$disconnect();

  // 汇总
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 条`);
  if (failures.length > 0) {
    console.log('\n  失败详情:');
    failures.forEach((f) => console.log(`    ❌ ${f}`));
  }
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
