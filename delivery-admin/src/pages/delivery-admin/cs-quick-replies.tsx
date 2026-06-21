import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Col, Form, Input, InputNumber, Row, Space, Table, Tag } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import type { ColumnsType } from 'antd/es/table';
import { getDeliveryConfig, updateDeliveryConfig } from '@/api/delivery-management';
import type { JsonValue } from '@/types/delivery-management';
import { PageHeader } from './components';
import {
  getCustomerServiceConfig,
  getCustomerServiceDefaults,
  type CustomerServiceDefaults,
} from './cs-helpers';
import { getErrorMessage } from './utils';

type QuickReplyFormValues = {
  serviceHours: string;
  escalationMinutes: number;
  quickQuestionsText: string;
  defaultReply: string;
};

type QuickReplyRow = {
  id: string;
  title: string;
  content: string;
  category: string;
  enabled: boolean;
};

function toFormValues(defaults: CustomerServiceDefaults): QuickReplyFormValues {
  return {
    serviceHours: defaults.serviceHours,
    escalationMinutes: defaults.escalationMinutes,
    quickQuestionsText: defaults.quickQuestions.join('\n'),
    defaultReply: defaults.defaultReply,
  };
}

function toConfigValue(values: QuickReplyFormValues): JsonValue {
  return {
    serviceHours: values.serviceHours.trim(),
    escalationMinutes: values.escalationMinutes,
    quickQuestions: values.quickQuestionsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    defaultReply: values.defaultReply.trim(),
  };
}

export default function DeliveryCsQuickRepliesPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<QuickReplyFormValues>();

  const configQuery = useQuery({
    queryKey: ['delivery-config', 'customer-service-defaults'],
    queryFn: () => getDeliveryConfig('CUSTOMER_SERVICE'),
  });

  const config = getCustomerServiceConfig(configQuery.data);
  const defaults = getCustomerServiceDefaults(configQuery.data);

  useEffect(() => {
    form.setFieldsValue(toFormValues(defaults));
  }, [defaults.defaultReply, defaults.escalationMinutes, defaults.quickQuestions, defaults.serviceHours, form]);

  const mutation = useMutation({
    mutationFn: async (values: QuickReplyFormValues) =>
      updateDeliveryConfig([
        {
          key: 'CUSTOMER_SERVICE_DEFAULTS',
          scope: 'CUSTOMER_SERVICE',
          description: config?.description ?? '配送客服默认配置',
          value: toConfigValue(values),
        },
      ]),
    onSuccess: async () => {
      message.success('配送客服快捷回复已保存');
      await queryClient.invalidateQueries({ queryKey: ['delivery-config', 'customer-service-defaults'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const rows: QuickReplyRow[] = [
    {
      id: 'default-reply',
      title: '默认开场回复',
      category: '默认回复',
      content: defaults.defaultReply,
      enabled: true,
    },
    ...defaults.quickQuestions.map((question, index) => ({
      id: `question-${index + 1}`,
      title: question,
      category: '常见问题',
      content: defaults.defaultReply,
      enabled: true,
    })),
  ];

  const columns: ColumnsType<QuickReplyRow> = [
    { title: '分类', dataIndex: 'category', width: 120, render: (value: string) => <Tag>{value}</Tag> },
    { title: '标题', dataIndex: 'title', width: 220, ellipsis: true },
    { title: '回复内容', dataIndex: 'content', ellipsis: true },
    { title: '状态', dataIndex: 'enabled', width: 90, render: (enabled: boolean) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag> },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送坐席快捷回复"
        subtitle="维护配送客服默认回复、服务时间和常见问题入口。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <ProCard title="回复设置" headerBordered>
            <Form<QuickReplyFormValues>
              form={form}
              layout="vertical"
              onFinish={(values) => mutation.mutate(values)}
            >
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="serviceHours" label="服务时间" rules={[{ required: true, message: '请输入服务时间' }]}>
                    <Input placeholder="例如：09:00-18:00" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="escalationMinutes" label="转人工提醒分钟数" rules={[{ required: true, message: '请输入分钟数' }]}>
                    <InputNumber min={1} max={1440} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="defaultReply" label="默认回复" rules={[{ required: true, message: '请输入默认回复' }]}>
                <Input.TextArea rows={4} />
              </Form.Item>
              <Form.Item name="quickQuestionsText" label="常见问题入口（一行一个）">
                <Input.TextArea rows={6} />
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={mutation.isPending}>
                保存快捷回复
              </Button>
            </Form>
          </ProCard>
        </Col>

        <Col xs={24} xl={14}>
          <ProCard title="当前快捷回复" headerBordered>
            <Table<QuickReplyRow>
              rowKey="id"
              columns={columns}
              dataSource={rows}
              loading={configQuery.isLoading}
              pagination={false}
            />
            <Space style={{ marginTop: 12 }}>
              <Tag>配置来源：配送客服默认配置</Tag>
            </Space>
          </ProCard>
        </Col>
      </Row>
    </div>
  );
}
