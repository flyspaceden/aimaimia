import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Select, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { getDeliveryUnits } from '@/api/delivery-management';
import type { DeliveryUnitSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import { formatDateTime, formatAddress, getErrorMessage, unitStatusOptions } from './utils';

export default function DeliveryUnitsPage() {
  const [status, setStatus] = useState<string | undefined>();
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });

  const query = useQuery({
    queryKey: ['delivery-units', pagination.current, pagination.pageSize, status],
    queryFn: () =>
      getDeliveryUnits({
        page: pagination.current,
        pageSize: pagination.pageSize,
        status,
      }),
  });

  const columns: ColumnsType<DeliveryUnitSummary> = [
    { title: '单位 ID', dataIndex: 'id', key: 'id', width: 140, ellipsis: true },
    { title: '单位名称', dataIndex: 'name', key: 'name', width: 180 },
    {
      title: '所属用户',
      key: 'user',
      width: 160,
      render: (_, record) => record.user?.nickname || record.user?.phone || record.userId,
    },
    { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 120 },
    { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 140 },
    {
      title: '地址',
      key: 'address',
      render: (_, record) => formatAddress(record),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: string) => <StatusPill value={value} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, record) => <DetailLinkButton to={`/units/${record.id}`} />,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送单位"
        subtitle="维护配送单位基础档案，并通过配置页控制字段展示。"
        extra={(
          <Select
            allowClear
            placeholder="筛选状态"
            style={{ width: 180 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
            options={unitStatusOptions.map((item) => ({ label: item, value: item }))}
          />
        )}
      />
      <Card>
        <Table<DeliveryUnitSummary>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1200 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无配送单位' }}
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
