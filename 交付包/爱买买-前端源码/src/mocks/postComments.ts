import { PostComment } from '../types';
import { mockUserProfile } from './userProfile';

export const mockPostComments: PostComment[] = [
  {
    id: 'pc-001',
    postId: 'post-001',
    content: '温差控制得真细，学习了。',
    author: {
      id: 'u-004',
      name: '季燃',
      avatar: 'https://placehold.co/200x200/png',
    },
    likeCount: 6,
    likedBy: ['u-001'],
    createdAt: '2024-12-05T10:10:00Z',
  },
  {
    id: 'pc-002',
    postId: 'post-001',
    content: '同求养护方案，能分享更多吗？',
    author: {
      id: mockUserProfile.id,
      name: mockUserProfile.name,
      avatar: mockUserProfile.avatar,
    },
    likeCount: 3,
    likedBy: [],
    createdAt: '2024-12-05T10:30:00Z',
    parentId: 'pc-001',
    replyTo: {
      id: 'pc-001',
      name: '季燃',
    },
  },
  {
    id: 'pc-003',
    postId: 'post-002',
    content: '认证流程耗时吗？我们也准备做。',
    author: {
      id: 'u-007',
      name: '柒柒',
      avatar: 'https://placehold.co/200x200/png',
    },
    likeCount: 2,
    likedBy: [],
    createdAt: '2024-12-03T16:40:00Z',
  },
  {
    id: 'pc-004',
    postId: 'post-005',
    content: '这个光照曲线太实用，收藏了。',
    author: {
      id: 'u-010',
      name: '澄野',
      avatar: 'https://placehold.co/200x200/png',
    },
    likeCount: 5,
    likedBy: ['u-002'],
    createdAt: '2024-12-02T19:10:00Z',
  },
];
