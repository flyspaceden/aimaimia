import { useCallback, useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button,
  Tag,
  message,
  Space,
  Switch,
  Image,
  Alert,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Typography,
  Popconfirm,
  Radio,
  Upload,
  Divider,
  Card,
  Flex,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  GiftOutlined,
  CloseOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  getVipGiftOptions,
  createVipGiftOption,
  updateVipGiftOption,
  updateVipGiftOptionStatus,
  deleteVipGiftOption,
  getRewardSkus,
} from '@/api/vip-gifts';
import type {
  VipGiftOption,
  VipGiftOptionStatus,
  CreateVipGiftOptionInput,
  CoverMode,
  RewardSkuOption,
} from '@/api/vip-gifts';
import { getRewardProducts } from '@/api/reward-products';
import type { RewardProduct, RewardProductSku } from '@/api/reward-products';
import { getConfig } from '@/api/config';
import { extractConfigValue } from '@/types';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

const { Text, Title } = Typography;

// 赠品方案状态映射
const statusMap: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '上架', color: 'green' },
  INACTIVE: { text: '下架', color: 'default' },
};

// ========== 每行商品搜索状态 ==========
interface RowProductState {
  keyword: string;
  selectedProductId?: string;
}

export default function VipGiftsPage() {
  const actionRef = useRef<ActionType>(null);
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VipGiftOption | null>(null);
  const [form] = Form.useForm();

  // 每行商品搜索状态（按 Form.List field.key 管理，key 是稳定且不会复用的）
  const [rowStates, setRowStates] = useState<Record<number, RowProductState>>({});

  // 防抖计时器
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // 当前 Form.List fields 快照（index → key 映射），用于 calculateSummary
  const fieldKeysRef = useRef<number[]>([]);

  // 获取 VIP 统一价格
  const { data: vipPriceConfig } = useQuery({
    queryKey: ['config', 'VIP_PRICE'],
    queryFn: () => getConfig('VIP_PRICE'),
  });
  const vipPrice = vipPriceConfig ? extractConfigValue(vipPriceConfig) : null;

  // 按行获取奖励商品列表（使用 field.key 作为标识）
  const useRowProducts = (rowKey: number) => {
    const keyword = rowStates[rowKey]?.keyword || '';
    const { data, isLoading } = useQuery({
      queryKey: ['reward-products-picker-vip', keyword],
      queryFn: () => getRewardProducts({ page: 1, pageSize: 50, keyword: keyword || undefined }),
    });
    return { products: data?.items ?? [], loading: isLoading };
  };

  // 按行获取 SKU 列表（使用 field.key 作为标识）
  const useRowSkus = (rowKey: number) => {
    const productId = rowStates[rowKey]?.selectedProductId;
    const { data, isLoading } = useQuery({
      queryKey: ['reward-skus', productId],
      queryFn: () => getRewardSkus(productId),
      enabled: !!productId,
    });
    return { skus: data ?? [], loading: isLoading };
  };

  // 创建赠品方案
  const createMutation = useMutation({
    mutationFn: createVipGiftOption,
    onSuccess: () => {
      message.success('赠品方案创建成功');
      closeDrawer();
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    },
    onError: (err: Error) => {
      message.error(err.message || '创建失败');
    },
  });

  // 更新赠品方案
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateVipGiftOption>[1] }) =>
      updateVipGiftOption(id, data),
    onSuccess: () => {
      message.success('赠品方案更新成功');
      closeDrawer();
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    },
    onError: (err: Error) => {
      message.error(err.message || '更新失败');
    },
  });

  // 更新状态
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: VipGiftOptionStatus }) =>
      updateVipGiftOptionStatus(id, status),
    onSuccess: () => {
      message.success('状态更新成功');
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    },
    onError: (err: Error) => {
      message.error(err.message || '状态更新失败');
    },
  });

  // 打开新增抽屉
  const openCreateDrawer = () => {
    setEditingRecord(null);
    setRowStates({});
    form.resetFields();
    form.setFieldsValue({
      sortOrder: 0,
      status: 'ACTIVE',
      coverMode: 'AUTO_GRID',
      items: [{ quantity: 1 }],
    });
    setDrawerOpen(true);
  };

  // 打开编辑抽屉
  const openEditDrawer = (record: VipGiftOption) => {
    setEditingRecord(record);
    // 构建行状态（预填每行的商品/SKU选择）
    // Form.List 初始 key 从 0 开始递增，与 idx 一致
    const newRowStates: Record<number, RowProductState> = {};
    const formItems = record.items.map((item, idx) => {
      newRowStates[idx] = {
        keyword: '',
        selectedProductId: item.sku?.product?.id,
      };
      return {
        productId: item.sku?.product?.id,
        skuId: item.skuId,
        quantity: item.quantity,
      };
    });
    setRowStates(newRowStates);
    form.setFieldsValue({
      title: record.title,
      subtitle: record.subtitle || '',
      badge: record.badge || '',
      sortOrder: record.sortOrder,
      status: record.status,
      coverMode: record.coverMode || 'AUTO_GRID',
      coverUrl: record.coverUrl || undefined,
      items: formItems,
    });
    setDrawerOpen(true);
  };

  // 关闭抽屉
  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingRecord(null);
    setRowStates({});
    form.resetFields();
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const items = values.items || [];

      // 检查重复 SKU
      const skuIds = items.map((item: { skuId: string }) => item.skuId).filter(Boolean);
      const uniqueSkuIds = new Set(skuIds);
      if (uniqueSkuIds.size < skuIds.length) {
        message.error('不能添加重复的商品规格，请检查');
        return;
      }

      const itemCount = items.length;
      const input: CreateVipGiftOptionInput = {
        title: values.title,
        subtitle: values.subtitle || undefined,
        badge: values.badge || undefined,
        sortOrder: values.sortOrder ?? 0,
        status: values.status ?? 'ACTIVE',
        coverMode: itemCount > 1 ? (values.coverMode ?? 'AUTO_GRID') : undefined,
        coverUrl: values.coverMode === 'CUSTOM' ? values.coverUrl : undefined,
        items: items.map((item: { skuId: string; quantity: number }, idx: number) => ({
          skuId: item.skuId,
          quantity: item.quantity ?? 1,
          sortOrder: idx,
        })),
      };

      if (editingRecord) {
        updateMutation.mutate({ id: editingRecord.id, data: input });
      } else {
        createMutation.mutate(input);
      }
    } catch {
      // 表单校验失败，antd 自动提示
    }
  };

  // 行级别：商品搜索防抖（rowKey = field.key，fieldName = field.name）
  const handleRowProductSearch = useCallback((rowKey: number, val: string) => {
    if (searchTimers.current[rowKey]) {
      clearTimeout(searchTimers.current[rowKey]);
    }
    searchTimers.current[rowKey] = setTimeout(() => {
      setRowStates((prev) => ({
        ...prev,
        [rowKey]: { ...prev[rowKey], keyword: val },
      }));
    }, 400);
  }, []);

  // 行级别：商品选择变更（rowKey = field.key，fieldName = field.name 用于表单操作）
  const handleRowProductChange = useCallback((rowKey: number, fieldName: number, productId: string | undefined, products: RewardProduct[]) => {
    setRowStates((prev) => ({
      ...prev,
      [rowKey]: { ...prev[rowKey], selectedProductId: productId },
    }));
    // 清空该行已选 SKU
    const items = form.getFieldValue('items') || [];
    items[fieldName] = { ...items[fieldName], skuId: undefined };
    form.setFieldsValue({ items });

    // 如果只有一个 SKU，自动选中
    if (productId) {
      const product = products.find((p) => p.id === productId);
      if (product && product.skus.length === 1) {
        items[fieldName] = { ...items[fieldName], skuId: product.skus[0].id };
        form.setFieldsValue({ items });
      }
    }
  }, [form]);

  // 状态切换
  const handleStatusToggle = (record: VipGiftOption, checked: boolean) => {
    statusMutation.mutate({
      id: record.id,
      status: checked ? 'ACTIVE' : 'INACTIVE',
    });
  };

  // 删除赠品方案
  const handleDelete = async (id: string) => {
    try {
      await deleteVipGiftOption(id);
      message.success('删除成功');
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 表格列定义
  const columns: ProColumns<VipGiftOption>[] = [
    {
      title: '方案标题',
      dataIndex: 'title',
      width: 160,
      ellipsis: true,
    },
    {
      title: '组合内容',
      dataIndex: 'items',
      width: 260,
      search: false,
      ellipsis: true,
      render: (_: unknown, r: VipGiftOption) => {
        if (!r.items || r.items.length === 0) {
          return <Text type="secondary">-</Text>;
        }
        const summary = r.items
          .map((item) => `${item.sku?.product?.title || '未知商品'}×${item.quantity}`)
          .join(', ');
        return <Text title={summary}>{summary}</Text>;
      },
    },
    {
      title: '组合总价',
      dataIndex: 'totalPrice',
      width: 110,
      search: false,
      render: (_: unknown, r: VipGiftOption) =>
        r.totalPrice != null ? (
          <Text strong>¥{r.totalPrice.toFixed(2)}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '标签',
      dataIndex: 'badge',
      width: 100,
      search: false,
      render: (_: unknown, r: VipGiftOption) =>
        r.badge ? <Tag color="gold">{r.badge}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '排序值',
      dataIndex: 'sortOrder',
      width: 80,
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        ACTIVE: { text: '上架', status: 'Success' },
        INACTIVE: { text: '下架', status: 'Default' },
      },
      render: (_: unknown, r: VipGiftOption) => (
        <PermissionGate
          permission={PERMISSIONS.VIP_GIFT_UPDATE}
          fallback={
            <Tag color={statusMap[r.status]?.color}>
              {statusMap[r.status]?.text || r.status}
            </Tag>
          }
        >
          <Switch
            checkedChildren="上架"
            unCheckedChildren="下架"
            checked={r.status === 'ACTIVE'}
            onChange={(checked) => handleStatusToggle(r, checked)}
            loading={statusMutation.isPending}
          />
        </PermissionGate>
      ),
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      search: false,
      render: (_: unknown, r: VipGiftOption) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.VIP_GIFT_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditDrawer(r)}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.VIP_GIFT_DELETE}>
            <Popconfirm title="确认删除该赠品方案？" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  // 监听 items 变化以计算统计
  const watchedItems = Form.useWatch('items', form) || [];
  const watchedCoverMode = Form.useWatch('coverMode', form);

  // 计算总价统计（使用 fieldKeysRef 将 index 映射回 field.key 以查找 rowStates）
  const calculateSummary = () => {
    let totalQty = 0;
    let totalPrice = 0;
    const items = watchedItems || [];
    items.forEach((item: { skuId?: string; quantity?: number }, idx: number) => {
      if (!item?.skuId) return;
      const qty = item.quantity ?? 1;
      totalQty += qty;
      // 用 field.key 查找 rowStates
      const fieldKey = fieldKeysRef.current[idx];
      const productId = fieldKey != null ? rowStates[fieldKey]?.selectedProductId : undefined;
      if (productId) {
        // 通过 queryClient 获取已缓存的 SKU 数据
        const cachedSkus = queryClient.getQueryData<RewardSkuOption[]>(['reward-skus', productId]);
        const sku = cachedSkus?.find((s) => s.id === item.skuId);
        if (sku) {
          totalPrice += sku.price * qty;
        }
      }
    });
    return { itemCount: items.length, totalQty, totalPrice };
  };

  const summary = calculateSummary();

  return (
    <div style={{ padding: 24 }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 16 }}>
        <Space align="center">
          <GiftOutlined style={{ fontSize: 24, color: '#C9A96E' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>购买VIP赠品</Title>
            <Text type="secondary">
              从奖励商品中选择可作为 VIP 开通赠品的商品方案（支持多商品组合）
            </Text>
          </div>
        </Space>
      </div>

      {/* 说明卡 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="VIP 赠品配置规则"
        description={
          <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
            <li>赠品必须来源于奖励商品，支持多商品组合</li>
            <li>奖励商品可以同时用于 VIP 赠品和抽奖奖品</li>
            <li>用户购买 VIP 后不可退款</li>
            <li>每个账号仅能购买一次 VIP</li>
            <li>VIP 礼包订单包邮</li>
            <li>
              当前 VIP 统一价格：
              <Text strong style={{ color: '#C9A96E' }}>
                {vipPrice != null ? `¥${Number(vipPrice).toFixed(2)}` : '加载中...'}
              </Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                (在 VIP 系统设置页修改)
              </Text>
            </li>
          </ul>
        }
      />

      {/* 赠品方案列表 */}
      <ProTable<VipGiftOption>
        headerTitle="赠品方案列表"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        scroll={{ x: 1100 }}
        request={async (params) => {
          const res = await getVipGiftOptions({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            status: params.status || undefined,
          });
          return { data: res.items, total: res.total, success: true };
        }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto' }}
        toolBarRender={() => [
          <PermissionGate key="add" permission={PERMISSIONS.VIP_GIFT_CREATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateDrawer}
            >
              新增赠品方案
            </Button>
          </PermissionGate>,
        ]}
      />

      {/* 新增/编辑抽屉 */}
      <Drawer
        title={editingRecord ? '编辑赠品方案' : '新增赠品方案'}
        width="75vw"
        open={drawerOpen}
        onClose={closeDrawer}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {editingRecord ? '保存修改' : '创建方案'}
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            sortOrder: 0,
            status: 'ACTIVE',
            coverMode: 'AUTO_GRID',
            items: [{ quantity: 1 }],
          }}
        >
          {/* ===== 基本信息 ===== */}
          <Divider orientation="left">基本信息</Divider>

          <Form.Item
            name="title"
            label="方案标题"
            rules={[
              { required: true, message: '请输入方案标题' },
              { max: 60, message: '方案标题不能超过60个字符' },
            ]}
          >
            <Input placeholder="如：甄选红酒礼遇" maxLength={60} showCount />
          </Form.Item>

          <Form.Item
            name="subtitle"
            label="副标题"
            rules={[{ max: 120, message: '副标题不能超过120个字符' }]}
          >
            <Input placeholder="如：法国波尔多干红 1 瓶，醇厚果香" maxLength={120} showCount />
          </Form.Item>

          <Form.Item
            name="badge"
            label="标签"
            rules={[{ max: 20, message: '标签不能超过20个字符' }]}
          >
            <Input placeholder="如：热销、鲜品、产地直发" maxLength={20} showCount />
          </Form.Item>

          <Space size="large">
            <Form.Item name="sortOrder" label="排序值">
              <InputNumber
                min={0}
                step={1}
                precision={0}
                placeholder="数字越小排序越靠前"
                style={{ width: 200 }}
              />
            </Form.Item>

            <Form.Item
              name="status"
              label="状态"
              rules={[{ required: true, message: '请选择状态' }]}
            >
              <Select
                style={{ width: 200 }}
                options={[
                  { label: '上架', value: 'ACTIVE' },
                  { label: '下架', value: 'INACTIVE' },
                ]}
              />
            </Form.Item>
          </Space>

          {/* ===== 商品列表 ===== */}
          <Divider orientation="left">组合商品</Divider>

          <Form.List
            name="items"
            rules={[
              {
                validator: async (_, items) => {
                  if (!items || items.length === 0) {
                    return Promise.reject(new Error('至少需要添加一件商品'));
                  }
                  if (items.length > 20) {
                    return Promise.reject(new Error('最多添加 20 件商品'));
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => {
              // 同步 index → key 映射供 calculateSummary 使用
              fieldKeysRef.current = fields.map((f) => f.key);
              return (
                <>
                  {fields.map((field) => (
                    <ItemRow
                      key={field.key}
                      field={field}
                      rowKey={field.key}
                      rowStates={rowStates}
                      form={form}
                      onProductSearch={handleRowProductSearch}
                      onProductChange={handleRowProductChange}
                      onRemove={fields.length > 1 ? () => {
                        remove(field.name);
                        // 清理行状态（使用 field.key，不受重新索引影响）
                        setRowStates((prev) => {
                          const next = { ...prev };
                          delete next[field.key];
                          return next;
                        });
                      } : undefined}
                      useRowProducts={useRowProducts}
                      useRowSkus={useRowSkus}
                    />
                  ))}
                  <Form.Item>
                    <Button
                      type="dashed"
                      onClick={() => add({ quantity: 1 })}
                      block
                      icon={<PlusOutlined />}
                      disabled={fields.length >= 20}
                    >
                      添加商品{fields.length >= 20 ? '（已达上限）' : ''}
                    </Button>
                    <Form.ErrorList errors={errors} />
                  </Form.Item>
                </>
              );
            }}
          </Form.List>

          {/* 价格统计 */}
          {watchedItems.length > 0 && (
            <Card size="small" style={{ marginBottom: 24, background: '#fafafa' }}>
              <Text>
                {summary.itemCount} 件商品，共 {summary.totalQty} 件，总价{' '}
                <Text strong style={{ color: '#C9A96E', fontSize: 16 }}>
                  ¥{summary.totalPrice.toFixed(2)}
                </Text>
              </Text>
            </Card>
          )}

          {/* ===== 封面样式（仅多商品时显示） ===== */}
          {watchedItems.length > 1 && (
            <>
              <Divider orientation="left">封面样式</Divider>

              <Form.Item name="coverMode" label="封面样式">
                <Radio.Group>
                  <Radio value="AUTO_GRID">宫格拼图</Radio>
                  <Radio value="AUTO_DIAGONAL">对角线分割</Radio>
                  <Radio value="AUTO_STACKED">层叠卡片</Radio>
                  <Radio value="CUSTOM">自定义上传</Radio>
                </Radio.Group>
              </Form.Item>

              {watchedCoverMode === 'CUSTOM' && (
                <Form.Item
                  name="coverUrl"
                  label="自定义封面图片"
                  rules={[{ required: true, message: '请上传封面图片' }]}
                >
                  <Input placeholder="输入封面图片 URL" />
                </Form.Item>
              )}
            </>
          )}
        </Form>
      </Drawer>
    </div>
  );
}

// ========== 每行商品选择器组件 ==========
interface ItemRowProps {
  field: { key: number; name: number };
  rowKey: number;
  rowStates: Record<number, RowProductState>;
  form: ReturnType<typeof Form.useForm>[0];
  onProductSearch: (rowKey: number, val: string) => void;
  onProductChange: (rowKey: number, fieldName: number, productId: string | undefined, products: RewardProduct[]) => void;
  onRemove?: () => void;
  useRowProducts: (rowKey: number) => { products: RewardProduct[]; loading: boolean };
  useRowSkus: (rowKey: number) => { skus: RewardSkuOption[]; loading: boolean };
}

function ItemRow({
  field,
  rowKey,
  rowStates,
  form,
  onProductSearch,
  onProductChange,
  onRemove,
  useRowProducts,
  useRowSkus,
}: ItemRowProps) {
  const { products, loading: productsLoading } = useRowProducts(rowKey);
  const { skus, loading: skusLoading } = useRowSkus(rowKey);
  const selectedProductId = rowStates[rowKey]?.selectedProductId;

  // 获取当前行表单值来计算小计（field.name 是当前在数组中的索引）
  const items = Form.useWatch('items', form) || [];
  const currentItem = items[field.name];
  const selectedSkuId = currentItem?.skuId;
  const quantity = currentItem?.quantity ?? 1;

  // 找到选中的 SKU 信息
  const selectedSku = skus.find((s) => s.id === selectedSkuId);
  const subtotal = selectedSku ? selectedSku.price * quantity : 0;

  // 获取商品图片
  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const imageUrl = selectedProduct?.media?.[0]?.url;

  // SKU 下拉选项
  const skuOptions = skus.map((sku) => ({
    label: `${sku.title} - ¥${sku.price.toFixed(2)} (库存: ${sku.stock})`,
    value: sku.id,
  }));

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Flex gap={12} align="start">
        {/* 商品缩略图 */}
        <div style={{ flexShrink: 0, width: 48, height: 48, marginTop: 30 }}>
          {imageUrl ? (
            <Image
              src={imageUrl}
              width={48}
              height={48}
              style={{ objectFit: 'cover', borderRadius: 4 }}
              preview={false}
              fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
            />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                background: '#f5f5f5',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GiftOutlined style={{ color: '#ccc' }} />
            </div>
          )}
        </div>

        {/* 奖励商品选择 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Form.Item
            {...field}
            name={[field.name, 'productId']}
            label="奖励商品"
            rules={[{ required: true, message: '请选择奖励商品' }]}
            style={{ marginBottom: 8 }}
          >
            <Select
              showSearch
              allowClear
              placeholder="搜索并选择奖励商品"
              onChange={(val) => onProductChange(rowKey, field.name, val, products)}
              onSearch={(val) => onProductSearch(rowKey, val)}
              filterOption={false}
              loading={productsLoading}
              options={products.map((p) => ({
                label: `${p.title} (¥${p.basePrice.toFixed(2)})`,
                value: p.id,
              }))}
              notFoundContent={productsLoading ? '加载中...' : '暂无奖励商品'}
            />
          </Form.Item>
        </div>

        {/* 商品规格选择 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Form.Item
            {...field}
            name={[field.name, 'skuId']}
            label="商品规格"
            rules={[{ required: true, message: '请选择商品规格' }]}
            style={{ marginBottom: 8 }}
          >
            <Select
              allowClear
              placeholder={selectedProductId ? '请选择商品规格' : '请先选择奖励商品'}
              disabled={!selectedProductId}
              loading={skusLoading}
              options={skuOptions}
              notFoundContent={selectedProductId ? '该商品暂无规格' : '请先选择商品'}
            />
          </Form.Item>
        </div>

        {/* 数量 */}
        <div style={{ width: 100, flexShrink: 0 }}>
          <Form.Item
            {...field}
            name={[field.name, 'quantity']}
            label="数量"
            rules={[{ required: true, message: '请输入数量' }]}
            style={{ marginBottom: 8 }}
          >
            <InputNumber min={1} max={99} style={{ width: '100%' }} />
          </Form.Item>
        </div>

        {/* 价格小计 */}
        <div style={{ width: 140, flexShrink: 0, marginTop: 30 }}>
          {selectedSku ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ¥{selectedSku.price.toFixed(2)} × {quantity} ={' '}
              <Text strong>¥{subtotal.toFixed(2)}</Text>
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              选择规格后显示价格
            </Text>
          )}
        </div>

        {/* 删除按钮 */}
        <div style={{ flexShrink: 0, marginTop: 30 }}>
          {onRemove ? (
            <Button
              type="text"
              danger
              icon={<CloseOutlined />}
              onClick={onRemove}
              size="small"
            />
          ) : (
            <div style={{ width: 24 }} />
          )}
        </div>
      </Flex>
    </Card>
  );
}
