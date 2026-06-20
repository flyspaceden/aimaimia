import type { ReactNode } from 'react';
import { Alert, Button, Descriptions, Empty, Result, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { formatMoney, safeStringify, statusColor } from './utils';

const { Text, Title } = Typography;

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <Space
      align="start"
      style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}
    >
      <div>
        <Title level={3} style={{ margin: 0 }}>
          {props.title}
        </Title>
        {props.subtitle ? (
          <Text type="secondary">{props.subtitle}</Text>
        ) : null}
      </div>
      {props.extra}
    </Space>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return <Alert type="error" showIcon message={message} />;
}

export function EmptyPanel({ description }: { description: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

export function NotFoundPanel({ title, subtitle }: { title: string; subtitle?: string }) {
  return <Result status="404" title={title} subTitle={subtitle} />;
}

export function StatusPill({ value }: { value?: string | null }) {
  return <Tag color={statusColor(value)}>{value || '-'}</Tag>;
}

export function MoneyText({
  cents,
  strong,
}: {
  cents?: number | null;
  strong?: boolean;
}) {
  const content = formatMoney(cents);
  return strong ? <Text strong>{content}</Text> : <>{content}</>;
}

export function MoneyBreakdown(props: {
  buyerAmountCents?: number | null;
  supplyAmountCents?: number | null;
  settlementAmountCents?: number | null;
  platformDiffAmountCents?: number | null;
}) {
  return (
    <Space direction="vertical" size={0}>
      <Text>买家金额: {formatMoney(props.buyerAmountCents)}</Text>
      <Text>商家供货: {formatMoney(props.supplyAmountCents)}</Text>
      <Text>商家应结: {formatMoney(props.settlementAmountCents)}</Text>
      <Text type="secondary">平台差额: {formatMoney(props.platformDiffAmountCents)}</Text>
    </Space>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  const text = safeStringify(value);
  if (!text) {
    return <Text type="secondary">-</Text>;
  }
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        background: '#f7faff',
        border: '1px solid #dbeafe',
        borderRadius: 6,
        maxHeight: 320,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 12,
      }}
    >
      {text}
    </pre>
  );
}

export function DetailDescriptions(props: {
  items: Array<{ key: string; label: string; children: ReactNode }>;
  columns?: number;
}) {
  return (
    <Descriptions
      bordered
      size="small"
      column={props.columns ?? 2}
      items={props.items}
    />
  );
}

export function DetailLinkButton({ to }: { to: string }) {
  return (
    <Link to={to}>
      <Button type="link" size="small">
        查看详情
      </Button>
    </Link>
  );
}
