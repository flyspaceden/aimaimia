import {
  Badge,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  ExceptionOutlined,
  FileSearchOutlined,
  MessageOutlined,
  RiseOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Column, Line, Pie } from '@ant-design/charts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardStats, getOperationsOverview, getSalesTrend } from '@/api/stats';
import type { Order } from '@/types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

type Tone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' | 'gray';

type ChartDatum = {
  type: string;
  value: number;
};

const toneMap: Record<Tone, { color: string; soft: string; border: string }> = {
  blue: { color: '#1d4ed8', soft: '#eff6ff', border: '#bfdbfe' },
  green: { color: '#15803d', soft: '#f0fdf4', border: '#bbf7d0' },
  orange: { color: '#c2410c', soft: '#fff7ed', border: '#fed7aa' },
  red: { color: '#b91c1c', soft: '#fef2f2', border: '#fecaca' },
  purple: { color: '#6d28d9', soft: '#f5f3ff', border: '#ddd6fe' },
  teal: { color: '#0f766e', soft: '#f0fdfa', border: '#99f6e4' },
  gray: { color: '#475569', soft: '#f8fafc', border: '#e2e8f0' },
};

const money = (value?: number | null) => `¥${Number(value ?? 0).toFixed(2)}`;

const assetValue = (value?: number | null) => Number(value ?? 0).toFixed(2);

const orderStatusText: Record<string, string> = {
  PENDING_PAYMENT: '待支付',
  PAID: '已付款',
  SHIPPED: '已发货',
  DELIVERED: '已签收',
  RECEIVED: '已完成',
  CANCELED: '已取消',
  REFUNDED: '已退款',
};

const orderStatusColor: Record<string, string> = {
  PAID: 'blue',
  SHIPPED: 'cyan',
  DELIVERED: 'geekblue',
  RECEIVED: 'green',
  CANCELED: 'default',
  REFUNDED: 'orange',
};

const paymentChannelText: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT_PAY: '微信',
  UNIONPAY: '银联',
  AGGREGATOR: '聚合',
};

const capitalDescriptionMap: Record<string, string> = {
  可用奖励: '可提现或可用于订单抵扣的消费积分',
  冻结奖励: '奖励保护期内暂不可用的金额',
  售后冻结: '订单售后处理中被临时冻结的奖励',
  预留奖励: '已占用但尚未完成结算的奖励',
  提现处理中: '已提交提现、等待到账的金额',
};

const chartPalette = ['#1d4ed8', '#15803d', '#c2410c', '#6d28d9', '#0f766e', '#b91c1c', '#475569'];

const hasChartData = (data: ChartDatum[]) => data.some((item) => Number(item.value) > 0);

function ShellCard({
  title,
  children,
  extra,
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <Card
      title={<span style={{ fontWeight: 700 }}>{title}</span>}
      extra={extra}
      styles={{ body: { padding: 16 } }}
      style={{ borderRadius: 8 }}
    >
      {children}
    </Card>
  );
}

function ChartContent({
  loading,
  data,
  emptyText,
  children,
}: {
  loading?: boolean;
  data: ChartDatum[];
  emptyText: string;
  children: ReactNode;
}) {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>;
  }
  if (!hasChartData(data)) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={emptyText}
        style={{ minHeight: 220, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      />
    );
  }
  return <>{children}</>;
}

function ChartValueList({
  data,
  formatter = (value: number) => String(value),
  descriptionMap,
}: {
  data: ChartDatum[];
  formatter?: (value: number) => string;
  descriptionMap?: Record<string, string>;
}) {
  const visibleData = data
    .map((item, index) => ({ ...item, color: chartPalette[index % chartPalette.length] }))
    .filter((item) => Number(item.value) > 0);
  const total = visibleData.reduce((sum, item) => sum + Number(item.value || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      {visibleData.map((item) => {
        const percent = total > 0 ? `${((Number(item.value) / total) * 100).toFixed(1)}%` : '0%';
        return (
          <div
            key={item.type}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '10px 12px',
              background: '#f8fafc',
            }}
          >
            <Space size={10} align="start" style={{ flex: '1 1 220px', minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: item.color, marginTop: 5, flex: '0 0 auto' }} />
              <span>
                <Text strong style={{ color: '#0f172a' }}>{item.type}</Text>
                {descriptionMap?.[item.type] ? (
                  <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>
                    {descriptionMap[item.type]}
                  </div>
                ) : null}
              </span>
            </Space>
            <Space size={10} style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              <Text strong style={{ fontSize: 15 }}>{formatter(Number(item.value))}</Text>
              <Text type="secondary">{percent}</Text>
            </Space>
          </div>
        );
      })}
    </div>
  );
}

