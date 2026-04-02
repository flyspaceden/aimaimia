/**
 * 帖子评论仓储（Repo）
 *
 * 作用：
 * - 帖子详情页评论区：楼中楼 + 点赞
 *
 * 后端接入说明：
 * - 建议接口见：`说明文档/后端接口清单.md#43-帖子评论楼中楼--点赞`
 */
import { mockPostComments, mockPosts, mockUserProfile } from '../mocks';
import { PostComment, PostCommentThread, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

// 帖子评论仓储：楼中楼结构 + 点赞互动（复杂业务逻辑需中文注释）
export const PostCommentRepo = {
  /** 帖子评论列表：`GET /api/v1/posts/{postId}/comments` */
  listByPost: async (postId: string): Promise<Result<PostCommentThread[]>> => {
    const all = mockPostComments.filter((comment) => comment.postId === postId);
    const parents = all.filter((comment) => !comment.parentId);
    const replies = all.filter((comment) => comment.parentId);
    const threads = parents.map((parent) => ({
      ...parent,
      replies: replies.filter((reply) => reply.parentId === parent.id),
    }));
    return simulateRequest(threads);
  },
  /**
   * 发表评论（一级）
   * - 后端建议：`POST /api/v1/posts/{postId}/comments`
   * - body：`{ content }`
   */
  create: async (payload: { postId: string; content: string }): Promise<Result<PostComment>> => {
    const post = mockPosts.find((item) => item.id === payload.postId);
    if (!post) {
      return err(createAppError('NOT_FOUND', `帖子不存在: ${payload.postId}`, '帖子未找到'));
    }
    const comment: PostComment = {
      id: `pc-${Date.now()}`,
      postId: payload.postId,
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
    mockPostComments.unshift(comment);
    post.commentCount += 1;
    return simulateRequest(comment, { delay: 200 });
  },
  /**
   * 回复评论（二级）
   * - 后端建议：`POST /api/v1/posts/{postId}/comments/{commentId}/reply`
   * - body：`{ content }`
   */
  reply: async (payload: { postId: string; parentId: string; content: string }): Promise<Result<PostComment>> => {
    const post = mockPosts.find((item) => item.id === payload.postId);
    if (!post) {
      return err(createAppError('NOT_FOUND', `帖子不存在: ${payload.postId}`, '帖子未找到'));
    }
    const parent = mockPostComments.find((item) => item.id === payload.parentId);
    if (!parent) {
      return err(createAppError('NOT_FOUND', `评论不存在: ${payload.parentId}`, '评论未找到'));
    }
    const comment: PostComment = {
      id: `pc-${Date.now()}`,
      postId: payload.postId,
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
    mockPostComments.unshift(comment);
    post.commentCount += 1;
    return simulateRequest(comment, { delay: 200 });
  },
  /**
   * 点赞/取消点赞（评论）
   * - 后端建议：`POST /api/v1/posts/{postId}/comments/{commentId}/like`
   */
  toggleLike: async (commentId: string, userId: string): Promise<Result<PostComment>> => {
    const comment = mockPostComments.find((item) => item.id === commentId);
    if (!comment) {
      return err(createAppError('NOT_FOUND', `评论不存在: ${commentId}`, '评论未找到'));
    }
    const hasLiked = comment.likedBy.includes(userId);
    comment.likedBy = hasLiked ? comment.likedBy.filter((item) => item !== userId) : [...comment.likedBy, userId];
    comment.likeCount = comment.likedBy.length;
    return simulateRequest(comment, { delay: 200 });
  },
};
