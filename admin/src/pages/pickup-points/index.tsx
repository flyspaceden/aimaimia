import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Select, Space, Tag, Typography } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { getCompanies } from '@/api/companies';
import { getPickupPoints, updatePickupPoint } from '@/api/pickup-points';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { PickupPoint } from '@/types';
import { formatPickupBusinessHours, pickupFullAddress } from '@/utils/pickup';

export default function PickupPointListPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [companyOptions, setCompanyOptions] = useState<Array<{ label: string; value: string }>>([]);

  useEffect(() => {
    getCompanies({ page: 1, pageSize: 200 })
      .then((response) => {
        setCompanyOptions(response.items.map((company) => ({ label: company.name, value: company.id })));
      })
      .catch(() => {});
  }, []);

  const toggleActive = (point: PickupPoint) => {
    const nextActive = !point.isActive;
    modal.confirm({
      title: nextActive ? '重新启用这个自提点？' : '平台停用这个自提点？',
      content: nextActive
        ? '启用后，该商家的新结算可以再次选择这个地点。'
        : '停用后新的结算不可选择；历史订单继续读取下单时冻结的地点快照。',
      okText: nextActive ? '启用' : '停用',
      okButtonProps: nextActive ? undefined : { danger: true },
      onOk: async () => {
        try {
          await updatePickupPoint(point.id, { isActive: nextActive });
          message.success(nextActive ? '自提点已启用' : '自提点已停用');
          actionRef.current?.reload();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '更新自提点状态失败');
        }
      },
    });
  };

  const columns: ProColumns<PickupPoint>[] = [
    {
      title: '自提点',
      dataIndex: 'name',
      width: 180,
      search: false,
      render: (_, point) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{point.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable>
            {point.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '商家',
      dataIndex: 'companyId',
      width: 180,
      renderFormItem: () => (
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="选择商家"
          options={companyOptions}
        />
      ),
      render: (_, point) => point.company?.name || point.companyId,
    },
    {
      title: '地址',
      dataIndex: 'detail',
      width: 300,
      search: false,
      render: (_, point) => (
        <Space align="start">
          <EnvironmentOutlined style={{ color: '#2563EB', marginTop: 4 }} />
          <span>{pickupFullAddress(point)}</span>
        </Space>
      ),
    },
    {
      title: '营业时间',
      dataIndex: 'businessHours',
      width: 180,
      search: false,
      render: (_, point) => formatPickupBusinessHours(point.businessHours),
    },
    {
      title: '联系人',
      dataIndex: 'contactName',
      width: 150,
      search: false,
      render: (_, point) => (
        <Space direction="vertical" size={0}>
          <span>{point.contactName}</span>
          <Typography.Text type="secondary">{point.contactPhone}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '营业状态',
      dataIndex: 'isActive',
      width: 120,
      valueType: 'select',
      valueEnum: {
        true: { text: '营业中' },
        false: { text: '已停用' },
      },
      render: (_, point) => (
        <Tag color={point.isActive ? 'success' : 'default'}>
          {point.isActive ? '营业中' : '已停用'}
        </Tag>
      ),
    },
    {
      title: '平台操作',
      valueType: 'option',
      width: 130,
      render: (_, point) => [
        <PermissionGate key="active" permission={PERMISSIONS.ORDERS_SHIP}>
          <Button
            type="link"
            size="small"
            danger={point.isActive}
            onClick={() => toggleActive(point)}
          >
            {point.isActive ? '停用' : '启用'}
          </Button>
        </PermissionGate>,
      ],
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Alert
        type="info"
        showIcon
        message="平台只负责监督点位状态"
        description="商家维护名称、联系人、地址和营业时间；平台停用点位不会覆盖已经付款订单中的历史快照。所有启停操作由后台审计记录。"
        style={{ marginBottom: 16 }}
      />
      <ProTable<PickupPoint>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="自提点管理"
        columns={columns}
        request={async (params) => {
          const rawActive = params.isActive;
          const isActive = rawActive === true || rawActive === 'true'
            ? true
            : rawActive === false || rawActive === 'false'
              ? false
              : undefined;
          const response = await getPickupPoints({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            companyId: params.companyId || undefined,
            isActive,
          });
          return { data: response.items, total: response.total, success: true };
        }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        scroll={{ x: 1250 }}
      />
    </div>
  );
}
