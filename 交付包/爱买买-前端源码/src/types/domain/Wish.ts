/**
 * 域模型：心愿（Wish）与心愿池 v2 扩展
 *
 * 用途：
 * - 心愿池：对平台/对企业/公开心愿
 * - v2：心愿力/徽章/榜单、企业接单、众筹、积分兑换
 */
export type WishStatus = 'adopted' | 'planning' | 'done';

export type WishType = 'platform' | 'company' | 'public';

export type WishPowerLevel = 'seed' | 'grow' | 'bloom';

export type WishPower = {
  score: number;
  level: WishPowerLevel;
};

export type WishBadgeTone = 'brand' | 'accent' | 'neutral';

export type WishBadge = {
  id: string;
  label: string;
  tone: WishBadgeTone;
};

export type WishFulfillmentStatus = 'open' | 'accepted' | 'producing' | 'delivered';

export type WishFulfillment = {
  status: WishFulfillmentStatus;
  companyId?: string;
  companyName?: string;
  updatedAt?: string;
};

export type WishCrowdfundingStatus = 'open' | 'success' | 'closed';

export type WishCrowdfunding = {
  targetAmount: number;
  pledgedAmount: number;
  supporters: number;
  status: WishCrowdfundingStatus;
};

export type WishExchange = {
  pointsRequired: number;
  stock: number;
  redeemed?: boolean;
};

export type WishRankingEntry = {
  id: string;
  wishId: string;
  title: string;
  authorName: string;
  score: number;
  rank: number;
};

export type WishAuthor = {
  id: string;
  name: string;
  avatar?: string;
};

export type WishResponse = {
  id: string;
  type: 'platform' | 'company';
  content: string;
  createdAt: string;
  companyId?: string;
};

export type Wish = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  type: WishType;
  status: WishStatus;
  progress?: number;
  createdAt: string;
  companyId?: string;
  mentions?: Array<{ id: string; name: string }>;
  author: WishAuthor;
  likeCount: number;
  commentCount: number;
  likedBy: string[];
  wishPower: WishPower;
  badges: WishBadge[];
  fulfillment?: WishFulfillment;
  crowdfunding?: WishCrowdfunding;
  exchange?: WishExchange;
  isPinned?: boolean;
  responses?: WishResponse[];
};

export type WishRecommendation = {
  id: string;
  wish: Wish;
  reason: string;
  tags: string[];
};
