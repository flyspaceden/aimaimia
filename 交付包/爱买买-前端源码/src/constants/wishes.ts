import { WishBadge, WishPowerLevel } from '../types';

export const wishPowerLevels: Array<{ id: WishPowerLevel; label: string; min: number }> = [
  { id: 'seed', label: '萌芽', min: 0 },
  { id: 'grow', label: '成长', min: 120 },
  { id: 'bloom', label: '繁茂', min: 260 },
];

export const wishBadges: WishBadge[] = [
  { id: 'creative', label: '创意之星', tone: 'accent' },
  { id: 'popular', label: '热门心愿', tone: 'brand' },
  { id: 'helper', label: '助愿使者', tone: 'neutral' },
  { id: 'fulfilled', label: '已实现', tone: 'accent' },
  { id: 'accepted', label: '企业接单', tone: 'brand' },
  { id: 'crowdfunding', label: '众筹中', tone: 'neutral' },
];

export const wishRankPeriods = [
  { id: 'weekly', label: '周榜' },
  { id: 'monthly', label: '月榜' },
];

export const wishCrowdfundingPresets = [10, 30, 50];
