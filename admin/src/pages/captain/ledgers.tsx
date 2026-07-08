import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Typography } from 'antd';
import dayjs from 'dayjs';
import { getCaptainLedgers } from '@/api/captain';
import type { CaptainCommissionLedger, CaptainLedgerStatus, CaptainLedgerType } from '@/types';
import {
  CaptainUser,
  StatusTag,
  captainLedgerStatusMap,
  captainLedgerTypeMap,
  money,
  percent,
} from './common';

export default function CaptainLedgersPage() {
  const columns: ProColumns<CaptainCommissionLedger>[] = [
    { title: '关键词', dataIndex: 'keyword', hideInTable: true },
    { title: '用户 ID', dataIndex: 'userId', hideInTable: true },
    { title: '订单 ID', dataIndex: 'orderId', hideInTable: true },
    { title: '结算 ID', dataIndex: 'settlementId', hideInTable: true },
    {
      title: '用户',
      search: false,
      width: 230,
      render: (_, record) => <CaptainUser user={record.user} />,
    },
    {
      title: '类型',
      dataIndex: 'type',
      valueType: 'select',
      width: 140,
      valueEnum: Object.fromEntries(Object.entries(captainLedgerTypeMap).map(([key, value]) => [key, { text: value.text }])),
      render: (_, record) => <StatusTag value={record.type as CaptainLedgerType} map={captainLedgerTypeMap} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 120,
      valueEnum: Object.fromEntries(Object.entries(captainLedgerStatusMap).map(([key, value]) => [key, { text: value.text }])),
      render: (_, record) => <StatusTag value={record.status as CaptainLedgerStatus} map={captainLedgerStatusMap} />,
    },
    { title: '金额', search: false, width: 120, render: (_, record) => <Typography.Text strong>{money(record.amount)}</Typography.Text> },
    { title: '基数', search: false, width: 120, render: (_, record) => money(record.commissionBase) },
    { title: '费率', search: false, width: 100, render: (_, record) => record.rate == null ? '-' : percent(record.rate) },
    {
      title: '关联',
      search: false,
      width: 180,
      render: (_, record) => record.orderId || record.settlement?.month || record.refId || '-',
    },
    { title: '创建时间', search: false, width: 170, render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm') },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<CaptainCommissionLedger>
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getCaptainLedgers({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            userId: params.userId as string | undefined,
            orderId: params.orderId as string | undefined,
            settlementId: params.settlementId as string | undefined,
            type: params.type as string | undefined,
            status: params.status as string | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
        headerTitle="佣金流水"
      />
    </div>
  );
}
