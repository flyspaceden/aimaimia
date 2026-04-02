/**
 * 域模型：评论（通用基础类型）
 *
 * 用途：
 * - 通用评论组件的类型基础（CommentItem, CommentThread 组件）
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
