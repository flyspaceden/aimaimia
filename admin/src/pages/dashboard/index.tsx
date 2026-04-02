import { Row, Col, Card, Statistic, Table, Spin, Progress, Typography } from 'antd';
import {
  UserOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  ShoppingOutlined,
  TrophyOutlined,
  WalletOutlined,
  CrownOutlined,
  AuditOutlined,
  FileSearchOutlined,
  BankOutlined,
  ExceptionOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Line, Column } from '@ant-design/charts';
import { getDashboardStats, getSalesTrend, getBonusStats } from '@/api/stats';
import { getProducts } from '@/api/products';
import { getCompanies } from '@/api/companies';
import { getWithdrawals } from '@/api/bonus';
import { getRefunds } from '@/api/refunds';
import { getReplacements } from '@/api/replacements';
import type { Order, PaginatedData } from '@/types';
import dayjs from 'dayjs';

const { Title } = Typography;

// 统计卡片颜色
const statCards = [
  { title: '总用户数', key: 'totalUsers' as const, icon: <UserOutlined />, color: '#1E40AF' },
  { title: '总订单数', key: 'totalOrders' as const, icon: <ShoppingCartOutlined />, color: '#1677ff' },
  { title: '总销售额', key: 'totalRevenue' as const, icon: <DollarOutlined />, color: '#F97316', prefix: '¥' },
  { title: '商品总数', key: 'totalProducts' as const, icon: <ShoppingOutlined />, color: '#722ed1' },
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
  {
    title: '待审核提现',
    queryKey: ['admin', 'pending-withdrawals'],
    queryFn: () => getWithdrawals({ page: 1, pageSize: 1, status: 'REQUESTED' }),
    icon: <DollarOutlined style={{ fontSize: 20 }} />,
    path: '/bonus/withdrawals',
  },
  {
    title: '待处理退款',
    queryKey: ['admin', 'pending-refunds'],
    queryFn: () => getRefunds({ page: 1, pageSize: 1, status: 'REQUESTED' }),
    icon: <ExceptionOutlined style={{ fontSize: 20 }} />,
    path: '/refunds',
  },
  {
    title: '待处理换货',
    queryKey: ['admin', 'pending-replacements'],
    queryFn: () => getReplacements({ page: 1, pageSize: 1, status: 'REQUESTED' }),
    icon: <SwapOutlined style={{ fontSize: 20 }} />,
    path: '/replacements',
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
  // 有待办项时用橙色，否则用绿色
  const color = hasItems ? '#faad14' : '#52c41a';

  return (
    <Card
      hoverable
      style={{
        cursor: 'pointer',
        borderLeft: hasItems ? '3px solid #faad14' : '3px solid #52c41a',
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

  const { data: bonusStats, isLoading: bonusLoading } = useQuery({
    queryKey: ['admin', 'bonus-stats'],
    queryFn: getBonusStats,
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
          <Col xs={12} sm={8} key={item.queryKey[1]}>
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

      {/* 奖励统计区 */}
      <Row gutter={[16, 16]} style={{ marginTop: 24, marginBottom: 24 }}>
        <Col xs={24}>
          <Card title="奖励 / 分润统计" loading={bonusLoading}>
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic
                  title="累计分配"
                  value={bonusStats?.totalDistributed ?? 0}
                  precision={2}
                  prefix={<TrophyOutlined />}
                  suffix="元"
                  valueStyle={{ color: '#cf1322' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="累计提现"
                  value={bonusStats?.totalWithdrawn ?? 0}
                  precision={2}
                  prefix={<WalletOutlined />}
                  suffix="元"
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="VIP 会员数"
                  value={bonusStats?.vipCount ?? 0}
                  prefix={<CrownOutlined />}
                  valueStyle={{ color: '#faad14' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="待审核提现"
                  value={bonusStats?.pendingWithdrawals ?? 0}
                  prefix={<AuditOutlined />}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* 奖励分配趋势 */}
        <Col xs={24} lg={14}>
          <Card title="奖励分配趋势（近 7 天）" style={{ marginBottom: 16 }}>
            {bonusLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : (
              <Column
                data={bonusStats?.dailyTrend ?? []}
                xField="date"
                yField="amount"
                color="#cf1322"
                height={280}
                label={{ position: 'middle' as const }}
                meta={{
                  amount: { alias: '分配金额', formatter: (v: number) => `¥${v.toFixed(2)}` },
                }}
              />
            )}
          </Card>
        </Col>

        {/* 会员概览 */}
        <Col xs={24} lg={10}>
          <Card title="会员概览" style={{ marginBottom: 16 }}>
            {bonusLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <Statistic
                  title="总会员数"
                  value={bonusStats?.totalMembers ?? 0}
                  style={{ marginBottom: 24 }}
                />
                <div style={{ maxWidth: 200, margin: '0 auto' }}>
                  <Progress
                    type="dashboard"
                    percent={bonusStats?.vipRate ?? 0}
                    format={(pct) => `VIP ${pct}%`}
                    strokeColor="#faad14"
                  />
                </div>
                <div style={{ color: '#999', marginTop: 12 }}>VIP 会员占比</div>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
