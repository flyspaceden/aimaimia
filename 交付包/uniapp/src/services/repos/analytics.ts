// 数据分析仓库：企业内容分析/用户兴趣图谱接口占位
import type { Result } from '../types';
import type { Post } from './feed';

export type CompanyContentStats = {
  companyId: string;
  companyName: string;
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  engagementRate: string;
  weeklyTrend: Array<{ label: string; value: number }>;
  topTags: string[];
  topPosts: Post[];
};

export type UserInterestProfile = {
  userId: string;
  summary: string[];
  tags: Array<{ label: string; weight: number }>;
  behaviors: string[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mockTopPosts: Post[] = [
  {
    id: 'p1',
    author: '江晴',
    authorId: 'u_mock',
    authorName: '江晴',
    authorType: 'user',
    city: '杭州',
    tag: '阳台种植爱好者',
    title: '高山小番茄的 7 天养护日记',
    content: '记录清晨雾气与温度对口感的影响，欢迎交流。',
    likes: 128,
    comments: 32,
    shares: 12,
    followed: true,
    createdAt: '2024-12-05 09:30',
    tags: ['种植日志', '育苗期'],
    image: 'https://placehold.co/900x900/png',
    images: ['https://placehold.co/900x900/png'],
    productId: 'p1',
    productTagLabel: '即看即买',
    intimacyLevel: 28,
  },
  {
    id: 'p2',
    author: '青禾农场',
    authorId: 'c1',
    authorName: '青禾农场',
    authorType: 'company',
    companyId: 'c1',
    city: '昆明',
    tag: '有机蔬菜供应商',
    title: '雨季育苗期注意事项',
    content: '雨季重点关注通风与排水，避免烂根。',
    likes: 92,
    comments: 18,
    shares: 6,
    followed: true,
    createdAt: '2024-12-04 10:20',
    tags: ['育苗期', '雨季管理'],
    image: 'https://placehold.co/900x900/png',
    images: ['https://placehold.co/900x900/png'],
    intimacyLevel: 62,
  },
];

const mockCompanyContentStats: CompanyContentStats = {
  companyId: 'c-002',
  companyName: '青禾农场',
  totalPosts: 48,
  totalLikes: 1280,
  totalComments: 312,
  totalShares: 96,
  engagementRate: '6.8%',
  weeklyTrend: [
    { label: '周一', value: 36 },
    { label: '周二', value: 48 },
    { label: '周三', value: 62 },
    { label: '周四', value: 58 },
    { label: '周五', value: 72 },
    { label: '周六', value: 84 },
    { label: '周日', value: 66 },
  ],
  topTags: ['育苗期', '有机种植', '产地直播', '采摘季'],
  topPosts: mockTopPosts,
};

const mockUserInterestProfile: UserInterestProfile = {
  userId: 'u_mock',
  summary: ['偏好有机蔬果与低糖饮食', '关注种植过程与溯源内容', '偏爱华东地区企业'],
  tags: [
    { label: '有机蔬菜', weight: 72 },
    { label: '产地溯源', weight: 64 },
    { label: '低糖饮食', weight: 48 },
    { label: '果园采摘', weight: 36 },
  ],
  behaviors: ['近 30 天浏览企业主页 12 次', '收藏内容 8 条', '参与互动评论 5 次'],
};

export const AnalyticsRepo = {
  getCompanyContentStats: async (companyId: string): Promise<Result<CompanyContentStats>> => {
    await sleep(240);
    return { ok: true, data: { ...mockCompanyContentStats, companyId } };
  },
  getUserInterestProfile: async (userId: string): Promise<Result<UserInterestProfile>> => {
    await sleep(220);
    return { ok: true, data: { ...mockUserInterestProfile, userId } };
  },
};
