import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Space, Typography } from 'antd';
import dayjs from 'dayjs';
import { getCaptainOrders } from '@/api/captain';
import type { CaptainOrderAttribution } from '@/types';
import { CaptainUser, money, percent } from './common';

export default function CaptainOrdersPage() {
  const columns: ProColumns<CaptainOrderAttribution>[] = [
    { title: '关键词', dataIndex: 'keyword', hideInTable: true },
    { title: '月份', dataIndex: 'month', valueType: 'dateMonth', hideInTable: true },
    { title: '团长用户 ID', dataIndex: 'captainUserId', hideInTable: true },
    {
      title: '订单',
      width: 180,
      render: (_, record) => (
        <Typography.Text copyable={{ text: record.orderId }} style={{ fontFamily: 'monospace' }}>
          {record.orderId.slice(-12)}
        </Typography.Text>
      ),
    },
    { title: '买家', search: false, width: 230, render: (_, record) => <CaptainUser user={record.buyer} /> },
    { title: '一级团长', search: false, width: 230, render: (_, record) => <CaptainUser user={record.directCaptain} /> },
    { title: '二级团长', search: false, width: 230, render: (_, record) => <CaptainUser user={record.indirectCaptain} /> },
    {
      title: '佣金基数',
      search: false,
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{money(record.commissionBase)}</Typography.Text>
          <Typography.Text type="secondary">退款 {money(record.refundAmount)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '费率',
      search: false,
      width: 120,
      render: (_, record) => `${percent(record.directRate)} / ${percent(record.indirectRate)}`,
    },
    { title: '状态', dataIndex: 'status', width: 120 },
    { title: '归因时间', search: false, width: 170, render: (_, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm') },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<CaptainOrderAttribution>
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getCaptainOrders({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            month: params.month as string | undefined,
            captainUserId: params.captainUserId as string | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
        headerTitle="订单归因"
      />
    </div>
  );
}
