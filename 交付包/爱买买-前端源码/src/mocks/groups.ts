import { Group } from '../types';

export const mockGroups: Group[] = [
  {
    id: 'g-001',
    companyId: 'c-001',
    title: '澄源生态农业春季考察团',
    destination: '云南·玉溪',
    targetSize: 30,
    memberCount: 18,
    deadline: '2025-03-10',
    status: 'forming',
    createdAt: '2025-03-01T08:00:00Z',
  },
  {
    id: 'g-002',
    companyId: 'c-002',
    title: '青禾智慧农场合作团',
    destination: '江苏·苏州',
    targetSize: 40,
    memberCount: 32,
    deadline: '2025-03-12',
    status: 'confirmed',
    createdAt: '2025-03-02T08:00:00Z',
  },
  {
    id: 'g-003',
    companyId: 'c-003',
    title: '北纬蓝莓研学团',
    destination: '辽宁·大连',
    targetSize: 25,
    memberCount: 25,
    deadline: '2025-03-08',
    status: 'inviting',
    createdAt: '2025-03-01T10:00:00Z',
  },
];
