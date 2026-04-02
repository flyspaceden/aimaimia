// 爱买买圈信息流仓库：帖子列表/互动占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type Post = {
  id: string;
  author: string;
  authorId?: string;
  authorName?: string;
  authorType?: 'company' | 'user';
  companyId?: string;
  city?: string;
  tag?: string;
  title: string;
  content: string;
  likes: number;
  comments: number;
  shares: number;
  followed: boolean;
  createdAt?: string;
  tags?: string[];
  image?: string;
  images?: string[];
  productId?: string;
  productTagLabel?: string;
  intimacyLevel?: number;
};

export type AuthorProfile = {
  id: string;
  name: string;
  avatar?: string;
  title?: string;
  tags?: string[];
  city?: string;
  followerCount?: number;
  isFollowed?: boolean;
  intimacyLevel?: number;
  interestTags?: string[];
};

const posts: Post[] = [
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
    followed: false,
    createdAt: '2024-12-05 09:30',
    tags: ['种植日志', '育苗期'],
    image: 'https://placehold.co/900x900/png',
    images: [
      'https://placehold.co/900x900/png',
      'https://placehold.co/900x900/png',
      'https://placehold.co/900x900/png',
    ],
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
    intimacyLevel: 62,
  },
  {
    id: 'p3',
    author: '山谷果园',
    authorId: 'c2',
    authorName: '山谷果园',
    authorType: 'company',
    companyId: 'c2',
    city: '昆明',
    tag: '高山水果',
    title: '今年的蓝莓甜度报告',
    content: '高山冷凉气候让果香更浓，欢迎预约采摘。',
    likes: 76,
    comments: 14,
    shares: 5,
    followed: true,
    createdAt: '2024-12-03 16:40',
    tags: ['蓝莓', '高山水果'],
    image: 'https://placehold.co/900x900/png',
    intimacyLevel: 48,
  },
];

const authorProfiles: Record<string, AuthorProfile> = {
  u_mock: {
    id: 'u_mock',
    name: '江晴',
    title: '阳台种植爱好者',
    city: '杭州',
    followerCount: 128,
    isFollowed: true,
    intimacyLevel: 28,
    interestTags: ['种植日志', '低糖饮食', '阳台种植'],
  },
  c1: {
    id: 'c1',
    name: '青禾农场',
    title: '有机蔬菜供应商',
    city: '昆明',
    followerCount: 860,
    isFollowed: true,
    intimacyLevel: 62,
    interestTags: ['有机种植', '育苗期'],
  },
  c2: {
    id: 'c2',
    name: '山谷果园',
    title: '高山水果',
    city: '昆明',
    followerCount: 420,
    isFollowed: false,
    intimacyLevel: 48,
    interestTags: ['高山水果', '采摘季'],
  },
};

const getProfile = (authorId: string): AuthorProfile => {
  if (authorProfiles[authorId]) return authorProfiles[authorId];
  return {
    id: authorId,
    name: '内容创作者',
    city: '未知',
    followerCount: 0,
    isFollowed: false,
    intimacyLevel: 0,
  };
};

export const FeedRepo = {
  list: async (params: { page: number; pageSize: number; tab?: string; sort?: string; userId?: string }): Promise<Result<PagedResult<Post>>> => {
    let items = [...posts];
    if (params.tab === 'following') {
      items = items.filter((item) => item.followed);
    }
    if (params.tab === 'company') {
      items = items.filter((item) => item.authorType === 'company');
    }
    if (params.tab === 'mine') {
      const userId = params.userId || 'u_mock';
      items = items.filter((item) => item.authorId === userId);
    }

    const toTime = (value?: string) => (value ? new Date(value.replace(' ', 'T')).getTime() : 0);

    if (params.sort === 'earliest') {
      items = items.sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
    } else if (params.sort === 'relevant') {
      items = items.sort((a, b) => b.likes + b.comments * 2 + b.shares - (a.likes + a.comments * 2 + a.shares));
    } else {
      items = items.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
    }
    return mockPage(items, params.page, params.pageSize);
  },

  // 帖子详情占位：后续接入后端详情接口
  getById: async (postId: string): Promise<Result<Post>> => {
    const item = posts.find((post) => post.id === postId);
    if (!item) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '帖子不存在' } };
    }
    return { ok: true, data: item };
  },

  // 作者信息占位：用于用户/企业主页
  getAuthorProfile: async (authorId: string): Promise<Result<AuthorProfile>> => {
    if (!authorId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少作者信息' } };
    }
    return { ok: true, data: getProfile(authorId) };
  },

  // 作者内容列表占位
  listByAuthor: async (authorId: string): Promise<Result<Post[]>> => {
    const list = posts.filter((item) => item.authorId === authorId);
    return { ok: true, data: list };
  },

  // 关注/取关占位
  toggleFollow: async (authorId: string, userId: string): Promise<Result<{ ok: true }>> => {
    if (!authorId || !userId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少关注对象' } };
    }
    const profile = getProfile(authorId);
    const nextFollowed = !profile.isFollowed;
    authorProfiles[authorId] = {
      ...profile,
      isFollowed: nextFollowed,
      followerCount: Math.max(0, (profile.followerCount || 0) + (nextFollowed ? 1 : -1)),
    };
    posts.forEach((post) => {
      if (post.authorId === authorId) {
        post.followed = nextFollowed;
      }
    });
    return { ok: true, data: { ok: true } };
  },
};
