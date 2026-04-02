/**
 * 心愿评论仓储（Repo）
 *
 * 作用：
 * - 心愿详情页评论区：楼中楼（主评论 + 多条回复）+ 点赞（评论也可点赞）
 * - 该 Repo 返回的是“线程结构” `CommentThread[]`，便于前端渲染
 *
 * 后端接入说明：
 * - 建议接口见：`说明文档/后端接口清单.md#32-心愿评论楼中楼--点赞`
 * - 注意：
 *   - 需要支持 parentId/replyTo 的层级关系
 *   - 点赞/取消点赞应为幂等或可 toggle
 */
import { wishBadges, wishPowerLevels } from '../constants';
import { mockComments, mockUserProfile, mockWishes } from '../mocks';
import { Comment, CommentThread, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

const resolveWishPowerLevel = (score: number) => {
  const ordered = [...wishPowerLevels].sort((a, b) => b.min - a.min);
  return ordered.find((level) => score >= level.min)?.id ?? 'seed';
};

const refreshWishBadges = (wishId: string) => {
  const wish = mockWishes.find((item) => item.id === wishId);
  if (!wish) {
    return;
  }
  const badges: string[] = [];
  if (wish.isPinned) {
    badges.push('popular');
  }
  if (wish.likeCount >= 25) {
    badges.push('popular');
  }
  if (wish.commentCount >= 6) {
    badges.push('helper');
  }
  if (wish.status === 'done') {
    badges.push('fulfilled');
  }
  if (wish.fulfillment?.status === 'accepted' || wish.fulfillment?.status === 'producing') {
    badges.push('accepted');
  }
  if (wish.crowdfunding?.status === 'open') {
    badges.push('crowdfunding');
  }
  if (wish.type === 'platform') {
    badges.push('creative');
  }
  const unique = badges.filter((item, index) => badges.indexOf(item) === index);
  wish.badges = unique
    .map((id) => wishBadges.find((badge) => badge.id === id))
    .filter((badge): badge is (typeof wishBadges)[number] => Boolean(badge));
};

// 评论仓储：提供楼中楼结构与点赞操作（复杂业务逻辑需中文注释）
export const CommentRepo = {
  /** 心愿评论列表：`GET /api/v1/wishes/{wishId}/comments` */
  listByWish: async (wishId: string): Promise<Result<CommentThread[]>> => {
    const all = mockComments.filter((comment) => comment.wishId === wishId);
    const parents = all.filter((comment) => !comment.parentId);
    const replies = all.filter((comment) => comment.parentId);
    const threads = parents.map((parent) => ({
      ...parent,
      replies: replies.filter((reply) => reply.parentId === parent.id),
    }));
    return simulateRequest(threads);
  },
  /**
   * 发表评论（一级评论）
   * - 后端建议：`POST /api/v1/wishes/{wishId}/comments`
   * - body：`{ content }`
   */
  create: async (payload: { wishId: string; content: string }): Promise<Result<Comment>> => {
    const wish = mockWishes.find((item) => item.id === payload.wishId);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${payload.wishId}`, '心愿未找到'));
    }
    const comment: Comment = {
      id: `cmt-${Date.now()}`,
      wishId: payload.wishId,
      content: payload.content,
      author: {
        id: mockUserProfile.id,
        name: mockUserProfile.name,
        avatar: mockUserProfile.avatar,
      },
      likeCount: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };
    mockComments.unshift(comment);
    wish.commentCount += 1;
    // 评论提升心愿力，并同步徽章状态
    const nextScore = (wish.wishPower?.score ?? 0) + 3;
    wish.wishPower = {
      score: nextScore,
      level: resolveWishPowerLevel(nextScore),
    };
    refreshWishBadges(wish.id);
    return simulateRequest(comment, { delay: 200 });
  },
  /**
   * 回复评论（二级回复）
   * - 后端建议：`POST /api/v1/wishes/{wishId}/comments/{commentId}/reply`
   * - body：`{ content }`
   */
  reply: async (payload: { wishId: string; parentId: string; content: string }): Promise<Result<Comment>> => {
    const wish = mockWishes.find((item) => item.id === payload.wishId);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${payload.wishId}`, '心愿未找到'));
    }
    const parent = mockComments.find((item) => item.id === payload.parentId);
    if (!parent) {
      return err(createAppError('NOT_FOUND', `评论不存在: ${payload.parentId}`, '评论未找到'));
    }
    const comment: Comment = {
      id: `cmt-${Date.now()}`,
      wishId: payload.wishId,
      content: payload.content,
      author: {
        id: mockUserProfile.id,
        name: mockUserProfile.name,
        avatar: mockUserProfile.avatar,
      },
      likeCount: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
      parentId: parent.id,
      replyTo: {
        id: parent.id,
        name: parent.author.name,
      },
    };
    mockComments.unshift(comment);
    wish.commentCount += 1;
    // 回复评论也计入心愿力
    const nextScore = (wish.wishPower?.score ?? 0) + 2;
    wish.wishPower = {
      score: nextScore,
      level: resolveWishPowerLevel(nextScore),
    };
    refreshWishBadges(wish.id);
    return simulateRequest(comment, { delay: 200 });
  },
  /**
   * 点赞/取消点赞（评论）
   * - 后端建议：`POST /api/v1/wishes/{wishId}/comments/{commentId}/like`
   * - 说明：可做 toggle；也可拆成 like/unlike 两个 endpoint
   */
  toggleLike: async (commentId: string, userId: string): Promise<Result<Comment>> => {
    const comment = mockComments.find((item) => item.id === commentId);
    if (!comment) {
      return err(createAppError('NOT_FOUND', `评论不存在: ${commentId}`, '评论未找到'));
    }
    const hasLiked = comment.likedBy.includes(userId);
    comment.likedBy = hasLiked ? comment.likedBy.filter((item) => item !== userId) : [...comment.likedBy, userId];
    comment.likeCount = comment.likedBy.length;
    return simulateRequest(comment, { delay: 200 });
  },
};
