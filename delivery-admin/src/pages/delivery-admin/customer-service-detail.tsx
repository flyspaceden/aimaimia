import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, Select, Space } from 'antd';
import { useParams } from 'react-router-dom';
import {
  getDeliveryCustomerServiceDetail,
  updateDeliveryCustomerService,
} from '@/api/delivery-management';
import { DetailDescriptions, NotFoundPanel, PageHeader, StatusPill } from './components';
import { conversationStatusOptions, formatDateTime, getErrorMessage } from './utils';

type ConversationFormValues = {
  subject?: string;
  message?: string;
  status?: 'OPEN' | 'CLOSED';
  assignedAdminId?: string;
  assignedStaffId?: string;
};

export default function DeliveryCustomerServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ConversationFormValues>();

  const query = useQuery({
    queryKey: ['delivery-customer-service-detail', id],
    queryFn: () => getDeliveryCustomerServiceDetail(id ?? ''),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!query.data) {
      return;
    }
    form.setFieldsValue({
      subject: query.data.subject ?? undefined,
      status: query.data.status as 'OPEN' | 'CLOSED',
      assignedAdminId: query.data.assignedAdminId ?? undefined,
      assignedStaffId: query.data.assignedStaffId ?? undefined,
    });
  }, [form, query.data]);

  const mutation = useMutation({
    mutationFn: (values: ConversationFormValues) => updateDeliveryCustomerService(id!, values),
    onSuccess: async () => {
      message.success('客服会话已更新');
      await queryClient.invalidateQueries({ queryKey: ['delivery-customer-service-detail', id] });
      await queryClient.invalidateQueries({ queryKey: ['delivery-customer-service'] });
      form.setFieldValue('message', undefined);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  if (!id) {
    return <NotFoundPanel title="缺少会话 ID" />;
  }

  if (query.isError) {
    return <NotFoundPanel title="配送客服会话不存在或无法加载" subtitle={(query.error as Error).message} />;
  }

  const data = query.data;

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="客服会话详情" subtitle="支持更新主题、状态、分配对象，并补一条管理侧消息摘要。" />

      <Card loading={query.isLoading}>
        {data ? (
          <DetailDescriptions
            items={[
              { key: 'id', label: '会话 ID', children: data.id },
              { key: 'subject', label: '主题', children: data.subject ?? '-' },
              { key: 'status', label: '状态', children: <StatusPill value={data.status} /> },
              { key: 'source', label: '来源', children: data.source },
              { key: 'buyer', label: '买家', children: data.user?.nickname || data.user?.phone || data.userId || '-' },
              { key: 'unit', label: '单位', children: data.unit?.name || data.unitId || '-' },
              { key: 'order', label: '订单', children: data.order?.id || data.orderId || '-' },
              { key: 'subOrder', label: '子订单', children: data.subOrder?.id || data.subOrderId || '-' },
              { key: 'assignedAdminId', label: '指派管理员', children: data.assignedAdminId ?? '-' },
              { key: 'assignedStaffId', label: '指派商家员工', children: data.assignedStaffId ?? '-' },
              { key: 'lastMessagePreview', label: '最近消息', children: data.lastMessagePreview ?? '-' },
              { key: 'lastMessageAt', label: '最近消息时间', children: formatDateTime(data.lastMessageAt) },
            ]}
          />
        ) : null}
      </Card>

      <Card title="更新会话" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="主题" name="subject" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item label="状态" name="status" style={{ width: 160 }}>
              <Select options={conversationStatusOptions.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
          </Space>

          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="assignedAdminId" name="assignedAdminId" style={{ flex: 1 }}>
              <Input placeholder="不填则保留当前值" />
            </Form.Item>
            <Form.Item label="assignedStaffId" name="assignedStaffId" style={{ flex: 1 }}>
              <Input placeholder="不填则保留当前值" />
            </Form.Item>
          </Space>

          <Form.Item label="补发管理消息摘要" name="message">
            <Input.TextArea rows={4} maxLength={500} placeholder="写入 lastMessagePreview，并将来源切到 ADMIN" />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            保存更新
          </Button>
        </Form>
      </Card>
    </div>
  );
}
