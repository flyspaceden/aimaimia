import { Card, Col, Row, Statistic, List, Button, Typography, Spin, Alert } from 'antd';
import {
  ShoppingCartOutlined,
  DollarOutlined,
  SendOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getOverview, getSalesTrend } from '@/api/analytics';
import { getOrders } from '@/api/orders';
import { getReplacements } from '@/api/replacements';
import { Line } from '@ant-design/charts';

const { Title } = Typography;

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: overview, isLoading: loadingOverview, isError: overviewError } = useQuery({
    queryKey: ['seller-overview'],
    queryFn: () => getOverview(),
  });

  const { data: salesTrend } = useQuery({
    queryKey: ['seller-sales-trend'],
    queryFn: () => getSalesTrend(14),
  });

  // 待发货订单
  const { data: pendingOrders } = useQuery({
    queryKey: ['seller-pending-orders'],
    queryFn: () => getOrders({ status: 'PAID', page: 1, pageSize: 5 }),
  });

  // 待处理换货
  const { data: pendingReplacements } = useQuery({
    queryKey: ['seller-pending-replacements'],
    queryFn: () => getReplacements({ status: 'REQUESTED,UNDER_REVIEW', page: 1, pageSize: 5 }),
  });

  if (loadingOverview) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (overviewError) {
    return <Alert type="error" message="数据加载失败" description="请刷新页面重试" showIcon style={{ margin: 24 }} />;
  }

  const todoItems = [
    ...(pendingOrders?.items || []).map((o) => ({
      key: `order-${o.id}`,
      title: `订单 ${o.id.slice(0, 12)}... 待发货`,
      action: () => navigate(`/orders/${o.id}`),
      label: '去发货',
    })),
    ...(pendingReplacements?.items || []).map((r) => ({
      key: `replacement-${r.id}`,
      title: `换货 ${r.id.slice(0, 12)}... 待处理`,
      action: () => navigate(`/replacements/${r.id}`),
      label: '去处理',
    })),
  ];

  return (
    <div>
      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} lg={5}>
          <Card>
            <Statistic
              title="今日订单"
              value={overview?.today.orderCount || 0}
              prefix={<ShoppingCartOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={5}>
          <Card>
            <Statistic
              title="今日销售额"
              value={overview?.today.revenue || 0}
              prefix={<DollarOutlined />}
              precision={2}
              suffix="元"
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={5}>
          <Card>
            <Statistic
              title="待发货"
              value={overview?.today.pendingShipCount || 0}
              prefix={<SendOutlined />}
              valueStyle={overview?.today.pendingShipCount ? { color: '#DC2626' } : undefined}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card>
            <Statistic
              title="待处理售后"
              value={overview?.today.pendingReplacementCount || 0}
              prefix={<SwapOutlined />}
              valueStyle={overview?.today.pendingReplacementCount ? { color: '#DC2626' } : undefined}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* 待处理事项 */}
        <Col span={12}>
          <Card title="待处理" style={{ marginBottom: 24 }}>
            {todoItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#999' }}>
                暂无待处理事项
              </div>
            ) : (
              <List
                dataSource={todoItems}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button type="link" size="small" onClick={item.action} key="action">
                        {item.label}
                      </Button>,
                    ]}
                  >
                    {item.title}
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* 销售趋势 */}
        <Col span={12}>
          <Card title={<Title level={5} style={{ margin: 0 }}>近 14 日销售趋势</Title>}>
            {salesTrend && salesTrend.length > 0 ? (
              <Line
                data={salesTrend}
                xField="date"
                yField="revenue"
                height={260}
                smooth
                point={{ size: 3 }}
                yAxis={{ label: { formatter: (v: string) => `¥${v}` } }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#999' }}>
                暂无销售数据
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
