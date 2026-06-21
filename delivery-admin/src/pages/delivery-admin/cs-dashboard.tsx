import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Col, Row, Statistic, Table, Tag } from 'antd';
import { ClockCircleOutlined, MessageOutlined, TeamOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import { getDeliveryCustomerServiceList } from '@/api/delivery-management';
import type { DeliveryConversation } from '@/types/delivery-management';
import { PageHeader } from './components';
import { getErrorMessage } from './utils';
import {
  getConversationCategory,
  getConversationRelation,
  getConversationTitle,
  renderConversationStatus,
  renderConversationTime,
} from './cs-helpers';

export default function DeliveryCsDashboardPage() {
  const query = useQuery({
    queryKey: ['delivery-customer-service', 'dashboard'],
    queryFn: () => getDeliveryCustomerServiceList({ pageSize: 200 }),
    refetchInterval: 30000,
  });

  const rows = query.data ?? [];
  const stats = useMemo(() => {
    const open = rows.filter((item) => item.status === 'OPEN').length;
    const closed = rows.filter((item) => item.status === 'CLOSED').length;
    const orderRelated = rows.filter((item) => item.orderId || item.subOrderId).length;
    const merchantRelated = rows.filter((item) => item.merchantId).length;
    return {
      total: rows.length,
      open,
      closed,
      orderRelated,
      merchantRelated,
    };
  }, [rows]);

  const columns: ColumnsType<DeliveryConversation> = [
    { title: '主题', key: 'title', ellipsis: true, render: (_, record) => getConversationTitle(record) },
    { title: '类型', key: 'category', width: 120, render: (_, record) => <Tag>{getConversationCategory(record)}</Tag> },
    { title: '关联对象', key: 'relation', width: 260, ellipsis: true, render: (_, record) => getConversationRelation(record) },
    { title: '状态', dataIndex: 'status', width: 110, render: renderConversationStatus },
    { title: '最近时间', dataIndex: 'lastMessageAt', width: 160, render: renderConversationTime },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="配送客服数据看板" subtitle="配送客服会话处理概况，当前按配送会话表统计。" />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={5}>
          <ProCard>
            <Statistic title="会话总数" value={stats.total} prefix={<MessageOutlined />} />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <ProCard>
            <Statistic title="待处理" value={stats.open} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#faad14' }} />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <ProCard>
            <Statistic title="已关闭" value={stats.closed} />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <ProCard>
            <Statistic title="订单相关" value={stats.orderRelated} />
          </ProCard>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <ProCard>
            <Statistic title="商家协作" value={stats.merchantRelated} prefix={<TeamOutlined />} />
          </ProCard>
        </Col>
      </Row>

      <ProCard title="最近会话" headerBordered>
        <Table<DeliveryConversation>
          rowKey="id"
          columns={columns}
          dataSource={rows.slice(0, 10)}
          loading={query.isLoading}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无会话' }}
          pagination={false}
        />
      </ProCard>
    </div>
  );
}
