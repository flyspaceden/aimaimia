/* eslint-disable react-refresh/only-export-components -- shared render helpers intentionally live with ledger page components. */
import { Button, Descriptions, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  FundLedgerEntry,
  FundType,
  IndustryFundPaymentStatus,
  PageResult,
} from '@/api/fund-ledgers';

export const FUND_TYPE_LABELS: Record<FundType, string> = {
  LEGACY_INDUSTRY_FUND: '历史平台产业基金',
  INDUSTRY_FUND: '产业基金',
  CHARITY_FUND: '慈善基金',
  TECH_FUND: '科技基金',
  RESERVE_FUND: '备用金',
  PLATFORM_PROFIT: '平台利润',
  FUND_POOL: '历史资金池',
  POINTS: '历史积分池',
};

export const FUND_TYPE_COLORS: Record<FundType, string> = {
  LEGACY_INDUSTRY_FUND: 'default',
  INDUSTRY_FUND: 'blue',
  CHARITY_FUND: 'magenta',
  TECH_FUND: 'purple',
  RESERVE_FUND: 'orange',
  PLATFORM_PROFIT: 'green',
  FUND_POOL: 'default',
  POINTS: 'default',
};

export const EVENT_LABELS: Record<string, string> = {
  STATE_CHANGE: '状态变更',
  ACCRUAL: '计提',
  FREEZE: '冻结',
  RELEASE: '释放',
  REVERSAL: '冲回',
  TRANSFER_IN: '转入',
  TRANSFER_OUT: '转出',
  RESERVE: '付款预留',
  UNRESERVE: '解除预留',
  PAYMENT: '付款登记',
  PAYMENT_RESERVED: '付款预留',
  PAYMENT_UNRESERVED: '解除付款预留',
  PAYMENT_CONFIRMED: '付款确认',
  PAYMENT_REVERSED: '付款冲正',
  REVERSAL_PENDING: '待冲回核实',
  PAYMENT_REVERSAL: '付款冲正',
  RECOVERY: '实际回款',
  ACCOUNT_UPDATED: '账户更新',
  LEDGER_CREATED: '账本记录',
};

export const SOURCE_LABELS: Record<string, string> = {
  NORMAL: '普通',
  VIP: 'VIP',
  LEGACY: '历史路径',
};

export const PAYMENT_STATUS_META: Record<string, { label: string; color: string }> = {
  RESERVED: { label: '待付款核实', color: 'processing' },
  PAYMENT_RESERVED: { label: '待付款核实', color: 'processing' },
  PAYMENT_UNRESERVED: { label: '已取消预留', color: 'default' },
  PAID: { label: '已付款登记', color: 'success' },
  PAYMENT_CONFIRMED: { label: '已付款登记', color: 'success' },
  CANCELLED: { label: '已取消', color: 'default' },
  REVERSED: { label: '已冲正', color: 'warning' },
  PAYMENT_REVERSED: { label: '已冲正', color: 'warning' },
  REVERSAL_PENDING: { label: '待冲回核实', color: 'warning' },
};

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '未记录';
  const amount = Number(value);
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function signedMoney(value: number | null | undefined, direction?: string): ReactNode {
  const amount = Number(value ?? 0);
  if (direction === 'INTERNAL') return <Typography.Text type="secondary">{amount === 0 ? '状态记录' : `内部变动 ${money(amount)}`}</Typography.Text>;
  const isDebit = direction === 'DEBIT' || amount < 0;
  return (
    <Typography.Text type={isDebit ? 'danger' : 'success'}>
      {isDebit ? '-' : '+'}{money(Math.abs(amount))}
    </Typography.Text>
  );
}

export function dateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function fundTag(fundType: FundType): ReactNode {
  return <Tag color={FUND_TYPE_COLORS[fundType]}>{FUND_TYPE_LABELS[fundType] ?? fundType}</Tag>;
}

