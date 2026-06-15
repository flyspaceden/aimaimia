import type { ReactNode } from 'react';
import { Space, Tooltip, Typography } from 'antd';

type BuyerIdentityTextProps = {
  buyerNo?: string | null;
  userId?: string | null;
  nickname?: ReactNode;
  phone?: ReactNode;
  compact?: boolean;
  showInternalId?: boolean;
};

export default function BuyerIdentityText({
  buyerNo,
  userId,
  nickname,
  phone,
  compact = false,
  showInternalId = true,
}: BuyerIdentityTextProps) {
  const displayName = nickname || phone || null;
  const primaryId = buyerNo || '非买家账号';
  const internalId = userId || null;

  return (
    <Space direction="vertical" size={0} style={{ maxWidth: '100%' }}>
      {displayName ? (
        <Typography.Text ellipsis style={{ maxWidth: compact ? 140 : 220 }}>
          {displayName}
        </Typography.Text>
      ) : null}
      <Typography.Text
        copyable={buyerNo ? { text: buyerNo } : false}
        style={{ fontSize: compact ? 12 : 13, fontFamily: buyerNo ? 'monospace' : undefined }}
        type={buyerNo ? undefined : 'secondary'}
      >
        {primaryId}
      </Typography.Text>
      {showInternalId && internalId && internalId !== buyerNo ? (
        <Tooltip title={internalId}>
          <Typography.Text
            type="secondary"
            copyable={{ text: internalId }}
            style={{ fontSize: 12, fontFamily: 'monospace' }}
          >
            内部ID: {compact ? `…${internalId.slice(-8)}` : internalId}
          </Typography.Text>
        </Tooltip>
      ) : null}
    </Space>
  );
}
