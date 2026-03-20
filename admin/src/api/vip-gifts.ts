import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

// 封面模式
export type CoverMode = 'AUTO_GRID' | 'AUTO_DIAGONAL' | 'AUTO_STACKED' | 'CUSTOM';

// VIP 赠品方案状态
export type VipGiftOptionStatus = 'ACTIVE' | 'INACTIVE';

// 赠品组合子项信息（后端返回）
export interface VipGiftItemInfo {
  id: string;
  skuId: string;
  quantity: number;
  sortOrder: number;
  sku: {
    id: string;
    title: string;
    price: number;
    stock: number;
    product: {
      id: string;
      title: string;
      media: Array<{ url: string }>;
    };
  };
}

// VIP 赠品方案
export interface VipGiftOption {
  id: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  coverMode: CoverMode;
  coverUrl: string | null;
  sortOrder: number;
  status: VipGiftOptionStatus;
  items: VipGiftItemInfo[];
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
}

// 赠品子项输入
export interface VipGiftItemInput {
  skuId: string;
  quantity: number;
  sortOrder?: number;
}

// 创建赠品方案
export interface CreateVipGiftOptionInput {
  title: string;
  subtitle?: string;
  badge?: string;
  sortOrder?: number;
  status?: VipGiftOptionStatus;
  coverMode?: CoverMode;
  coverUrl?: string;
  items: VipGiftItemInput[];
}

// 更新赠品方案
export interface UpdateVipGiftOptionInput {
  title?: string;
  subtitle?: string;
  badge?: string;
  sortOrder?: number;
  status?: VipGiftOptionStatus;
  coverMode?: CoverMode;
  coverUrl?: string;
  items?: VipGiftItemInput[];
}

// 查询参数
interface VipGiftOptionParams extends PaginationParams {
  status?: string;
}

// 奖励商品 SKU（用于选择器）
export interface RewardSkuOption {
  id: string;
  title: string;
  price: number;
  stock: number;
  product: {
    id: string;
    title: string;
  };
}

// SKU 引用信息
export interface SkuReferenceInfo {
  vipGiftOptions: Array<{ id: string; title: string; status: string }>;
  lotteryPrizes: Array<{ id: string; name: string }>;
  totalReferences: number;
}

// 赠品方案列表
export const getVipGiftOptions = (params?: VipGiftOptionParams): Promise<PaginatedData<VipGiftOption>> =>
  client.get('/admin/vip/gift-options', { params });

// 赠品方案详情
export const getVipGiftOption = (id: string): Promise<VipGiftOption> =>
  client.get(`/admin/vip/gift-options/${id}`);

// 创建赠品方案
export const createVipGiftOption = (data: CreateVipGiftOptionInput): Promise<VipGiftOption> =>
  client.post('/admin/vip/gift-options', data);

// 更新赠品方案
export const updateVipGiftOption = (id: string, data: UpdateVipGiftOptionInput): Promise<VipGiftOption> =>
  client.patch(`/admin/vip/gift-options/${id}`, data);

// 更新赠品方案状态
export const updateVipGiftOptionStatus = (id: string, status: VipGiftOptionStatus): Promise<VipGiftOption> =>
  client.patch(`/admin/vip/gift-options/${id}/status`, { status });

// 删除赠品方案
export const deleteVipGiftOption = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/vip/gift-options/${id}`);

// 获取奖励商品 SKU 列表（用于选择器）
export const getRewardSkus = (productId?: string): Promise<RewardSkuOption[]> =>
  client.get('/admin/vip/gift-options/reward-skus', { params: { productId } });

// 查询 SKU 引用情况
export const getSkuReferences = (skuId: string): Promise<SkuReferenceInfo> =>
  client.get(`/admin/vip/gift-options/sku-references/${skuId}`);
