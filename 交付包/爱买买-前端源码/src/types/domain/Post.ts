/**
 * 域模型：帖子（Post）与作者（PostAuthor）
 *
 * 用途：
 * - 爱买买圈信息流、帖子详情、我的发布、企业动态
 * - 运营/风控字段（审核状态、举报数、精华、贡献值）为 v2 预留
 */
import { AiMusicTrack } from './Ai';
import { ContentModerationStatus } from './Moderation';

export type PostAuthorType = 'company' | 'user';

export type PostAuthor = {
  id: string;
  name: string;
  avatar?: string;
  type: PostAuthorType;
  verified?: boolean;
  title?: string;
  tags?: string[];
  companyId?: string;
  isFollowed?: boolean;
  intimacyLevel?: number;
  followerCount?: number;
  city?: string;
  interestTags?: string[];
};

export type PostTemplate = 'story' | 'diary' | 'recipe' | 'general';
export type PostVisibility = 'public' | 'followers' | 'private';

export type Post = {
  id: string;
  title: string;
  content: string;
  images: string[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  shareCount?: number;
  likedBy: string[];
  productId?: string;
  productTagLabel?: string;
  tags?: string[];
  template?: PostTemplate;
  music?: AiMusicTrack;
  visibility?: PostVisibility;
  allowComments?: boolean;
  syncToCompany?: boolean;
  isFeatured?: boolean;
  contributionScore?: number;
  moderationStatus?: ContentModerationStatus;
  reportCount?: number;
  author: PostAuthor;
};
