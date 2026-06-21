import { Col, Row, Statistic, Button, Typography, Spin, Alert, Space, Tag } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import {
  ShoppingCartOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
  ExportOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '@/api/dashboard';

const { Text, Title } = Typography;

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: dashboard, isLoading, isError } = useQuery({
    queryKey: ['delivery-seller-dashboard'],
    queryFn: () => getDashboard(),
  });

  if (isLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (isError) {
    return <Alert type="error" message="数据加载失败" description="请刷新页面重试" showIcon style={{ margin: 24 }} />;
  }

  const summaryCards = [
    {
      title: '待发货',
      value: dashboard?.pendingShipmentCount || 0,
      prefix: <ShoppingCartOutlined />,
    },
    {
      title: '待结算',
      value: dashboard?.deliveredPendingSettlementCount || 0,
      prefix: <ClockCircleOutlined />,
    },
  ];

  const quickLinks = [
    { label: '待发货订单', path: '/orders?statusTab=pending', icon: <ShoppingCartOutlined /> },
    { label: '库存管理', path: '/products/stock', icon: <AppstoreOutlined /> },
    { label: '物流跟踪', path: '/orders/logistics', icon: <TruckOutlined /> },
    { label: '经营导出', path: '/exports', icon: <ExportOutlined /> },
    { label: '账号安全', path: '/account-security', icon: <ClockCircleOutlined /> },
  ];

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <ProCard
        title="履约工作台"
        extra={<Tag color="orange">配送中心</Tag>}
        headerBordered
        style={{ borderTop: '3px solid #EA580C' }}
      >
        <Row gutter={[16, 16]}>
          {summaryCards.map((item) => (
            <Col xs={24} md={12} key={item.title}>
              <Statistic title={item.title} value={item.value} prefix={item.prefix} />
            </Col>
          ))}
        </Row>
      </ProCard>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <ProCard
            title={<Title level={5} style={{ margin: 0 }}>快捷入口</Title>}
            headerBordered
          >
            <Space wrap>
              {quickLinks.map((item) => (
                <Button key={item.path} icon={item.icon} onClick={() => navigate(item.path)}>
                  {item.label}
                </Button>
              ))}
            </Space>
          </ProCard>
        </Col>

        <Col xs={24} lg={9}>
          <ProCard
            title={<Title level={5} style={{ margin: 0 }}>处理队列</Title>}
            headerBordered
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Button block onClick={() => navigate('/orders?statusTab=pending')}>待发货订单</Button>
              <Button block onClick={() => navigate('/exports')}>财务结算导出</Button>
              <Text type="secondary">配送中心只展示供货、履约和结算相关事项。</Text>
            </Space>
          </ProCard>
        </Col>
      </Row>
    </Space>
  );
}