function MetricTile({
  title,
  value,
  hint,
  icon,
  tone = 'gray',
  path,
}: {
  title: string;
  value: number | string;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  path?: string;
}) {
  const navigate = useNavigate();
  const colors = toneMap[tone];
  return (
    <button
      type="button"
      aria-disabled={!path}
      onClick={() => path && navigate(path)}
      style={{
        width: '100%',
        minHeight: 88,
        textAlign: 'left',
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 14,
        background: colors.soft,
        cursor: path ? 'pointer' : 'default',
      }}
    >
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ color: '#64748b', fontSize: 13, wordBreak: 'keep-all' }}>{title}</span>
        {icon ? <span style={{ color: colors.color, fontSize: 18 }}>{icon}</span> : null}
      </Space>
      <div style={{ color: colors.color, fontSize: 25, lineHeight: 1.2, fontWeight: 750, marginTop: 8 }}>
        {value}
      </div>
      {hint ? <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>{hint}</div> : null}
    </button>
  );
}

function RecentOrders({ orders, loading }: { orders?: Order[]; loading?: boolean }) {
  const navigate = useNavigate();
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>;
  }
  if (!orders || orders.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  }
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {orders.slice(0, 6).map((order) => (
        <div
          key={order.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/orders/${order.id}`)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              navigate(`/orders/${order.id}`);
            }
          }}
          style={{
            width: '100%',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            background: '#fff',
            padding: '10px 12px',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text copyable ellipsis style={{ maxWidth: 180 }}>{order.orderNo}</Text>
              <div style={{ marginTop: 6 }}>
                <Tag color={orderStatusColor[order.status] || 'default'} style={{ marginInlineEnd: 6 }}>
                  {orderStatusText[order.status] || order.status}
                </Tag>
                <Text type="secondary">{dayjs(order.createdAt).format('MM-DD HH:mm')}</Text>
              </div>
            </div>
            <Text strong style={{ color: '#0f172a', whiteSpace: 'nowrap' }}>{money(order.totalAmount)}</Text>
          </Space>
        </div>
      ))}
    </Space>
  );
}

function KpiCard({
  title,
  value,
  prefix,
  tone,
  path,
  loading,
}: {
  title: string;
  value: number;
  prefix?: ReactNode;
  tone: Tone;
  path?: string;
  loading?: boolean;
}) {
  const navigate = useNavigate();
  const colors = toneMap[tone];
  return (
    <Card
      hoverable={Boolean(path)}
      onClick={() => path && navigate(path)}
      style={{ borderRadius: 8, borderTop: `3px solid ${colors.color}` }}
      styles={{ body: { padding: 18 } }}
    >
      <Statistic
        title={title}
        value={value}
        precision={title.includes('额') || title.includes('价') ? 2 : 0}
        prefix={prefix}
        valueStyle={{ color: colors.color, fontWeight: 750 }}
        loading={loading}
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

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin', 'operations-overview'],
    queryFn: getOperationsOverview,
    refetchInterval: 60_000,
  });

  const today = overview?.today;
  const pending = overview?.pending;
  const capital = overview?.capital;
  const activities = overview?.activities;

  const pendingItems = [
    { title: '商品审核', value: pending?.productReviews ?? 0, tone: 'orange' as Tone, icon: <FileSearchOutlined />, path: '/products' },
    { title: '企业审核', value: pending?.companyReviews ?? 0, tone: 'orange' as Tone, icon: <BankOutlined />, path: '/companies' },
    { title: '提现审核', value: pending?.withdrawalReviews ?? 0, tone: 'red' as Tone, icon: <DollarOutlined />, path: '/bonus/withdrawals' },
    { title: '提现处理中', value: pending?.withdrawalProcessing ?? 0, tone: 'purple' as Tone, icon: <WalletOutlined />, path: '/bonus/withdrawals' },
    { title: '售后申请', value: pending?.afterSaleRequests ?? 0, tone: 'orange' as Tone, icon: <ExceptionOutlined />, path: '/after-sale' },
    { title: '卖家审核中', value: pending?.afterSaleSellerReviews ?? 0, tone: 'blue' as Tone, icon: <ClockCircleOutlined />, path: '/after-sale' },
    { title: '退货处理中', value: pending?.afterSaleReturns ?? 0, tone: 'purple' as Tone, icon: <ExceptionOutlined />, path: '/after-sale' },
    { title: '平台仲裁', value: pending?.afterSaleArbitrations ?? 0, tone: 'red' as Tone, icon: <AuditOutlined />, path: '/after-sale' },
    { title: '人工复核', value: pending?.afterSaleManualReviews ?? 0, tone: 'red' as Tone, icon: <AuditOutlined />, path: '/after-sale' },
    { title: '退款处理中', value: pending?.afterSaleRefunding ?? 0, tone: 'purple' as Tone, icon: <ExceptionOutlined />, path: '/after-sale' },
    { title: '发票申请', value: pending?.invoiceRequests ?? 0, tone: 'blue' as Tone, icon: <FileSearchOutlined />, path: '/invoices' },
    { title: '客服排队', value: pending?.customerServiceQueue ?? 0, tone: 'red' as Tone, icon: <MessageOutlined />, path: '/cs/workstation' },
    { title: '未关工单', value: pending?.openTickets ?? 0, tone: 'orange' as Tone, icon: <MessageOutlined />, path: '/cs/tickets' },
  ];

  const hotPending = pendingItems
    .filter((item) => Number(item.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 5);

  const totalPending = pendingItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const paymentSummary = today?.payments?.length
    ? today.payments
        .map((item) => `${paymentChannelText[item.channel] || item.channel} ${money(item.amount)} / ${item.count} 单`)
        .join('   ')
    : '暂无支付通道数据';

  const couponUsageRate = activities?.couponUsageRate ?? 0;
  const orderMixData: ChartDatum[] = [
    { type: '普通订单', value: today?.normalOrderCount ?? 0 },
    { type: 'VIP订单', value: today?.vipOrderCount ?? 0 },
    { type: '团购订单', value: today?.groupBuyOrderCount ?? 0 },
  ];
  const paymentChartData: ChartDatum[] = (today?.payments || []).map((item) => ({
    type: paymentChannelText[item.channel] || item.channel,
    value: Number(item.amount || 0),
  }));
  const pendingChartData: ChartDatum[] = pendingItems
    .map((item) => ({ type: item.title, value: Number(item.value || 0) }))
    .filter((item) => item.value > 0);
  const capitalChartData: ChartDatum[] = [
    { type: '可用奖励', value: capital?.rewardAvailableAmount ?? 0 },
    { type: '冻结奖励', value: capital?.rewardFrozenAmount ?? 0 },
    { type: '售后冻结', value: capital?.rewardReturnFrozenAmount ?? 0 },
    { type: '预留奖励', value: capital?.rewardReservedAmount ?? 0 },
    { type: '提现处理中', value: capital?.withdrawalProcessingAmount ?? 0 },
  ];
  const activityChartData: ChartDatum[] = [
    { type: '红包发放', value: activities?.couponIssuedCount ?? 0 },
    { type: '红包核销', value: activities?.couponUsedCount ?? 0 },
    { type: '今日抽奖', value: activities?.todayDraws ?? 0 },
    { type: '今日中奖', value: activities?.todayWins ?? 0 },
    { type: '团购分享中', value: activities?.activeGroupBuyInstances ?? 0 },
    { type: '团购已完成', value: activities?.completedGroupBuyInstances ?? 0 },
  ];
  const lineConfig = {
    data: trend || [],
    xField: 'date',
    yField: 'amount',
    smooth: true,
    color: '#1d4ed8',
    point: { size: 3, shape: 'circle' },
    yAxis: { label: { formatter: (v: string) => `¥${v}` } },
    tooltip: {
      formatter: (datum: Record<string, unknown>) => ({
        name: '销售额',
        value: money(datum.amount as number),
      }),
    },
  };
  const orderMixConfig = {
    data: orderMixData,
    angleField: 'value',
    colorField: 'type',
    color: chartPalette,
    radius: 0.82,
    innerRadius: 0.56,
    height: 260,
    label: false,
    legend: { color: { position: 'bottom' as const } },
  };
  const paymentColumnConfig = {
    data: paymentChartData,
    xField: 'type',
    yField: 'value',
    colorField: 'type',
    color: chartPalette,
    height: 260,
    label: {
      text: (datum: ChartDatum) => money(datum.value),
      position: 'top' as const,
      style: { fontSize: 11 },
    },
    axis: {
      y: { labelFormatter: (value: number) => `¥${Number(value).toFixed(0)}` },
      x: { labelAutoRotate: true, labelAutoHide: true },
    },
    legend: { color: { position: 'bottom' as const } },
  };
  const pendingColumnConfig = {
    data: pendingChartData,
    xField: 'type',
    yField: 'value',
    colorField: 'type',
    color: chartPalette,
    height: 260,
    label: { text: 'value', position: 'top' as const, style: { fontSize: 11 } },
    axis: { x: { labelAutoRotate: true, labelAutoHide: true } },
    legend: { color: { position: 'bottom' as const } },
  };
  const capitalPieConfig = {
    data: capitalChartData,
    angleField: 'value',
    colorField: 'type',
    color: chartPalette,
    radius: 0.82,
    innerRadius: 0.62,
    height: 238,
    label: false,
    legend: false,
    tooltip: {
      formatter: (datum: ChartDatum) => ({
        name: '金额',
        value: money(Number(datum.value)),
      }),
    },
  };
  const activityColumnConfig = {
    data: activityChartData,
    xField: 'type',
    yField: 'value',
    colorField: 'type',
    color: chartPalette,
    height: 260,
    label: { text: 'value', position: 'top' as const, style: { fontSize: 11 } },
    axis: { x: { labelAutoRotate: true, labelAutoHide: true } },
    legend: { color: { position: 'bottom' as const } },
  };

  return (
    <div style={{ padding: 24, background: '#f6f7f9', minHeight: '100%' }}>
      <div style={{ marginBottom: 18 }}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>工作台</Title>
            <Text type="secondary">经营脉搏 · 处理优先级 · 资金活动一屏看清</Text>
          </div>
          {totalPending > 0 ? (
            <Badge count={totalPending} color="#fa541c">
              <Tag icon={<ClockCircleOutlined />} color="orange">有待处理事项</Tag>
            </Badge>
          ) : (
            <Tag icon={<CheckCircleOutlined />} color="green">暂无待办</Tag>
          )}
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard title="今日成交额" value={today?.gmv ?? 0} prefix="¥" tone="blue" path="/orders" loading={overviewLoading} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard title="今日支付订单" value={today?.paidOrderCount ?? 0} prefix={<ShoppingCartOutlined />} tone="green" path="/orders" loading={overviewLoading} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard title="客单价" value={today?.averageOrderAmount ?? 0} prefix="¥" tone="orange" loading={overviewLoading} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard title="总用户数" value={stats?.totalUsers ?? 0} prefix={<UserOutlined />} tone="teal" path="/users" loading={statsLoading} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={16}>
          <ShellCard title="待办中心" extra={<Text type="secondary">处理优先级 · 60 秒刷新</Text>}>
            {overviewLoading ? (
              <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
            ) : hotPending.length > 0 ? (
              <Row gutter={[12, 12]}>
                {hotPending.map((item) => (
                  <Col xs={24} sm={12} lg={8} key={item.title}>
                    <MetricTile
                      title={item.title}
                      value={item.value}
                      icon={item.icon}
                      tone={item.tone}
                      path={item.path}
                      hint="点击进入处理"
                    />
                  </Col>
                ))}
              </Row>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办" />
            )}
          </ShellCard>
        </Col>
        <Col xs={24} xl={8}>
          <ShellCard title="今日经营">
            <Row gutter={[12, 12]}>
              <Col span={8}>
                <MetricTile title="普通订单" value={today?.normalOrderCount ?? 0} tone="blue" path="/orders" />
              </Col>
              <Col span={8}>
                <MetricTile title="VIP订单" value={today?.vipOrderCount ?? 0} tone="orange" path="/orders" />
              </Col>
              <Col span={8}>
                <MetricTile title="团购订单" value={today?.groupBuyOrderCount ?? 0} tone="purple" path="/group-buy/orders" />
              </Col>
              <Col span={24}>
                <Tooltip title={paymentSummary}>
                  <div style={{ color: '#475569', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, minHeight: 48 }}>
                    <Text strong>支付通道</Text>
                    <div style={{ marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{paymentSummary}</div>
                  </div>
                </Tooltip>
              </Col>
            </Row>
          </ShellCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={14}>
          <ShellCard title="销售趋势" extra={<Text type="secondary">按有效支付时间统计</Text>}>
            {trendLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : (
              <Line {...lineConfig} height={300} />
            )}
          </ShellCard>
        </Col>
        <Col xs={24} xl={10}>
          <ShellCard title="最近订单">
            <RecentOrders orders={stats?.recentOrders} loading={statsLoading} />
          </ShellCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={8}>
          <ShellCard title="订单结构" extra={<Text type="secondary">今日成交订单</Text>}>
            <ChartContent loading={overviewLoading} data={orderMixData} emptyText="今日暂无支付订单">
              <Pie {...orderMixConfig} />
            </ChartContent>
          </ShellCard>
        </Col>
        <Col xs={24} lg={8}>
          <ShellCard title="支付渠道分布" extra={<Text type="secondary">按成交金额</Text>}>
            <ChartContent loading={overviewLoading} data={paymentChartData} emptyText="暂无支付渠道数据">
              <Column {...paymentColumnConfig} />
            </ChartContent>
          </ShellCard>
        </Col>
        <Col xs={24} lg={8}>
          <ShellCard title="待办分布" extra={<Text type="secondary">不含提现失败</Text>}>
            <ChartContent loading={overviewLoading} data={pendingChartData} emptyText="暂无待办">
              <Column {...pendingColumnConfig} />
            </ChartContent>
          </ShellCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <ShellCard title="资金结构" extra={<Text type="secondary">奖励 · 提现</Text>}>
            <ChartContent loading={overviewLoading} data={capitalChartData} emptyText="暂无奖励/提现资金数据">
              <Pie {...capitalPieConfig} />
              <ChartValueList data={capitalChartData} formatter={money} descriptionMap={capitalDescriptionMap} />
            </ChartContent>
          </ShellCard>
        </Col>
        <Col xs={24} lg={12}>
          <ShellCard title="活动转化" extra={<Text type="secondary">红包 · 抽奖 · 团购</Text>}>
            <ChartContent loading={overviewLoading} data={activityChartData} emptyText="暂无活动数据">
              <Column {...activityColumnConfig} />
            </ChartContent>
          </ShellCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={12}>
          <ShellCard title="奖励资金">
            <Row gutter={[12, 12]}>
              <Col xs={12} sm={8}>
                <MetricTile title="可用奖励" value={money(capital?.rewardAvailableAmount)} tone="blue" path="/bonus/members" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="冻结奖励" value={money(capital?.rewardFrozenAmount)} tone="orange" path="/bonus/members" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="售后保护冻结" value={money(capital?.rewardReturnFrozenAmount)} tone="purple" path="/bonus/members" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="今日奖励生成" value={money(capital?.rewardTodayCreatedAmount)} tone="red" path="/bonus/members" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="预留奖励" value={money(capital?.rewardReservedAmount)} tone="gray" path="/bonus/members" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="提现处理中" value={money(capital?.withdrawalProcessingAmount)} tone="purple" path="/bonus/withdrawals" />
              </Col>
            </Row>
          </ShellCard>
        </Col>
        <Col xs={24} xl={12}>
          <ShellCard
            title="活动增长"
            extra={<Text type="secondary">红包 · 抽奖 · 团购</Text>}
          >
            <Row gutter={[12, 12]}>
              <Col xs={12} sm={8}>
                <MetricTile title="有效红包活动" value={activities?.activeCouponCampaigns ?? 0} hint={`全部 ${activities?.totalCouponCampaigns ?? 0}`} tone="red" path="/coupons" />
              </Col>
              <Col xs={12} sm={8}>
                <div style={{ border: '1px solid #fed7aa', borderRadius: 8, padding: 14, background: '#fff7ed', minHeight: 88 }}>
                  <Text type="secondary">红包核销率</Text>
                  <Progress percent={couponUsageRate} size="small" strokeColor="#f97316" style={{ marginTop: 10 }} />
                </div>
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="红包抵扣" value={money(activities?.couponDiscountAmount)} tone="orange" path="/coupons" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="今日抽奖" value={activities?.todayDraws ?? 0} hint={`中奖 ${activities?.todayWins ?? 0}`} tone="green" path="/lottery" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="团购分享中" value={activities?.activeGroupBuyInstances ?? 0} hint={`完成 ${activities?.completedGroupBuyInstances ?? 0}`} tone="purple" path="/group-buy/instances" />
              </Col>
              <Col xs={12} sm={8}>
                <MetricTile title="待释放返还" value={money(activities?.pendingGroupBuyRebateAmount)} tone="blue" path="/group-buy/rebate-ledgers" />
              </Col>
            </Row>
          </ShellCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <ShellCard title="数字资产概览" extra={<Text type="secondary">虚拟资产 · 不计入资金结构</Text>}>
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricTile
                  title="数字资产值"
                  value={assetValue(capital?.digitalAssetTotalBalance)}
                  hint="虚拟资产余额，不等同现金"
                  icon={<BarChartOutlined />}
                  tone="teal"
                  path="/digital-assets"
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricTile
                  title="资产账户数"
                  value={capital?.digitalAssetAccountCount ?? 0}
                  hint="已有数字资产记录的用户"
                  icon={<UserOutlined />}
                  tone="blue"
                  path="/digital-assets"
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricTile
                  title="今日新增资产"
                  value={assetValue(capital?.digitalAssetTodayCreditAmount)}
                  hint="今日确认收货入账的虚拟资产"
                  icon={<RiseOutlined />}
                  tone="green"
                  path="/digital-assets"
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricTile
                  title="对应累计消费"
                  value={money(capital?.digitalAssetCumulativeSpendAmount)}
                  hint="形成数字资产的消费口径"
                  icon={<ShoppingCartOutlined />}
                  tone="purple"
                  path="/digital-assets"
                />
              </Col>
            </Row>
            <div style={{ marginTop: 12, color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>
              数字资产是基于累计消费形成的虚拟权益指标，不参与可用奖励、提现处理中或真实资金占比统计。
            </div>
          </ShellCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 8 }}>
            <Statistic title="企业总数" value={stats?.totalCompanies ?? 0} prefix={<BankOutlined />} loading={statsLoading} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 8 }}>
            <Statistic title="有效红包活动" value={activities?.activeCouponCampaigns ?? 0} prefix={<DollarOutlined />} loading={overviewLoading} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 8 }}>
            <Statistic title="活跃团购活动" value={activities?.activeGroupBuyActivities ?? 0} prefix={<RiseOutlined />} loading={overviewLoading} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
