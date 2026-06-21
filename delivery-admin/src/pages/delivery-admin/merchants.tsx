import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { getDeliveryMerchants, updateDeliveryMerchant } from '@/api/delivery-management';
import type { DeliveryMerchantSummary } from '@/types/delivery-management';
import { DetailLinkButton, PageHeader, StatusPill } from './components';
import { deliveryValueEnum, formatBps, formatDateTime, formatDeliveryDisplayText, getErrorMessage, merchantStatusOptions } from './utils';

type MerchantFormValues = {
  name?: string;
  status?: string;
  servicePhone?: string;
  defaultMarkupBps?: number | null;
};

export default function DeliveryMerchantsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [editing, setEditing] = useState<DeliveryMerchantSummary | null>(null);
  const [form] = Form.useForm<MerchantFormValues>();

  useEffect(() => {
    if (!editing) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      name: editing.name,
      status: editing.status,
      servicePhone: editing.servicePhone ?? undefined,
      defaultMarkupBps: editing.defaultMarkupBps,
    });
  }, [editing, form]);

  const mutation = useMutation({
    mutationFn: (values: MerchantFormValues) =>
      updateDeliveryMerchant(editing!.id, {
        name: values.name,
        status: values.status,
        servicePhone: values.servicePhone,
        defaultMarkupBps: values.defaultMarkupBps ?? undefined,
      }),
    onSuccess: async () => {
      message.success('商家信息已更新');
      setEditing(null);
      actionRef.current?.reload();
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-detail'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ProColumns<DeliveryMerchantSummary>[] = [
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '搜商家/联系人/手机号' },
    },
    { title: '商家编号', dataIndex: 'id', key: 'id', width: 160, ellipsis: true, copyable: true, search: false },
    { title: '商家名称', dataIndex: 'name', key: 'name', width: 200, search: false },
    { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 120, search: false },
    { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 140, search: false },
    { title: '客服热线', dataIndex: 'servicePhone', key: 'servicePhone', width: 140, search: false },
    {
      title: '默认加价率',
      dataIndex: 'defaultMarkupBps',
      key: 'defaultMarkupBps',
      width: 120,
      render: (_, record) => formatBps(record.defaultMarkupBps),
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      valueEnum: deliveryValueEnum(merchantStatusOptions),
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
      fixed: 'right',
      width: 180,
      render: (_, record) => (
        <Space size="small">
          <DetailLinkButton to={`/merchants/${record.id}`} />
          <Button type="link" size="small" onClick={() => setEditing(record)}>
            编辑
          </Button>
        </Space>
      ),
      search: false,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送商家"
        subtitle="管理商家状态、客服热线和默认加价率。"
      />
      <ProTable<DeliveryMerchantSummary>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const result = await getDeliveryMerchants({
            page: params.current,
            pageSize: params.pageSize,
            keyword: typeof params.keyword === 'string' ? params.keyword.trim() : undefined,
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
        scroll={{ x: 1350 }}
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>
            刷新
          </Button>,
        ]}
      />

      <Modal
        open={Boolean(editing)}
        title="编辑配送商家"
        confirmLoading={mutation.isPending}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          const values = await form.validateFields();
          mutation.mutate(values);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="商家名称" name="name">
            <Input />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select options={merchantStatusOptions.map((item) => ({ label: formatDeliveryDisplayText(item), value: item }))} />
          </Form.Item>
          <Form.Item label="客服热线" name="servicePhone">
            <Input />
          </Form.Item>
          <Form.Item label="默认加价率（万分比）" name="defaultMarkupBps">
            <InputNumber min={0} max={100000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
