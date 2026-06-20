import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { getDeliveryShippingRecords } from '@/api/delivery-management';
import type { DeliveryShippingRecord } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import { formatDateTime, formatMoney, getErrorMessage } from './utils';

export default function DeliveryShippingRecordsPage() {
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });

  const query = useQuery({
    queryKey: ['delivery-shipping-records', pagination.current, pagination.pageSize],
    queryFn: () =>
      getDeliveryShippingRecords({
        page: pagination.current,
        pageSize: pagination.pageSize,
      }),
  });

  const columns: ColumnsType<DeliveryShippingRecord> = [
    { title: '运单 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '订单 ID', dataIndex: 'orderId', key: 'orderId', width: 150, ellipsis: true },
    { title: '子订单 ID', dataIndex: 'subOrderId', key: 'subOrderId', width: 150, ellipsis: true },
    { title: '商家 ID', dataIndex: 'merchantId', key: 'merchantId', width: 150, ellipsis: true },
    { title: '承运商', dataIndex: 'carrierName', key: 'carrierName', width: 130 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: string) => <StatusPill value={value} /> },
    { title: '面单号', dataIndex: 'waybillNo', key: 'waybillNo', width: 140 },
    {
      title: '买家预估运费',
      dataIndex: 'estimatedUserShippingFeeCents',
      key: 'estimatedUserShippingFeeCents',
      width: 130,
      render: (value: number | null) => formatMoney(value),
    },
    {
      title: '承运实际成本',
      dataIndex: 'actualCarrierCostCents',
      key: 'actualCarrierCostCents',
      width: 130,
      render: (value: number | null) => formatMoney(value),
    },
    { title: '承运记录号', dataIndex: 'carrierRecordNo', key: 'carrierRecordNo', width: 160 },
    { title: '发货时间', dataIndex: 'shippedAt', key: 'shippedAt', width: 150, render: formatDateTime },
    { title: '签收时间', dataIndex: 'deliveredAt', key: 'deliveredAt', width: 150, render: formatDateTime },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="配送发货记录" subtitle="查看面单号、买家预估运费和顺丰实际成本。" />

      <Card>
        <Table<DeliveryShippingRecord>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1640 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无发货记录' }}
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
