import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  type FundType,
} from '@/api/fund-ledgers';
import { getAdminErrorMessage } from '@/utils/adminErrorMessage';
import {
  EVENT_LABELS,
  FUND_TYPE_COLORS,
  FUND_TYPE_LABELS,
  LedgerEntryDescriptions,
  dateTime,
  money,
  sourceTag,
} from './common';

export default function FundLedgerEntryDetailPage() {
  const navigate = useNavigate();
  const { fundType: rawFundType, id } = useParams<{ fundType: string; id: string }>();
  const fundType = rawFundType as FundType;
  const query = useQuery({
    queryKey: ['admin', 'fund-ledgers', 'entry', fundType, id],
    queryFn: () => getFundLedgerEntry(fundType, id!),
    enabled: !!fundType && !!id,
  });

  if (query.isLoading) {
    return <Card style={{ margin: 24 }}><Skeleton active /></Card>;
  }
  if (query.isError || !query.data) {
    return (
      <Result
        status="error"
        title="流水加载失败"
        subTitle={getAdminErrorMessage(query.error, '暂时无法读取该流水')}
        extra={<Space><Button onClick={() => query.refetch()}>重试</Button><Button onClick={() => navigate(`/fund-ledgers/${fundType}`)}>返回流水</Button></Space>}
      />
    );
  }

  const entry = query.data;
  const snapshot = entry.snapshot || entry.metadata;

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space>
          <Button onClick={() => navigate(`/fund-ledgers/${fundType}`)}>返回流水</Button>
          <Typography.Title level={3} style={{ margin: 0 }}>基金流水详情</Typography.Title>
        </Space>
        <Alert type="info" showIcon message={entry.metadata?.historical ? "历史流水按原记录展示，未记录的余额及计算依据不补造。" : "该记录为不可覆盖的账本事件。冲回、冲正和回款通过新事件关联原流水，不会删除原记录。"} />
        <Card title={<Space><Tag color={FUND_TYPE_COLORS[fundType]}>{FUND_TYPE_LABELS[fundType] || fundType}</Tag><span>{entry.entryNo || entry.id}</span></Space>}>
          <LedgerEntryDescriptions entry={entry} />
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginTop: 16 }}>
            <Descriptions.Item label="事件类型">{EVENT_LABELS[entry.eventType] || entry.eventType}</Descriptions.Item>
            <Descriptions.Item label="来源类型">{sourceTag(entry.sourceType)}</Descriptions.Item>
            <Descriptions.Item label="发生时间">{dateTime(entry.occurredAt || entry.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="可用余额后">{money(entry.availableAfter)}</Descriptions.Item>
            <Descriptions.Item label="冻结余额后">{money(entry.frozenAfter)}</Descriptions.Item>
            <Descriptions.Item label="预留余额后">{money(entry.reservedAfter)}</Descriptions.Item>
            <Descriptions.Item label="待追偿后">{money(entry.recoveryDueAfter)}</Descriptions.Item>
            <Descriptions.Item label="公司">{entry.companyId ? <Link to={`/fund-ledgers/companies/${entry.companyId}`}>{entry.companyName || entry.companyId}</Link> : '-'}</Descriptions.Item>
            <Descriptions.Item label="关联订单">{entry.orderId || '-'}</Descriptions.Item>
            <Descriptions.Item label="关联付款单">{entry.paymentId || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>
        {snapshot && (
          <Card title="计算与来源快照">
            <Typography.Paragraph copyable={{ text: JSON.stringify(snapshot, null, 2) }}>
              <pre style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(snapshot, null, 2)}</pre>
            </Typography.Paragraph>
          </Card>
        )}
        <Card title="关联记录">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="原流水">{entry.reversalOfId || '-'}</Descriptions.Item>
            <Descriptions.Item label="关联流水">{entry.relatedEntryId || '-'}</Descriptions.Item>
            <Descriptions.Item label="付款单">{entry.paymentId || '-'}</Descriptions.Item>
            <Descriptions.Item label="操作者">{entry.operator?.realName || entry.operator?.username || entry.operator?.id || '系统任务'}</Descriptions.Item>
            <Descriptions.Item label="原因">{entry.reason || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>
      </Space>
    </div>
  );
}
