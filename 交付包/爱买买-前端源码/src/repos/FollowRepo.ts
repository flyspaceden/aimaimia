/**
 * 关注关系仓储（Repo）
 *
 * 作用：
 * - “我的关注”列表：用户/企业 tabs、排序（最近关注/最活跃）
 * - 关注/取关：与爱买买圈作者维度（PostAuthor）联动
 *
 * 当前实现：
 * - 复用 `FeedRepo.toggleFollow` 来同步作者的 isFollowed/intimacy/followerCount（前端占位）
 *
 * 后端接入说明：
 * - 建议接口见：`说明文档/后端接口清单.md#56-我的关注`
 * - 关键点：
 *   - 关注关系应与 token 用户绑定
 *   - 亲密度/推荐关注可由后端根据互动频率计算
 */
import { mockPosts } from '../mocks';
import { FollowListItem, FollowSortOption, PostAuthor, Result } from '../types';
import { simulateRequest } from './helpers';
import { FeedRepo } from './FeedRepo';

const toTime = (value: string) => new Date(value.replace(' ', 'T')).getTime();

const uniqueAuthors = () => {
  const map = new Map<string, PostAuthor>();
  mockPosts.forEach((post) => {
    if (!map.has(post.author.id)) {
      map.set(post.author.id, post.author);
    }
  });
  return [...map.values()];
};

const toFollowItems = (authors: PostAuthor[]): FollowListItem[] =>
  authors.map((author) => ({
    author,
    followedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }));

// 关注仓储：我的关注列表与取消关注（复杂业务逻辑需中文注释）
export const FollowRepo = {
  /**
   * 我的关注列表
   * - 后端建议：`GET /api/v1/follows?role=user|company&sort=recent|active`
   */
  listFollowing: async (
    role: PostAuthor['type'],
    sort: FollowSortOption = 'recent'
  ): Promise<Result<FollowListItem[]>> => {
    const authors = uniqueAuthors().filter((author) => author.type === role && author.isFollowed);
    let list = toFollowItems(authors);
    if (sort === 'active') {
      list = list.sort((a, b) => (b.author.followerCount ?? 0) - (a.author.followerCount ?? 0));
    } else {
      list = list.sort((a, b) => toTime(b.followedAt) - toTime(a.followedAt));
    }
    return simulateRequest(list, { delay: 220 });
  },
  /**
   * 关注/取关
   * - 后端建议：`POST /api/v1/follows/{authorId}/toggle`
   * - 说明：也可用 `POST /api/v1/authors/{id}/follow` 统一入口（与 FeedRepo 对齐）
   */
  toggleFollow: async (authorId: string, userId: string) => {
    return FeedRepo.toggleFollow(authorId, userId);
  },
};
