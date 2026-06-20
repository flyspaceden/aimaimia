import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Descriptions, Table, Typography } from 'antd';
import { getDeliveryStats } from '@/api/delivery-management';
import { MoneyText, PageHeader } from './components';
import { getErrorMessage } from './utils';

const { Text } = Typography;

export default function DeliveryStatsPage() {
  const query = useQuery({
    queryKey: ['delivery-stats'],
    queryFn: getDeliveryStats,
  });

  const stats = query.data;
  const metricRows = [
    {
      key: 'users',
      metric: '配送用户',
      value: stats?.users ?? 0,
      note: '已开通配送能力的买家账号数',
    },
    {
      key: 'units',
      metric: '配送单位',
      value: stats?.units ?? 0,
      note: '已绑定配送收货单位的数量',
    },
    {
      key: 'merchants',
      metric: '商家数',
      value: stats?.merchants ?? 0,
      note: '参与配送业务的商家数量',
    },
    {
      key: 'activeOrders',
      metric: '进行中订单',
      value: stats?.activeOrders ?? 0,
      note: '待发货 / 已发货 / 履约中的订单',
    },
    {
      key: 'totalOrderAmountCents',
      metric: '买家成交额',
      value: <MoneyText cents={stats?.totalOrderAmountCents} />,
      note: '买家侧订单总额，含买家承担运费',
    },
    {
      key: 'pendingMerchantApplications',
      metric: '待审入驻',
      value: stats?.pendingMerchantApplications ?? 0,
      note: '尚未审核的商家入驻申请',
    },
    {
      key: 'abnormalPayments',
      metric: '异常支付',
      value: stats?.abnormalPayments ?? 0,
      note: '后端标记为异常的支付记录',
    },
    {
      key: 'pendingSettlements',
      metric: '待结算',
      value: stats?.pendingSettlements ?? 0,
      note: '尚未结算给商家的记录数',
    },
    {
      key: 'totalSettledAmountCents',
      metric: '已结金额',
      value: <MoneyText cents={stats?.totalSettledAmountCents} />,
      note: '已完成结算的金额总和',
    },
    {
      key: 'openConversations',
      metric: '开放会话',
      value: stats?.openConversations ?? 0,
      note: '仍在处理中的客服会话',
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="数据看板"
        subtitle="配送运营指标总览，并明确买家金额、商家供货、商家应结和平台差额的边界。"
      />

      {query.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={getErrorMessage(query.error)}
        />
      ) : null}

      <Card title="运营指标" style={{ marginBottom: 16 }}>
        <Table
          rowKey="key"
          pagination={false}
          loading={query.isLoading}
          columns={[
            { title: '指标', dataIndex: 'metric', key: 'metric', width: 180 },
            {
              title: '数值',
              dataIndex: 'value',
              key: 'value',
              width: 180,
              render: (value) => value,
            },
            { title: '说明', dataIndex: 'note', key: 'note' },
          ]}
          dataSource={metricRows}
        />
      </Card>

      <Card title="运营快照" style={{ marginBottom: 16 }}>
        <Descriptions
          column={2}
          size="small"
          bordered
          items={[
            { key: 'settled', label: '已结金额', children: <MoneyText cents={stats?.totalSettledAmountCents} /> },
            { key: 'open', label: '开放会话', children: stats?.openConversations ?? 0 },
            { key: 'orders', label: '活跃订单', children: stats?.activeOrders ?? 0 },
            { key: 'abnormal', label: '异常支付', children: stats?.abnormalPayments ?? 0 },
          ]}
        />
      </Card>

      <Card title="金额边界">
        <div style={{ display: 'grid', gap: 8 }}>
          <Text>买家金额: 订单总额，含买家侧支付的运费。</Text>
          <Text>商家供货: 商家商品供货价合计。</Text>
          <Text>商家应结: 商家供货 + 运费分摊。</Text>
          <Text type="secondary">平台差额: 买家金额 - 商家应结。</Text>
        </div>
      </Card>
    </div>
  );
}
