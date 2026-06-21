import { useRef } from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { getDeliveryUnits } from '@/api/delivery-management';
import type { DeliveryUnitSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import { deliveryValueEnum, formatDateTime, formatAddress, unitStatusOptions } from './utils';

export default function DeliveryUnitsPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);

  const columns: ProColumns<DeliveryUnitSummary>[] = [
    { title: '单位编号', dataIndex: 'id', key: 'id', width: 160, ellipsis: true, copyable: true, search: false },
    { title: '单位名称', dataIndex: 'name', key: 'name', width: 180, search: false },
    {
      title: '所属用户',
      key: 'user',
      width: 160,
      render: (_, record) => record.user?.nickname || record.user?.phone || record.userId,
      search: false,
    },
    { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 120, search: false },
    { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 140, search: false },
    {
      title: '地址',
      key: 'address',
      render: (_, record) => formatAddress(record),
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      valueEnum: deliveryValueEnum(unitStatusOptions),
      render: (_, record) => <StatusPill value={record.status} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (_, record) => formatDateTime(record.createdAt),
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, record) => <DetailLinkButton to={`/units/${record.id}`} />,
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送单位"
        subtitle="维护配送单位基础档案，并通过配置页控制字段展示。"
      />
      <ProTable<DeliveryUnitSummary>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryUnits({
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
        scroll={{ x: 1200 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />
    </div>
  );
}
