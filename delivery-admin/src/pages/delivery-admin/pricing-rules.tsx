import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  createDeliveryPricingRule,
  getDeliveryPricingRules,
  updateDeliveryPricingRule,
} from '@/api/delivery-management';
import type { DeliveryPriceRule } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import {
  formatBps,
  formatDateTime,
  formatMoney,
  getErrorMessage,
  pricingRuleTypeOptions,
  pricingScopeOptions,
} from './utils';

type RuleFormValues = {
  scope: string;
  ruleType: string;
  merchantId?: string;
  productId?: string;
  skuId?: string;
  minQuantity: number;
  maxQuantity?: number | null;
  fixedPriceCents?: number | null;
  markupBps?: number | null;
  priority: number;
  isActive: boolean;
  note?: string | null;
};

export default function DeliveryPricingRulesPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<string | undefined>();
  const [ruleType, setRuleType] = useState<string | undefined>();
  const [isActive, setIsActive] = useState<'true' | 'false' | undefined>();
  const [editing, setEditing] = useState<DeliveryPriceRule | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<RuleFormValues>();

  const query = useQuery({
    queryKey: ['delivery-pricing-rules', scope, ruleType, isActive],
    queryFn: () => getDeliveryPricingRules({ scope, ruleType, isActive }),
  });

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }
    if (editing) {
      form.setFieldsValue({
        scope: editing.scope,
        ruleType: editing.ruleType,
        merchantId: editing.merchantId ?? undefined,
        productId: editing.productId ?? undefined,
        skuId: editing.skuId ?? undefined,
        minQuantity: editing.minQuantity,
        maxQuantity: editing.maxQuantity ?? undefined,
        fixedPriceCents: editing.fixedPriceCents ?? undefined,
        markupBps: editing.markupBps ?? undefined,
        priority: editing.priority,
        isActive: editing.isActive,
        note: editing.note ?? undefined,
      });
      return;
    }
    form.setFieldsValue({
      scope: 'PLATFORM',
      ruleType: 'MARKUP_RATE',
      minQuantity: 1,
      priority: 0,
      isActive: true,
    });
  }, [editing, form, open]);

  const mutation = useMutation({
    mutationFn: async (values: RuleFormValues) => {
      const payload = {
        ...values,
        merchantId: values.merchantId?.trim() || undefined,
        productId: values.productId?.trim() || undefined,
        skuId: values.skuId?.trim() || undefined,
        maxQuantity: values.maxQuantity ?? undefined,
        fixedPriceCents: values.fixedPriceCents ?? undefined,
        markupBps: values.markupBps ?? undefined,
        note: values.note?.trim() || undefined,
      };
      if (editing) {
        return updateDeliveryPricingRule(editing.id, payload);
      }
      return createDeliveryPricingRule(payload);
    },
    onSuccess: async () => {
      message.success(editing ? '规则已更新' : '规则已创建');
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['delivery-pricing-rules'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ColumnsType<DeliveryPriceRule> = [
    { title: '规则 ID', dataIndex: 'id', key: 'id', width: 150, ellipsis: true },
    { title: '作用域', dataIndex: 'scope', key: 'scope', width: 100 },
    { title: '规则类型', dataIndex: 'ruleType', key: 'ruleType', width: 130 },
    {
      title: '范围',
      key: 'scopeRefs',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>merchantId: {record.merchantId ?? '-'}</span>
          <span>productId: {record.productId ?? '-'}</span>
          <span>skuId: {record.skuId ?? '-'}</span>
        </Space>
      ),
    },
    {
      title: '数量区间',
      key: 'quantity',
      width: 110,
      render: (_, record) => `${record.minQuantity} - ${record.maxQuantity ?? '∞'}`,
    },
    {
      title: '定价',
      key: 'pricing',
      width: 170,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>固定价: {formatMoney(record.fixedPriceCents)}</span>
          <span>加价率: {formatBps(record.markupBps)}</span>
        </Space>
      ),
    },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 90 },
    {
      title: '启用',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 90,
      render: (value: boolean) => <StatusPill value={value ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setEditing(record);
            setOpen(true);
          }}
        >
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="配送定价规则"
        subtitle="维护平台、商家、商品、SKU 四级定价规则。"
        extra={(
          <Space wrap>
            <Select
              allowClear
              placeholder="作用域"
              style={{ width: 150 }}
              value={scope}
              onChange={setScope}
              options={pricingScopeOptions.map((item) => ({ label: item, value: item }))}
            />
            <Select
              allowClear
              placeholder="规则类型"
              style={{ width: 160 }}
              value={ruleType}
              onChange={setRuleType}
              options={pricingRuleTypeOptions.map((item) => ({ label: item, value: item }))}
            />
            <Select
              allowClear
              placeholder="是否启用"
              style={{ width: 130 }}
              value={isActive}
              onChange={setIsActive}
              options={[
                { label: '启用', value: 'true' },
                { label: '停用', value: 'false' },
              ]}
            />
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              新建规则
            </Button>
          </Space>
        )}
      />

      <Card>
        <Table<DeliveryPriceRule>
          rowKey="id"
          columns={columns}
          dataSource={query.data?.items ?? []}
          loading={query.isLoading}
          scroll={{ x: 1280 }}
          locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无定价规则' }}
        />
      </Card>

      <Modal
        open={open}
        width={680}
        title={editing ? '编辑定价规则' : '新建定价规则'}
        confirmLoading={mutation.isPending}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={async () => {
          const values = await form.validateFields();
          mutation.mutate(values);
        }}
      >
        <Form form={form} layout="vertical">
          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="作用域" name="scope" rules={[{ required: true }]}>
              <Select style={{ width: 160 }} options={pricingScopeOptions.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
            <Form.Item label="规则类型" name="ruleType" rules={[{ required: true }]}>
              <Select style={{ width: 180 }} options={pricingRuleTypeOptions.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
            <Form.Item label="是否启用" name="isActive" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="merchantId" name="merchantId" style={{ flex: 1 }}>
              <Input placeholder="MERCHANT 作用域时填写" />
            </Form.Item>
            <Form.Item label="productId" name="productId" style={{ flex: 1 }}>
              <Input placeholder="PRODUCT 作用域时填写" />
            </Form.Item>
            <Form.Item label="skuId" name="skuId" style={{ flex: 1 }}>
              <Input placeholder="SKU 作用域时填写" />
            </Form.Item>
          </Space>

          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="最小数量" name="minQuantity" rules={[{ required: true }]}>
              <InputNumber min={1} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="最大数量" name="maxQuantity">
              <InputNumber min={1} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="优先级" name="priority" rules={[{ required: true }]}>
              <InputNumber min={0} max={999} precision={0} style={{ width: 120 }} />
            </Form.Item>
          </Space>

          <Space align="start" style={{ width: '100%' }}>
            <Form.Item label="固定价（分）" name="fixedPriceCents">
              <InputNumber min={0} precision={0} style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label="加价率（bps）" name="markupBps">
              <InputNumber min={0} max={100000} precision={0} style={{ width: 180 }} />
            </Form.Item>
          </Space>

          <Form.Item label="备注" name="note">
            <Input.TextArea rows={4} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
