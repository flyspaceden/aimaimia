// 推荐仓库：为你推荐占位
import type { Result } from '../types';
import type { Product } from './product';

export type RecommendItem = {
  id: string;
  product: Product;
  reason: string;
};

const STORAGE_KEY = 'nm_recommend_hidden_v1';

const recommendations: RecommendItem[] = [
  {
    id: 'r1',
    product: {
      id: 'p1',
      title: '有机小番茄礼盒',
      price: 39.9,
      unit: '盒',
      origin: '昆明 · 有机基地',
      image: 'https://placehold.co/600x600/png',
      tags: ['可信溯源', '当季鲜采'],
    },
    reason: '推荐理由：因为你关注了青禾农场',
  },
  {
    id: 'r2',
    product: {
      id: 'p2',
      title: '高山蓝莓鲜果',
      price: 59.0,
      unit: '盒',
      origin: '云南 · 高山果园',
      image: 'https://placehold.co/600x720/png',
      tags: ['有机认证', '地理标志'],
    },
    reason: '推荐理由：当季本地新鲜采摘',
  },
];

const readHidden = (): string[] => {
  const raw = uni.getStorageSync(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

const writeHidden = (ids: string[]) => {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(ids));
};

export const RecommendRepo = {
  listForMe: async (): Promise<Result<RecommendItem[]>> => {
    const hidden = new Set(readHidden());
    const list = recommendations.filter((item) => !hidden.has(item.id));
    return { ok: true, data: list };
  },

  markNotInterested: async (id: string): Promise<Result<{ ok: true }>> => {
    const hidden = readHidden();
    if (!hidden.includes(id)) hidden.push(id);
    writeHidden(hidden);
    return { ok: true, data: { ok: true } };
  },
};
