import { Row, Col, Card, Statistic, Table, Spin, Typography } from 'antd';
import {
  UserOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  ShoppingOutlined,
  AuditOutlined,
  FileSearchOutlined,
  BankOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Line } from '@ant-design/charts';
import { getDashboardStats, getSalesTrend } from '@/api/stats';
import { getProducts } from '@/api/products';
import { getCompanies } from '@/api/companies';
import type { Order, PaginatedData } from '@/types';
import dayjs from 'dayjs';

const { Title } = Typography;

// 统计卡片颜色
const statCards = [
  { title: '总用户数', key: 'totalUsers' as const, icon: <UserOutlined />, color: '#0B5CAD' },
  { title: '总订单数', key: 'totalOrders' as const, icon: <ShoppingCartOutlined />, color: '#2563eb' },
  { title: '总销售额', key: 'totalRevenue' as const, icon: <DollarOutlined />, color: '#0284c7', prefix: '¥' },
  { title: '商品总数', key: 'totalProducts' as const, icon: <ShoppingOutlined />, color: '#1d4ed8' },
];

// 待办事项配置
const pendingItems = [
  {
    title: '待审核商品',
    queryKey: ['admin', 'pending-products'],
    queryFn: () => getProducts({ page: 1, pageSize: 1, auditStatus: 'PENDING' }),
    icon: <FileSearchOutlined style={{ fontSize: 20 }} />,
    path: '/products',
  },
  {
    title: '待审核企业',
    queryKey: ['admin', 'pending-companies'],
    queryFn: () => getCompanies({ page: 1, pageSize: 1, status: 'PENDING' }),
    icon: <BankOutlined style={{ fontSize: 20 }} />,
    path: '/companies',
  },
];

// 最近订单列
const orderColumns = [
  { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: 180 },
  {
    title: '金额',
    dataIndex: 'totalAmount',
    key: 'totalAmount',
    render: (v: number) => `¥${v.toFixed(2)}`,
  },
  { title: '状态', dataIndex: 'status', key: 'status' },
  {
    title: '时间',
    dataIndex: 'createdAt',
    key: 'createdAt',
    render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
  },
];

/** 待办事项卡片组件 */
function PendingCard({ title, queryKey, queryFn, icon, path }: typeof pendingItems[number]) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery<PaginatedData<unknown>>({
    queryKey,
    queryFn: queryFn as () => Promise<PaginatedData<unknown>>,
    // 每 60 秒自动刷新待办数量
    refetchInterval: 60_000,
  });

  const count = data?.total ?? 0;
  const hasItems = count > 0;
  const color = hasItems ? '#0284c7' : '#16a34a';

  return (
    <Card
      hoverable
      style={{
        cursor: 'pointer',
        borderLeft: hasItems ? '3px solid #0284c7' : '3px solid #16a34a',
      }}
      onClick={() => navigate(path)}
    >
      <Statistic
        title={title}
        value={count}
        prefix={icon}
        valueStyle={{ color }}
        loading={isLoading}
      />
    </Card>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: getDashboardStats,
  });

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['admin', 'sales-trend'],
    queryFn: getSalesTrend,
  });

  const lineConfig = {
    data: trend || [],
    xField: 'date',
    yField: 'amount',
    smooth: true,
    color: '#1E40AF',
    point: { size: 3, shape: 'circle' },
    yAxis: { label: { formatter: (v: string) => `¥${v}` } },
    tooltip: {
      formatter: (datum: Record<string, unknown>) => ({
        name: '销售额',
        value: `¥${(datum.amount as number)?.toFixed(2) || 0}`,
      }),
    },
  };

  return (
    <div style={{ padding: 24 }}>
      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((card) => (
          <Col xs={24} sm={12} lg={6} key={card.key}>
            <Card hoverable>
              <Statistic
                title={card.title}
                value={stats?.[card.key] ?? 0}
                precision={card.prefix === '¥' ? 2 : 0}
                prefix={card.prefix || card.icon}
                valueStyle={{ color: card.color }}
                loading={statsLoading}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 待办事项 */}
      <Title level={5} style={{ marginBottom: 12 }}>
        <AuditOutlined style={{ marginRight: 8 }} />
        待办事项
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {pendingItems.map((item) => (
          <Col xs={24} sm={12} key={item.queryKey[1]}>
            <PendingCard {...item} />
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        {/* 销售趋势图 */}
        <Col xs={24} lg={14}>
          <Card title="销售趋势" style={{ marginBottom: 16 }}>
            {trendLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : (
              <Line {...lineConfig} height={320} />
            )}
          </Card>
        </Col>

        {/* 最近订单 */}
        <Col xs={24} lg={10}>
          <Card title="最近订单">
            <Table<Order>
              columns={orderColumns}
              dataSource={stats?.recentOrders || []}
              rowKey="id"
              pagination={false}
              size="small"
              loading={statsLoading}
              scroll={{ y: 280 }}
            />
          </Card>
        </Col>
      </Row>

    </div>
  );
}
