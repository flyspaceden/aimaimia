import { useRef } from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { getDeliveryUsers } from '@/api/delivery-management';
import type { DeliveryUserSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import { formatDateTime } from './utils';

export default function DeliveryUsersPage() {
  const actionRef = useRef<ActionType | undefined>(undefined);

  const columns: ProColumns<DeliveryUserSummary>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜手机号或昵称' },
    },
    { title: '用户编号', dataIndex: 'id', key: 'id', width: 170, ellipsis: true, copyable: true, search: false },
    { title: '手机号', dataIndex: 'phone', key: 'phone', width: 140, search: false },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname', width: 140, search: false },
    {
      title: '当前单位',
      key: 'currentUnit',
      width: 180,
      render: (_, record) => record.currentUnit?.name ?? '-',
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (_, record) => <StatusPill value={record.status} />,
      search: false,
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 160,
      render: (_, record) => formatDateTime(record.lastLoginAt),
      search: false,
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
      fixed: 'right',
      width: 90,
      render: (_, record) => <DetailLinkButton to={`/users/${record.id}`} />,
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送用户"
        subtitle="查看配送买家账号、当前单位和登录状态。"
      />
      <ProTable<DeliveryUserSummary>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryUsers({
            page: params.current,
            pageSize: params.pageSize,
            keyword: typeof params.keyword === 'string' ? params.keyword.trim() : undefined,
          });
          return {
            data: result.items,
            success: true,
            total: result.total,
          };
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        search={{ labelWidth: 84 }}
        scroll={{ x: 1100 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />
    </div>
  );
}
