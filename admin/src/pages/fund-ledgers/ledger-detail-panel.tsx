import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  getFundLedgerEntry,
  type FundLedgerEntry,
  type FundType,
} from '@/api/fund-ledgers';
import { PERMISSIONS } from '@/constants/permissions';
import { usePermission } from '@/hooks/usePermission';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import {
  EVENT_LABELS,
  FUND_TYPE_COLORS,
  FUND_TYPE_LABELS,
  LedgerEntryDescriptions,
  dateTime,
  money,
  signedMoney,
  sourceTag,
} from './common';
import { fundLink, safeFundReturn } from './workspace-state';

interface LedgerDetailPanelProps {
  fundType: FundType;
  id?: string | null;
  returnTo?: string;
  onClose?: () => void;
}

function metadataFlag(entry: FundLedgerEntry, key: string): boolean {
  return Boolean(entry.metadata && typeof entry.metadata[key] === 'boolean' && entry.metadata[key]);
}

function metadataText(entry: FundLedgerEntry, key: string): string | undefined {
  const value = entry.metadata?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function ratioText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '未记录';
  const ratio = Number(value);
  return `${(Math.abs(ratio) <= 1 ? ratio * 100 : ratio).toFixed(2)}%`;
}

function calculateBasis(entry: FundLedgerEntry): string {
  if (entry.eventType !== 'ACCRUAL') {
    return '本笔为结算或状态事件，金额沿用账本记录，不按利润基数 × 比例重新计算。';
  }
  if (entry.profitBase === null || entry.profitBase === undefined || entry.allocationRatio === null || entry.allocationRatio === undefined) {
    return '未记录利润基数或实际比例；不使用当前配置反推历史金额。';
  }
  return `利润基数 ${money(entry.profitBase)}，基金比例 ${ratioText(entry.allocationRatio)}；本笔计提 ${money(Math.abs(entry.amount))}，以公司归属分摊及分币取整后的账本金额为准。`;
}

function linkWithClose(path: string, label: string, onClose: () => void) {
  return <Link to={path} onClick={onClose}>{label}</Link>;
}

