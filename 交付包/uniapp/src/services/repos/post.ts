// 帖子仓库：发布占位
import type { Result } from '../types';

export const PostRepo = {
  create: async (payload: {
    title: string;
    content: string;
    tags: string[];
    template?: 'story' | 'diary' | 'recipe' | 'general';
    images?: string[];
    coverIndex?: number;
    music?: { id: string; title: string; artist?: string };
    extras?: Record<string, string>;
    // settings 说明：
    // - visibility：可见范围（公开/仅关注/私密），后端可用来决定进入哪些信息流、是否可被搜索
    // - allowComment：是否允许评论（后端可用于拦截评论创建）
    // - syncCompany：是否同步到企业主页（后端可用于企业内容墙）
    settings: { visibility: 'public' | 'followers' | 'private'; allowComment: boolean; syncCompany: boolean };
    productId?: string;
  }): Promise<Result<{ id: string }>> => {
    return { ok: true, data: { id: `post-${Date.now()}` } };
  },
};
