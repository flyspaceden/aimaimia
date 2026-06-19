import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Input, Table } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { getDeliveryUsers } from '@/api/delivery-management';
import type { DeliveryUserSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import { formatDateTime, getErrorMessage } from './utils';

export default function DeliveryUsersPage() {
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
  });

  const query = useQuery({
    queryKey: ['delivery-users', pagination.current, pagination.pageSize, keyword],
    queryFn: () =>
      getDeliveryUsers({
        page: pagination.current,
        pageSize: pagination.pageSize,
        keyword,
      }),
  });

  const columns: ColumnsType<DeliveryUserSummary> = [
    { title: '用户 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '手机号', dataIndex: 'phone', key: 'phone', width: 140 },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname', width: 140 },
    {
      title: '当前单位',
      key: 'currentUnit',
      width: 180,
      render: (_, record) => record.currentUnit?.name ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: string) => <StatusPill value={value} />,
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 160,
      render: formatDateTime,
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
      fixed: 'right',
      width: 90,
      render: (_, record) => <DetailLinkButton to={`/users/${record.id}`} />,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送用户"
        subtitle="查看配送买家账号、当前单位和登录状态。"
        extra={(
          <Input.Search
            allowClear
            placeholder="搜手机号或昵称"
            style={{ width: 280 }}
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            onSearch={(value) => {
              setKeyword(value.trim());
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
          />
        )}
      />
      <Card>
        <Table<DeliveryUserSummary>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1100 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无配送用户' }}
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
