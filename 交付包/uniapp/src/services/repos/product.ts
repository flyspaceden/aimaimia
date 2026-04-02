// 商品仓库：商品列表/详情接口占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type Product = {
  id: string;
  title: string;
  price: number;
  unit: string;
  origin: string;
  image: string;
  tags: string[];
  strikePrice?: number;
  categoryId?: string;
};

const products: Product[] = [
  {
    id: 'p1',
    title: '有机小番茄礼盒',
    price: 39.9,
    unit: '盒',
    origin: '昆明 · 有机基地',
    image: 'https://placehold.co/600x600/png',
    tags: ['可信溯源', '当季鲜采'],
    strikePrice: 49.9,
    categoryId: 'fresh',
  },
  {
    id: 'p2',
    title: '高山蓝莓鲜果',
    price: 59.0,
    unit: '盒',
    origin: '云南 · 高山果园',
    image: 'https://placehold.co/600x720/png',
    tags: ['有机认证', '地理标志'],
    strikePrice: 69.0,
    categoryId: 'fruit',
  },
  {
    id: 'p3',
    title: '阳光草莓',
    price: 29.9,
    unit: '盒',
    origin: '浙江 · 生态种植',
    image: 'https://placehold.co/600x640/png',
    tags: ['当季鲜采', '检测报告'],
    categoryId: 'fruit',
  },
  {
    id: 'p4',
    title: '脆甜黄瓜',
    price: 18.8,
    unit: '斤',
    origin: '山东 · 直供基地',
    image: 'https://placehold.co/600x560/png',
    tags: ['产地直供', '可信溯源'],
    categoryId: 'vegetable',
  },
  {
    id: 'p5',
    title: '有机鸡蛋 30 枚',
    price: 42.0,
    unit: '盒',
    origin: '安徽 · 林下散养',
    image: 'https://placehold.co/600x680/png',
    tags: ['有机认证', '检测报告'],
    categoryId: 'fresh',
  },
  {
    id: 'p6',
    title: '原香糯玉米',
    price: 12.8,
    unit: '根',
    origin: '东北 · 黑土产区',
    image: 'https://placehold.co/600x520/png',
    tags: ['当季鲜采', '地理标志'],
    categoryId: 'grain',
  },
  {
    id: 'p7',
    title: '当季脐橙',
    price: 26.0,
    unit: '斤',
    origin: '赣南 · 生态果园',
    image: 'https://placehold.co/600x700/png',
    tags: ['可信溯源', '当季鲜采'],
    categoryId: 'fruit',
  },
  {
    id: 'p8',
    title: '山泉小土豆',
    price: 16.5,
    unit: '斤',
    origin: '云南 · 高山泉水',
    image: 'https://placehold.co/600x620/png',
    tags: ['产地直供', '检测报告'],
    categoryId: 'vegetable',
  },
];

export const ProductRepo = {
  list: async (params: { page: number; pageSize: number; category?: string }): Promise<Result<PagedResult<Product>>> => {
    const filtered = params.category ? products.filter((item) => item.categoryId === params.category) : products;
    return mockPage(filtered, params.page, params.pageSize);
  },
  getById: async (id: string): Promise<Result<Product | null>> => {
    const found = products.find((item) => item.id === id) || null;
    return { ok: true, data: found };
  },
};
