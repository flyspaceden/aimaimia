// 心愿池仓库：心愿列表/详情/成长体系/AI 标签接口占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type WishStatus = '草稿' | '规划中' | '已采纳' | '已实现';
export type WishType = '给平台' | '给企业' | '公开心愿';

export type Wish = {
  id: string;
  author: string | { id?: string; name: string; avatar?: string };
  status: WishStatus;
  type: WishType;
  title: string;
  content: string;
  likes: number;
  comments: number;
  power?: number;
  tags?: string[];
  createdAt?: string;
  companyName?: string;
  badges?: { id: string; label: string; tone?: string }[];
  likedBy?: string[];
  mentions?: { id: string; name: string }[];
  progress?: number;
  wishPower?: {
    score: number;
    level: string;
    nextLevelMin: number;
  };
  fulfillment?: {
    status: 'open' | 'accepted' | 'producing' | 'delivered';
    companyName?: string;
  };
  crowdfunding?: {
    status: 'open' | 'success';
    pledgedAmount: number;
    targetAmount: number;
    supporters: number;
  };
  exchange?: {
    pointsRequired: number;
    stock: number;
    redeemed?: boolean;
  };
  responses?: { id: string; type: 'platform' | 'company'; content: string; createdAt: string }[];
};

export type WishPower = {
  value: number;
  level: string;
  nextLevel: number;
};

export type WishBadge = {
  id: string;
  name: string;
  desc: string;
};

export type WishLeaderboardItem = {
  id: string;
  wishId: string;
  rank: number;
  title: string;
  authorName: string;
  score: number;
};

export type AiTag = {
  id: string;
  label: string;
};

const wishes: Wish[] = [
  {
    id: 'w1',
    author: { id: 'u1', name: '小麦' },
    status: '规划中',
    type: '给平台',
    title: '希望增加农产品溯源视频',
    content: '能看到育种到采摘的全过程，增强信任。',
    likes: 88,
    comments: 14,
    power: 120,
    tags: ['溯源', '视频'],
    createdAt: '2024-12-05 09:30',
    badges: [{ id: 'b1', label: '创意之星' }],
    likedBy: [],
    mentions: [{ id: 'c1', name: '青禾有机农场' }],
    progress: 30,
    wishPower: { score: 120, level: '萌芽', nextLevelMin: 200 },
    fulfillment: { status: 'open' },
    crowdfunding: {
      status: 'open',
      pledgedAmount: 3200,
      targetAmount: 12000,
      supporters: 18,
    },
    exchange: { pointsRequired: 200, stock: 18 },
    responses: [
      {
        id: 'r1',
        type: 'platform',
        content: '已纳入需求池，后续上线溯源视频后通知你。',
        createdAt: '2024-12-06 10:10',
      },
    ],
  },
  {
    id: 'w2',
    author: { id: 'u2', name: '海风' },
    status: '已采纳',
    type: '公开心愿',
    title: '希望增加有机蓝莓',
    content: '支持某些企业先试产，用户愿意预购。',
    likes: 120,
    comments: 26,
    power: 260,
    tags: ['有机', '蓝莓'],
    createdAt: '2024-12-04 11:10',
    companyName: '青禾有机农场',
    badges: [{ id: 'b2', label: '热门心愿', tone: 'accent' }],
    likedBy: ['u1'],
    progress: 60,
    wishPower: { score: 260, level: '成长', nextLevelMin: 400 },
    fulfillment: { status: 'accepted', companyName: '青禾有机农场' },
    crowdfunding: {
      status: 'success',
      pledgedAmount: 20000,
      targetAmount: 20000,
      supporters: 92,
    },
    exchange: { pointsRequired: 260, stock: 0, redeemed: false },
    responses: [
      {
        id: 'r2',
        type: 'company',
        content: '已进入试产排期，将开放预约试吃。',
        createdAt: '2024-12-06 14:20',
      },
    ],
  },
  {
    id: 'w3',
    author: { id: 'u3', name: '甜柚' },
    status: '已采纳',
    type: '给企业',
    title: '想要无糖草莓酱',
    content: '希望企业推出低糖款，适合家庭烘焙。',
    likes: 64,
    comments: 10,
    power: 90,
    tags: ['低糖', '草莓'],
    createdAt: '2024-12-03 16:40',
    likedBy: [],
    progress: 60,
    wishPower: { score: 90, level: '萌芽', nextLevelMin: 200 },
    fulfillment: { status: 'producing', companyName: '山谷果园' },
    exchange: { pointsRequired: 180, stock: 8, redeemed: true },
  },
];

