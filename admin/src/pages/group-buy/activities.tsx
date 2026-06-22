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
  updateGroupBuyActivity,
  updateGroupBuyActivityStatus,
} from '@/api/group-buy';
import { getRewardProducts } from '@/api/reward-products';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type {
  AdminGroupBuyActivity,
  CreateGroupBuyActivityInput,
  GroupBuyActivityStatus,
  GroupBuyTierInput,
} from '@/types';
import { StatusTag, activityStatusMap, money } from './common';

const defaultTiers: GroupBuyTierInput[] = [
  { sequence: 1, basisPoints: 1000, label: '第一位好友' },
  { sequence: 2, basisPoints: 2000, label: '第二位好友' },
  { sequence: 3, basisPoints: 7000, label: '第三位好友' },
];

type ActivityFormValues = Omit<CreateGroupBuyActivityInput, 'startAt' | 'endAt'> & {
  timeRange?: [dayjs.Dayjs, dayjs.Dayjs];
};

export default function GroupBuyActivitiesPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const [form] = Form.useForm<ActivityFormValues>();
  const productId = Form.useWatch('productId', form);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AdminGroupBuyActivity | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: rewardProducts } = useQuery({
    queryKey: ['admin', 'reward-products', 'group-buy-selector'],
    queryFn: () => getRewardProducts({ page: 1, pageSize: 100, status: 'ACTIVE' }),
  });

  const selectedProduct = useMemo(
    () => rewardProducts?.items.find((item) => item.id === productId),
    [productId, rewardProducts?.items],
  );

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      title: '',
      productId: undefined,
      skuId: undefined,
      price: 0,
      freeShipping: true,
      status: 'DRAFT',
      displayOrder: 0,
      ruleSummary: '仅限直接推荐全新用户购买同款商品，新客有效订单计入分享进度',
      tiers: defaultTiers,
      timeRange: undefined,
    });
    setDrawerOpen(true);
  };

  const openEdit = (record: AdminGroupBuyActivity) => {
    setEditing(record);
    form.setFieldsValue({
      title: record.title,
      productId: record.productId,
      skuId: record.skuId,
      price: record.price,
      freeShipping: record.freeShipping,
      status: record.status,
      displayOrder: record.displayOrder,
      ruleSummary: record.ruleSummary,
      tiers: record.tiers.map((tier) => ({
        sequence: tier.sequence,
        basisPoints: tier.basisPoints,
        label: tier.label,
      })),
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

  const buildPayload = (values: ActivityFormValues): CreateGroupBuyActivityInput => ({
    title: values.title,
    productId: values.productId,
    skuId: values.skuId,
    price: Number(values.price),
    freeShipping: Boolean(values.freeShipping),
    status: values.status,
    displayOrder: Number(values.displayOrder ?? 0),
    ruleSummary: values.ruleSummary || null,
    tiers: (values.tiers || []).map((tier) => ({
      sequence: Number(tier.sequence),
      basisPoints: Number(tier.basisPoints),
      label: tier.label || null,
    })),
    startAt: values.timeRange?.[0]?.toISOString() ?? null,
    endAt: values.timeRange?.[1]?.toISOString() ?? null,
  });

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
            {record.product?.title || record.productId} / {record.sku?.title || record.skuId}
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
          <Typography.Text>{record.startAt ? dayjs(record.startAt).format('YYYY-MM-DD HH:mm') : '不限开始'}</Typography.Text>
          <Typography.Text type="secondary">{record.endAt ? dayjs(record.endAt).format('YYYY-MM-DD HH:mm') : '不限结束'}</Typography.Text>
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
            <Input maxLength={120} placeholder="例如：深海大龙虾分享回馈" />
          </Form.Item>
          <Space style={{ width: '100%' }} size={16} align="start">
            <Form.Item name="productId" label="平台商品" style={{ flex: 1, minWidth: 300 }} rules={[{ required: true, message: '请选择平台商品' }]}>
              <Select
                showSearch
                placeholder="选择后台奖励商品"
                optionFilterProp="label"
                options={(rewardProducts?.items || []).map((product) => ({
                  label: product.title,
                  value: product.id,
                }))}
                onChange={() => form.setFieldValue('skuId', undefined)}
              />
            </Form.Item>
            <Form.Item name="skuId" label="SKU" style={{ flex: 1, minWidth: 220 }} rules={[{ required: true, message: '请选择 SKU' }]}>
              <Select
                placeholder="选择规格"
                options={(selectedProduct?.skus || []).map((sku) => ({
                  label: `${sku.title} / 库存 ${sku.stock}`,
                  value: sku.id,
                }))}
              />
            </Form.Item>
          </Space>
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
          <Form.Item name="timeRange" label="活动时间">
            <DatePicker.RangePicker showTime style={{ width: '100%' }} allowEmpty={[true, true]} />
          </Form.Item>
          <Form.Item name="ruleSummary" label="规则摘要">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Form.Item name="displayOrder" label="排序值">
            <InputNumber style={{ width: 160 }} />
          </Form.Item>
          <Form.List name="tiers">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <Typography.Text strong>返还档位</Typography.Text>
                  <Button size="small" onClick={() => add({ sequence: fields.length + 1, basisPoints: 1000, label: '' })}>添加档位</Button>
                </Space>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex' }}>
                    <Form.Item {...field} name={[field.name, 'sequence']} rules={[{ required: true, message: '序号必填' }]}>
                      <InputNumber min={1} placeholder="序号" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'basisPoints']} rules={[{ required: true, message: '比例必填' }]}>
                      <InputNumber min={1} max={10000} placeholder="基点" addonAfter="基点" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'label']}>
                      <Input placeholder="展示文案" style={{ width: 180 }} />
                    </Form.Item>
                    {fields.length > 1 ? <Button danger onClick={() => remove(field.name)}>删除</Button> : null}
                  </Space>
                ))}
                <Typography.Text type="secondary">
                  1000 基点代表 10%。全部档位合计可按活动规则配置，允许超过 10000 基点。
                </Typography.Text>
              </Space>
            )}
          </Form.List>
        </Form>
      </Drawer>
    </div>
  );
}
