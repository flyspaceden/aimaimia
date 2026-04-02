// 企业仓库：企业列表/详情接口占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type Company = {
  id: string;
  name: string;
  cover: string;
  mainBusiness: string;
  location: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  distanceKm: number;
  badges: string[];
  latestTestedAt?: string;
  groupTargetSize?: number;
};

const companies: Company[] = [
  {
    id: 'c1',
    name: '青禾有机农场',
    cover: 'https://placehold.co/900x480/png',
    mainBusiness: '有机蔬菜供应商 · 全流程可视化',
    location: '浙江省杭州市',
    coordinates: { lat: 30.274, lng: 120.155 },
    distanceKm: 12.6,
    badges: ['品质认证', '产地直供', '优选基地'],
    latestTestedAt: '2024-12-05',
    groupTargetSize: 30,
  },
  {
    id: 'c2',
    name: '山谷果园',
    cover: 'https://placehold.co/900x480/png',
    mainBusiness: '高山水果种植 · 冷链直达',
    location: '云南省昆明市',
    coordinates: { lat: 24.88, lng: 102.83 },
    distanceKm: 58.2,
    badges: ['品质认证', '低碳种植'],
    latestTestedAt: '2024-12-02',
    groupTargetSize: 40,
  },
  {
    id: 'c3',
    name: '江南稻作基地',
    cover: 'https://placehold.co/900x480/png',
    mainBusiness: '稻米种植加工一体化',
    location: '江苏省苏州市',
    coordinates: { lat: 31.299, lng: 120.585 },
    distanceKm: 22.4,
    badges: ['品质认证', '产地直供'],
    latestTestedAt: '2024-11-28',
    groupTargetSize: 30,
  },
  {
    id: 'c4',
    name: '青山牧场',
    cover: 'https://placehold.co/900x480/png',
    mainBusiness: '牧草种植与乳制品一体化',
    location: '重庆市',
    coordinates: { lat: 29.563, lng: 106.551 },
    distanceKm: 120.8,
    badges: ['品质认证', '低碳种植'],
    latestTestedAt: '2024-12-01',
    groupTargetSize: 50,
  },
];

export const CompanyRepo = {
  list: async (params: { page: number; pageSize: number; keyword?: string }): Promise<Result<PagedResult<Company>>> => {
    return mockPage(companies, params.page, params.pageSize);
  },
  // 企业详情：后端需根据 id 返回单个企业
  getById: async (id: string): Promise<Result<Company>> => {
    const found = companies.find((item) => item.id === id);
    if (!found) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '企业不存在' } };
    }
    return { ok: true, data: found };
  },
};
