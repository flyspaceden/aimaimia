import { AiFinanceService, AiRecommendInsight, AiTraceOverview } from '../types';

export const mockAiTraceOverview: AiTraceOverview = {
  productId: 'p-001',
  productName: '高山有机小番茄',
  batchId: 'YUXI-2024-09',
  farmName: '云岭有机基地',
  statusLabel: '已完成全链路溯源',
  tags: ['有机认证', '冷链配送', '检测通过'],
  steps: [
    {
      id: 'step-seed',
      title: '育苗准备',
      description: '温室育苗 18 天，记录温湿度与光照',
      status: 'done',
      time: '2024-08-12',
      location: '育苗棚',
    },
    {
      id: 'step-grow',
      title: '生态种养',
      description: '滴灌管理 + 生态防治，实时采集环境数据',
      status: 'done',
      time: '2024-08-30',
      location: '核心种植区',
    },
    {
      id: 'step-check',
      title: '质检抽检',
      description: '第三方检测机构完成农残与重金属检测',
      status: 'doing',
      time: '2024-09-14',
      location: '质检中心',
    },
    {
      id: 'step-logistics',
      title: '冷链运输',
      description: '全程冷链记录，温度稳定 2-6℃',
      status: 'pending',
      location: '冷链仓',
    },
  ],
};

export const mockAiRecommendInsights: AiRecommendInsight[] = [
  {
    id: 'insight-1',
    title: '偏好健康轻食',
    description: '你近期浏览了低糖、轻食类商品',
    weight: 0.82,
    tags: ['#轻食#', '#低糖#'],
  },
  {
    id: 'insight-2',
    title: '关注产地认证',
    description: '你收藏了有机认证、检测报告相关内容',
    weight: 0.76,
    tags: ['#有机#', '#品质认证#'],
  },
  {
    id: 'insight-3',
    title: '偏好短链冷链',
    description: '对冷链、溯源标签的点击率更高',
    weight: 0.68,
    tags: ['#冷链#', '#可信溯源#'],
  },
];

export const mockAiFinanceServices: AiFinanceService[] = [
  {
    id: 'finance-1',
    title: '企业采购授信',
    description: '为企业客户提供周期性授信额度',
    status: 'available',
    badge: '企业',
  },
  {
    id: 'finance-2',
    title: '农资分期服务',
    description: '面向农户的农资分期与补贴入口',
    status: 'soon',
    badge: '农户',
  },
  {
    id: 'finance-3',
    title: '订单保障保险',
    description: '提供运输、质量异常的风险保障',
    status: 'locked',
    badge: '平台',
  },
];
