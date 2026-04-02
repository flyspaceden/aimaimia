/**
 * 域模型：心愿评论（楼中楼）
 *
 * 用途：
 * - 心愿详情评论区：主评论 + 多条回复 + 点赞
 *
 * 后端接入建议：
 * - 评论列表建议支持排序（最早/最晚/最相关/最多赞）（见 `说明文档/后端接口清单.md#32-心愿评论楼中楼--点赞`）
 */
export type CommentAuthor = {
  id: string;
  name: string;
  avatar?: string;
};

export type CommentBase = {
  id: string;
  content: string;
  author: CommentAuthor;
  likeCount: number;
  likedBy: string[];
  createdAt: string;
  parentId?: string;
  replyTo?: {
    id: string;
    name: string;
  };
};

export type CommentThreadBase = CommentBase & {
  replies: CommentBase[];
};

export type Comment = CommentBase & {
  wishId: string;
};

export type CommentThread = CommentThreadBase & {
  wishId: string;
};

export type PostComment = CommentBase & {
  postId: string;
};

export type PostCommentThread = CommentThreadBase & {
  postId: string;
};
