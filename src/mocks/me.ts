import { CheckInStatus, RecommendationItem, Task } from '../types';
import { mockProducts } from './products';

export const mockTasks: Task[] = [
  {
    id: 'task-001',
    title: '完善健康偏好',
    rewardLabel: '+30 成长值',
    rewardGrowth: 30,
    status: 'todo',
    targetRoute: '/settings',
  },
  {
    id: 'task-002',
    title: '首次使用 AI 买买',
    rewardLabel: '+50 成长值',
    rewardGrowth: 50,
    status: 'inProgress',
    targetRoute: '/ai/chat',
  },
  {
    id: 'task-003',
    title: '预约一次考察',
    rewardLabel: '+20 积分',
    rewardPoints: 20,
    status: 'todo',
    targetRoute: '/(tabs)/museum',
  },
];

export const mockCheckInStatus: CheckInStatus = {
  streakDays: 3,
  todayChecked: false,
  rewards: [
    { day: 1, label: '+5 积分', points: 5 },
    { day: 2, label: '+8 积分', points: 8 },
    { day: 3, label: '+10 积分', points: 10 },
    { day: 4, label: '+12 积分', points: 12 },
    { day: 5, label: '+15 积分', points: 15 },
    { day: 6, label: '+20 积分', points: 20 },
    { day: 7, label: '大奖', points: 50, growth: 20, highlight: true },
  ],
};

export const mockRecommendations: RecommendationItem[] = [
  {
    id: 'rec-001',
    product: mockProducts[0],
    reason: '推荐理由：你关注了青禾智慧农场',
  },
  {
    id: 'rec-002',
    product: mockProducts[2],
    reason: '推荐理由：当季本地新鲜采摘',
  },
  {
    id: 'rec-003',
    product: mockProducts[3],
    reason: '推荐理由：低糖轻食偏好',
  },
];
