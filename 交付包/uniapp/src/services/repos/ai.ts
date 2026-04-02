// AI 生成能力仓库：标签/配乐推荐占位（需后端对接）
import type { Result } from '../types';

export type AiTagSuggestion = {
  id: string;
  label: string;
  reason: string;
};

export type AiMusicTrack = {
  id: string;
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  duration: string;
};

export const AiRepo = {
  // AI 标签推荐：后端需根据标题/正文/模板生成标签与理由
  recommendTags: async (payload: {
    template: 'story' | 'diary' | 'recipe' | 'general';
    title: string;
    content: string;
  }): Promise<Result<AiTagSuggestion[]>> => {
    return {
      ok: true,
      data: [
        { id: 't1', label: '育苗期', reason: '内容提到生长阶段' },
        { id: 't2', label: '有机种植', reason: '强调绿色生产方式' },
        { id: 't3', label: '产地记录', reason: '包含产地故事线' },
      ],
    };
  },

  // AI 配乐推荐：后端需根据内容情绪生成曲目列表
  recommendMusic: async (payload: {
    template: 'story' | 'diary' | 'recipe' | 'general';
    title: string;
    content: string;
  }): Promise<Result<AiMusicTrack[]>> => {
    return {
      ok: true,
      data: [
        { id: 'm1', title: '清晨田野', artist: '爱买买AI', mood: '温暖', bpm: 92, duration: '1:24' },
        { id: 'm2', title: '雨后微风', artist: '爱买买AI', mood: '清新', bpm: 88, duration: '1:12' },
        { id: 'm3', title: '丰收时刻', artist: '爱买买AI', mood: '欢快', bpm: 110, duration: '1:36' },
      ],
    };
  },
};
