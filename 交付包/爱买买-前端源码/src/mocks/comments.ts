import { Comment } from '../types';
import { mockUserProfile } from './userProfile';

export const mockComments: Comment[] = [
  {
    id: 'cmt-001',
    wishId: 'w-001',
    content: '这个需求很好，期待企业回应。',
    author: {
      id: 'u-002',
      name: '陆知野',
      avatar: 'https://placehold.co/200x200/png',
    },
    likeCount: 4,
    likedBy: ['u-001'],
    createdAt: '2024-12-02T09:20:00Z',
  },
  {
    id: 'cmt-002',
    wishId: 'w-001',
    content: '我们基地可以尝试，欢迎私信沟通。',
    author: {
      id: 'u-010',
      name: '企业代表·澄源',
      avatar: 'https://placehold.co/200x200/png',
    },
    likeCount: 6,
    likedBy: ['u-001', 'u-003'],
    createdAt: '2024-12-02T10:12:00Z',
  },
  {
    id: 'cmt-003',
    wishId: 'w-001',
    content: '已经收到~稍后会统一回复。',
    author: {
      id: mockUserProfile.id,
      name: mockUserProfile.name,
      avatar: mockUserProfile.avatar,
    },
    likeCount: 1,
    likedBy: [],
    createdAt: '2024-12-02T11:40:00Z',
    parentId: 'cmt-002',
    replyTo: {
      id: 'cmt-002',
      name: '企业代表·澄源',
    },
  },
  {
    id: 'cmt-004',
    wishId: 'w-002',
    content: '礼盒水果我也想要，最好是带产地故事。',
    author: {
      id: 'u-004',
      name: '顾清',
      avatar: 'https://placehold.co/200x200/png',
    },
    likeCount: 3,
    likedBy: [],
    createdAt: '2024-11-19T09:10:00Z',
  },
  {
    id: 'cmt-005',
    wishId: 'w-002',
    content: '如果能做企业团购价格更好。',
    author: {
      id: mockUserProfile.id,
      name: mockUserProfile.name,
      avatar: mockUserProfile.avatar,
    },
    likeCount: 2,
    likedBy: ['u-002'],
    createdAt: '2024-11-19T10:40:00Z',
    parentId: 'cmt-004',
    replyTo: {
      id: 'cmt-004',
      name: '顾清',
    },
  },
  {
    id: 'cmt-006',
    wishId: 'w-004',
    content: '视频溯源太有必要了，支持。',
    author: {
      id: 'u-005',
      name: '宋远',
      avatar: 'https://placehold.co/200x200/png',
    },
    likeCount: 5,
    likedBy: ['u-002'],
    createdAt: '2024-12-09T08:30:00Z',
  },
];
