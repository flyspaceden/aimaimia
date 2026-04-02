import client from './client';
import type {
  BonusMember,
  BonusMemberDetail,
  WithdrawRequest,
  PaginatedData,
  PaginationParams,
  VipTreeContextResponse,
  VipTreeNodeView,
  BroadcastBucketInfo,
  BroadcastWindowResponse,
  BroadcastDistributionResponse,
  TreeRewardRecord,
  TreeRelatedOrder,
  PathExplainResponse,
  VipRootStat,
  NormalRootStat,
} from '@/types';

interface MemberQueryParams extends PaginationParams {
  tier?: string;
}

interface WithdrawQueryParams extends PaginationParams {
  status?: string;
  channel?: string;
  accountType?: string;
}

// ========== 会员 / 提现 ==========

/** 会员列表 */
export const getMembers = (params?: MemberQueryParams): Promise<PaginatedData<BonusMember>> =>
  client.get('/admin/bonus/members', { params });

/** 会员详情 */
export const getMemberDetail = (userId: string): Promise<BonusMemberDetail> =>
  client.get(`/admin/bonus/members/${userId}`);

/** 提现请求列表 */
export const getWithdrawals = (params?: WithdrawQueryParams): Promise<PaginatedData<WithdrawRequest>> =>
  client.get('/admin/bonus/withdrawals', { params });

/** 批准提现 */
export const approveWithdrawal = (id: string): Promise<WithdrawRequest> =>
  client.post(`/admin/bonus/withdrawals/${id}/approve`);

/** 拒绝提现 */
export const rejectWithdrawal = (id: string, reason?: string): Promise<WithdrawRequest> =>
  client.post(`/admin/bonus/withdrawals/${id}/reject`, { reason });

// ========== VIP 树可视化 ==========

/** 搜索用户（VIP 树搜索框） */
export const searchVipTreeUsers = (keyword: string): Promise<Array<{
  userId: string;
  nickname: string | null;
  phone: string | null;
  avatarUrl: string | null;
  tier: string;
  treeStatus: 'active' | 'silent' | 'frozen' | 'exited' | null;
  hasVipNode: boolean;
}>> => client.get('/admin/bonus/vip-tree/search', { params: { keyword } });

/** VIP 树根节点统计 */
export const getVipTreeRootStats = (): Promise<VipRootStat[]> =>
  client.get('/admin/bonus/vip-tree/root-stats');

/** 获取 VIP 树上下文 */
export const getVipTreeContext = (userId: string, descendantDepth = 1): Promise<VipTreeContextResponse> =>
  client.get('/admin/bonus/vip-tree/context', { params: { userId, descendantDepth } });

/** 懒加载子节点 */
export const getVipTreeChildren = (userId: string): Promise<{ children: VipTreeNodeView[] }> =>
  client.get(`/admin/bonus/vip-tree/${userId}/children`);

/** VIP 树奖励记录 */
export const getVipTreeRewardRecords = (
  userId: string,
  page = 1,
  pageSize = 10,
): Promise<PaginatedData<TreeRewardRecord>> =>
  client.get(`/admin/bonus/vip-tree/${userId}/reward-records`, { params: { page, pageSize } });

/** VIP 树关联订单 */
export const getVipTreeRelatedOrders = (
  userId: string,
  page = 1,
  pageSize = 10,
): Promise<PaginatedData<TreeRelatedOrder>> =>
  client.get(`/admin/bonus/vip-tree/${userId}/orders`, { params: { page, pageSize } });

/** VIP 树奖励路径解释 */
export const getVipPathExplain = (
  userId: string,
  ledgerId: string,
): Promise<PathExplainResponse> =>
  client.get(`/admin/bonus/vip-tree/${userId}/path-explain`, { params: { ledgerId } });

/** 普通树奖励路径解释 */
export const getNormalPathExplain = (
  userId: string,
  ledgerId: string,
): Promise<PathExplainResponse> =>
  client.get(`/admin/bonus/normal-tree/${userId}/path-explain`, { params: { ledgerId } });

// ========== 普通奖励滑动窗口 ==========

/** 获取所有桶概览 */
export const getBroadcastBuckets = (): Promise<BroadcastBucketInfo[]> =>
  client.get('/admin/bonus/broadcast-window/buckets');

/** 获取指定桶的窗口订单 */
export const getBroadcastWindow = (
  bucket: string,
  page = 1,
  pageSize = 30,
): Promise<BroadcastWindowResponse> =>
  client.get('/admin/bonus/broadcast-window', { params: { bucket, page, pageSize } });

/** 获取订单奖励分配明细 */
export const getBroadcastDistributions = (orderId: string): Promise<BroadcastDistributionResponse> =>
  client.get(`/admin/bonus/broadcast-window/${orderId}/distributions`);

// ========== 普通奖励树可视化 ==========

/** 搜索用户（普通树搜索框） */
export const searchNormalTreeUsers = (keyword: string): Promise<Array<{
  userId: string;
  nickname: string | null;
  phone: string | null;
  avatarUrl: string | null;
  tier: string;
  treeStatus: 'active' | 'silent' | 'frozen' | 'exited' | null;
  hasNormalNode: boolean;
}>> => client.get('/admin/bonus/normal-tree/search', { params: { keyword } });

/** 普通树根节点统计 */
export const getNormalTreeRootStats = (): Promise<NormalRootStat> =>
  client.get('/admin/bonus/normal-tree/root-stats');

/** 获取普通树上下文 */
export const getNormalTreeContext = (userId: string, descendantDepth = 1): Promise<VipTreeContextResponse> =>
  client.get('/admin/bonus/normal-tree/context', { params: { userId, descendantDepth } });

/** 懒加载普通树子节点 */
export const getNormalTreeChildren = (userId: string): Promise<{ children: VipTreeNodeView[] }> =>
  client.get(`/admin/bonus/normal-tree/${userId}/children`);

/** 普通树奖励记录 */
export const getNormalTreeRewardRecords = (
  userId: string,
  page = 1,
  pageSize = 10,
): Promise<PaginatedData<TreeRewardRecord>> =>
  client.get(`/admin/bonus/normal-tree/${userId}/reward-records`, { params: { page, pageSize } });

/** 普通树关联订单 */
export const getNormalTreeRelatedOrders = (
  userId: string,
  page = 1,
  pageSize = 10,
): Promise<PaginatedData<TreeRelatedOrder>> =>
  client.get(`/admin/bonus/normal-tree/${userId}/orders`, { params: { page, pageSize } });
