import { Card, Col, Row, Statistic, Button, Typography, Spin, Alert, Space } from 'antd';
import { ShoppingCartOutlined, ClockCircleOutlined, MessageOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '@/api/dashboard';

const { Title } = Typography;

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
    {
      title: '在线会话',
      value: dashboard?.openConversationCount || 0,
      prefix: <MessageOutlined />,
    },
  ];

  const quickLinks = [
    { label: '订单', path: '/orders', icon: <ShoppingCartOutlined /> },
    { label: '商品', path: '/products', icon: <AppstoreOutlined /> },
    { label: '公司', path: '/company/settings', icon: <ClockCircleOutlined /> },
    { label: '账号安全', path: '/account-security', icon: <MessageOutlined /> },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {summaryCards.map((item) => (
          <Col xs={24} sm={8} key={item.title}>
            <Card>
              <Statistic title={item.title} value={item.value} prefix={item.prefix} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card title={<Title level={5} style={{ margin: 0 }}>快捷入口</Title>}>
            <Space wrap>
              {quickLinks.map((item) => (
                <Button key={item.path} icon={item.icon} onClick={() => navigate(item.path)}>
                  {item.label}
                </Button>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title={<Title level={5} style={{ margin: 0 }}>当前范围</Title>}>
            <div style={{ color: '#666', lineHeight: 1.8 }}>
              <div>仅展示配送中心可见的数据。</div>
              <div>所有统计均来自配送中心工作台。</div>
              <div>如需继续处理，请从快捷入口进入对应页面。</div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