function LedgerDetailContent({
  entry,
  fundType,
  returnTo,
  onClose,
}: {
  entry: FundLedgerEntry;
  fundType: FundType;
  returnTo: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canReadIndustry = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_READ);
  const fullDetailPath = fundLink(`/fund-ledgers/entries/${fundType}/${encodeURIComponent(entry.id)}`, returnTo);
  const historical = metadataFlag(entry, 'historical');
  const sourceOperation = metadataText(entry, 'sourceOperation');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="金额与事件">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space wrap>
            <Tag color={FUND_TYPE_COLORS[fundType]}>{FUND_TYPE_LABELS[fundType] || fundType}</Tag>
            <Tag>{EVENT_LABELS[entry.eventType] || entry.eventType}</Tag>
            {sourceTag(entry.sourceType)}
          </Space>
          <Typography.Title level={2} style={{ margin: 0 }}>{signedMoney(entry.amount, entry.direction)}</Typography.Title>
          <Typography.Text type="secondary">{dateTime(entry.occurredAt || entry.createdAt)} · {entry.entryNo || entry.id}</Typography.Text>
        </Space>
      </Card>

      {historical && <Alert type="info" showIcon message="历史流水按原记录展示" description="历史记录缺少的余额与计算依据保持为未记录；不会使用当前配置补算。" />}

      <Card size="small" title="来源与账本记录">
        <LedgerEntryDescriptions entry={entry} />
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} style={{ marginTop: 12 }}>
          <Descriptions.Item label="来源订单">
            {entry.orderId ? linkWithClose(fundLink(`/orders/${encodeURIComponent(entry.orderId)}`, returnTo), entry.orderId, onClose) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源公司">
            {entry.companyId && canReadIndustry
              ? linkWithClose(fundLink(`/fund-ledgers/companies/${encodeURIComponent(entry.companyId)}`, returnTo), entry.companyName || entry.companyId, onClose)
              : entry.companyName || entry.companyId || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="付款单">
            {entry.paymentId && canReadIndustry
              ? linkWithClose(fundLink(`/fund-ledgers/payments/${encodeURIComponent(entry.paymentId)}`, returnTo), entry.paymentId, onClose)
              : entry.paymentId || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源操作">{sourceOperation || '系统记账'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title="计算依据">
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          <Typography.Text strong>{entry.eventType === 'ACCRUAL' ? '利润基数、基金比例与本笔计提' : '本笔金额口径'}</Typography.Text>
          <br />
          <Typography.Text>{calculateBasis(entry)}</Typography.Text>
        </Typography.Paragraph>
        {entry.ruleVersion && <Typography.Text type="secondary">规则版本：{entry.ruleVersion}</Typography.Text>}
      </Card>

      <Card size="small" title="余额变化">
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="可用余额后">{money(entry.availableAfter)}</Descriptions.Item>
          <Descriptions.Item label="冻结余额后">{money(entry.frozenAfter)}</Descriptions.Item>
          <Descriptions.Item label="付款预留后">{money(entry.reservedAfter)}</Descriptions.Item>
          <Descriptions.Item label="待追偿后">{money(entry.recoveryDueAfter)}</Descriptions.Item>
          <Descriptions.Item label="变动后余额">{money(entry.balanceAfter)}</Descriptions.Item>
          <Descriptions.Item label="方向">{entry.direction === 'CREDIT' ? '收入' : entry.direction === 'DEBIT' ? '支出' : '状态变动'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title="关联记录">
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="原流水">{entry.reversalOfId || '-'}</Descriptions.Item>
          <Descriptions.Item label="关联流水">{entry.relatedEntryId || '-'}</Descriptions.Item>
          <Descriptions.Item label="计提 / 分配">{entry.accrualId || entry.allocationId || '-'}</Descriptions.Item>
          <Descriptions.Item label="原因">{entry.reason || '-'}</Descriptions.Item>
          <Descriptions.Item label="操作者">{entry.operator?.realName || entry.operator?.username || entry.operator?.id || '系统任务'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>关闭</Button>
        <Button type="primary" onClick={() => { onClose(); navigate(fullDetailPath); }}>打开完整详情</Button>
      </Space>
    </Space>
  );
}

export function LedgerDetailPanel({ fundType, id, returnTo, onClose }: LedgerDetailPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const safeReturnTo = useMemo(() => {
    if (returnTo) return safeFundReturn(returnTo, `/fund-ledgers/${fundType}`);
    const current = new URLSearchParams(location.search);
    current.delete('entryId');
    return safeFundReturn(`${location.pathname}${current.toString() ? `?${current}` : ''}`, `/fund-ledgers/${fundType}`);
  }, [fundType, location.pathname, location.search, returnTo]);
  const close = onClose ?? (() => navigate(safeReturnTo));
  const entryQuery = useQuery({
    queryKey: ['admin', 'fund-ledgers', 'entry', fundType, id],
    queryFn: () => getFundLedgerEntry(fundType, id!),
    enabled: Boolean(id),
  });

  return (
    <Drawer
      title={entryQuery.data?.entryNo || '流水详情'}
      placement="right"
      width="min(720px, 100vw)"
      open={Boolean(id)}
      onClose={close}
      destroyOnClose
    >
      {entryQuery.isPending && <Skeleton active paragraph={{ rows: 12 }} />}
      {entryQuery.isError && (
        <Result
          status="error"
          title="流水加载失败"
          subTitle={getAdminErrorMessage(entryQuery.error, '暂时无法读取该流水')}
          extra={<Space><Button onClick={() => { void entryQuery.refetch(); }}>重试</Button><Button onClick={close}>关闭</Button></Space>}
        />
      )}
      {entryQuery.data && <LedgerDetailContent entry={entryQuery.data} fundType={fundType} returnTo={safeReturnTo} onClose={close} />}
    </Drawer>
  );
}

export default LedgerDetailPanel;
