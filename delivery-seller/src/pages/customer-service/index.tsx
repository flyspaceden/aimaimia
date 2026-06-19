import { useState } from 'react';
import { App, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createConversation,
  getConversations,
  updateConversation,
  type CreateConversationPayload,
  type DeliveryConversation,
  type UpdateConversationPayload,
} from '@/api/customerService';
import dayjs from 'dayjs';

type ConversationForm = CreateConversationPayload & UpdateConversationPayload;

export default function CustomerServicePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'OPEN' | 'CLOSED' | undefined>('OPEN');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryConversation | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ConversationForm>();

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-customer-service', status],
    queryFn: () => getConversations({ status }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['delivery-customer-service'] });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'OPEN' });
    setModalOpen(true);
  };

  const openEdit = (record: DeliveryConversation) => {
    setEditing(record);
    form.setFieldsValue({
      subject: record.subject || '',
      message: '',
      status: record.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values: ConversationForm) => {
    setSaving(true);
    try {
      if (editing) {
        const payload: UpdateConversationPayload = {
          subject: values.subject?.trim() || undefined,
          message: values.message?.trim() || undefined,
          status: values.status,
        };
        await updateConversation(editing.id, payload);
        message.success('工单已更新');
      } else {
        await createConversation({
          orderId: values.orderId?.trim() || undefined,
          subOrderId: values.subOrderId?.trim() || undefined,
          subject: values.subject?.trim() || undefined,
          message: values.message.trim(),
        });
        message.success('工单已创建');
      }
      setModalOpen(false);
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Select
          value={status}
          style={{ width: 160 }}
          onChange={setStatus}
          options={[
            { value: 'OPEN', label: '处理中' },
            { value: 'CLOSED', label: '已关闭' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建工单
        </Button>
      </Space>

      <Table<DeliveryConversation>
        rowKey="id"
        loading={isLoading}
        dataSource={data || []}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        size="middle"
        columns={[
          {
            title: '主题',
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{row.subject || '配送中心咨询'}</Typography.Text>
                <Typography.Text type="secondary">{row.lastMessagePreview || '-'}</Typography.Text>
              </Space>
            ),
          },
          {
            title: '关联订单',
            width: 180,
            render: (_, row) => row.subOrderId || row.orderId || '-',
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (value: DeliveryConversation['status']) => (
              <Tag color={value === 'OPEN' ? 'orange' : 'default'}>
                {value === 'OPEN' ? '处理中' : '已关闭'}
              </Tag>
            ),
          },
          {
            title: '最后更新',
            dataIndex: 'lastMessageAt',
            width: 170,
            render: (value?: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
          },
          {
            title: '操作',
            width: 120,
            render: (_, row) => (
              <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                处理
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '处理工单' : '新建工单'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form<ConversationForm> form={form} layout="vertical" onFinish={handleSubmit}>
          {!editing ? (
            <>
              <Form.Item name="subOrderId" label="子订单号">
                <Input placeholder="可选" />
              </Form.Item>
              <Form.Item name="orderId" label="主订单号">
                <Input placeholder="可选" />
              </Form.Item>
            </>
          ) : null}
          <Form.Item name="subject" label="主题">
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item
            name="message"
            label="处理内容"
            rules={editing ? [] : [{ required: true, message: '请输入处理内容' }]}
          >
            <Input.TextArea rows={4} maxLength={500} showCount />
          </Form.Item>
          {editing ? (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'OPEN', label: '处理中' },
                  { value: 'CLOSED', label: '已关闭' },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </Space>
  );
}
