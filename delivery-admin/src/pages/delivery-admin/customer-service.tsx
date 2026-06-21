import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getDeliveryCustomerServiceList } from '@/api/delivery-management';
import type { DeliveryConversation } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import { conversationStatusOptions, formatDateTime, formatDeliveryDisplayText, getErrorMessage } from './utils';

export default function DeliveryCustomerServicePage() {
  const [status, setStatus] = useState<string | undefined>();
  const query = useQuery({
    queryKey: ['delivery-customer-service', status],
    queryFn: () => getDeliveryCustomerServiceList({ status }),
  });

  const columns: ColumnsType<DeliveryConversation> = [
    { title: '会话编号', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '主题', dataIndex: 'subject', key: 'subject', width: 220, ellipsis: true, render: (value) => value || '-' },
    {
      title: '关联对象',
      key: 'relation',
      width: 220,
      render: (_, record) => [record.user?.nickname || record.user?.phone || record.userId, record.unit?.name || record.unitId, record.order?.id || record.orderId].filter(Boolean).join(' / ') || '-',
    },
    { title: '来源', dataIndex: 'source', key: 'source', width: 100 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: string) => <StatusPill value={value} /> },
    { title: '最近消息', dataIndex: 'lastMessagePreview', key: 'lastMessagePreview', ellipsis: true },
    { title: '最近时间', dataIndex: 'lastMessageAt', key: 'lastMessageAt', width: 150, render: formatDateTime },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, record) => <DetailLinkButton to={`/customer-service/${record.id}`} />,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送客服会话"
        subtitle="后端当前返回会话数组，前端按最新消息时间展示。"
        extra={(
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 180 }}
            value={status}
            onChange={setStatus}
            options={conversationStatusOptions.map((item) => ({ label: formatDeliveryDisplayText(item), value: item }))}
          />
        )}
      />
      <Card>
        <Table<DeliveryConversation>
          rowKey="id"
          columns={columns}
          dataSource={query.data ?? []}
          loading={query.isLoading}
          scroll={{ x: 1260 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无会话' }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </Card>
    </div>
  );
}
