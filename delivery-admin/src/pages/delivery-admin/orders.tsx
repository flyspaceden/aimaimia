import { useRef } from 'react';
import { Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { getDeliveryOrders } from '@/api/delivery-management';
import type { DeliveryOrderSummary } from '@/types/delivery-management';
import { DetailLinkButton, MoneyBreakdown, PageHeader, StatusPill } from './components';
import { deliveryValueEnum, formatDateTime, getOrderAmountSummary, orderStatusOptions } from './utils';

export default function DeliveryOrdersPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);

  const columns: ProColumns<DeliveryOrderSummary>[] = [
    { title: '订单编号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true, copyable: true, search: false },
    {
      title: '买家 / 单位',
      key: 'buyer',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{record.user?.nickname || record.user?.phone || record.userId}</span>
          <span>{record.unit?.name || record.unitId}</span>
        </Space>
      ),
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      valueEnum: deliveryValueEnum(orderStatusOptions),
      render: (_, record) => <StatusPill value={record.status} />,
    },
    {
      title: '金额拆分',
      key: 'money',
      width: 260,
      render: (_, record) => {
        const summary = getOrderAmountSummary(record);
        return <MoneyBreakdown {...summary} />;
      },
      search: false,
    },
    {
      title: '子单数',
      key: 'subOrders',
      width: 90,
      render: (_, record) => record.subOrders.length,
      search: false,
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      key: 'paidAt',
      width: 150,
      render: (_, record) => formatDateTime(record.paidAt),
      search: false,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (_, record) => formatDateTime(record.updatedAt),
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, record) => <DetailLinkButton to={`/orders/${record.id}`} />,
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送订单"
        subtitle="订单列表中明确区分买家金额、商家供货、商家应结和平台差额。"
      />

      <ProTable<DeliveryOrderSummary>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryOrders({
            page: params.current,
            pageSize: params.pageSize,
            status: typeof params.status === 'string' ? params.status : undefined,
          });
          return {
            data: result.items,
            success: true,
            total: result.total,
          };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 84 }}
        scroll={{ x: 1280 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />
    </div>
  );
}
