/**
 * 关注关系仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用本地 mock 作者数据
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 * - `GET /api/v1/follows?role=user|company&sort=recent|active` → `Result<FollowListItem[]>`
 * - `POST /api/v1/follows/{authorId}/toggle` → `Result<{ authorId, isFollowed }>`
 * - `GET /api/v1/authors/{id}` → `Result<PostAuthor>`
 */
import { FollowListItem, FollowSortOption, PostAuthor, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

const toTime = (value: string) => new Date(value.replace(' ', 'T')).getTime();

// 本地 mock 作者数据（自包含，不依赖其他模块）
const mockAuthors: PostAuthor[] = [
  {
    id: 'u-002',
    name: '江晴',
    avatar: 'https://placehold.co/200x200/png',
    type: 'user',
    tags: ['阳台种植爱好者', '轻食玩家'],
    isFollowed: true,
    intimacyLevel: 28,
    followerCount: 1280,
    city: '上海',
    interestTags: ['阳台种植', '轻食'],
  },
  {
    id: 'c-004',
    name: '云岭茶事研究社',
    avatar: 'https://placehold.co/200x200/png',
    type: 'company',
    verified: true,
    title: '茶饮/礼盒供应商',
    companyId: 'c-004',
    isFollowed: true,
    intimacyLevel: 64,
    followerCount: 5600,
    city: '上海',
    interestTags: ['有机茶', '茶园'],
  },
  {
    id: 'c-003',
    name: '北纬蓝莓实验田',
    avatar: 'https://placehold.co/200x200/png',
    type: 'company',
    verified: true,
    title: '蓝莓深加工基地',
    companyId: 'c-003',
    isFollowed: false,
    intimacyLevel: 0,
    followerCount: 2380,
    city: '杭州',
    interestTags: ['蓝莓', '冷链'],
  },
  {
    id: 'u-006',
    name: '顾予夏',
    avatar: 'https://placehold.co/200x200/png',
    type: 'user',
    tags: ['美食达人', '健康控'],
    isFollowed: false,
    intimacyLevel: 0,
    followerCount: 980,
    city: '上海',
    interestTags: ['轻食', '食谱'],
  },
  {
    id: 'c-002',
    name: '青禾智慧农场',
    avatar: 'https://placehold.co/200x200/png',
    type: 'company',
    verified: true,
    title: '有机蔬菜供应商',
    companyId: 'c-002',
    isFollowed: true,
    intimacyLevel: 42,
    followerCount: 6300,
    city: '南京',
    interestTags: ['有机蔬菜', '智慧温室'],
  },
];

// 关注状态管理（前端占位）
const followState = new Map<string, { isFollowed: boolean; intimacyLevel: number; followerCount: number }>();

const ensureFollowState = (author: PostAuthor) => {
  if (!followState.has(author.id)) {
    followState.set(author.id, {
      isFollowed: Boolean(author.isFollowed),
      intimacyLevel: author.intimacyLevel ?? 0,
      followerCount: author.followerCount ?? 0,
    });
  }
  return followState.get(author.id)!;
};

const syncAuthorState = (author: PostAuthor): PostAuthor => {
  const state = ensureFollowState(author);
  return { ...author, ...state };
};

const getAuthors = (): PostAuthor[] => mockAuthors.map(syncAuthorState);

const toFollowItems = (authors: PostAuthor[]): FollowListItem[] =>
  authors.map((author) => ({
    author,
    followedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }));

// 关注仓储：我的关注列表与取消关注
export const FollowRepo = {
  /**
   * 我的关注列表
   * - 后端接口：`GET /api/v1/follows?role=user|company&sort=recent|active`
   */
  listFollowing: async (
    role: PostAuthor['type'],
    sort: FollowSortOption = 'recent'
  ): Promise<Result<FollowListItem[]>> => {
    if (USE_MOCK) {
      const authors = getAuthors().filter((author) => author.type === role && author.isFollowed);
      let list = toFollowItems(authors);
      if (sort === 'active') {
        list = list.sort((a, b) => (b.author.followerCount ?? 0) - (a.author.followerCount ?? 0));
      } else {
        list = list.sort((a, b) => toTime(b.followedAt) - toTime(a.followedAt));
      }
      return simulateRequest(list, { delay: 220 });
    }

    return ApiClient.get<FollowListItem[]>('/follows', { role, sort });
  },
  /**
   * 关注/取关
   * - 后端接口：`POST /api/v1/follows/{authorId}/toggle`
   */
  toggleFollow: async (authorId: string, _userId: string): Promise<Result<{ authorId: string; isFollowed: boolean }>> => {
    if (USE_MOCK) {
      const author = mockAuthors.find((a) => a.id === authorId);
      // 如果作者不在 mock 数据中（例如企业详情页的 companyId），直接模拟关注切换
      if (!author) {
        const currentState = followState.get(authorId);
        const nextFollowed = currentState ? !currentState.isFollowed : true;
        followState.set(authorId, {
          isFollowed: nextFollowed,
          intimacyLevel: nextFollowed ? 18 : 0,
          followerCount: nextFollowed ? 1 : 0,
        });
        return simulateRequest({ authorId, isFollowed: nextFollowed }, { delay: 220 });
      }
      const state = ensureFollowState(author);
      const nextFollowed = !state.isFollowed;
      const nextFollowerCount = Math.max(0, state.followerCount + (nextFollowed ? 1 : -1));
      const nextIntimacy = nextFollowed ? Math.max(12, state.intimacyLevel || 18) : 0;
      followState.set(authorId, {
        isFollowed: nextFollowed,
        intimacyLevel: nextIntimacy,
        followerCount: nextFollowerCount,
      });
      return simulateRequest({ authorId, isFollowed: nextFollowed }, { delay: 220 });
    }

    return ApiClient.post<{ authorId: string; isFollowed: boolean }>(`/follows/${authorId}/toggle`);
  },
  /**
   * 获取作者资料
   * - 后端接口：`GET /api/v1/authors/{id}`
   */
  getAuthorProfile: async (authorId: string): Promise<Result<PostAuthor>> => {
    if (USE_MOCK) {
      const author = getAuthors().find((a) => a.id === authorId);
      if (!author) {
        return err(createAppError('NOT_FOUND', `作者不存在: ${authorId}`, '作者未找到'));
      }
      return simulateRequest(author);
    }

    return ApiClient.get<PostAuthor>(`/authors/${authorId}`);
  },
};
