import { UserProfile } from '../types';

export const mockUserProfile: UserProfile = {
  id: 'u-001',
  name: '林青禾',
  phone: '13812345678',
  email: 'linqinghe@example.com',
  wechatNickname: '林青禾',
  avatar: 'https://placehold.co/200x200/png',
  level: '生长会员',
  levelProgress: 0.62,
  growthPoints: 620,
  nextLevelPoints: 1000,
  points: 280,
  location: '上海',
  interests: ['有机蔬菜', '蓝莓', '轻食'],
  avatarFrame: {
    id: 'frame-vip-01',
    type: 'vip',
    label: '丰收会员框',
  },
  hasAgreedReturnPolicy: false,
};
