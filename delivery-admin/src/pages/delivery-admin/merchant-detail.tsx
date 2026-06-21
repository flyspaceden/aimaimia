import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd';
import { useParams } from 'react-router-dom';
import { getDeliveryMerchant, updateDeliveryMerchant } from '@/api/delivery-management';
import type { DeliverySellerStaff } from '@/types/delivery-management';
import { DetailDescriptions, JsonBlock, NotFoundPanel, PageHeader, StatusPill } from './components';
import { formatBps, formatDateTime, formatDeliveryDisplayText, getErrorMessage, merchantStatusOptions } from './utils';

type MerchantFormValues = {
  name?: string;
  status?: string;
  servicePhone?: string;
  defaultMarkupBps?: number | null;
};

export default function DeliveryMerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<MerchantFormValues>();
  const query = useQuery({
    queryKey: ['delivery-merchant-detail', id],
    queryFn: () => getDeliveryMerchant(id ?? ''),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!open || !query.data) {
      return;
    }
    form.setFieldsValue({
      name: query.data.name,
      status: query.data.status,
      servicePhone: query.data.servicePhone ?? undefined,
      defaultMarkupBps: query.data.defaultMarkupBps ?? undefined,
    });
  }, [form, open, query.data]);

  const mutation = useMutation({
    mutationFn: (values: MerchantFormValues) =>
      updateDeliveryMerchant(id!, {
        name: values.name,
        status: values.status,
        servicePhone: values.servicePhone,
        defaultMarkupBps: values.defaultMarkupBps ?? undefined,
      }),
    onSuccess: async () => {
      message.success('商家详情已更新');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchant-detail', id] });
      await queryClient.invalidateQueries({ queryKey: ['delivery-merchants'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  if (!id) {
    return <NotFoundPanel title="缺少商家编号" />;
  }

  if (query.isError) {
    return <NotFoundPanel title="配送商家不存在或无法加载" subtitle={(query.error as Error).message} />;
  }

  const data = query.data;

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="商家详情"
        subtitle="查看商家档案、默认加价率和员工列表。"
        extra={(
          <Space>
            <Button type="primary" onClick={() => setOpen(true)}>
              编辑默认加价率
            </Button>
          </Space>
        )}
      />
      <Card loading={query.isLoading}>
        {data ? (
          <DetailDescriptions
            items={[
              { key: 'id', label: '商家编号', children: data.id },
              { key: 'name', label: '商家名称', children: data.name },
              { key: 'contactName', label: '联系人', children: data.contactName },
              { key: 'contactPhone', label: '联系电话', children: data.contactPhone },
              { key: 'servicePhone', label: '客服热线', children: data.servicePhone ?? '-' },
              { key: 'status', label: '状态', children: <StatusPill value={data.status} /> },
              {
                key: 'defaultMarkupBps',
                label: '默认加价率',
                children: formatBps(data.defaultMarkupBps),
              },
              { key: 'createdAt', label: '创建时间', children: formatDateTime(data.createdAt) },
              { key: 'updatedAt', label: '更新时间', children: formatDateTime(data.updatedAt) },
            ]}
          />
        ) : null}
      </Card>

      <Card title="地址信息" style={{ marginTop: 16 }}>
        <JsonBlock value={data?.addressJson} />
      </Card>

      <Card title="商家员工" style={{ marginTop: 16 }}>
        <Table<DeliverySellerStaff>
          rowKey="id"
          pagination={false}
          size="small"
          dataSource={data?.staff ?? []}
          columns={[
            { title: '员工编号', dataIndex: 'id', key: 'id', width: 140, ellipsis: true },
            { title: '姓名', dataIndex: 'realName', key: 'realName', width: 120 },
            { title: '用户名', dataIndex: 'username', key: 'username', width: 140 },
            { title: '手机号', dataIndex: 'phone', key: 'phone', width: 140 },
            { title: '角色', dataIndex: 'role', key: 'role', width: 100 },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 100,
              render: (value: string) => <StatusPill value={value} />,
            },
            {
              title: '最近登录',
              dataIndex: 'lastLoginAt',
              key: 'lastLoginAt',
              width: 160,
              render: formatDateTime,
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="编辑商家"
        confirmLoading={mutation.isPending}
        onCancel={() => setOpen(false)}
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
            <InputNumber min={0} max={100000} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
