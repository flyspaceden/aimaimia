import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  type FormInstance,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  createGroupBuyActivity,
  deleteGroupBuyActivity,
  getGroupBuyActivities,
  getGroupBuyProductCatalog,
  updateGroupBuyActivity,
  updateGroupBuyActivityStatus,
} from '@/api/group-buy';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type {
  AdminGroupBuyActivity,
  CreateGroupBuyActivityInput,
  GroupBuyActivityItemInput,
  GroupBuyActivityStatus,
  GroupBuyCatalogProduct,
} from '@/types';
import { StatusTag, activityStatusMap, money } from './common';
import { toTierFormValues, toTierPayloadValues, type TierPercentValue } from './tierPercent';

type GroupBuyTierConfig = TierPercentValue;

const defaultTiers: TierPercentValue[] = [
  { sequence: 1, percent: 10, label: '第一位好友' },
  { sequence: 2, percent: 20, label: '第二位好友' },
  { sequence: 3, percent: 70, label: '第三位好友' },
];

type ActivityItemFormValue = {
  productId?: string;
  skuId?: string;
  quantity?: number;
  sortOrder?: number;
};

type ActivityFormValues = Omit<
  CreateGroupBuyActivityInput,
  'startAt' | 'endAt' | 'tiers' | 'items' | 'productId' | 'skuId'
> & {
  items?: ActivityItemFormValue[];
  tiers?: TierPercentValue[];
  timeRange?: [dayjs.Dayjs, dayjs.Dayjs];
};

function buildItemSummary(record: AdminGroupBuyActivity) {
  const items = record.items && record.items.length > 0
    ? record.items
    : [{
        productId: record.productId,
        skuId: record.skuId,
        quantity: 1,
        product: record.product,
        sku: record.sku,
      }];
  return items
    .map((item) => `${item.product?.title || item.productId} x${item.quantity}`)
    .join('、');
}

function normalizeActivityItems(values: ActivityItemFormValue[] | undefined): GroupBuyActivityItemInput[] {
  return (values || []).map((item, index) => ({
    productId: String(item.productId || ''),
    skuId: String(item.skuId || ''),
    quantity: Number(item.quantity || 1),
    sortOrder: index,
  }));
}

function GroupBuyItemsEditor({
  form,
  products,
}: {
  form: FormInstance<ActivityFormValues>;
  products: GroupBuyCatalogProduct[];
}) {
  const productOptions = products.map((product) => ({
    label: product.title,
    value: product.id,
  }));

  return (
    <Form.List
      name="items"
      rules={[
        {
          validator: async (_, items?: ActivityItemFormValue[]) => {
            if (!items || items.length === 0) {
              throw new Error('请至少添加一个团购商品');
            }
          },
        },
      ]}
    >
      {(fields, { add, remove }, { errors }) => (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space>
            <Typography.Text strong>团购商品组合</Typography.Text>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => add({ quantity: 1, sortOrder: fields.length })}
            >
              添加商品
            </Button>
          </Space>
          {fields.map((field, index) => (
            <Space key={field.key} align="start" style={{ display: 'flex', width: '100%' }}>
              <Typography.Text type="secondary" style={{ width: 28, paddingTop: 6 }}>
                {index + 1}
              </Typography.Text>
              <Form.Item
                {...field}
                name={[field.name, 'productId']}
                rules={[{ required: true, message: '请选择平台商品' }]}
                style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
              >
                <Select
                  showSearch
                  placeholder="选择平台商品"
                  optionFilterProp="label"
                  options={productOptions}
                  onChange={() => form.setFieldValue(['items', field.name, 'skuId'], undefined)}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => {
                  const currentProductId = getFieldValue(['items', field.name, 'productId']);
                  const selectedProduct = products.find((product) => product.id === currentProductId);
                  return (
                    <Form.Item
                      {...field}
                      name={[field.name, 'skuId']}
                      rules={[{ required: true, message: '请选择 SKU' }]}
                      style={{ flex: 1, minWidth: 220, marginBottom: 0 }}
                    >
                      <Select
                        disabled={!selectedProduct}
                        placeholder="选择规格"
                        options={(selectedProduct?.skus || []).map((sku) => ({
                          label: `${sku.title} / 库存 ${sku.stock} / ${sku.weightGram}g`,
                          value: sku.id,
                        }))}
                      />
                    </Form.Item>
                  );
                }}
              </Form.Item>
              <Form.Item
                {...field}
                name={[field.name, 'quantity']}
                rules={[{ required: true, message: '数量必填' }]}
                style={{ width: 110, marginBottom: 0 }}
              >
                <InputNumber min={1} precision={0} addonBefore="x" style={{ width: '100%' }} />
              </Form.Item>
              {fields.length > 1 ? (
                <Button danger onClick={() => remove(field.name)}>删除</Button>
              ) : null}
            </Space>
          ))}
          <Form.ErrorList errors={errors} />
          <Typography.Text type="secondary">
            团购价按上方设置为准，不自动等于组合商品原价合计；返还也按团购价计算。
          </Typography.Text>
        </Space>
      )}
    </Form.List>
  );
}

