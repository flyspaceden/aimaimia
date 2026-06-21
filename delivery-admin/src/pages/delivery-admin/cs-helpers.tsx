import { Tag, Typography } from 'antd';
import type { DeliveryConfigItem, DeliveryConversation, JsonValue } from '@/types/delivery-management';
import { formatDateTime, formatDeliveryDisplayText } from './utils';

export const deliveryConversationStatusOptions = ['OPEN', 'CLOSED'];

export const deliveryTicketStatusTabs = [
  { key: 'ALL', label: '全部' },
  { key: 'OPEN', label: '待处理' },
  { key: 'CLOSED', label: '已关闭' },
];

export type CustomerServiceDefaults = {
  serviceHours: string;
  escalationMinutes: number;
  quickQuestions: string[];
  defaultReply: string;
};

const defaultCustomerServiceDefaults: CustomerServiceDefaults = {
  serviceHours: '09:00-18:00',
  escalationMinutes: 30,
  quickQuestions: [],
  defaultReply: '您好，这里是配送客服，请提供配送订单号或配送单位名称。',
};

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getCustomerServiceDefaults(configs?: DeliveryConfigItem[]): CustomerServiceDefaults {
  const item = configs?.find((config) => config.key === 'CUSTOMER_SERVICE_DEFAULTS');
  const value = item?.value;
  if (!isJsonObject(value)) {
    return defaultCustomerServiceDefaults;
  }

  const quickQuestions = Array.isArray(value.quickQuestions)
    ? value.quickQuestions.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    serviceHours: typeof value.serviceHours === 'string' ? value.serviceHours : defaultCustomerServiceDefaults.serviceHours,
    escalationMinutes: typeof value.escalationMinutes === 'number' ? value.escalationMinutes : defaultCustomerServiceDefaults.escalationMinutes,
    quickQuestions,
    defaultReply: typeof value.defaultReply === 'string' ? value.defaultReply : defaultCustomerServiceDefaults.defaultReply,
  };
}

export function getCustomerServiceConfig(configs?: DeliveryConfigItem[]) {
  return configs?.find((config) => config.key === 'CUSTOMER_SERVICE_DEFAULTS') ?? null;
}

export function getConversationTitle(record: DeliveryConversation) {
  return record.subject || record.lastMessagePreview || '配送咨询';
}

export function getConversationCategory(record: DeliveryConversation) {
  if (record.orderId || record.subOrderId) {
    return '订单咨询';
  }
  if (record.merchantId) {
    return '商家协作';
  }
  if (record.unitId) {
    return '单位资料';
  }
  return '配送咨询';
}

export function getConversationRelation(record: DeliveryConversation) {
  const parts = [
    record.user?.nickname || record.user?.phone || record.userId,
    record.unit?.name || record.unitId,
    record.order?.id || record.orderId,
  ].filter(Boolean);
  return parts.join(' / ') || '-';
}

export function renderConversationStatus(status: string) {
  const color = status === 'OPEN' ? 'processing' : status === 'CLOSED' ? 'default' : 'default';
  return <Tag color={color}>{formatDeliveryDisplayText(status)}</Tag>;
}

export function renderConversationTime(value?: string | null) {
  return value ? formatDateTime(value) : <Typography.Text type="secondary">暂无消息</Typography.Text>;
}
