import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Space, Table, Tabs, Tag, Typography } from 'antd';
import { CustomerServiceOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import { getDeliveryCustomerServiceList } from '@/api/delivery-management';
import type { DeliveryConversation } from '@/types/delivery-management';
import { PageHeader } from './components';
import { formatDateTime, getErrorMessage } from './utils';
import {
  deliveryTicketStatusTabs,
  getConversationCategory,
  getConversationRelation,
  getConversationTitle,
  renderConversationStatus,
} from './cs-helpers';

export default function DeliveryCsTicketsPage() {
  const [activeTab, setActiveTab] = useState('ALL');

  const query = useQuery({
    queryKey: ['delivery-customer-service', 'tickets', activeTab],
    queryFn: () =>
      getDeliveryCustomerServiceList({
        status: activeTab === 'ALL' ? undefined : activeTab,
        pageSize: 100,
      }),
  });

  const rows = query.data ?? [];

  const columns: ColumnsType<DeliveryConversation> = [
    {
      title: '工单编号',
      dataIndex: 'id',
      width: 150,
      ellipsis: true,
      render: (id: string) => <Typography.Text copyable={{ text: id }}>{id}</Typography.Text>,
    },
    {
      title: '用户/单位/订单',
      key: 'relation',
      width: 260,
      ellipsis: true,
      render: (_, record) => getConversationRelation(record),
    },
    {
      title: '类别',
      key: 'category',
      width: 120,
      render: (_, record) => <Tag>{getConversationCategory(record)}</Tag>,
    },
    {
      title: '优先级',
      key: 'priority',
      width: 100,
      render: (_, record) => <Tag color={record.status === 'OPEN' ? 'orange' : 'default'}>{record.status === 'OPEN' ? '普通' : '-'}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: renderConversationStatus,
    },
    {
      title: '摘要',
      key: 'summary',
      ellipsis: true,
      render: (_, record) => record.lastMessagePreview || getConversationTitle(record),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: formatDateTime,
    },
  ];

  const expandedRowRender = (record: DeliveryConversation) => (
    <Space direction="vertical" size={8}>
      <Typography.Text>关联会话：{record.id}</Typography.Text>
      <Typography.Text type="secondary">最近消息：{record.lastMessagePreview || '-'}</Typography.Text>
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送工单管理"
        subtitle="配送后端当前以客服会话承载工单处理信息，独立工单接口接入后本页可直接切换数据源。"
      />

      <ProCard
        title={(
          <Space>
            <CustomerServiceOutlined />
            <span>工单列表</span>
          </Space>
        )}
        headerBordered
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={deliveryTicketStatusTabs.map((tab) => ({ key: tab.key, label: tab.label }))}
          style={{ marginBottom: 16 }}
        />
        <Table<DeliveryConversation>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={query.isLoading}
          expandable={{ expandedRowRender }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无工单' }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1120 }}
        />
      </ProCard>
    </div>
  );
}
