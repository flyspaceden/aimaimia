import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * cart.service.ts 中 maxPerOrder 校验逻辑的单元测试
 *
 * 由于 CartService 依赖 PrismaService / RedisCoordinatorService / BonusConfigService，
 * 这里采用「提取逻辑函数」策略，将 addItem 和 updateItemQuantity 中的
 * maxPerOrder 校验逻辑复现为纯函数，便于独立测试。
 */

// ---------- 复现 addItem 的限购校验逻辑 ----------

/**
 * 模拟 addItem 中的两阶段 maxPerOrder 校验：
 * Phase 1（事务外）：quantity 本身超过限额
 * Phase 2（事务内）：existing.quantity + quantity 超过限额
 */
function validateAddItem(
  sku: { maxPerOrder: number | null; stock: number },
  quantity: number,
  existingQuantity: number | null, // null 表示购物车中没有该 SKU
): void {
  // Phase 1: 事务外初步检查（quantity 本身超过限额）
  if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
    throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
  }

  if (existingQuantity !== null) {
    // 事务内：已有购物车行，检查累计数量
    const newQty = existingQuantity + quantity;
    if (sku.maxPerOrder !== null && newQty > sku.maxPerOrder) {
      throw new BadRequestException(
        `该商品每单限购 ${sku.maxPerOrder} 件，购物车已有 ${existingQuantity} 件`,
      );
    }
    if (newQty > sku.stock) throw new BadRequestException('库存不足');
  } else {
    // 事务内：新建购物车行
    if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
      throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
    }
    if (quantity > sku.stock) throw new BadRequestException('库存不足');
  }
}

// ---------- 复现 updateItemQuantity 的限购校验逻辑 ----------

function validateUpdateItemQuantity(
  sku: { maxPerOrder: number | null; stock: number } | null,
  quantity: number,
): void {
  if (sku && quantity > sku.stock) throw new BadRequestException('库存不足');
  if (sku && sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
    throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
  }
}

// ================================================================
// addItem 测试用例
// ================================================================

describe('CartService.addItem — maxPerOrder 校验', () => {
  const skuWith3Limit = { maxPerOrder: 3, stock: 100 };
  const skuNoLimit = { maxPerOrder: null, stock: 100 };

  it('maxPerOrder=3，加购数量=1，购物车为空 → 应成功', () => {
    expect(() => validateAddItem(skuWith3Limit, 1, null)).not.toThrow();
  });

  it('maxPerOrder=3，加购数量=1，购物车已有 3 件 → 应抛出含"购物车已有 3 件"的错误', () => {
    expect(() => validateAddItem(skuWith3Limit, 1, 3)).toThrow(
      BadRequestException,
    );
    expect(() => validateAddItem(skuWith3Limit, 1, 3)).toThrow(
      '该商品每单限购 3 件，购物车已有 3 件',
    );
  });

  it('maxPerOrder=3，直接加购数量=4 → 应在事务外就抛出"每单限购 3 件"', () => {
    expect(() => validateAddItem(skuWith3Limit, 4, null)).toThrow(
      BadRequestException,
    );
    expect(() => validateAddItem(skuWith3Limit, 4, null)).toThrow(
      '该商品每单限购 3 件',
    );
  });

  it('maxPerOrder=null（无限制），加购数量在库存内 → 应成功', () => {
    expect(() => validateAddItem(skuNoLimit, 50, null)).not.toThrow();
    expect(() => validateAddItem(skuNoLimit, 50, 10)).not.toThrow();
  });

  it('maxPerOrder=3，加购数量=3，购物车为空 → 恰好达到限额，应成功', () => {
    expect(() => validateAddItem(skuWith3Limit, 3, null)).not.toThrow();
  });

  it('maxPerOrder=3，加购数量=2，购物车已有 1 件 → 累计 3 件恰好达到限额，应成功', () => {
    expect(() => validateAddItem(skuWith3Limit, 2, 1)).not.toThrow();
  });

  it('maxPerOrder=3，加购数量=2，购物车已有 2 件 → 累计 4 件超限，应抛出错误', () => {
    expect(() => validateAddItem(skuWith3Limit, 2, 2)).toThrow(
      '该商品每单限购 3 件，购物车已有 2 件',
    );
  });
});

// ================================================================
// updateItemQuantity 测试用例
// ================================================================

describe('CartService.updateItemQuantity — maxPerOrder 校验', () => {
  const skuWith5Limit = { maxPerOrder: 5, stock: 100 };
  const skuNoLimit = { maxPerOrder: null, stock: 100 };

  it('maxPerOrder=5，更新数量=5 → 恰好达到限额，应成功', () => {
    expect(() => validateUpdateItemQuantity(skuWith5Limit, 5)).not.toThrow();
  });

  it('maxPerOrder=5，更新数量=6 → 超出限额，应抛出"每单限购 5 件"', () => {
    expect(() => validateUpdateItemQuantity(skuWith5Limit, 6)).toThrow(
      BadRequestException,
    );
    expect(() => validateUpdateItemQuantity(skuWith5Limit, 6)).toThrow(
      '该商品每单限购 5 件',
    );
  });

  it('maxPerOrder=null（无限制），更新数量在库存内 → 应成功', () => {
    expect(() => validateUpdateItemQuantity(skuNoLimit, 100)).not.toThrow();
  });

  it('maxPerOrder=5，更新数量=1 → 低于限额，应成功', () => {
    expect(() => validateUpdateItemQuantity(skuWith5Limit, 1)).not.toThrow();
  });

  it('SKU 不存在（null）时不做校验 → 应成功（由上层 NotFoundException 处理）', () => {
    expect(() => validateUpdateItemQuantity(null, 100)).not.toThrow();
  });
});
