import { Avatar, Space, Tag, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import type {
  CaptainApplicationStatus,
  CaptainLedgerStatus,
  CaptainLedgerType,
  CaptainProfileStatus,
  CaptainSettlementStatus,
  UserLite,
} from '@/types';

export const money = (value?: number | null) => `¥${Number(value ?? 0).toFixed(2)}`;
export const percent = (value?: number | null) => `${(Number(value ?? 0) * 100).toFixed(2)}%`;

export const captainProfileStatusMap: Record<CaptainProfileStatus, { text: string; color: string }> = {
  ACTIVE: { text: '启用', color: 'green' },
  PAUSED: { text: '暂停', color: 'orange' },
  DISABLED: { text: '禁用', color: 'red' },
};

export const captainLedgerTypeMap: Record<CaptainLedgerType, { text: string; color: string }> = {
  DIRECT_ORDER: { text: '一级逐单', color: 'green' },
  INDIRECT_ORDER: { text: '二级逐单', color: 'cyan' },
  MANAGEMENT_ALLOWANCE: { text: '管理津贴', color: 'blue' },
  GROWTH_BONUS: { text: '增长奖', color: 'purple' },
  CULTIVATION_BONUS: { text: '辅导奖', color: 'magenta' },
  TEAM_POOL: { text: '团队池', color: 'geekblue' },
  VOID: { text: '冲回', color: 'red' },
  ADJUSTMENT: { text: '调整', color: 'orange' },
};

export const captainLedgerStatusMap: Record<CaptainLedgerStatus, { text: string; color: string }> = {
  FROZEN: { text: '冻结', color: 'gold' },
  AVAILABLE: { text: '可用', color: 'green' },
  VOIDED: { text: '作废', color: 'default' },
  WITHDRAWN: { text: '已支付', color: 'blue' },
  CLAWBACK_PENDING: { text: '待追扣', color: 'red' },
};

export const captainSettlementStatusMap: Record<CaptainSettlementStatus, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  PENDING_REVIEW: { text: '待审核', color: 'gold' },
  APPROVED: { text: '已审核', color: 'green' },
  PAID: { text: '已支付', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
};

export const captainApplicationStatusMap: Record<CaptainApplicationStatus, { text: string; color: string }> = {
  PENDING: { text: '待审核', color: 'gold' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已驳回', color: 'red' },
  WITHDRAWN: { text: '已撤回', color: 'default' },
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

export function CaptainUser({ user }: { user?: UserLite | null }) {
  if (!user) return <Typography.Text type="secondary">-</Typography.Text>;
  return (
    <Space>
      <Avatar size={32} src={user.profile?.avatarUrl} icon={<UserOutlined />} />
      <BuyerIdentityText
        buyerNo={user.buyerNo}
        userId={user.id}
        nickname={user.profile?.nickname || '-'}
        compact
      />
    </Space>
  );
}
