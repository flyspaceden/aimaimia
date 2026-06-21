import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Col, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import { getDeliveryCustomerServiceList } from '@/api/delivery-management';
import type { DeliveryConversation } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader } from './components';
import { formatDeliveryDisplayText, getErrorMessage } from './utils';
import {
  deliveryConversationStatusOptions,
  getConversationCategory,
  getConversationRelation,
  getConversationTitle,
  renderConversationStatus,
  renderConversationTime,
} from './cs-helpers';

export default function DeliveryCsWorkstationPage() {
  const [status, setStatus] = useState<string | undefined>();
  const query = useQuery({
    queryKey: ['delivery-customer-service', 'workstation', status],
    queryFn: () => getDeliveryCustomerServiceList({ status, pageSize: 50 }),
  });

  const rows = query.data ?? [];
  const openCount = rows.filter((item) => item.status === 'OPEN').length;
  const closedCount = rows.filter((item) => item.status === 'CLOSED').length;

  const columns: ColumnsType<DeliveryConversation> = [
    {
      title: '会话编号',
      dataIndex: 'id',
      key: 'id',
      width: 150,
      ellipsis: true,
      render: (id: string) => <Typography.Text copyable={{ text: id }}>{id}</Typography.Text>,
    },
    {
      title: '主题',
      key: 'subject',
      width: 240,
      ellipsis: true,
      render: (_, record) => getConversationTitle(record),
    },
    {
      title: '类型',
      key: 'category',
      width: 120,
      render: (_, record) => <Tag>{getConversationCategory(record)}</Tag>,
    },
    {
      title: '关联对象',
      key: 'relation',
      width: 260,
      ellipsis: true,
      render: (_, record) => getConversationRelation(record),
    },
    { title: '来源', dataIndex: 'source', key: 'source', width: 110, render: (value: string) => formatDeliveryDisplayText(value) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: renderConversationStatus },
    { title: '最近消息', dataIndex: 'lastMessagePreview', key: 'lastMessagePreview', ellipsis: true, render: (value) => value || '-' },
    { title: '最近时间', dataIndex: 'lastMessageAt', key: 'lastMessageAt', width: 160, render: renderConversationTime },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_, record) => <DetailLinkButton to={`/customer-service/${record.id}`} />,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送对话工作台"
        subtitle="集中处理配送用户、配送单位、订单和商家协作相关会话。"
        extra={(
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 180 }}
            value={status}
            onChange={setStatus}
            options={deliveryConversationStatusOptions.map((item) => ({ label: formatDeliveryDisplayText(item), value: item }))}
          />
        )}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <ProCard>
            <Space>
              <MessageOutlined style={{ color: '#1677ff', fontSize: 22 }} />
              <StatisticLike label="当前会话" value={rows.length} />
            </Space>
          </ProCard>
        </Col>
        <Col xs={24} md={8}>
          <ProCard>
            <StatisticLike label="待处理" value={openCount} />
          </ProCard>
        </Col>
        <Col xs={24} md={8}>
          <ProCard>
            <StatisticLike label="已关闭" value={closedCount} />
          </ProCard>
        </Col>
      </Row>

      <ProCard
        title="会话列表"
        headerBordered
        extra={<Button onClick={() => query.refetch()}>刷新</Button>}
      >
        <Table<DeliveryConversation>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={query.isLoading}
          scroll={{ x: 1320 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无会话' }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </ProCard>
    </div>
  );
}

function StatisticLike({ label, value }: { label: string; value: number }) {
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Title level={3} style={{ margin: 0 }}>{value}</Typography.Title>
    </Space>
  );
}
