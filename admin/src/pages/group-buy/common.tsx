import { Avatar, Space, Tag, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import type {
  AdminGroupBuyUserSummary,
  GroupBuyActivityStatus,
  GroupBuyCodeStatus,
  GroupBuyInstanceStatus,
  GroupBuyRebateLedgerStatus,
  GroupBuyRebateLedgerType,
  GroupBuyReferralStatus,
} from '@/types';

export const money = (value?: number | null) => `¥${Number(value ?? 0).toFixed(2)}`;

export const activityStatusMap: Record<GroupBuyActivityStatus, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  ACTIVE: { text: '进行中', color: 'green' },
  PAUSED: { text: '已暂停', color: 'orange' },
  ENDED: { text: '已结束', color: 'red' },
};

export const instanceStatusMap: Record<GroupBuyInstanceStatus, { text: string; color: string }> = {
  QUALIFICATION_PENDING: { text: '待生成分享码', color: 'gold' },
  SHARING: { text: '分享中', color: 'green' },
  COMPLETED: { text: '已完成', color: 'blue' },
  TERMINATED: { text: '已结束分享', color: 'default' },
  QUALIFICATION_ABANDONED: { text: '已放弃', color: 'default' },
  QUALIFICATION_INVALID: { text: '资格无效', color: 'red' },
  EXPIRED: { text: '已过期', color: 'red' },
};

export const codeStatusMap: Record<GroupBuyCodeStatus, { text: string; color: string }> = {
  PENDING: { text: '待启用', color: 'gold' },
  ACTIVE: { text: '可用', color: 'green' },
  DISABLED: { text: '已停用', color: 'default' },
  COMPLETED: { text: '已完成', color: 'blue' },
  EXPIRED: { text: '已过期', color: 'red' },
};

export const referralStatusMap: Record<GroupBuyReferralStatus, { text: string; color: string }> = {
  CANDIDATE: { text: '待确认', color: 'gold' },
  VALID: { text: '有效', color: 'green' },
  INVALID: { text: '无效', color: 'red' },
  VOIDED: { text: '已作废', color: 'default' },
};

export const ledgerTypeMap: Record<GroupBuyRebateLedgerType, { text: string; color: string }> = {
  PENDING_REBATE: { text: '待返还', color: 'gold' },
  RELEASE: { text: '返还货款', color: 'green' },
  VOID: { text: '作废', color: 'default' },
  WITHDRAW: { text: '提现', color: 'blue' },
  DEDUCT: { text: '抵扣', color: 'purple' },
  REFUND_RETURN: { text: '退回', color: 'red' },
  ADMIN_ADJUST: { text: '后台调整', color: 'orange' },
};

export const ledgerStatusMap: Record<GroupBuyRebateLedgerStatus, { text: string; color: string }> = {
  PENDING: { text: '待处理', color: 'gold' },
  AVAILABLE: { text: '可用', color: 'green' },
  RESERVED: { text: '已预占', color: 'purple' },
  COMPLETED: { text: '已完成', color: 'blue' },
  VOIDED: { text: '已作废', color: 'default' },
  FAILED: { text: '失败', color: 'red' },
};

export function StatusTag<T extends string>({
  value,
  map,
}: {
  value?: T | null;
  map: Record<T, { text: string; color: string }>;
}) {
  if (!value) return <Tag>未知</Tag>;
  const item = map[value];
  return <Tag color={item?.color || 'default'}>{item?.text || value}</Tag>;
}

export function GroupBuyUser({ user, compact = true }: { user?: AdminGroupBuyUserSummary | null; compact?: boolean }) {
  if (!user) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Space>
      <Avatar src={user.profile?.avatarUrl} icon={<UserOutlined />} size={compact ? 32 : 40} />
      <BuyerIdentityText
        buyerNo={user.buyerNo}
        userId={user.id}
        nickname={user.profile?.nickname || '-'}
        compact={compact}
      />
    </Space>
  );
}
