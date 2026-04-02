/**
 * 域模型：考察团（Group）
 *
 * 用途：
 * - 企业页组团看板、考察团详情、参团确认与支付入口（占位）
 *
 * 后端接入建议：
 * - targetSize 阈值需支持企业可配置（默认 30）（见 `说明文档/后端接口清单.md#24-考察团group`）
 */
export type GroupStatus = 'forming' | 'inviting' | 'confirmed' | 'paid' | 'completed';

export type Group = {
  id: string;
  companyId: string;
  title: string;
  destination: string;
  targetSize: number;
  memberCount: number;
  deadline: string;
  status: GroupStatus;
  createdAt: string;
};
