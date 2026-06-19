import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Select, Space, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { getDeliveryOrders } from '@/api/delivery-management';
import type { DeliveryOrderSummary } from '@/types/delivery-management';
import { DetailLinkButton, MoneyBreakdown, PageHeader, StatusPill } from './components';
import { formatDateTime, getErrorMessage, getOrderAmountSummary, orderStatusOptions } from './utils';

export default function DeliveryOrdersPage() {
  const [status, setStatus] = useState<string | undefined>();
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });

  const query = useQuery({
    queryKey: ['delivery-orders', pagination.current, pagination.pageSize, status],
    queryFn: () =>
      getDeliveryOrders({
        page: pagination.current,
        pageSize: pagination.pageSize,
        status,
      }),
  });

  const columns: ColumnsType<DeliveryOrderSummary> = [
    { title: '订单 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    {
      title: '买家 / 单位',
      key: 'buyer',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{record.user?.nickname || record.user?.phone || record.userId}</span>
          <span>{record.unit?.name || record.unitId}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (value: string) => <StatusPill value={value} />,
    },
    {
      title: '金额拆分',
      key: 'money',
      width: 260,
      render: (_, record) => {
        const summary = getOrderAmountSummary(record);
        return <MoneyBreakdown {...summary} />;
      },
    },
    {
      title: '子单数',
      key: 'subOrders',
      width: 90,
      render: (_, record) => record.subOrders.length,
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      key: 'paidAt',
      width: 150,
      render: formatDateTime,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, record) => <DetailLinkButton to={`/orders/${record.id}`} />,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送订单"
        subtitle="订单列表中明确区分买家金额、商家供货、商家应结和平台差额。"
        extra={(
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 180 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
            options={orderStatusOptions.map((item) => ({ label: item, value: item }))}
          />
        )}
      />

      <Card>
        <Table<DeliveryOrderSummary>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1280 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无订单' }}
          pagination={{
            current: query.data?.page ?? pagination.current,
            pageSize: query.data?.pageSize ?? pagination.pageSize,
            total: query.data?.total ?? 0,
            showSizeChanger: true,
          }}
          onChange={(nextPagination) => setPagination(nextPagination)}
        />
      </Card>
    </div>
  );
}
