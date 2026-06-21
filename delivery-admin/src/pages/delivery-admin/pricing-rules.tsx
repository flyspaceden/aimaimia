import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ModalForm, ProFormDigit, ProFormSelect, ProFormTextArea, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { App as AntdApp, Alert, Button, Card, Col, Form, Row, Select, Space, Switch, Tag, Typography } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  createDeliveryPricingRule,
  getDeliveryMerchants,
  getDeliveryProducts,
  getDeliveryPricingRules,
  updateDeliveryPricingRule,
} from '@/api/delivery-management';
import type { DeliveryMerchantSummary, DeliveryPriceRule, DeliveryProduct } from '@/types/delivery-management';
import { PageHeader, StatusPill } from './components';
import {
  normalizeDeliveryPricingRulePayload,
  validateDeliveryPricingRuleDraft,
} from './formValidation';
import type { DeliveryPricingRuleDraft } from './formValidation';
import {
  formatBps,
  formatDateTime,
  formatMoney,
  getErrorMessage,
} from './utils';

const { Text } = Typography;

type RuleFormValues = {
  scope: string;
  ruleType: string;
  merchantId?: string;
  productId?: string;
  skuId?: string;
  minQuantity: number;
  maxQuantity?: number | null;
  fixedPriceYuan?: number | null;
  markupPercent?: number | null;
  priority: number;
  isActive: boolean;
  note?: string | null;
};

type PricingQuickAction = {
  title: string;
  description: string;
  initialValues: Partial<RuleFormValues>;
};

const pricingTargetOptions = [
  { value: 'PLATFORM', label: '全平台默认规则', help: '没有更精细规则时使用' },
  { value: 'MERCHANT', label: '指定商家规则', help: '只影响某一个商家的商品' },
  { value: 'PRODUCT', label: '指定商品规则', help: '只影响某一个商品' },
  { value: 'SKU', label: '指定规格规则', help: '只影响某一个商品规格' },
];

const pricingMethodOptions = [
  { value: 'MARKUP_RATE', label: '按供货价加价' },
  { value: 'FIXED_PRICE', label: '直接指定售价' },
];

const pricingRuleGuideItems = [
  {
    title: '先定管谁',
    description: '选择这条规则作用在全平台、某个商家、某个商品，还是某个具体规格。',
  },
  {
    title: '再定数量',
    description: '设置从第几件开始生效，也可以设置结束数量，用于大批量阶梯价。',
  },
  {
    title: '最后定价格',
    description: '选择按供货价加价，或者直接填写买家看到的售价。',
  },
];

const pricingQuickActionItems: PricingQuickAction[] = [
  {
    title: '全平台默认加价',
    description: '先建立兜底规则。没有商家、商品或规格专属规则时，就用它计算售价。',
    initialValues: {
      scope: 'PLATFORM',
      ruleType: 'MARKUP_RATE',
      minQuantity: 1,
      priority: 0,
      markupPercent: 30,
      isActive: true,
    },
  },
  {
    title: '商家单独加价',
    description: '某个商家的毛利、成本或合作条件不同，就给这个商家单独设置。',
    initialValues: {
      scope: 'MERCHANT',
      ruleType: 'MARKUP_RATE',
      minQuantity: 1,
      priority: 30,
      markupPercent: 30,
      isActive: true,
    },
  },
  {
    title: '大批量阶梯价',
    description: '购买数量越大，售价规则可以不同。适合单位大批量下单。',
    initialValues: {
      scope: 'MERCHANT',
      ruleType: 'MARKUP_RATE',
      minQuantity: 100,
      priority: 60,
      markupPercent: 20,
      isActive: true,
    },
  },
];

const matchOrderItems = ['规格优先', '商品其次', '商家再次', '全平台兜底'];

const optionLabel = (options: Array<{ value: string; label: string }>, value?: string | null) =>
  options.find((item) => item.value === value)?.label ?? '未设置';

const toPercent = (bps?: number | null) => (
  bps === null || bps === undefined ? undefined : Number((bps / 100).toFixed(2))
);

const toYuan = (cents?: number | null) => (
  cents === null || cents === undefined ? undefined : Number((cents / 100).toFixed(2))
);

