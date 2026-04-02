/**
 * 域模型：作者（Author）
 *
 * 用途：
 * - 用户/企业作者信息，用于关注关系、用户主页等
 */

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
