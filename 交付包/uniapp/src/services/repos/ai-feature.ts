// AI 功能仓库：溯源/推荐/金融数据占位（需后端对接）
import type { Result } from '../types';

export type TraceStep = {
  id: string;
  title: string;
  description: string;
  status: 'done' | 'doing' | 'pending';
  time?: string;
  location?: string;
};

export type TraceOverview = {
  productId: string;
  productName: string;
  batchId: string;
  farmName: string;
  statusLabel: string;
  tags: string[];
  steps: TraceStep[];
};

export type RecommendInsight = {
  id: string;
  title: string;
  description: string;
  weight: number;
  tags: string[];
};

export type FinanceOffer = {
  id: string;
  title: string;
  amount: string;
  rate: string;
  term: string;
  status: 'available' | 'soon' | 'locked';
  desc: string;
};

export const AiFeatureRepo = {
  // AI 溯源概览占位
  getTraceOverview: async (): Promise<Result<TraceOverview>> => {
    return {
      ok: true,
      data: {
        productId: 'p1',
        productName: '高山小番茄礼盒',
        batchId: 'NM-2025-001',
        farmName: '青禾农场',
        statusLabel: '溯源链路已确认',
        tags: ['有机', '产地直供', '冷链'],
        steps: [
          {
            id: 's1',
            title: '育苗期',
            description: '温室育苗与监测数据确认。',
            status: 'done',
            time: '2024-11-18',
            location: '昆明',
          },
          {
            id: 's2',
            title: '采收期',
            description: '成熟采摘与质检中。',
            status: 'doing',
            time: '2024-12-02',
            location: '昆明',
          },
          {
            id: 's3',
            title: '流通期',
            description: '冷链运输与仓储。',
            status: 'pending',
          },
        ],
      },
    };
  },

  // AI 推荐画像占位
  getRecommendInsights: async (): Promise<Result<RecommendInsight[]>> => {
    return {
      ok: true,
      data: [
        {
          id: 'r1',
          title: '偏好有机蔬果',
          description: '浏览与收藏中有机标签占比最高。',
          weight: 0.42,
          tags: ['有机', '轻食', '产地直供'],
        },
        {
          id: 'r2',
          title: '关注同城农场',
          description: '近期互动集中在华东产地内容。',
          weight: 0.28,
          tags: ['同城', '生鲜', '短链'],
        },
      ],
    };
  },

  // AI 金融占位
  getFinanceOverview: async (): Promise<Result<{ offers: FinanceOffer[]; summary: string }>> => {
    return {
      ok: true,
      data: {
        summary: '基于经营数据生成授信额度与补贴方案（占位）',
        offers: [
          {
            id: 'f1',
            title: '农企订单贷',
            amount: '¥300,000',
            rate: '4.2%',
            term: '6 个月',
            status: 'available',
            desc: '面向订单稳定企业的授信产品。',
          },
          {
            id: 'f2',
            title: '设备升级贷',
            amount: '¥120,000',
            rate: '3.8%',
            term: '12 个月',
            status: 'soon',
            desc: '支持设施农业升级与改造。',
          },
        ],
      },
    };
  },
};
