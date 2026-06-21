import { useRef } from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { getDeliveryShippingRecords } from '@/api/delivery-management';
import type { DeliveryShippingRecord } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import { formatDateTime, formatMoney } from './utils';

export default function DeliveryShippingRecordsPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);

  const columns: ProColumns<DeliveryShippingRecord>[] = [
    { title: '运单编号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '订单编号', dataIndex: 'orderId', key: 'orderId', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '子订单编号', dataIndex: 'subOrderId', key: 'subOrderId', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '商家编号', dataIndex: 'merchantId', key: 'merchantId', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '承运商', dataIndex: 'carrierName', key: 'carrierName', width: 130, search: false },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (_, record) => <StatusPill value={record.status} />, search: false },
    { title: '面单号', dataIndex: 'waybillNo', key: 'waybillNo', width: 140, copyable: true, search: false },
    {
      title: '买家预估运费',
      dataIndex: 'estimatedUserShippingFeeCents',
      key: 'estimatedUserShippingFeeCents',
      width: 130,
      render: (_, record) => formatMoney(record.estimatedUserShippingFeeCents),
      search: false,
    },
    {
      title: '承运实际成本',
      dataIndex: 'actualCarrierCostCents',
      key: 'actualCarrierCostCents',
      width: 130,
      render: (_, record) => formatMoney(record.actualCarrierCostCents),
      search: false,
    },
    { title: '承运记录号', dataIndex: 'carrierRecordNo', key: 'carrierRecordNo', width: 160, copyable: true, search: false },
    { title: '发货时间', dataIndex: 'shippedAt', key: 'shippedAt', width: 150, render: (_, record) => formatDateTime(record.shippedAt), search: false },
    { title: '签收时间', dataIndex: 'deliveredAt', key: 'deliveredAt', width: 150, render: (_, record) => formatDateTime(record.deliveredAt), search: false },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="配送发货记录" subtitle="查看面单号、买家预估运费和顺丰实际成本。" />

      <ProTable<DeliveryShippingRecord>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryShippingRecords({
            page: params.current,
            pageSize: params.pageSize,
          });
          return {
            data: result.items,
            success: true,
            total: result.total,
          };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={false}
        scroll={{ x: 1640 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />
    </div>
  );
}
