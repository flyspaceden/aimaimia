import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Card,
  Button,
  Spin,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Table,
  Space,
  Breadcrumb,
  Popconfirm,
  Modal,
  Tag,
  Typography,
  Result,
  Row,
  Col,
  Statistic,
  Image,
} from 'antd';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ShoppingOutlined,
  DollarOutlined,
  AccountBookOutlined,
} from '@ant-design/icons';
import {
  getRewardProduct,
  updateRewardProduct,
  addRewardProductSku,
  updateRewardProductSku,
  deleteRewardProductSku,
} from '@/api/reward-products';
import type {
  RewardProductSku,
  UpdateRewardProductInput,
  CreateSkuInput,
  UpdateSkuInput,
} from '@/api/reward-products';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

const { Text } = Typography;

// 奖励商品状态映射
const statusOptions = [
  { label: '上架', value: 'ACTIVE' },
  { label: '下架', value: 'INACTIVE' },
  { label: '草稿', value: 'DRAFT' },
];

const statusColorMap: Record<string, string> = {
  ACTIVE: 'green',
  INACTIVE: 'default',
  DRAFT: 'blue',
};

const statusTextMap: Record<string, string> = {
  ACTIVE: '上架',
  INACTIVE: '下架',
  DRAFT: '草稿',
};

/** SKU 编辑弹窗表单值 */
interface SkuFormValues {
  title: string;
  cost: number;
  price: number;
  stock: number;
  weightGram?: number;
}

