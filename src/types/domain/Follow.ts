/**
 * 域模型：关注（Follow）
 *
 * 用途：
 * - 我的关注列表（用户/企业）+ 排序
 * - 推荐关注（同城/同好）分组
 */
import { PostAuthor } from './Author';

export type FollowSuggestionReason = 'same_city' | 'same_interest';

export type FollowSuggestion = {
  author: PostAuthor;
  reason: FollowSuggestionReason;
  reasonLabel: string;
};

export type FollowSuggestionGroup = {
  sameCity: FollowSuggestion[];
  sameInterest: FollowSuggestion[];
};

export type FollowSortOption = 'recent' | 'active';

export type FollowListItem = {
  author: PostAuthor;
  followedAt: string;
};
