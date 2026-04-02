import { CompanyContentStats, UserInterestProfile } from '../types';
import { mockPosts } from './posts';

const companyPosts = mockPosts.filter((post) => post.author.type === 'company' && post.author.companyId === 'c-002');
const totalLikes = companyPosts.reduce((sum, post) => sum + post.likeCount, 0);
const totalComments = companyPosts.reduce((sum, post) => sum + post.commentCount, 0);
const totalShares = companyPosts.reduce((sum, post) => sum + (post.shareCount ?? 0), 0);
const totalPosts = companyPosts.length;
const engagementRate = totalPosts
  ? Number(((totalLikes + totalComments + totalShares) / totalPosts / 100).toFixed(2))
  : 0;

export const mockCompanyContentStats: CompanyContentStats = {
  companyId: 'c-002',
  companyName: '青禾智慧农场',
  totalPosts,
  totalLikes,
  totalComments,
  totalShares,
  engagementRate,
  topTags: ['#成长期#', '有机蔬菜', '智慧温室'],
  weeklyTrend: [
    { label: '周一', value: 12 },
    { label: '周二', value: 18 },
    { label: '周三', value: 9 },
    { label: '周四', value: 24 },
    { label: '周五', value: 16 },
    { label: '周六', value: 28 },
    { label: '周日', value: 20 },
  ],
  topPosts: companyPosts.slice(0, 2),
};

export const mockUserInterestProfile: UserInterestProfile = {
  userId: 'u-001',
  summary: ['偏好有机蔬菜与轻食教程', '关注智慧温室与种植日志'],
  tags: [
    { label: '有机蔬菜', weight: 78 },
    { label: '轻食', weight: 64 },
    { label: '蓝莓', weight: 52 },
    { label: '种植日志', weight: 46 },
    { label: '供应链', weight: 38 },
  ],
  behaviors: ['近 7 天点赞 12 次', '收藏商品 3 件', '评论互动 4 次'],
};
