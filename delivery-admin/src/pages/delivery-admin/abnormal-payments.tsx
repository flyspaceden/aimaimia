import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { getDeliveryAbnormalPayments } from '@/api/delivery-management';
import type { DeliveryAbnormalPayment } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import { formatDateTime, formatMoney, getErrorMessage } from './utils';

export default function DeliveryAbnormalPaymentsPage() {
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });

  const query = useQuery({
    queryKey: ['delivery-abnormal-payments', pagination.current, pagination.pageSize],
    queryFn: () =>
      getDeliveryAbnormalPayments({
        page: pagination.current,
        pageSize: pagination.pageSize,
      }),
  });

  const columns: ColumnsType<DeliveryAbnormalPayment> = [
    { title: '支付单编号', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '商户单号', dataIndex: 'merchantOrderNo', key: 'merchantOrderNo', width: 180, ellipsis: true },
    { title: '渠道', dataIndex: 'channel', key: 'channel', width: 100 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: string) => <StatusPill value={value} /> },
    { title: '金额', dataIndex: 'amountCents', key: 'amountCents', width: 110, render: (value: number) => formatMoney(value) },
    { title: '订单', key: 'order', width: 150, render: (_, record) => record.order?.id ?? record.orderId ?? '-' },
    { title: '异常摘要', dataIndex: 'exceptionSummary', key: 'exceptionSummary', ellipsis: true },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 150, render: formatDateTime },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="异常支付" subtitle="仅拉取后端标记为 FAILED 的支付记录，用于人工跟进。" />
      <Card>
        <Table<DeliveryAbnormalPayment>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1240 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无异常支付' }}
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
