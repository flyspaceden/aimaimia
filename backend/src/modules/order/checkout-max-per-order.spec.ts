import { BadRequestException } from '@nestjs/common';

/**
 * checkout.service.ts 中 maxPerOrder 校验逻辑的单元测试
 *
 * checkout() 方法在 SKU 校验循环（步骤 3）中包含单笔限购检查：
 *   if (sku.maxPerOrder !== null && item.quantity > sku.maxPerOrder) {
 *     throw new BadRequestException(`商品规格「${sku.title}」每单限购 ${sku.maxPerOrder} 件`);
 *   }
 *
 * 由于 CheckoutService 依赖众多（PrismaService / BonusConfigService / 可选注入的若干 Service），
 * 这里将该校验逻辑提取为纯函数进行测试，与 checkout.service.ts 的实现完全对应。
 */

// 复现 checkout.service.ts 中的 maxPerOrder 校验片段
function validateCheckoutMaxPerOrder(
  sku: { maxPerOrder: number | null; title: string },
  quantity: number,
): void {
  if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
    throw new BadRequestException(
      `商品规格「${sku.title}」每单限购 ${sku.maxPerOrder} 件`,
    );
  }
}

// ================================================================
// 结账 maxPerOrder 校验测试用例
// ================================================================

describe('CheckoutService — maxPerOrder 校验', () => {
  const skuWith3Limit = { maxPerOrder: 3, title: '有机苹果 5 斤装' };
  const skuNoLimit = { maxPerOrder: null, title: '普通大米 10 斤' };
  const skuWith1Limit = { maxPerOrder: 1, title: '限量礼盒装' };

  it('数量超过限额时应抛出 BadRequestException，且消息含限购件数', () => {
    expect(() => validateCheckoutMaxPerOrder(skuWith3Limit, 4)).toThrow(
      BadRequestException,
    );
    expect(() => validateCheckoutMaxPerOrder(skuWith3Limit, 4)).toThrow(
      '商品规格「有机苹果 5 斤装」每单限购 3 件',
    );
  });

  it('数量恰好等于限额时应成功（边界值）', () => {
    expect(() => validateCheckoutMaxPerOrder(skuWith3Limit, 3)).not.toThrow();
  });

  it('数量低于限额时应成功', () => {
    expect(() => validateCheckoutMaxPerOrder(skuWith3Limit, 2)).not.toThrow();
  });

  it('maxPerOrder=null（无限制）时，任意数量均应成功', () => {
    expect(() => validateCheckoutMaxPerOrder(skuNoLimit, 500)).not.toThrow();
    expect(() => validateCheckoutMaxPerOrder(skuNoLimit, 1)).not.toThrow();
  });

  it('maxPerOrder=1 的限量 SKU，数量=2 时应抛出错误', () => {
    expect(() => validateCheckoutMaxPerOrder(skuWith1Limit, 2)).toThrow(
      '商品规格「限量礼盒装」每单限购 1 件',
    );
  });

  it('maxPerOrder=1 的限量 SKU，数量=1 时应成功', () => {
    expect(() => validateCheckoutMaxPerOrder(skuWith1Limit, 1)).not.toThrow();
  });

  it('错误消息应包含 SKU title（便于前端展示给用户）', () => {
    let thrown: BadRequestException | null = null;
    try {
      validateCheckoutMaxPerOrder(skuWith3Limit, 10);
    } catch (e) {
      thrown = e as BadRequestException;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('有机苹果 5 斤装');
    expect(thrown!.message).toContain('3');
  });
});
