import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
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
import { FundHeading } from './workspace';
import { fundLink, safeFundReturn } from './workspace-state';

const validFundTypes = Object.keys(FUND_TYPE_LABELS) as FundType[];

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

function calculationText(entry: FundLedgerEntry): string {
  if (entry.eventType !== 'ACCRUAL') {
    return '本笔为结算或状态事件，金额沿用账本记录，不按利润基数 × 比例重新计算。';
  }
  if (entry.profitBase === null || entry.profitBase === undefined || entry.allocationRatio === null || entry.allocationRatio === undefined) {
    return '未记录利润基数或实际比例；不使用当前配置反推历史金额。';
  }
  return `利润基数 ${money(entry.profitBase)}，基金比例 ${ratioText(entry.allocationRatio)}；本笔计提 ${money(Math.abs(entry.amount))}，以公司归属分摊及分币取整后的账本金额为准。`;
}

function safeEntryId(id: string | undefined): string | undefined {
  const value = id?.trim();
  return value || undefined;
}

function DetailSections({ entry, fundType, returnTo }: { entry: FundLedgerEntry; fundType: FundType; returnTo: string }) {
  const { hasPermission } = usePermission();
  const canReadIndustry = hasPermission(PERMISSIONS.INDUSTRY_FUNDS_READ);
  const historical = metadataFlag(entry, 'historical');
  const sourceOperation = metadataText(entry, 'sourceOperation');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {historical && <Alert type="info" showIcon message="历史流水按原记录展示" description="历史记录缺少的余额与计算依据保持为未记录；不会使用当前配置补算。" />}
      <Card title={<Space><Tag color={FUND_TYPE_COLORS[fundType]}>{FUND_TYPE_LABELS[fundType] || fundType}</Tag><span>{entry.entryNo || entry.id}</span></Space>}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space wrap>
            <Tag>{EVENT_LABELS[entry.eventType] || entry.eventType}</Tag>
            {sourceTag(entry.sourceType)}
          </Space>
          <Typography.Title level={2} style={{ margin: 0 }}>{signedMoney(entry.amount, entry.direction)}</Typography.Title>
          <Typography.Text type="secondary">发生时间：{dateTime(entry.occurredAt || entry.createdAt)}</Typography.Text>
        </Space>
        <div style={{ marginTop: 16 }}><LedgerEntryDescriptions entry={entry} /></div>
      </Card>

      <Card title="来源与计算依据">
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="来源订单">
            {entry.orderId ? <Link to={fundLink(`/orders/${encodeURIComponent(entry.orderId)}`, returnTo)}>{entry.orderId}</Link> : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源公司">
            {entry.companyId && canReadIndustry
              ? <Link to={fundLink(`/fund-ledgers/companies/${encodeURIComponent(entry.companyId)}`, returnTo)}>{entry.companyName || entry.companyId}</Link>
              : entry.companyName || entry.companyId || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="付款单">
            {entry.paymentId && canReadIndustry
              ? <Link to={fundLink(`/fund-ledgers/payments/${encodeURIComponent(entry.paymentId)}`, returnTo)}>{entry.paymentId}</Link>
              : entry.paymentId || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源操作">{sourceOperation || '系统记账'}</Descriptions.Item>
          <Descriptions.Item label={entry.eventType === 'ACCRUAL' ? '利润基数、基金比例与本笔计提' : '本笔金额口径'} span={2}>{calculationText(entry)}</Descriptions.Item>
          <Descriptions.Item label="规则版本">{entry.ruleVersion || '未记录'}</Descriptions.Item>
          <Descriptions.Item label="原因">{entry.reason || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="余额变化">
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="可用余额后">{money(entry.availableAfter)}</Descriptions.Item>
          <Descriptions.Item label="冻结余额后">{money(entry.frozenAfter)}</Descriptions.Item>
          <Descriptions.Item label="付款预留后">{money(entry.reservedAfter)}</Descriptions.Item>
          <Descriptions.Item label="待追偿后">{money(entry.recoveryDueAfter)}</Descriptions.Item>
          <Descriptions.Item label="变动后余额">{money(entry.balanceAfter)}</Descriptions.Item>
          <Descriptions.Item label="方向">{entry.direction === 'CREDIT' ? '收入' : entry.direction === 'DEBIT' ? '支出' : '状态变动'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="关联记录">
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="原流水">{entry.reversalOfId || '-'}</Descriptions.Item>
          <Descriptions.Item label="关联流水">{entry.relatedEntryId || '-'}</Descriptions.Item>
          <Descriptions.Item label="计提 / 分配">{entry.accrualId || entry.allocationId || '-'}</Descriptions.Item>
          <Descriptions.Item label="操作者">{entry.operator?.realName || entry.operator?.username || entry.operator?.id || '系统任务'}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

export default function FundLedgerEntryDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { fundType: rawFundType, id: rawId } = useParams<{ fundType: string; id: string }>();
  const fundType = rawFundType as FundType;
  const id = safeEntryId(rawId);
  const valid = validFundTypes.includes(fundType);
  const returnTo = useMemo(
    () => safeFundReturn(searchParams.get('returnTo'), `/fund-ledgers/${fundType}`),
    [fundType, searchParams],
  );
  const query = useQuery({
    queryKey: ['admin', 'fund-ledgers', 'entry', fundType, id],
    queryFn: () => getFundLedgerEntry(fundType, id!),
    enabled: valid && Boolean(id),
  });

  if (!valid || !id) {
    return <Result status="error" title="流水地址无效" extra={<Button onClick={() => navigate(returnTo)}>返回流水</Button>} />;
  }

  if (query.isPending) {
    return <div className="fund-workspace"><Skeleton active paragraph={{ rows: 12 }} /></div>;
  }

  if (query.isError || !query.data) {
    return (
      <div className="fund-workspace">
        <Result
          status="error"
          title="流水加载失败"
          subTitle={getAdminErrorMessage(query.error, '暂时无法读取该流水')}
          extra={<Space><Button onClick={() => { void query.refetch(); }}>重试</Button><Button onClick={() => navigate(returnTo)}>返回流水</Button></Space>}
        />
      </div>
    );
  }

  const entry = query.data;
  return (
    <div className="fund-workspace">
      <FundHeading
        title="基金流水详情"
        description="账本事件只读展示；冲回、回款和更正通过新的关联事件记录。"
        actions={<Button onClick={() => navigate(returnTo)}>返回流水</Button>}
      />
      <DetailSections entry={entry} fundType={fundType} returnTo={returnTo} />
    </div>
  );
}
