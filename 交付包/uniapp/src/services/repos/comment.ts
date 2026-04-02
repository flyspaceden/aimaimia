// 评论仓库：帖子/心愿评论接口占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type CommentReply = {
  id: string;
  author: string;
  content: string;
  createdAt?: string;
};

export type Comment = {
  id: string;
  author: string;
  content: string;
  likes: number;
  liked?: boolean;
  replies?: CommentReply[];
  createdAt?: string;
};

const comments: Comment[] = [
  {
    id: 'c1',
    author: '青禾农场',
    content: '如果需求多，我们可以优先规划。',
    likes: 12,
    liked: false,
    createdAt: '2024-12-05 10:40',
    replies: [
      { id: 'r1', author: '小麦', content: '太好了，期待！', createdAt: '2024-12-05 11:00' },
      { id: 'r2', author: '青禾农场', content: '后续我们会开放试吃体验。', createdAt: '2024-12-05 11:20' },
    ],
  },
  { id: 'c2', author: '海风', content: '建议同步产地直播。', likes: 4, liked: false, createdAt: '2024-12-05 12:10' },
  { id: 'c3', author: '阿诺', content: '我也很关注溯源视频。', likes: 8, liked: false, createdAt: '2024-12-05 13:20' },
];

export const CommentRepo = {
  list: async (params: { page: number; pageSize: number; targetId: string; targetType: 'post' | 'wish' }): Promise<Result<PagedResult<Comment>>> => {
    return mockPage(comments, params.page, params.pageSize);
  },

  // 评论点赞占位
  toggleLike: async (payload: { commentId: string; liked: boolean }): Promise<Result<{ liked: boolean; likes: number }>> => {
    const found = comments.find((item) => item.id === payload.commentId);
    if (!found) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '评论不存在' } };
    }
    const nextLiked = !payload.liked;
    const nextLikes = Math.max(0, found.likes + (nextLiked ? 1 : -1));
    found.likes = nextLikes;
    found.liked = nextLiked;
    return { ok: true, data: { liked: nextLiked, likes: nextLikes } };
  },
};
