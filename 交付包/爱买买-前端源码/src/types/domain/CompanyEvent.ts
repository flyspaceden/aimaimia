/**
 * 域模型：企业事件（CompanyEvent）
 *
 * 用途：
 * - 企业页日历：未来 7 天滚动窗口/整月视图；同一天可多个事件（按 startTime 排序）
 *
 * 后端接入建议：
 * - 事件类型中 “visit/activity/briefing” 需要走预约表单（见 `说明文档/后端接口清单.md#22-企业事件日历活动讲解参观`）
 */
export type CompanyEventType = 'visit' | 'activity' | 'briefing' | 'live';

export type CompanyEvent = {
  id: string;
  companyId: string;
  date: string;
  startTime: string;
  endTime?: string;
  title: string;
  type: CompanyEventType;
  description?: string;
  location?: string;
  capacity?: number;
  bookedCount?: number;
};
