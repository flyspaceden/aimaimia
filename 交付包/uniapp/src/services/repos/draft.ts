// 草稿仓库：发布草稿列表/保存占位
import type { Result, PagedResult } from '../types';
import type { AiMusicTrack } from './ai';
import { mockPage } from './mock';

export type Draft = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  images: string[];
  template: 'story' | 'diary' | 'recipe' | 'general';
  coverIndex: number;
  music?: AiMusicTrack;
  visibility: 'public' | 'followers' | 'private';
  allowComments: boolean;
  syncToCompany: boolean;
  updatedAt: string;
};

export type DraftInput = Omit<Draft, 'id' | 'updatedAt'> & { id?: string };

const drafts: Draft[] = [
  {
    id: 'd1',
    title: '雨季育苗期注意事项',
    content: '整理了雨季育苗的温湿度控制与病虫害预防策略。',
    tags: ['育苗期', '种植日志'],
    images: ['https://placehold.co/640x640/png'],
    template: 'diary',
    coverIndex: 0,
    visibility: 'public',
    allowComments: true,
    syncToCompany: false,
    updatedAt: '2024-12-05 09:10',
  },
  {
    id: 'd2',
    title: '高山蓝莓甜度记录',
    content: '记录蓝莓甜度变化与采摘窗口期建议。',
    tags: ['有机', '产地记录'],
    images: ['https://placehold.co/640x520/png', 'https://placehold.co/640x720/png'],
    template: 'story',
    coverIndex: 0,
    visibility: 'public',
    allowComments: true,
    syncToCompany: true,
    updatedAt: '2024-12-04 16:30',
  },
];

export const DraftRepo = {
  list: async (params: { page: number; pageSize: number }): Promise<Result<PagedResult<Draft>>> => {
    return mockPage(drafts, params.page, params.pageSize);
  },
  // 草稿详情：后端需根据 draftId 返回具体草稿内容
  getById: async (draftId: string): Promise<Result<Draft>> => {
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '草稿不存在' } };
    }
    return { ok: true, data: draft };
  },
  // 删除草稿：后端需删除草稿并返回结果
  remove: async (draftId: string): Promise<Result<{ ok: true }>> => {
    if (!draftId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少草稿信息' } };
    }
    return { ok: true, data: { ok: true } };
  },
  save: async (payload: DraftInput): Promise<Result<{ id: string }>> => {
    return { ok: true, data: { id: `draft-${Date.now()}` } };
  },
};