export function eventTag(eventType?: string | null): ReactNode {
  const label = eventType ? EVENT_LABELS[eventType] ?? eventType : '-';
  return <Tag>{label}</Tag>;
}

export function sourceTag(sourceType?: string | null): ReactNode {
  if (!sourceType) return '-';
  return <Tag color={sourceType === 'VIP' ? 'gold' : sourceType === 'NORMAL' ? 'blue' : 'default'}>
    {SOURCE_LABELS[sourceType] ?? sourceType}
  </Tag>;
}

export function paymentStatusTag(status?: IndustryFundPaymentStatus | null): ReactNode {
  if (!status) return '-';
  const meta = PAYMENT_STATUS_META[status] ?? { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export function getRows<T>(value: unknown): PageResult<T> {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nested = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record;
  const items = Array.isArray(nested.items) ? nested.items as T[] : [];
  return {
    items,
    total: typeof nested.total === 'number' ? nested.total : items.length,
    page: typeof nested.page === 'number' ? nested.page : 1,
    pageSize: typeof nested.pageSize === 'number' ? nested.pageSize : items.length || 20,
    nextCursor: typeof nested.nextCursor === 'string' ? nested.nextCursor : null,
    asOf: typeof nested.asOf === 'string' ? nested.asOf : null,
  };
}

export function getArray<T>(value: unknown, keys = ['funds', 'items']): T[] {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nested = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : record;
  for (const key of keys) {
    if (Array.isArray(nested[key])) return nested[key] as T[];
  }
  return [];
}

export function entryLink(entry: FundLedgerEntry, fundType?: FundType): ReactNode {
  if (!entry.id || !fundType) return entry.id || '-';
  return <Link to={`/fund-ledgers/entries/${fundType}/${entry.id}`}>{entry.entryNo || entry.id}</Link>;
}

export function companyLink(companyId?: string | null, companyName?: string | null): ReactNode {
  if (!companyId) return companyName || '-';
  return <Link to={`/fund-ledgers/companies/${companyId}`}>{companyName || companyId}</Link>;
}

export function LedgerEntryDescriptions({ entry }: { entry: FundLedgerEntry }): ReactNode {
  return (
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
      <Descriptions.Item label="流水号">{entry.entryNo || entry.id}</Descriptions.Item>
      <Descriptions.Item label="事件">{eventTag(entry.eventType)}</Descriptions.Item>
      <Descriptions.Item label="来源">{sourceTag(entry.sourceType)}</Descriptions.Item>
      <Descriptions.Item label="金额">{signedMoney(entry.amount, entry.direction)}</Descriptions.Item>
      <Descriptions.Item label="变动后余额">{money(entry.balanceAfter)}</Descriptions.Item>
      <Descriptions.Item label="待追偿后">{money(entry.recoveryDueAfter)}</Descriptions.Item>
      <Descriptions.Item label="发生时间">{dateTime(entry.occurredAt || entry.createdAt)}</Descriptions.Item>
      <Descriptions.Item label="来源订单">{entry.orderId || '-'}</Descriptions.Item>
      <Descriptions.Item label="计提/分配">{entry.accrualId || entry.allocationId || '-'}</Descriptions.Item>
      <Descriptions.Item label="付款单">{entry.paymentId || '-'}</Descriptions.Item>
      <Descriptions.Item label="原流水">{entry.reversalOfId || '-'}</Descriptions.Item>
      <Descriptions.Item label="规则版本">{entry.ruleVersion || '-'}</Descriptions.Item>
      <Descriptions.Item label="原因" span={2}>{entry.reason || '-'}</Descriptions.Item>
    </Descriptions>
  );
}

export function BackButton({ children = '返回' }: { children?: ReactNode }): ReactNode {
  return <Button onClick={() => window.history.back()}>{children}</Button>;
}

export function PageNotice({ children }: { children: ReactNode }): ReactNode {
  return <Space direction="vertical" size={2} style={{ width: '100%' }}>{children}</Space>;
}
