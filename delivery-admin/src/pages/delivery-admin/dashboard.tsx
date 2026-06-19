import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Space, Statistic, Table, Typography } from 'antd';
import { Link } from 'react-router-dom';
import {
  getDeliveryAbnormalPayments,
  getDeliveryMerchantApplications,
  getDeliverySettlements,
  getDeliveryStats,
} from '@/api/delivery-management';
import type {
  DeliveryAbnormalPayment,
  DeliveryMerchantApplicationSummary,
  DeliverySettlement,
} from '@/types/delivery-management';
import { DetailLinkButton, MoneyText, PageHeader, StatusPill } from './components';
import { formatDateTime, getErrorMessage } from './utils';

const { Text } = Typography;

export default function DeliveryDashboardPage() {
  const statsQuery = useQuery({
    queryKey: ['delivery-dashboard', 'stats'],
    queryFn: getDeliveryStats,
  });
  const applicationsQuery = useQuery({
    queryKey: ['delivery-dashboard', 'applications'],
    queryFn: () => getDeliveryMerchantApplications({ page: 1, pageSize: 5, status: 'PENDING' }),
  });
  const paymentsQuery = useQuery({
    queryKey: ['delivery-dashboard', 'abnormal-payments'],
    queryFn: () => getDeliveryAbnormalPayments({ page: 1, pageSize: 5 }),
  });
  const settlementsQuery = useQuery({
    queryKey: ['delivery-dashboard', 'settlements'],
    queryFn: () => getDeliverySettlements({ page: 1, pageSize: 5, status: 'PENDING' }),
  });

  const stats = statsQuery.data;
  const errorMessage = [
    statsQuery.error,
    applicationsQuery.error,
    paymentsQuery.error,
    settlementsQuery.error,
  ]
    .filter(Boolean)
    .map((item) => getErrorMessage(item))
    .join('；');

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送工作台"
        subtitle="聚合配送用户、订单、异常支付、客服与结算待办。"
      />

      {errorMessage ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={errorMessage} /> : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="配送用户" value={stats?.users ?? 0} loading={statsQuery.isLoading} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="配送单位" value={stats?.units ?? 0} loading={statsQuery.isLoading} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic title="商家数" value={stats?.merchants ?? 0} loading={statsQuery.isLoading} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="进行中订单"
              value={stats?.activeOrders ?? 0}
              loading={statsQuery.isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="买家成交额"
              value={stats?.totalOrderAmountCents ? stats.totalOrderAmountCents / 100 : 0}
              prefix="¥"
              precision={2}
              loading={statsQuery.isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="待审入驻"
              value={stats?.pendingMerchantApplications ?? 0}
              loading={statsQuery.isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="异常支付"
              value={stats?.abnormalPayments ?? 0}
              loading={statsQuery.isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Space direction="vertical" size={2}>
              <Text type="secondary">待结算 / 已结金额</Text>
              <Text strong style={{ fontSize: 24 }}>
                {stats?.pendingSettlements ?? 0}
              </Text>
              <Text type="secondary">
                已结金额 <MoneyText cents={stats?.totalSettledAmountCents} />
              </Text>
              <Text type="secondary">开放会话 {stats?.openConversations ?? 0}</Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card
            title="待审入驻申请"
            extra={<Link to="/merchant-applications">查看全部</Link>}
          >
            <Table<DeliveryMerchantApplicationSummary>
              size="small"
              pagination={false}
              rowKey="id"
              loading={applicationsQuery.isLoading}
              dataSource={applicationsQuery.data?.items ?? []}
              columns={[
                { title: '企业名', dataIndex: 'companyName', key: 'companyName' },
                { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 110 },
                { title: '电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 130 },
                {
                  title: '创建时间',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  width: 150,
                  render: formatDateTime,
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 90,
                  render: (_, record) => <DetailLinkButton to={`/merchant-applications/${record.id}`} />,
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card
            title="异常支付"
            extra={<Link to="/payments/abnormal">查看全部</Link>}
          >
            <Table<DeliveryAbnormalPayment>
              size="small"
              pagination={false}
              rowKey="id"
              loading={paymentsQuery.isLoading}
              dataSource={paymentsQuery.data?.items ?? []}
              columns={[
                { title: '支付单', dataIndex: 'merchantOrderNo', key: 'merchantOrderNo', ellipsis: true },
                { title: '渠道', dataIndex: 'channel', key: 'channel', width: 100 },
                {
                  title: '金额',
                  dataIndex: 'amountCents',
                  key: 'amountCents',
                  width: 110,
                  render: (value: number) => <MoneyText cents={value} />,
                },
                {
                  title: '订单',
                  key: 'order',
                  width: 120,
                  render: (_, record) =>
                    record.orderId ? <Link to={`/orders/${record.orderId}`}>{record.orderId}</Link> : '-',
                },
                {
                  title: '失败时间',
                  dataIndex: 'updatedAt',
                  key: 'updatedAt',
                  width: 150,
                  render: formatDateTime,
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card
            title="待结算"
            extra={<Link to="/settlements">查看全部</Link>}
          >
            <Table<DeliverySettlement>
              size="small"
              pagination={false}
              rowKey="id"
              loading={settlementsQuery.isLoading}
              dataSource={settlementsQuery.data?.items ?? []}
              columns={[
                {
                  title: '商家',
                  key: 'merchant',
                  render: (_, record) => record.merchant?.name ?? record.merchantId,
                },
                {
                  title: '子订单',
                  key: 'subOrder',
                  width: 120,
                  render: (_, record) =>
                    record.subOrder ? <Link to={`/orders/${record.subOrder.orderId}`}>{record.subOrder.id}</Link> : '-',
                },
                {
                  title: '应结',
                  dataIndex: 'expectedAmountCents',
                  key: 'expectedAmountCents',
                  width: 110,
                  render: (value: number) => <MoneyText cents={value} />,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 90,
                  render: (value: string) => <StatusPill value={value} />,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
