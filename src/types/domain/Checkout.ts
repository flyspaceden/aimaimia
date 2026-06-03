/**
 * 结算（Checkout）相关类型
 *
 * - PendingCheckout：当前用户最新一条 ACTIVE CheckoutSession 的快照，
 *   用于"未完成订单横幅"在首页/购物车顶部展示，并支持续付。
 */
export type PendingCheckout = {
  sessionId: string;
  merchantOrderNo: string | null;
  expectedTotal: number;
  goodsAmount: number;
  shippingFee: number;
  expiresAt: string;
  itemCount: number;
  bizType: 'NORMAL_GOODS' | 'VIP_PACKAGE';
  preview: { firstItemImage: string; firstItemTitle: string; extraCount: number };
  items: Array<{ image: string; title: string; skuTitle: string; quantity: number; unitPrice: number }>;
};
