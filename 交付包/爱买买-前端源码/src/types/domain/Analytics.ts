/**
 * 域模型：数据分析（企业内容面板 / 用户兴趣图谱）
 *
 * 用途：
 * - 爱买买圈 v2：企业内容分析面板、用户兴趣图谱占位页
 */
import { Post } from './Post';

export type CompanyContentTrendPoint = {
  label: string;
  value: number;
};

export type CompanyContentStats = {
  companyId: string;
  companyName: string;
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  engagementRate: number;
  topTags: string[];
  weeklyTrend: CompanyContentTrendPoint[];
  topPosts: Post[];
};

export type InterestTag = {
  label: string;
  weight: number;
};

export type UserInterestProfile = {
  userId: string;
  summary: string[];
  tags: InterestTag[];
  behaviors: string[];
};