export default function GroupBuyActivitiesPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [form] = Form.useForm<ActivityFormValues>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AdminGroupBuyActivity | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: productCatalog } = useQuery({
    queryKey: ['admin', 'group-buy', 'product-catalog'],
    queryFn: () => getGroupBuyProductCatalog(),
  });

  const catalogProducts = useMemo(
    () => productCatalog?.items || [],
    [productCatalog?.items],
  );

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      title: '',
      description: '',
      items: [{ quantity: 1, sortOrder: 0 }],
      price: 0,
      freeShipping: true,
      status: 'DRAFT',
      displayOrder: 0,
      tiers: defaultTiers,
      timeRange: undefined,
    });
    setDrawerOpen(true);
  };

  const openEdit = (record: AdminGroupBuyActivity) => {
    setEditing(record);
    form.setFieldsValue({
      title: record.title,
      description: record.description || '',
      items: record.items && record.items.length > 0
        ? record.items.map((item, index) => ({
            productId: item.productId,
            skuId: item.skuId,
            quantity: item.quantity,
            sortOrder: index,
          }))
        : [{
            productId: record.productId,
            skuId: record.skuId,
            quantity: 1,
            sortOrder: 0,
          }],
      price: record.price,
      freeShipping: record.freeShipping,
      status: record.status,
      displayOrder: record.displayOrder,
      tiers: toTierFormValues(record.tiers),
      timeRange: record.startAt && record.endAt
        ? [dayjs(record.startAt), dayjs(record.endAt)]
        : undefined,
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const buildPayload = (values: ActivityFormValues): CreateGroupBuyActivityInput => {
    const items = normalizeActivityItems(values.items);
    const primaryItem = items[0];
    return {
      title: values.title,
      description: values.description?.trim() || null,
      productId: primaryItem?.productId,
      skuId: primaryItem?.skuId,
      items,
      price: Number(values.price),
      freeShipping: Boolean(values.freeShipping),
      status: values.status,
      displayOrder: Number(values.displayOrder ?? 0),
      tiers: toTierPayloadValues(values.tiers || []),
      startAt: values.timeRange?.[0]?.toISOString(),
      endAt: values.timeRange?.[1]?.toISOString(),
    };
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      const values = await form.validateFields();
      const payload = buildPayload(values);
      if (editing) {
        await updateGroupBuyActivity(editing.id, payload);
        message.success('活动已更新');
      } else {
        await createGroupBuyActivity(payload);
        message.success('活动已创建');
      }
      closeDrawer();
      actionRef.current?.reload();
    } catch (err) {
      if (err instanceof Error) message.error(err.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatus = async (record: AdminGroupBuyActivity, status: GroupBuyActivityStatus) => {
    try {
      await updateGroupBuyActivityStatus(record.id, status);
      message.success('状态已更新');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '状态更新失败');
    }
  };

  const handleDelete = async (record: AdminGroupBuyActivity) => {
    try {
      await deleteGroupBuyActivity(record.id);
      message.success('活动已删除');
      actionRef.current?.reload();
    } catch (err) {
      modal.error({
        title: '无法删除',
        content: err instanceof Error ? err.message : '删除失败',
      });
    }
  };

  const columns: ProColumns<AdminGroupBuyActivity>[] = [
    {
      title: '活动商品',
      dataIndex: 'keyword',
      width: 300,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.title}</Typography.Text>
          <Typography.Text type="secondary">
            {buildItemSummary(record)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 120,
      valueEnum: {
        DRAFT: { text: '草稿' },
        ACTIVE: { text: '进行中' },
        PAUSED: { text: '已暂停' },
        ENDED: { text: '已结束' },
      },
      render: (_: unknown, record) => (
        <StatusTag value={record.status} map={activityStatusMap} />
      ),
    },
    {
      title: '团购价',
      dataIndex: 'price',
      search: false,
      width: 120,
      render: (_: unknown, record) => <Typography.Text strong>{money(record.price)}</Typography.Text>,
    },
    {
      title: '运费',
      dataIndex: 'freeShipping',
      search: false,
      width: 100,
      render: (_: unknown, record) => (record.freeShipping ? '包邮' : '按配置收取'),
    },
    {
      title: '档位',
      dataIndex: 'tiers',
      search: false,
      width: 220,
      render: (_: unknown, record) => (
        <Space wrap size={[4, 4]}>
          {record.tiers.map((tier) => (
            <Typography.Text key={tier.id || tier.sequence} type="secondary">
              {tier.label || `第${tier.sequence}位`} {tier.basisPoints / 100}%
            </Typography.Text>
          ))}
        </Space>
      ),
    },
    {
      title: '发起记录',
      dataIndex: ['_count', 'instances'],
      search: false,
      width: 100,
      render: (_: unknown, record) => record._count?.instances ?? 0,
    },
    {
      title: '有效期',
      dataIndex: 'startAt',
      search: false,
      width: 210,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{record.startAt ? dayjs(record.startAt).format('YYYY-MM-DD HH:mm') : '未设置开始'}</Typography.Text>
          <Typography.Text type="secondary">{record.endAt ? dayjs(record.endAt).format('YYYY-MM-DD HH:mm') : '未设置结束'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      render: (_: unknown, record) => [
        <PermissionGate key="edit" permission={PERMISSIONS.GROUP_BUY_MANAGE}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
        </PermissionGate>,
        <PermissionGate key="status" permission={PERMISSIONS.GROUP_BUY_MANAGE}>
          {record.status === 'ACTIVE' ? (
            <Button type="link" onClick={() => handleStatus(record, 'PAUSED')}>暂停</Button>
          ) : (
            <Button type="link" onClick={() => handleStatus(record, 'ACTIVE')}>启用</Button>
          )}
        </PermissionGate>,
        <PermissionGate key="delete" permission={PERMISSIONS.GROUP_BUY_MANAGE}>
          <Popconfirm title="确认删除该活动？" onConfirm={() => handleDelete(record)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </PermissionGate>,
      ],
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<AdminGroupBuyActivity>
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        request={async (params) => {
          const res = await getGroupBuyActivities({
            page: params.current,
            pageSize: params.pageSize,
            keyword: params.keyword as string | undefined,
            status: params.status as GroupBuyActivityStatus | undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        options={false}
        toolBarRender={() => [
          <PermissionGate key="create" permission={PERMISSIONS.GROUP_BUY_MANAGE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建团购活动</Button>
          </PermissionGate>,
        ]}
      />

      <Drawer
        title={editing ? '编辑团购活动' : '新建团购活动'}
        width={720}
        open={drawerOpen}
        destroyOnClose
        onClose={closeDrawer}
        extra={<Button type="primary" loading={submitting} onClick={handleSubmit}>保存</Button>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="活动标题" rules={[{ required: true, message: '请输入活动标题' }]}>
            <Input maxLength={120} placeholder="例如：深海大龙虾团购" />
          </Form.Item>
          <Form.Item
            name="description"
            label="团购详情介绍"
            rules={[{ max: 2000, message: '团购详情介绍不能超过 2000 个字符' }]}
          >
            <Input.TextArea
              rows={5}
              maxLength={2000}
              showCount
              placeholder="填写展示在 App 团购商品详情页的介绍，例如商品规格、产地、口感、包装、配送说明等。"
            />
          </Form.Item>
          <GroupBuyItemsEditor form={form} products={catalogProducts} />
          <Space style={{ width: '100%' }} size={16} align="start">
            <Form.Item name="price" label="团购价格" rules={[{ required: true, message: '请输入团购价格' }]} style={{ width: 180 }}>
              <InputNumber min={0.01} precision={2} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="freeShipping" label="是否包邮" valuePropName="checked" style={{ width: 140 }}>
              <Switch checkedChildren="包邮" unCheckedChildren="按配置收取" />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 160 }}>
              <Select
                options={[
                  { label: '草稿', value: 'DRAFT' },
                  { label: '进行中', value: 'ACTIVE' },
                  { label: '已暂停', value: 'PAUSED' },
                  { label: '已结束', value: 'ENDED' },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item
            name="timeRange"
            label="活动时间"
            rules={[{ required: true, message: '请选择活动开始和结束时间' }]}
          >
            <DatePicker.RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="displayOrder" label="排序值">
            <InputNumber style={{ width: 160 }} />
          </Form.Item>
          <Form.List name="tiers">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <Typography.Text strong>返还档位</Typography.Text>
                  <Button size="small" onClick={() => add({ sequence: fields.length + 1, percent: 10, label: '' })}>添加档位</Button>
                </Space>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex' }}>
                    <Form.Item {...field} name={[field.name, 'sequence']} rules={[{ required: true, message: '序号必填' }]}>
                      <InputNumber min={1} placeholder="序号" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'percent']} rules={[{ required: true, message: '比例必填' }]}>
                      <InputNumber min={0.01} precision={2} placeholder="比例" addonAfter="%" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'label']}>
                      <Input placeholder="展示文案" style={{ width: 180 }} />
                    </Form.Item>
                    {fields.length > 1 ? (
                      <Button
                        danger
                        onClick={() => {
                          const currentTiers = (form.getFieldValue('tiers') || []) as TierPercentValue[];
                          remove(field.name);
                          form.setFieldValue(
                            'tiers',
                            currentTiers
                              .filter((_: GroupBuyTierConfig, index: number) => index !== field.name)
                              .map((tier: GroupBuyTierConfig, index: number) => ({ ...tier, sequence: index + 1 })),
                          );
                        }}
                      >
                        删除
                      </Button>
                    ) : null}
                  </Space>
                ))}
                <Typography.Text type="secondary">
                  直接填写百分比，例如 10 代表 10%。全部档位合计可按活动规则配置，允许超过 100%。
                </Typography.Text>
              </Space>
            )}
          </Form.List>
        </Form>
      </Drawer>
    </div>
  );
}
