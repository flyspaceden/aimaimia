/**
 * 售后系统工具函数
 * 纯函数 + 数据库查询辅助，供各端 Service 共用
 */

import { AFTER_SALE_CONFIG_DEFAULTS } from './after-sale.constants';

/**
 * Prisma 客户端类型（兼容 PrismaService 和事务客户端 tx）
 * 只声明本文件需要的子集，避免直接依赖完整 PrismaClient
 */
type PrismaLike = {
  product: { findUnique: (args: any) => Promise<any> };
  category: { findUnique: (args: any) => Promise<any> };
  ruleConfig: { findUnique: (args: any) => Promise<any> };
};

/**
 * 解析商品的退货政策
 * 优先取商品自身设置，若为 INHERIT 则沿品类树向上查找，
 * 直到找到第一个非 INHERIT 的值；兜底返回 RETURNABLE
 */
export async function resolveReturnPolicy(
  prisma: PrismaLike,
  productId: string,
): Promise<'RETURNABLE' | 'NON_RETURNABLE'> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { returnPolicy: true, categoryId: true },
  });
  if (!product) return 'RETURNABLE';

  // 商品自身有明确策略，直接返回
  if (product.returnPolicy && product.returnPolicy !== 'INHERIT') {
    return product.returnPolicy as 'RETURNABLE' | 'NON_RETURNABLE';
  }

  // 沿品类树向上查找
  let categoryId: string | null = product.categoryId;
  // 防止循环引用导致无限循环，最多查 10 层
  const MAX_DEPTH = 10;
  let depth = 0;

  while (categoryId && depth < MAX_DEPTH) {
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

  // 兜底：支持退货
  return 'RETURNABLE';
}

/**
 * 计算退款金额
 * - 按商品金额在订单商品总额中的占比分摊优惠券抵扣
 * - 整单退时可额外退还运费（无理由退货除外）
 *
 * @param unitPrice          商品单价（元）
 * @param quantity           退货数量
 * @param orderGoodsAmount   订单商品总额（不含运费、优惠券抵扣前）
 * @param orderTotalCouponDiscount 订单优惠券总抵扣额（元）
 * @param orderShippingFee   订单运费（元）
 * @param afterSaleType      售后类型
 * @param isFullRefund       是否整单退款
 * @returns 退款金额（元，精确到分）
 */
export function calculateRefundAmount(
  unitPrice: number,
  quantity: number,
  orderGoodsAmount: number,
  orderTotalCouponDiscount: number,
  orderShippingFee: number,
  afterSaleType: string,
  isFullRefund: boolean,
): number {
  const itemAmount = unitPrice * quantity;

  // 按商品金额占比分摊优惠券抵扣
  const couponShare =
    orderGoodsAmount > 0 && orderTotalCouponDiscount
      ? orderTotalCouponDiscount * (itemAmount / orderGoodsAmount)
      : 0;

  let refundAmount = itemAmount - couponShare;

  // 整单退且非无理由退货时，退还运费
  if (isFullRefund && afterSaleType !== 'NO_REASON_RETURN') {
    refundAmount += orderShippingFee;
  }

  // 四舍五入到分
  return Math.round(refundAmount * 100) / 100;
}

/**
 * 判断是否需要买家退回商品
 * - 无理由退货：一律需要退回
 * - 质量问题退货/换货：商品金额超过门槛才需退回（低于门槛免退货退款）
 *
 * @param afterSaleType 售后类型
 * @param itemAmount    商品金额（元）
 * @param threshold     免退货门槛（元）
 */
export function requiresReturnShipping(
  afterSaleType: string,
  itemAmount: number,
  threshold: number,
): boolean {
  if (afterSaleType === 'NO_REASON_RETURN') {
    return true;
  }
  // QUALITY_RETURN / QUALITY_EXCHANGE：超过门槛才需退回
  return itemAmount > threshold;
}

/**
 * 判断是否在退货窗口期内
 *
 * @param deliveredAt       物流签收时间
 * @param receivedAt        买家确认收货时间
 * @param returnPolicy      商品退货政策（已解析后的值，非 INHERIT）
 * @param afterSaleType     售后类型
 * @param returnWindowDays  无理由退货窗口（天）
 * @param normalReturnDays  普通退货窗口（天）
 * @param freshReturnHours  生鲜退货窗口（小时）
 */
export function isWithinReturnWindow(
  deliveredAt: Date | null | undefined,
  receivedAt: Date | null | undefined,
  returnPolicy: 'RETURNABLE' | 'NON_RETURNABLE',
  afterSaleType: string,
  returnWindowDays: number,
  normalReturnDays: number,
  freshReturnHours: number,
): boolean {
  // 以签收时间为准，回退到确认收货时间
  const baseTime = deliveredAt || receivedAt;
  if (!baseTime) return false;

  const now = new Date();
  const baseMs = new Date(baseTime).getTime();

  if (afterSaleType === 'NO_REASON_RETURN') {
    // 不支持无理由退货的商品，直接拒绝
    if (returnPolicy === 'NON_RETURNABLE') return false;
    // 可退货商品：检查无理由退货窗口
    const deadline = baseMs + returnWindowDays * 24 * 60 * 60 * 1000;
    return now.getTime() < deadline;
  }

  // 质量问题退货/换货
  if (returnPolicy === 'NON_RETURNABLE') {
    // 不可退商品（如生鲜）：使用较短的生鲜窗口
    const deadline = baseMs + freshReturnHours * 60 * 60 * 1000;
    return now.getTime() < deadline;
  }

  // 可退商品 + 质量问题：使用普通退货窗口
  const deadline = baseMs + normalReturnDays * 24 * 60 * 60 * 1000;
  return now.getTime() < deadline;
}

/**
 * 从 RuleConfig 表读取配置值，不存在则使用默认值
 * RuleConfig.value 为 Json 类型，数值配置通常直接存为数字
 *
 * @param prisma   Prisma 客户端（或事务客户端）
 * @param key      配置键
 * @param defaultValue 默认值（可选，优先于 AFTER_SALE_CONFIG_DEFAULTS）
 */
export async function getConfigValue(
  prisma: PrismaLike,
  key: string,
  defaultValue?: number,
): Promise<number> {
  const fallback = defaultValue ?? AFTER_SALE_CONFIG_DEFAULTS[key] ?? 0;

  const config = await prisma.ruleConfig.findUnique({
    where: { key },
  });

  if (!config) return fallback;

  // RuleConfig.value 是 Json 类型，可能直接是数字或包装在对象中
  const val = config.value;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    return isNaN(parsed) ? fallback : parsed;
  }

  return fallback;
}
