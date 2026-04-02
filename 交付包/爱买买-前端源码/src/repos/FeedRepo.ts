/**
 * 爱买买圈信息流仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/posts.ts` 作为数据源
 * - 在前端实现了“推荐/关注/企业/我的发布”的分流、点赞、关注/亲密度占位等逻辑
 *
 * 后端接入说明：
 * - 推荐把排序/推荐/亲密度/同城同好推荐等算法放到后端
 * - 前端侧以本 Repo 方法为唯一入口：替换为 HTTP 请求即可完成接入
 *
 * 建议接口（节选）：
 * - `GET /api/v1/feed/recommend` / `GET /api/v1/feed/following` / `GET /api/v1/feed/companies` / `GET /api/v1/feed/mine`
 * - `GET /api/v1/posts/{id}`、`POST /api/v1/posts`、`PUT /api/v1/posts/{id}`、`DELETE /api/v1/posts/{id}`
 * - `POST /api/v1/posts/{id}/like`
 * - `POST /api/v1/authors/{id}/follow`
 * - `GET /api/v1/follow/suggestions`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#41-信息流与发帖feed--posts`
 */
import { mockPosts, mockUserProfile } from '../mocks';
import { FollowSuggestion, FollowSuggestionGroup, Post, PostAuthor, Result, UserProfile, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

const toTime = (value: string) => new Date(value.replace(' ', 'T')).getTime();
const formatPostTime = (value: Date) => value.toISOString().slice(0, 16).replace('T', ' ');

const followState = new Map<string, { isFollowed: boolean; intimacyLevel: number; followerCount: number }>();

const ensureFollowState = (author: PostAuthor) => {
  if (!followState.has(author.id)) {
    const intimacyLevel = author.intimacyLevel ?? (author.isFollowed ? 36 : 0);
    const followerCount = author.followerCount ?? 0;
    followState.set(author.id, {
      isFollowed: Boolean(author.isFollowed),
      intimacyLevel,
      followerCount,
    });
  }
  return followState.get(author.id)!;
};

const syncAuthorState = (author: PostAuthor): PostAuthor => {
  const state = ensureFollowState(author);
  return {
    ...author,
    isFollowed: state.isFollowed,
    intimacyLevel: state.intimacyLevel,
    followerCount: state.followerCount,
  };
};

// 同步作者关注/亲密度状态到帖子列表
const syncPostsAuthorState = () => {
  mockPosts.forEach((post, index) => {
    const updated = syncAuthorState(post.author);
    if (updated !== post.author) {
      mockPosts[index] = { ...post, author: updated };
    }
  });
};

// 聚合作者列表用于推荐关注
const uniqueAuthors = () => {
  const map = new Map<string, PostAuthor>();
  mockPosts.forEach((post) => {
    if (!map.has(post.author.id)) {
      map.set(post.author.id, syncAuthorState(post.author));
    }
  });
  return [...map.values()];
};

// 帖子仓储：爱买买圈信息流（含推荐/关注/企业分流与互动）
export const FeedRepo = {
  /**
   * 推荐流
   * - 用途：爱买买圈 Tab 默认页（AI 混合推荐）
   * - 后端建议：`GET /api/v1/feed/recommend`
   */
  listRecommend: async (): Promise<Result<Post[]>> => {
    syncPostsAuthorState();
    const sorted = [...mockPosts].sort((a, b) => {
      const scoreA = a.likeCount + a.commentCount * 2 + (a.shareCount ?? 0);
      const scoreB = b.likeCount + b.commentCount * 2 + (b.shareCount ?? 0);
      return scoreB - scoreA;
    });
    return simulateRequest(sorted);
  },
  /**
   * 关注流
   * - 用途：爱买买圈“关注”页（我关注的作者/企业内容）
   * - 后端建议：`GET /api/v1/feed/following`
   */
  listFollowing: async (): Promise<Result<Post[]>> => {
    syncPostsAuthorState();
    return simulateRequest(
      mockPosts
        .filter((post) => post.author.isFollowed)
        .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt))
    );
  },
  /**
   * 企业流
   * - 用途：爱买买圈“企业”页
   * - 后端建议：`GET /api/v1/feed/companies`
   */
  listCompanies: async (): Promise<Result<Post[]>> => {
    syncPostsAuthorState();
    return simulateRequest(
      mockPosts
        .filter((post) => post.author.type === 'company')
        .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt))
    );
  },
  /**
   * 我的发布
   * - 用途：爱买买圈“我的发布”页
   * - 后端建议：`GET /api/v1/feed/mine`（后端从 token 推断当前用户）
   */
  listMine: async (userId: string): Promise<Result<Post[]>> => {
    syncPostsAuthorState();
    return simulateRequest(
      mockPosts
        .filter((post) => post.author.id === userId)
        .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt))
    );
  },
  /**
   * 帖子详情
   * - 用途：帖子详情页
   * - 后端建议：`GET /api/v1/posts/{id}`
   */
  getById: async (id: string): Promise<Result<Post>> => {
    syncPostsAuthorState();
    const post = mockPosts.find((item) => item.id === id);
    if (!post) {
      return err(createAppError('NOT_FOUND', `帖子不存在: ${id}`, '帖子未找到'));
    }
    return simulateRequest(post);
  },
  // 获取作者资料（用于用户主页/企业主页跳转占位）
  /**
   * 作者资料（用户/企业）
   * - 用途：进入 /user/[id] 或 /company/[id] 前展示/补全资料
   * - 后端建议：`GET /api/v1/authors/{id}`
   */
  getAuthorProfile: async (authorId: string): Promise<Result<PostAuthor>> => {
    syncPostsAuthorState();
    const author = uniqueAuthors().find((item) => item.id === authorId);
    if (!author) {
      return err(createAppError('NOT_FOUND', `作者不存在: ${authorId}`, '作者未找到'));
    }
    return simulateRequest(author);
  },
  // 获取作者发布的帖子列表
  /**
   * 获取作者帖子列表
   * - 用途：作者主页下的帖子列表
   * - 后端建议：`GET /api/v1/authors/{id}/posts`
   */
  listByAuthor: async (authorId: string): Promise<Result<Post[]>> => {
    syncPostsAuthorState();
    const list = mockPosts
      .filter((post) => post.author.id === authorId)
      .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
    return simulateRequest(list);
  },
  /**
   * 创建帖子
   * - 用途：发布页点击“发布”
   * - 后端建议：`POST /api/v1/posts`
   * - body：`{ title, content, images, tags?, template?, productId?, productTagLabel?, music?, visibility?, allowComments?, syncToCompany? }`
   */
  create: async (payload: {
    title: string;
    content: string;
    images: string[];
    tags?: string[];
    template?: Post['template'];
    productId?: string;
    productTagLabel?: string;
    music?: Post['music'];
    visibility?: Post['visibility'];
    allowComments?: Post['allowComments'];
    syncToCompany?: Post['syncToCompany'];
  }): Promise<Result<Post>> => {
    // 发帖创建：模拟后端写入（复杂业务逻辑需中文注释）
    const post: Post = {
      id: `post-${Date.now()}`,
      title: payload.title,
      content: payload.content,
      images: payload.images,
      createdAt: formatPostTime(new Date()),
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      likedBy: [],
      productId: payload.productId,
      productTagLabel: payload.productTagLabel,
      tags: payload.tags,
      template: payload.template,
      music: payload.music,
      visibility: payload.visibility,
      allowComments: payload.allowComments,
      syncToCompany: payload.syncToCompany,
      isFeatured: false,
      contributionScore: 0,
      moderationStatus: 'pending',
      reportCount: 0,
      author: {
        id: mockUserProfile.id,
        name: mockUserProfile.name,
        avatar: mockUserProfile.avatar,
        type: 'user',
        tags: ['内容创作者'],
      },
    };
    mockPosts.unshift(post);
    return simulateRequest(post, { delay: 300 });
  },
  /**
   * 更新帖子
   * - 用途：我的发布 -> 编辑
   * - 后端建议：`PUT /api/v1/posts/{id}`
   */
  update: async (
    id: string,
    payload: {
      title: string;
      content: string;
      images: string[];
      tags?: string[];
      template?: Post['template'];
      productId?: string;
      productTagLabel?: string;
      music?: Post['music'];
      visibility?: Post['visibility'];
      allowComments?: Post['allowComments'];
      syncToCompany?: Post['syncToCompany'];
    }
  ): Promise<Result<Post>> => {
    // 发帖更新：用于“我的发布”编辑入口
    const index = mockPosts.findIndex((item) => item.id === id);
    if (index === -1) {
      return err(createAppError('NOT_FOUND', `帖子不存在: ${id}`, '帖子未找到'));
    }
    const existing = mockPosts[index];
    const updated: Post = {
      ...existing,
      title: payload.title,
      content: payload.content,
      images: payload.images,
      tags: payload.tags,
      template: payload.template,
      productId: payload.productId,
      productTagLabel: payload.productTagLabel,
      music: payload.music,
      visibility: payload.visibility,
      allowComments: payload.allowComments,
      syncToCompany: payload.syncToCompany,
    };
    mockPosts[index] = updated;
    return simulateRequest(updated, { delay: 260 });
  },
  /**
   * 删除帖子
   * - 用途：我的发布 -> 删除
   * - 后端建议：`DELETE /api/v1/posts/{id}`
   */
  remove: async (id: string): Promise<Result<{ id: string }>> => {
    // 发帖删除：用于“我的发布”移除内容
    const index = mockPosts.findIndex((item) => item.id === id);
    if (index === -1) {
      return err(createAppError('NOT_FOUND', `帖子不存在: ${id}`, '帖子未找到'));
    }
    mockPosts.splice(index, 1);
    return simulateRequest({ id }, { delay: 200 });
  },
  /**
   * 点赞/取消点赞（帖子）
   * - 用途：信息流/帖子详情页
   * - 后端建议：`POST /api/v1/posts/{id}/like`（toggle）
   */
  toggleLike: async (id: string, userId: string): Promise<Result<Post>> => {
    const post = mockPosts.find((item) => item.id === id);
    if (!post) {
      return err(createAppError('NOT_FOUND', `帖子不存在: ${id}`, '帖子未找到'));
    }
    const hasLiked = post.likedBy.includes(userId);
    post.likedBy = hasLiked ? post.likedBy.filter((item) => item !== userId) : [...post.likedBy, userId];
    post.likeCount = post.likedBy.length;
    return simulateRequest(post, { delay: 200 });
  },
  /**
   * 关注/取关作者（用户/企业）
   * - 用途：作者卡片、作者主页
   * - 后端建议：`POST /api/v1/authors/{authorId}/follow`（toggle）
   * - 鉴权：后端根据 token 的当前用户来建立关注关系与亲密度
   */
  toggleFollow: async (authorId: string, userId: string): Promise<Result<{ authorId: string; isFollowed: boolean }>> => {
    // 关注/取关作者：同步作者维度状态与亲密度（复杂业务逻辑需中文注释）
    const author = mockPosts.find((post) => post.author.id === authorId)?.author;
    if (!author) {
      return err(createAppError('NOT_FOUND', `作者不存在: ${authorId}`, '作者未找到'));
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
    mockPosts.forEach((post, index) => {
      if (post.author.id === authorId) {
        mockPosts[index] = {
          ...post,
          author: {
            ...post.author,
            isFollowed: nextFollowed,
            intimacyLevel: nextIntimacy,
            followerCount: nextFollowerCount,
          },
        };
      }
    });
    return simulateRequest({ authorId, isFollowed: nextFollowed }, { delay: 220 });
  },
  /**
   * 推荐关注（同城/同好）
   * - 用途：爱买买圈顶部“推荐关注”区域
   * - 后端建议：`GET /api/v1/follow/suggestions`
   * - 说明：返回分组 + 推荐理由，前端只负责渲染与跳转
   */
  listFollowSuggestions: async (user: UserProfile = mockUserProfile): Promise<Result<FollowSuggestionGroup>> => {
    // 同城/同好推荐：基于地理位置与兴趣标签的占位算法（复杂业务逻辑需中文注释）
    syncPostsAuthorState();
    const interests = user.interests ?? [];
    const authors = uniqueAuthors().filter((author) => author.id !== user.id);
    const sameCity = authors.filter(
      (author) => author.city && user.location && author.city === user.location && !author.isFollowed
    );
    const sameInterest = authors.filter((author) => {
      if (author.isFollowed) {
        return false;
      }
      if (!author.interestTags?.length || interests.length === 0) {
        return false;
      }
      return author.interestTags.some((tag) => interests.includes(tag));
    });
    const toSuggestion = (author: PostAuthor, reason: FollowSuggestion['reason'], label: string): FollowSuggestion => ({
      author,
      reason,
      reasonLabel: label,
    });
    const uniqueById = (list: PostAuthor[]) => {
      const map = new Map<string, PostAuthor>();
      list.forEach((author) => {
        if (!map.has(author.id)) {
          map.set(author.id, author);
        }
      });
      return [...map.values()];
    };
    const sameCityList = uniqueById(sameCity)
      .slice(0, 6)
      .map((author) => toSuggestion(author, 'same_city', '同城推荐'));
    const sameInterestList = uniqueById(sameInterest)
      .filter((author) => !sameCity.some((item) => item.id === author.id))
      .slice(0, 6)
      .map((author) => toSuggestion(author, 'same_interest', '同好推荐'));
    return simulateRequest({ sameCity: sameCityList, sameInterest: sameInterestList });
  },
};