const buildPricingDraft = (values: RuleFormValues): DeliveryPricingRuleDraft => ({
  scope: values.scope,
  ruleType: values.ruleType,
  merchantId: values.merchantId,
  productId: values.productId,
  skuId: values.skuId,
  minQuantity: values.minQuantity,
  maxQuantity: values.maxQuantity,
  fixedPriceCents:
    values.fixedPriceYuan === null || values.fixedPriceYuan === undefined
      ? undefined
      : Math.round(values.fixedPriceYuan * 100),
  markupBps:
    values.markupPercent === null || values.markupPercent === undefined
      ? undefined
      : Math.round(values.markupPercent * 100),
  priority: values.priority,
  isActive: values.isActive,
  note: values.note,
});

function FormSection({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div style={{ border: '1px solid #E5EAF2', borderRadius: 8, padding: 16, background: '#fff' }}>
      <Space align="start" size={12} style={{ width: '100%' }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0B5CAD',
            background: '#E6F4FF',
            fontWeight: 700,
            flex: '0 0 auto',
          }}
        >
          {step}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong>{title}</Text>
          <Text type="secondary" style={{ display: 'block', marginTop: 4, marginBottom: 12 }}>
            {description}
          </Text>
          {children}
        </div>
      </Space>
    </div>
  );
}