export default function RewardProductEditPage() {
  const { message } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [basicForm] = Form.useForm();

  // SKU 弹窗状态
  const [skuModal, setSkuModal] = useState<{
    visible: boolean;
    sku: RewardProductSku | null; // null = 新增模式
  }>({ visible: false, sku: null });
  const [skuForm] = Form.useForm<SkuFormValues>();

  // SKU 弹窗中实时监听成本价和售价，用于利润提示
  const skuCost = Form.useWatch('cost', skuForm);
  const skuPrice = Form.useWatch('price', skuForm);

  // 保存中状态
  const [saving, setSaving] = useState(false);

  // 监听表单变化以跟踪未保存更改
  Form.useWatch([], basicForm);
  useUnsavedChanges(basicForm.isFieldsTouched());

  // 查询商品详情
  const { data: product, isLoading, error } = useQuery({
    queryKey: ['admin', 'reward-product', id],
    queryFn: () => getRewardProduct(id!),
    enabled: !!id,
  });

  // 是否为单规格模式（可切换）
  const [multiSpecMode, setMultiSpecMode] = useState(false);

  // 根据商品数据初始化模式
  const isSingleSku = !multiSpecMode;

  // 商品加载后根据 SKU 数量设置初始模式
  useMemo(() => {
    if (product) {
      const skuCount = product.skus?.length ?? 0;
      setMultiSpecMode(skuCount > 1);
    }
  }, [product]);

  // 更新商品基本信息
  const updateBasicMutation = useMutation({
    mutationFn: (data: UpdateRewardProductInput) => updateRewardProduct(id!, data),
    onSuccess: () => {
      message.success('基本信息保存成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'reward-product', id] });
    },
    onError: (err: Error) => {
      message.error(err.message || '保存失败');
    },
  });

  // 新增规格
  const addSkuMutation = useMutation({
    mutationFn: (data: CreateSkuInput) => addRewardProductSku(id!, data),
    onSuccess: () => {
      message.success('规格添加成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'reward-product', id] });
      setSkuModal({ visible: false, sku: null });
      skuForm.resetFields();
    },
    onError: (err: Error) => {
      message.error(err.message || '添加规格失败');
    },
  });

  // 更新规格
  const updateSkuMutation = useMutation({
    mutationFn: ({ skuId, data }: { skuId: string; data: UpdateSkuInput }) =>
      updateRewardProductSku(id!, skuId, data),
    onSuccess: () => {
      message.success('规格更新成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'reward-product', id] });
      setSkuModal({ visible: false, sku: null });
      skuForm.resetFields();
    },
    onError: (err: Error) => {
      message.error(err.message || '更新规格失败');
    },
  });

  // 删除规格
  const deleteSkuMutation = useMutation({
    mutationFn: (skuId: string) => deleteRewardProductSku(id!, skuId),
    onSuccess: () => {
      message.success('规格删除成功');
      queryClient.invalidateQueries({ queryKey: ['admin', 'reward-product', id] });
    },
    onError: (err: Error) => {
      message.error(err.message || '删除规格失败');
    },
  });

  /** 保存基本信息（单规格时包含价格库存） */
  const handleSaveBasic = async () => {
    try {
      setSaving(true);
      const values = await basicForm.validateFields();

      const data: UpdateRewardProductInput = {
        title: values.title,
        description: values.description || undefined,
        status: values.status,
      };

      // 单规格：同时更新 SKU 和商品级字段
      if (isSingleSku && product?.skus?.[0]) {
        const cost = Number(values.cost);
        const price = Number(values.price);

        if (cost > price) {
          message.error('成本价不能大于售价');
          return;
        }

        // 更新商品级 basePrice 和 cost
        data.basePrice = price;
        data.cost = cost;

        // 同时更新 SKU
        await updateRewardProductSku(id!, product.skus[0].id, {
          cost,
          price,
          stock: Math.floor(Number(values.stock)),
          weightGram: values.weightGram != null ? Number(values.weightGram) : undefined,
        });
      }

      await updateBasicMutation.mutateAsync(data);
    } catch (err) {
      if (err instanceof Error) {
        message.error(err.message || '保存失败');
      }
      // 表单校验错误不额外提示
    } finally {
      setSaving(false);
    }
  };

  /** 打开新增 SKU 弹窗 */
  const handleAddSku = () => {
    skuForm.resetFields();
    setSkuModal({ visible: true, sku: null });
  };

  /** 打开编辑 SKU 弹窗 */
  const handleEditSku = (sku: RewardProductSku) => {
    skuForm.setFieldsValue({
      title: sku.title,
      cost: typeof sku.cost === 'number' ? sku.cost : 0,
      price: sku.price,
      stock: sku.stock,
      weightGram: sku.weightGram || undefined,
    });
    setSkuModal({ visible: true, sku });
  };

  /** 提交 SKU 弹窗表单 */
  const handleSkuSubmit = async () => {
    try {
      const values = await skuForm.validateFields();
      const cost = Number(values.cost ?? 0);
      const price = Number(values.price);

      if (cost > price) {
        message.error('成本价不能大于售价');
        return;
      }

      if (skuModal.sku) {
        // 更新模式
        await updateSkuMutation.mutateAsync({
          skuId: skuModal.sku.id,
          data: {
            title: values.title,
            cost,
            price,
            stock: Math.floor(Number(values.stock)),
            weightGram: values.weightGram != null ? Number(values.weightGram) : undefined,
          },
        });
      } else {
        // 新增模式
        await addSkuMutation.mutateAsync({
          title: values.title,
          cost,
          price,
          stock: Math.floor(Number(values.stock)),
          weightGram: values.weightGram != null ? Number(values.weightGram) : undefined,
        });
      }
    } catch {
      // 表单校验失败不额外提示
    }
  };

  /** 商品规格表格列定义（多规格时使用） */
  const skuColumns = [
    {
      title: '规格名称',
      dataIndex: 'title',
      key: 'title',
      width: 180,
    },
    {
      title: '成本价（元）',
      dataIndex: 'cost',
      key: 'cost',
      width: 120,
      render: (v: number | null | undefined) =>
        typeof v === 'number' ? `¥${v.toFixed(2)}` : '-',
    },
    {
      title: '售价（元）',
      dataIndex: 'price',
      key: 'price',
      width: 120,
      render: (v: number) => `¥${v.toFixed(2)}`,
    },
    {
      title: '库存',
      dataIndex: 'stock',
      key: 'stock',
      width: 80,
      render: (v: number) => (
        <span style={{ color: v <= 0 ? '#ff4d4f' : undefined }}>{v}</span>
      ),
    },
    {
      title: '重量（克）',
      dataIndex: 'weightGram',
      key: 'weightGram',
      width: 100,
      render: (v: number | null | undefined) =>
        typeof v === 'number' && v > 0 ? `${v}g` : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: RewardProductSku) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.REWARD_PRODUCTS_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditSku(record)}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.REWARD_PRODUCTS_UPDATE}>
            <Popconfirm
              title="确认删除该规格？"
              description="删除后不可恢复，至少需保留一个商品规格"
              onConfirm={() => deleteSkuMutation.mutate(record.id)}
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={(product?.skus?.length ?? 0) <= 1}
              >
                删除
              </Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  // 加载中
  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  // 加载失败
  if (error || !product) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="error"
          title="加载失败"
          subTitle={error instanceof Error ? error.message : '未找到该奖励商品'}
          extra={
            <Button type="primary" onClick={() => navigate('/reward-products')}>
              返回列表
            </Button>
          }
        />
      </div>
    );
  }

  // 汇总统计计算值
  const skus = product.skus || [];
  const totalStock = skus.reduce((sum, s) => sum + (s.stock ?? 0), 0);
  const prices = skus.map(s => s.price);
  const costs = skus.map(s => s.cost).filter((c): c is number => typeof c === 'number');
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const minCost = costs.length > 0 ? Math.min(...costs) : null;
  const maxCost = costs.length > 0 ? Math.max(...costs) : null;

  // 单规格时的默认 SKU
  const defaultSku = isSingleSku ? skus[0] : null;

  return (
    <div style={{ padding: 24 }}>
      {/* 面包屑导航 */}
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <a onClick={() => navigate('/')}>首页</a> },
          { title: <a onClick={() => navigate('/reward-products')}>奖励商品</a> },
          { title: '编辑商品' },
        ]}
      />

      {/* 返回按钮 + 商品标题 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/reward-products')}
        >
          返回列表
        </Button>
        <Text strong style={{ fontSize: 18 }}>{product.title}</Text>
        <Tag color={statusColorMap[product.status]}>
          {statusTextMap[product.status] || product.status}
        </Tag>
      </div>

      {/* 汇总统计卡片（多规格时显示） */}
      {!isSingleSku && skus.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="总库存"
                value={totalStock}
                prefix={<ShoppingOutlined />}
                valueStyle={{ color: totalStock <= 10 ? '#ff4d4f' : '#1677ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="售价区间"
                value={`¥${minPrice.toFixed(2)} ~ ¥${maxPrice.toFixed(2)}`}
                prefix={<DollarOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="成本区间"
                value={minCost !== null ? `¥${minCost.toFixed(2)} ~ ¥${maxCost!.toFixed(2)}` : '-'}
                prefix={<AccountBookOutlined />}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 商品图片 */}
      <Card title="商品图片" style={{ marginBottom: 16 }}>
        {product.media && product.media.length > 0 ? (
          <Space wrap size={12}>
            {product.media
              .filter((m) => m.type === 'IMAGE')
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((m, i) => (
                <Image
                  key={m.id || i}
                  src={m.url}
                  width={120}
                  height={120}
                  style={{ objectFit: 'cover', borderRadius: 8, border: '1px solid #d9d9d9' }}
                  fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                />
              ))}
          </Space>
        ) : (
          <Text type="secondary">暂无商品图片</Text>
        )}
      </Card>

      {/* 基本信息卡片 */}
      <Card
        title="基本信息"
        style={{ marginBottom: 16 }}
        extra={
          <PermissionGate permission={PERMISSIONS.REWARD_PRODUCTS_UPDATE}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveBasic}
              loading={saving}
            >
              保存
            </Button>
          </PermissionGate>
        }
      >
        <Form
          form={basicForm}
          layout="vertical"
          initialValues={{
            title: product.title,
            description: product.description || '',
            status: product.status,
            // 单规格时直接从 SKU 取值
            cost: defaultSku ? (typeof defaultSku.cost === 'number' ? defaultSku.cost : undefined) : undefined,
            price: defaultSku ? defaultSku.price : undefined,
            stock: defaultSku ? defaultSku.stock : undefined,
            weightGram: defaultSku?.weightGram || undefined,
          }}
        >
          <Form.Item
            label="商品名称"
            name="title"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input placeholder="请输入商品名称" maxLength={120} showCount />
          </Form.Item>

          <Form.Item label="商品描述" name="description">
            <Input.TextArea rows={3} placeholder="请输入商品描述（选填）" maxLength={2000} showCount />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="状态" name="status" rules={[{ required: true }]}>
                <Select options={statusOptions} placeholder="选择状态" />
              </Form.Item>
            </Col>
          </Row>

          {/* 多规格开关 */}
          <Row style={{ marginTop: 8, marginBottom: 16 }}>
            <Col>
              <Space>
                <Text>多规格商品</Text>
                <Switch
                  checked={multiSpecMode}
                  onChange={(checked) => {
                    if (checked && isSingleSku) {
                      // 单→多：把当前单规格值带入，后续通过"添加规格"管理
                    }
                    if (!checked && skus.length > 1) {
                      message.warning('当前有多个规格，切换为单规格后将仅保留第一个规格的数据显示');
                    }
                    setMultiSpecMode(checked);
                  }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {multiSpecMode ? '可管理多个规格（如不同包装、重量）' : '适用于只有一种规格的商品'}
                </Text>
              </Space>
            </Col>
          </Row>

          {/* 单规格模式：直接在基本信息里展示价格库存 */}
          {isSingleSku && (
            <>
              <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 16 }}>
                价格与库存
              </Typography.Title>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label="成本价（元）"
                    name="cost"
                    rules={[{ required: true, message: '请输入成本价' }]}
                  >
                    <InputNumber
                      min={0}
                      precision={2}
                      step={0.01}
                      style={{ width: '100%' }}
                      prefix="¥"
                      placeholder="如：40.00"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="售价（元）"
                    name="price"
                    rules={[{ required: true, message: '请输入售价' }]}
                  >
                    <InputNumber
                      min={0}
                      precision={2}
                      step={0.01}
                      style={{ width: '100%' }}
                      prefix="¥"
                      placeholder="如：88.00"
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label="库存"
                    name="stock"
                    rules={[{ required: true, message: '请输入库存' }]}
                  >
                    <InputNumber
                      min={0}
                      precision={0}
                      style={{ width: '100%' }}
                      placeholder="如：100"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="重量（克）" name="weightGram">
                    <InputNumber
                      min={0}
                      precision={0}
                      style={{ width: '100%' }}
                      placeholder="选填"
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
        </Form>
      </Card>

      {/* 商品规格管理卡片（多规格时显示） */}
      {!isSingleSku && (
        <Card
          title={`商品规格管理（${skus.length} 个）`}
          extra={
            <PermissionGate permission={PERMISSIONS.REWARD_PRODUCTS_UPDATE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddSku}>
                添加规格
              </Button>
            </PermissionGate>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            商品规格指同一商品的不同包装、重量、口味等销售单元，每个规格有独立的价格和库存
          </Text>
          <Table
            columns={skuColumns}
            dataSource={skus}
            rowKey="id"
            pagination={false}
            size="middle"
            locale={{ emptyText: '暂无商品规格，请点击"添加规格"创建' }}
            summary={() => {
              if (skus.length === 0) return null;
              const summaryTotalStock = skus.reduce((sum, s) => sum + (s.stock ?? 0), 0);
              const summaryPrices = skus.map((s) => s.price);
              const summaryCosts = skus
                .map((s) => s.cost)
                .filter((c): c is number => typeof c === 'number');
              const summaryMinPrice = Math.min(...summaryPrices);
              const summaryMaxPrice = Math.max(...summaryPrices);
              const summaryMinCost = summaryCosts.length > 0 ? Math.min(...summaryCosts) : null;
              const summaryMaxCost = summaryCosts.length > 0 ? Math.max(...summaryCosts) : null;

              return (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <Text strong>合计</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1}>
                      <Text type="secondary">
                        {summaryMinCost !== null
                          ? summaryMinCost === summaryMaxCost
                            ? `¥${summaryMinCost.toFixed(2)}`
                            : `¥${summaryMinCost.toFixed(2)} ~ ¥${summaryMaxCost!.toFixed(2)}`
                          : '-'}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2}>
                      <Text type="secondary">
                        {summaryMinPrice === summaryMaxPrice
                          ? `¥${summaryMinPrice.toFixed(2)}`
                          : `¥${summaryMinPrice.toFixed(2)} ~ ¥${summaryMaxPrice.toFixed(2)}`}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3}>
                      <Text strong>{summaryTotalStock}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} />
                  </Table.Summary.Row>
                </Table.Summary>
              );
            }}
          />
        </Card>
      )}

      {/* 规格新增/编辑弹窗 */}
      <Modal
        title={skuModal.sku ? '编辑规格' : '添加规格'}
        open={skuModal.visible}
        onCancel={() => {
          setSkuModal({ visible: false, sku: null });
          skuForm.resetFields();
        }}
        onOk={handleSkuSubmit}
        confirmLoading={addSkuMutation.isPending || updateSkuMutation.isPending}
        destroyOnClose
        width={520}
      >
        <Form
          form={skuForm}
          layout="vertical"
          preserve={false}
        >
          <Form.Item
            label="规格名称"
            name="title"
            rules={[{ required: true, message: '请输入规格名称' }]}
          >
            <Input placeholder="如：默认规格 / 500g装 / 大包装" maxLength={100} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="成本价（元）"
                name="cost"
                rules={[{ required: true, message: '请输入成本价' }]}
              >
                <InputNumber
                  min={0}
                  precision={2}
                  step={0.01}
                  style={{ width: '100%' }}
                  prefix="¥"
                  placeholder="如：40.00"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="售价（元）"
                name="price"
                rules={[{ required: true, message: '请输入售价' }]}
              >
                <InputNumber
                  min={0}
                  precision={2}
                  step={0.01}
                  style={{ width: '100%' }}
                  prefix="¥"
                  placeholder="如：88.00"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* 利润提示 */}
          {typeof skuCost === 'number' && typeof skuPrice === 'number' && skuPrice > 0 && (
            <div style={{
              padding: '8px 12px',
              marginBottom: 16,
              borderRadius: 4,
              background: skuPrice > skuCost ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${skuPrice > skuCost ? '#b7eb8f' : '#ffccc7'}`,
            }}>
              <Text type={skuPrice > skuCost ? 'success' : 'danger'}>
                利润: ¥{(skuPrice - skuCost).toFixed(2)} | 利润率: {((skuPrice - skuCost) / skuPrice * 100).toFixed(1)}%
              </Text>
            </div>
          )}

          <Form.Item
            label="库存"
            name="stock"
            rules={[{ required: true, message: '请输入库存数量' }]}
          >
            <InputNumber
              min={0}
              precision={0}
              style={{ width: '100%' }}
              placeholder="请输入库存数量"
            />
          </Form.Item>

          <Form.Item label="重量（克）" name="weightGram">
            <InputNumber
              min={0}
              precision={0}
              style={{ width: '100%' }}
              placeholder="选填"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
