/**
 * 域模型：商品（Product）
 *
 * 用途：
 * - 首页/分类/搜索商品流、商品详情、购物车与订单项引用
 */
export type Product = {
  id: string;
  title: string;
  price: number;
  unit: string;
  origin: string;
  image: string;
  tags: string[];
  strikePrice?: number;
  companyId?: string;
  rating?: number;
};