export default function DeliveryPricingRulesPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<string | undefined>();
  const [ruleType, setRuleType] = useState<string | undefined>();
  const [isActive, setIsActive] = useState<'true' | 'false' | undefined>();
  const [editing, setEditing] = useState<DeliveryPriceRule | null>(null);
  const [createInitialValues, setCreateInitialValues] = useState<Partial<RuleFormValues> | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<RuleFormValues>();
  const formScope = Form.useWatch('scope', form);
  const formRuleType = Form.useWatch('ruleType', form);
  const formMerchantId = Form.useWatch('merchantId', form);
  const formProductId = Form.useWatch('productId', form);
  const formMinQuantity = Form.useWatch('minQuantity', form);
  const formMaxQuantity = Form.useWatch('maxQuantity', form);
  const formFixedPriceYuan = Form.useWatch('fixedPriceYuan', form);
  const formMarkupPercent = Form.useWatch('markupPercent', form);

  const query = useQuery({
    queryKey: ['delivery-pricing-rules', scope, ruleType, isActive],
    queryFn: () => getDeliveryPricingRules({ scope, ruleType, isActive }),
  });
  const merchantsQuery = useQuery({
    queryKey: ['delivery-pricing-rule-merchants'],
    queryFn: () => getDeliveryMerchants({ pageSize: 200 }),
  });
  const productsQuery = useQuery({
    queryKey: ['delivery-pricing-rule-products'],
    queryFn: () => getDeliveryProducts(),
  });
  const merchants = merchantsQuery.data?.items ?? [];
  const products = productsQuery.data?.items ?? [];
  const merchantById = useMemo(
    () => new Map(merchants.map((merchant) => [merchant.id, merchant] as const)),
    [merchants],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product] as const)),
    [products],
  );
  const skuById = useMemo(() => {
    const map = new Map<string, { product: DeliveryProduct; sku: DeliveryProduct['skus'][number] }>();
    for (const product of products) {
      for (const sku of product.skus) {
        map.set(sku.id, { product, sku });
      }
    }
    return map;
  }, [products]);
  const productOptions = useMemo(
    () =>
      products
        .filter((product) => !formMerchantId || product.merchantId === formMerchantId)
        .map((product) => ({
          label: `${product.title}（${product.merchant?.name ?? '未绑定商家'}）`,
          value: product.id,
        })),
    [formMerchantId, products],
  );
  const skuOptions = useMemo(() => {
    const product = formProductId ? productById.get(formProductId) : undefined;
    return (product?.skus ?? []).map((sku) => ({
      label: sku.title,
      value: sku.id,
    }));
  }, [formProductId, productById]);

  const formatMerchantRef = (merchantId?: string | null) => {
    if (!merchantId) return '未指定商家';
    const merchant = merchantById.get(merchantId);
    return merchant?.name ?? '未找到商家';
  };

  const formatProductRef = (productId?: string | null) => {
    if (!productId) return '未指定商品';
    const product = productById.get(productId);
    return product?.title ?? '未找到商品';
  };

  const formatSkuRef = (skuId?: string | null) => {
    if (!skuId) return '未指定规格';
    const ref = skuById.get(skuId);
    return ref ? `${ref.product.title} / ${ref.sku.title}` : '未找到规格';
  };

  const formatQuantityRange = (record: Pick<DeliveryPriceRule, 'minQuantity' | 'maxQuantity'>) => {
    if (record.maxQuantity === null || record.maxQuantity === undefined) {
      return `从第 ${record.minQuantity} 件起`;
    }
    if (record.minQuantity === record.maxQuantity) {
      return `第 ${record.minQuantity} 件`;
    }
    return `第 ${record.minQuantity} - ${record.maxQuantity} 件`;
  };

  const renderTargetSummary = (record: DeliveryPriceRule) => {
    const targetName = record.scope === 'MERCHANT'
      ? formatMerchantRef(record.merchantId)
      : record.scope === 'PRODUCT'
        ? formatProductRef(record.productId)
        : record.scope === 'SKU'
          ? formatSkuRef(record.skuId)
          : '全平台默认';

    return (
      <Space direction="vertical" size={2}>
        <Text strong>{targetName}</Text>
        <Text type="secondary">{optionLabel(pricingTargetOptions, record.scope)}</Text>
      </Space>
    );
  };

  const renderRuleMatchPath = (record: DeliveryPriceRule) => (
    <Space size={6} wrap>
      <Tag color={record.scope === 'SKU' ? 'blue' : 'default'}>规格优先</Tag>
      <Tag color={record.scope === 'PRODUCT' ? 'blue' : 'default'}>商品其次</Tag>
      <Tag color={record.scope === 'MERCHANT' ? 'blue' : 'default'}>商家再次</Tag>
      <Tag color={record.scope === 'PLATFORM' ? 'blue' : 'default'}>全平台兜底</Tag>
    </Space>
  );

  const renderRuleScenario = (record: DeliveryPriceRule) => (
    <Space direction="vertical" size={6}>
      {renderTargetSummary(record)}
      <Text type="secondary">数量门槛: {formatQuantityRange(record)}</Text>
      {renderRuleMatchPath(record)}
    </Space>
  );

  const renderPricingSummary = (record: DeliveryPriceRule) => {
    if (record.ruleType === 'FIXED_PRICE') {
      return (
        <Space direction="vertical" size={2}>
          <Text strong>直接指定售价</Text>
          <Text>{formatMoney(record.fixedPriceCents)}</Text>
          <Text type="secondary">直接填写买家看到的售价</Text>
        </Space>
      );
    }

    return (
      <Space direction="vertical" size={2}>
        <Text strong>按供货价加价</Text>
        <Text>供货价 × (1 + 加价比例)</Text>
        <Text type="secondary">当前加价 {formatBps(record.markupBps)}</Text>
      </Space>
    );
  };

  const renderPricingPreview = () => {
    const target = optionLabel(pricingTargetOptions, formScope);
    const quantity = formMaxQuantity
      ? `第 ${formMinQuantity ?? 1} - ${formMaxQuantity} 件`
      : `从第 ${formMinQuantity ?? 1} 件起`;
    const pricing = formRuleType === 'FIXED_PRICE'
      ? `买家看到的售价为 ${formFixedPriceYuan ? `¥${Number(formFixedPriceYuan).toFixed(2)}` : '待填写'}`
      : `按供货价 × (1 + 加价比例) 计算，加价比例为 ${formMarkupPercent ?? '待填写'}%`;

    return (
      <Alert
        type="info"
        showIcon
        message="价格预览"
        description={`当买家购买${target}，数量${quantity}时，系统会${pricing}。更精细的规则会优先命中，配送中心看不到这里设置的最终售价。`}
      />
    );
  };

  const openCreateRule = (initialValues: Partial<RuleFormValues> = {}) => {
    setEditing(null);
    setCreateInitialValues(initialValues);
    setOpen(true);
  };

  const renderPricingGuide = () => (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={8}>
          <Card title="一条规则只回答三件事" variant="borderless" style={{ height: '100%' }}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              {pricingRuleGuideItems.map((item, index) => (
                <Space key={item.title} align="start">
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#E6F4FF',
                      color: '#0B5CAD',
                      fontWeight: 700,
                      flex: '0 0 auto',
                    }}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <Text strong>{item.title}</Text>
                    <Text type="secondary" style={{ display: 'block', marginTop: 2 }}>
                      {item.description}
                    </Text>
                  </span>
                </Space>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="命中顺序" variant="borderless" style={{ height: '100%' }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              同时存在多条规则时，系统先看更具体的规则；同一层级再看数量门槛和规则优先级。
            </Text>
            <Space wrap size={[6, 10]}>
              {matchOrderItems.map((item, index) => (
                <Tag key={item} color={index === 0 ? 'blue' : 'default'} style={{ padding: '4px 10px' }}>
                  {item}
                </Tag>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="价格怎么计算" variant="borderless" style={{ height: '100%' }}>
            <Space direction="vertical" size={10}>
              <Text>
                <Text strong>按供货价加价: </Text>
                供货价 × (1 + 加价比例)
              </Text>
              <Text>
                <Text strong>直接指定售价: </Text>
                直接填写买家看到的售价
              </Text>
              <Text type="secondary">配送中心只填写供货价，看不到这里设置的最终售价。</Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <div
        style={{
          marginBottom: 16,
          background: '#fff',
          borderRadius: 8,
          padding: 16,
          border: '1px solid #F0F0F0',
        }}
      >
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <Text strong>常用设置</Text>
            <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
              不确定从哪里开始时，可以按下面的业务场景新建，再补充商家、商品或规格。
            </Text>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateRule()}>
            新建价格规则
          </Button>
        </Space>
        <Row gutter={[12, 12]}>
          {pricingQuickActionItems.map((item) => (
            <Col xs={24} lg={8} key={item.title}>
              <div
                style={{
                  border: '1px solid #E5EAF2',
                  borderRadius: 8,
                  padding: 14,
                  height: '100%',
                  background: '#FAFCFF',
                }}
              >
                <Text strong>{item.title}</Text>
                <Text type="secondary" style={{ display: 'block', marginTop: 6, minHeight: 44 }}>
                  {item.description}
                </Text>
                <Button
                  size="small"
                  style={{ marginTop: 12 }}
                  onClick={() => openCreateRule(item.initialValues)}
                >
                  按这个新建
                </Button>
              </div>
            </Col>
          ))}
        </Row>
      </div>
    </>
  );

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
        productId: editing.productId ?? skuById.get(editing.skuId ?? '')?.product.id ?? undefined,
        skuId: editing.skuId ?? undefined,
        minQuantity: editing.minQuantity,
        maxQuantity: editing.maxQuantity ?? undefined,
        fixedPriceYuan: toYuan(editing.fixedPriceCents),
        markupPercent: toPercent(editing.markupBps),
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
      ...createInitialValues,
    });
  }, [createInitialValues, editing, form, open, skuById]);

  const closeForm = () => {
    setOpen(false);
    setEditing(null);
    setCreateInitialValues(null);
    form.resetFields();
  };

  const mutation = useMutation({
    mutationFn: async (values: RuleFormValues) => {
      const draft = buildPricingDraft(values);
      const validationMessage = validateDeliveryPricingRuleDraft(draft);
      if (validationMessage) {
        throw new Error(validationMessage);
      }
      const payload = normalizeDeliveryPricingRulePayload(draft);
      if (editing) {
        return updateDeliveryPricingRule(editing.id, payload);
      }
      return createDeliveryPricingRule(payload);
    },
    onSuccess: async () => {
      message.success(editing ? '价格规则已更新' : '价格规则已创建');
      closeForm();
      await queryClient.invalidateQueries({ queryKey: ['delivery-pricing-rules'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns: ProColumns<DeliveryPriceRule>[] = [
    {
      title: '适用场景',
      key: 'scenario',
      width: 420,
      search: false,
      render: (_, record) => renderRuleScenario(record),
    },
    {
      title: '定价方式',
      key: 'pricing',
      width: 250,
      search: false,
      render: (_, record) => renderPricingSummary(record),
    },
    {
      title: '规则优先级',
      dataIndex: 'priority',
      width: 130,
      search: false,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.priority}</Text>
          <Text type="secondary">数字越大越优先</Text>
        </Space>
      ),
    },
    {
      title: '规则状态',
      dataIndex: 'isActive',
      width: 100,
      search: false,
      render: (_, record) => <StatusPill value={record.isActive ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      search: false,
      render: (_, record) => formatDateTime(record.updatedAt),
    },
    {
      title: '操作',
      width: 100,
      search: false,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => {
            setEditing(record);
            setCreateInitialValues(null);
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
        subtitle="用业务场景管理买家最终售价；配送中心只看到自己的供货价。"
        extra={(
          <Space wrap>
            <Select
              allowClear
              placeholder="按适用对象筛选"
              style={{ width: 180 }}
              value={scope}
              onChange={setScope}
              options={pricingTargetOptions.map((item) => ({ label: item.label, value: item.value }))}
            />
            <Select
              allowClear
              placeholder="按定价方式筛选"
              style={{ width: 180 }}
              value={ruleType}
              onChange={setRuleType}
              options={pricingMethodOptions}
            />
            <Select
              allowClear
              placeholder="按状态筛选"
              style={{ width: 140 }}
              value={isActive}
              onChange={setIsActive}
              options={[
                { label: '启用', value: 'true' },
                { label: '停用', value: 'false' },
              ]}
            />
          </Space>
        )}
      />

      <ProTable<DeliveryPriceRule>
        rowKey="id"
        headerTitle="价格规则"
        columns={columns}
        dataSource={query.data?.items ?? []}
        loading={query.isLoading}
        search={false}
        options={false}
        pagination={{ defaultPageSize: 20 }}
        scroll={{ x: 1060 }}
        locale={{ emptyText: query.isError ? getErrorMessage(query.error) : '暂无价格规则，可以先新建全平台默认加价规则' }}
        toolBarRender={() => [
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openCreateRule()}
          >
            新建价格规则
          </Button>,
        ]}
      />

      <Alert
        style={{ margin: '16px 0' }}
        type="info"
        showIcon
        message="价格规则说明"
        description="管理员只需要决定这条规则管谁、买多少时生效、价格怎么计算。系统会按命中顺序自动选择最合适的规则，不需要管理员理解后端字段。"
      />

      {renderPricingGuide()}

      <ModalForm<RuleFormValues>
        form={form}
        open={open}
        width={780}
        title={editing ? '编辑价格规则' : '新建价格规则'}
        modalProps={{
          destroyOnHidden: true,
          onCancel: closeForm,
        }}
        submitter={{
          searchConfig: {
            submitText: '保存规则',
            resetText: '取消',
          },
          submitButtonProps: {
            loading: mutation.isPending,
          },
        }}
        onFinish={async (values) => {
          try {
            await mutation.mutateAsync(values);
            return true;
          } catch {
            return false;
          }
        }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text strong>编辑步骤</Text>
            <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
              按下面四步填写即可。右侧保存后，买家端会按规则计算最终售价。
            </Text>
          </div>

          {renderPricingPreview()}

          <FormSection
            step="1"
            title="先定管谁"
            description="选择规则要影响的平台范围。越具体的规则越优先，例如规格规则会优先于商品规则。"
          >
            <ProFormSelect
              name="scope"
              label="规则适用对象"
              rules={[{ required: true, message: '请选择规则适用对象' }]}
              options={pricingTargetOptions.map((item) => ({
                label: `${item.label} - ${item.help}`,
                value: item.value,
              }))}
              fieldProps={{
                onChange: () => {
                  form.setFieldsValue({ merchantId: undefined, productId: undefined, skuId: undefined });
                },
              }}
            />

            {formScope !== 'PLATFORM' && (
              <Space align="start" style={{ width: '100%' }}>
                <ProFormSelect
                  name="merchantId"
                  label={formScope === 'MERCHANT' ? '选择商家' : '先按商家筛选'}
                  width="md"
                  rules={formScope === 'MERCHANT' ? [{ required: true, message: '请选择商家' }] : undefined}
                  options={merchants.map((merchant: DeliveryMerchantSummary) => ({
                    label: merchant.name,
                    value: merchant.id,
                  }))}
                  fieldProps={{
                    allowClear: true,
                    showSearch: true,
                    loading: merchantsQuery.isLoading,
                    optionFilterProp: 'label',
                    onChange: () => {
                      form.setFieldsValue({ productId: undefined, skuId: undefined });
                    },
                  }}
                />
                {(formScope === 'PRODUCT' || formScope === 'SKU') && (
                  <ProFormSelect
                    name="productId"
                    label="选择商品"
                    width="md"
                    rules={formScope === 'PRODUCT' ? [{ required: true, message: '请选择商品' }] : undefined}
                    options={productOptions}
                    fieldProps={{
                      allowClear: true,
                      showSearch: true,
                      loading: productsQuery.isLoading,
                      optionFilterProp: 'label',
                      onChange: () => {
                        form.setFieldsValue({ skuId: undefined });
                      },
                    }}
                  />
                )}
                {formScope === 'SKU' && (
                  <ProFormSelect
                    name="skuId"
                    label="选择规格"
                    width="md"
                    rules={[{ required: true, message: '请选择规格' }]}
                    options={skuOptions}
                    fieldProps={{
                      allowClear: true,
                      showSearch: true,
                      loading: productsQuery.isLoading,
                      disabled: !formProductId,
                      optionFilterProp: 'label',
                    }}
                  />
                )}
              </Space>
            )}
          </FormSection>

          <FormSection
            step="2"
            title="再定数量"
            description="用于大批量下单的阶梯价格。结束数量留空，表示从开始数量之后一直生效。"
          >
            <Space align="start" style={{ width: '100%' }}>
              <ProFormDigit
                name="minQuantity"
                label="从第几件开始生效"
                width="sm"
                min={1}
                fieldProps={{ precision: 0 }}
                rules={[{ required: true, message: '请输入开始数量' }]}
              />
              <ProFormDigit
                name="maxQuantity"
                label="到第几件结束"
                width="sm"
                min={1}
                fieldProps={{ precision: 0, placeholder: '不填表示不限' }}
              />
              <ProFormDigit
                name="priority"
                label="规则优先级"
                width="sm"
                min={0}
                max={999}
                fieldProps={{ precision: 0 }}
                rules={[{ required: true, message: '请输入规则优先级' }]}
                extra="同一场景命中多条规则时，数字越大越先使用。"
              />
            </Space>
          </FormSection>

          <FormSection
            step="3"
            title="最后定价格"
            description="推荐优先使用按供货价加价；需要锁定买家售价时，再使用直接指定售价。"
          >
            <Space align="start" style={{ width: '100%' }}>
              <ProFormSelect
                name="ruleType"
                label="定价方式"
                width="md"
                rules={[{ required: true, message: '请选择定价方式' }]}
                options={pricingMethodOptions}
                fieldProps={{
                  onChange: () => {
                    form.setFieldsValue({ fixedPriceYuan: undefined, markupPercent: undefined });
                  },
                }}
              />
              {formRuleType === 'FIXED_PRICE' ? (
                <ProFormDigit
                  name="fixedPriceYuan"
                  label="指定售价（元）"
                  width="md"
                  min={0.01}
                  fieldProps={{ precision: 2, step: 1 }}
                  rules={[{ required: true, message: '请输入指定售价' }]}
                  extra="这里是买家看到的售价。"
                />
              ) : (
                <ProFormDigit
                  name="markupPercent"
                  label="加价比例（%）"
                  width="md"
                  min={0}
                  max={1000}
                  fieldProps={{ precision: 2, step: 1 }}
                  rules={[{ required: true, message: '请输入加价比例' }]}
                  extra="例如填 30，表示供货价上加 30%。"
                />
              )}
            </Space>
          </FormSection>

          <FormSection
            step="4"
            title="启用与备注"
            description="停用后规则不会参与买家售价计算。备注只给配送管理后台查看。"
          >
            <Form.Item label="规则状态" name="isActive" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
            <ProFormTextArea
              name="note"
              label="备注"
              placeholder="填写给后台管理人员看的说明，不会展示给买家或配送中心。"
              fieldProps={{ rows: 3, maxLength: 500, showCount: true }}
            />
          </FormSection>
        </Space>
      </ModalForm>
    </div>
  );
}
