import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Space, Typography } from 'antd';
import dayjs from 'dayjs';
import { getGroupBuyRebateLedgers } from '@/api/group-buy';
import type {
  AdminGroupBuyRebateLedger,
  GroupBuyRebateLedgerStatus,
  GroupBuyRebateLedgerType,
} from '@/types';
import {
  GroupBuyUser,
  StatusTag,
  ledgerStatusMap,
  ledgerTypeMap,
  money,
  referralStatusMap,
} from './common';

export default function GroupBuyRebateLedgersPage() {
  const columns: ProColumns<AdminGroupBuyRebateLedger>[] = [
    {
      title: '流水编号',
      dataIndex: 'keyword',
      width: 180,
      render: (_: unknown, record) => (
        <Typography.Text copyable={{ text: record.id }} style={{ fontFamily: 'monospace' }}>
          {record.id.slice(-12)}
        </Typography.Text>
      ),
    },
    {
      title: '用户',
      search: false,
      width: 260,
      render: (_: unknown, record) => <GroupBuyUser user={record.user} />,
    },
    {
      title: '类型',
      dataIndex: 'type',
      valueType: 'select',
      width: 140,
      valueEnum: {
        RELEASE: { text: '返还货款' },
        WITHDRAW: { text: '提现' },
        DEDUCT: { text: '抵扣' },
        REFUND_RETURN: { text: '退回' },
        ADMIN_ADJUST: { text: '后台调整' },
        VOID: { text: '作废' },
      },
      render: (_: unknown, record) => <StatusTag value={record.type} map={ledgerTypeMap} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 130,
      valueEnum: {
        PENDING: { text: '待处理' },
        AVAILABLE: { text: '可用' },
        RESERVED: { text: '已预占' },
        COMPLETED: { text: '已完成' },
        VOIDED: { text: '已作废' },
        FAILED: { text: '失败' },
      },
      render: (_: unknown, record) => <StatusTag value={record.status} map={ledgerStatusMap} />,
    },
    {
      title: '金额',
      search: false,
      width: 150,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{money(record.amount)}</Typography.Text>
          <Typography.Text type="secondary">
            {money(record.balanceBefore)} → {money(record.balanceAfter)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '活动商品',
      search: false,
      width: 220,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.instance?.activity?.title || '-'}</Typography.Text>
          <Typography.Text type="secondary">
            {record.instance?.code?.code || record.instanceId || '-'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '直接推荐',
      search: false,
      width: 170,
      render: (_: unknown, record) => record.referral ? (
        <Space direction="vertical" size={0}>
          <StatusTag value={record.referral.status} map={referralStatusMap} />
          <Typography.Text type="secondary">
            第 {record.referral.effectiveSequence || record.referral.candidateSequence || '-'} 位
          </Typography.Text>
        </Space>
      ) : '-',
    },
    {
      title: '关联订单',
      search: false,
      width: 160,
      render: (_: unknown, record) => record.orderId ? (
        <Typography.Text copyable={{ text: record.orderId }} style={{ fontFamily: 'monospace' }}>
          {record.orderId.slice(-10)}
        </Typography.Text>
      ) : '-',
    },
    {
      title: '创建时间',
      search: false,
      width: 170,
      render: (_: unknown, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<AdminGroupBuyRebateLedger>
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getGroupBuyRebateLedgers({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            type: params.type as GroupBuyRebateLedgerType | undefined,
            status: params.status as GroupBuyRebateLedgerStatus | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
      />
    </div>
  );
}