export const WishRepo = {
  list: async (params: { page: number; pageSize: number; tab?: string }): Promise<Result<PagedResult<Wish>>> => {
    return mockPage(wishes, params.page, params.pageSize);
  },

  // 心愿详情占位：后续接入后端详情接口
  getById: async (wishId: string): Promise<Result<Wish>> => {
    const item = wishes.find((wish) => wish.id === wishId);
    if (!item) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '心愿不存在' } };
    }
    return { ok: true, data: item };
  },

  // 心愿力与等级占位：后续由后端根据用户行为计算
  getPower: async (params: { userId: string }): Promise<Result<WishPower>> => {
    return { ok: true, data: { value: 320, level: '成长', nextLevel: 500 } };
  },

  // 徽章占位：后续由后端返回已获得徽章列表
  listBadges: async (params: { userId: string }): Promise<Result<WishBadge[]>> => {
    return {
      ok: true,
      data: [
        { id: 'b1', name: '创意之星', desc: '发布 3 条心愿' },
        { id: 'b2', name: '助愿使者', desc: '点赞/评论 20 次' },
      ],
    };
  },

  // 榜单占位：后续由后端返回高赞/高心愿力列表
  listLeaderboard: async (period?: 'weekly' | 'monthly'): Promise<Result<WishLeaderboardItem[]>> => {
    const base =
      period === 'monthly'
        ? [
            { id: 'r1', wishId: 'w2', title: '希望增加有机蓝莓', authorName: '海风', score: 320 },
            { id: 'r2', wishId: 'w1', title: '希望增加农产品溯源视频', authorName: '小麦', score: 260 },
            { id: 'r3', wishId: 'w3', title: '想要无糖草莓酱', authorName: '甜柚', score: 210 },
          ]
        : [
            { id: 'r4', wishId: 'w1', title: '希望增加农产品溯源视频', authorName: '小麦', score: 180 },
            { id: 'r5', wishId: 'w2', title: '希望增加有机蓝莓', authorName: '海风', score: 160 },
            { id: 'r6', wishId: 'w3', title: '想要无糖草莓酱', authorName: '甜柚', score: 120 },
          ];
    return {
      ok: true,
      data: base.map((item, index) => ({ ...item, rank: index + 1 })),
    };
  },

  // AI 标签占位：后续由后端/模型返回标签
  listAiTags: async (params: { content: string; type: WishType }): Promise<Result<AiTag[]>> => {
    return {
      ok: true,
      data: [
        { id: 't1', label: '有机' },
        { id: 't2', label: '当季' },
        { id: 't3', label: '产地直供' },
      ],
    };
  },

  // 创建心愿占位
  create: async (payload: {
    type: WishType;
    title: string;
    content: string;
    tags: string[];
    companyId?: string;
  }): Promise<Result<{ id: string }>> => {
    if (!payload.content || payload.content.length < 5) {
      return { ok: false, error: { code: 'INVALID', message: '正文至少 5 个字' } };
    }
    return { ok: true, data: { id: `wish-${Date.now()}` } };
  },

  // 心愿点赞占位
  toggleLike: async (payload: { wishId: string; userId: string }): Promise<Result<{ liked: boolean; likes: number }>> => {
    const item = wishes.find((wish) => wish.id === payload.wishId);
    if (!item) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '心愿不存在' } };
    }
    const likedBy = item.likedBy || [];
    const existed = likedBy.includes(payload.userId);
    item.likedBy = existed ? likedBy.filter((id) => id !== payload.userId) : likedBy.concat(payload.userId);
    item.likes = Math.max(0, item.likes + (existed ? -1 : 1));
    return { ok: true, data: { liked: !existed, likes: item.likes } };
  },

  // 发起人变更状态占位
  updateStatus: async (payload: { wishId: string; status: WishStatus }): Promise<Result<{ ok: true }>> => {
    return { ok: true, data: { ok: true } };
  },

  // 企业接单占位
  acceptByCompany: async (payload: { wishId: string; companyId: string }): Promise<Result<{ ok: true }>> => {
    return { ok: true, data: { ok: true } };
  },

  // 众筹占位
  createCrowdfunding: async (payload: { wishId: string; targetAmount: number }): Promise<Result<{ ok: true }>> => {
    return { ok: true, data: { ok: true } };
  },

  // 积分兑换占位
  redeemPoints: async (payload: { wishId: string; points: number }): Promise<Result<{ ok: true }>> => {
    return { ok: true, data: { ok: true } };
  },
};
