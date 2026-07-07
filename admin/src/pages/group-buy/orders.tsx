import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { getGroupBuyOrders } from '@/api/group-buy';
import { BuyerSuggestInput } from '@/components/BuyerSuggestInput';
import type { AdminGroupBuyOrder, OrderStatus } from '@/types';
import {
  GroupBuyUser,
  StatusTag,
  codeStatusMap,
  instanceStatusMap,
  money,
  referralStatusMap,
} from './common';

const orderStatusMap: Record<string, { text: string; color: string }> = {
  PAID: { text: '已付款', color: 'gold' },
  SHIPPED: { text: '已发货', color: 'blue' },
  DELIVERED: { text: '已签收', color: 'cyan' },
  RECEIVED: { text: '已确认收货', color: 'green' },
  CANCELED: { text: '已取消', color: 'default' },
  REFUNDED: { text: '已退款', color: 'red' },
};

export default function GroupBuyOrdersPage() {
  const columns: ProColumns<AdminGroupBuyOrder>[] = [
    {
      title: '订单编号',
      dataIndex: 'keyword',
      width: 180,
      render: (_: unknown, record) => (
        <Typography.Text copyable={{ text: record.id }} style={{ fontFamily: 'monospace' }}>
          {record.id.slice(-12)}
        </Typography.Text>
      ),
    },
    {
      title: '购买用户',
      search: false,
      width: 260,
      render: (_: unknown, record) => <GroupBuyUser user={record.user} />,
    },
    {
      title: '买家',
      dataIndex: 'userId',
      hideInTable: true,
      renderFormItem: () => (
        <BuyerSuggestInput placeholder="搜索并选择买家编号、手机号或昵称" />
      ),
    },
    {
      title: '订单角色',
      search: false,
      width: 220,
      render: (_: unknown, record) => {
        if (record.groupBuyReferredPurchase) {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="purple">通过分享购买</Tag>
              <Typography.Text type="secondary">
                分享用户：{record.groupBuyReferredPurchase.instance?.user?.buyerNo || '-'}
              </Typography.Text>
            </Space>
          );
        }
        if (record.groupBuyInitiatedInstance) {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="green">发起团购</Tag>
              <StatusTag value={record.groupBuyInitiatedInstance.status} map={instanceStatusMap} />
            </Space>
          );
        }
        return <Tag>团购订单</Tag>;
      },
    },
    {
      title: '活动商品',
      search: false,
      width: 220,
      render: (_: unknown, record) => {
        const activity =
          record.groupBuyInitiatedInstance?.activity ||
          record.groupBuyReferredPurchase?.instance?.activity;
        const code =
          record.groupBuyInitiatedInstance?.code ||
          record.groupBuyReferredPurchase?.instance?.code;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{activity?.title || '-'}</Typography.Text>
            {code ? (
              <Space>
                <Typography.Text type="secondary" copyable={{ text: code.code }} style={{ fontFamily: 'monospace' }}>
                  {code.code}
                </Typography.Text>
                <StatusTag value={code.status} map={codeStatusMap} />
              </Space>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '订单状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 130,
      valueEnum: {
        PAID: { text: '已付款' },
        SHIPPED: { text: '已发货' },
        DELIVERED: { text: '已签收' },
        RECEIVED: { text: '已确认收货' },
        CANCELED: { text: '已取消' },
        REFUNDED: { text: '已退款' },
      },
      render: (_: unknown, record) => <StatusTag value={record.status} map={orderStatusMap} />,
    },
    {
      title: '直接推荐状态',
      search: false,
      width: 140,
      render: (_: unknown, record) =>
        record.groupBuyReferredPurchase
          ? <StatusTag value={record.groupBuyReferredPurchase.status} map={referralStatusMap} />
          : '-',
    },
    {
      title: '金额',
      search: false,
      width: 120,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{money(record.totalAmount)}</Typography.Text>
          <Typography.Text type="secondary">商品 {money(record.goodsAmount)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '确认收货',
      search: false,
      width: 170,
      render: (_: unknown, record) => record.receivedAt
        ? dayjs(record.receivedAt).format('YYYY-MM-DD HH:mm')
        : '-',
    },
    {
      title: '下单时间',
      search: false,
      width: 170,
      render: (_: unknown, record) => dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<AdminGroupBuyOrder>
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getGroupBuyOrders({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            status: params.status as OrderStatus | undefined,
            userId: params.userId as string | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
      />
    </div>
  );
}
