import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  App, Button, Tag, Space, Popconfirm, Switch, Tooltip, Drawer,
  Upload, Card, Form, Input, InputNumber, Row, Col, Typography, Result, Image,
  Avatar, Table,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, WarningOutlined,
  InboxOutlined, MinusCircleOutlined,
  LinkOutlined, FileImageOutlined,
} from '@ant-design/icons';
import {
  getRewardProducts,
  createRewardProduct,
  deleteRewardProduct,
  updateRewardProduct,
} from '@/api/reward-products';
import type { RewardProduct, RewardProductSku } from '@/api/reward-products';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';

const { Dragger } = Upload;
const { Text } = Typography;

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// 库存预警阈值
const LOW_STOCK_THRESHOLD = 10;

// 奖励商品状态映射
const rewardProductStatusMap: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '上架', color: 'green' },
  INACTIVE: { text: '下架', color: 'default' },
  DRAFT: { text: '草稿', color: 'blue' },
};

const getDisplayStock = (product: RewardProduct) =>
  (product.skus || []).reduce((sum, sku) => sum + (Number(sku.stock) || 0), 0);

const isLowStock = (product: RewardProduct): boolean => {
  const stock = getDisplayStock(product);
  return stock < LOW_STOCK_THRESHOLD;
};

/** 规格行类型（创建表单用） */
interface SkuRow {
  title: string;
  cost: number | undefined;
  price: number | undefined;
  stock: number | undefined;
  weightGram?: number;
}

export default function RewardProductsPage() {
  const { message } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [multiSku, setMultiSku] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [createForm] = Form.useForm();

  const handleDelete = async (id: string) => {
    try {
      await deleteRewardProduct(id);
      message.success('删除成功');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleStatusToggle = async (id: string, checked: boolean) => {
    try {
      setTogglingId(id);
      await updateRewardProduct(id, { status: checked ? 'ACTIVE' : 'INACTIVE' });
      message.success(checked ? '已上架' : '已下架');
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '状态更新失败');
    } finally {
      setTogglingId(null);
    }
  };

  /** 多规格切换 */
  const handleMultiSkuToggle = (checked: boolean) => {
    if (checked) {
      // 单规格 → 多规格：将单规格的值填入第一行
      const cost = createForm.getFieldValue('cost');
      const price = createForm.getFieldValue('price');
      const stock = createForm.getFieldValue('stock');
      const weightGram = createForm.getFieldValue('weightGram');
      createForm.setFieldsValue({
        skus: [{ title: '默认规格', cost, price, stock, weightGram }],
      });
    } else {
      // 多规格 → 单规格：将第一行的值回填
      const skus: SkuRow[] = createForm.getFieldValue('skus') || [];
      if (skus.length > 0) {
        createForm.setFieldsValue({
          cost: skus[0].cost,
          price: skus[0].price,
          stock: skus[0].stock,
          weightGram: skus[0].weightGram,
        });
      }
    }
    setMultiSku(checked);
  };

  /** 提交创建表单 */
  const handleCreateSubmit = async () => {
    try {
      setSubmitting(true);
      const values = await createForm.validateFields();

      // 处理图片
      const media = fileList
        .filter((f) => f.status === 'done')
        .map((f, i) => ({
          type: 'IMAGE' as const,
          url: (f.response as any)?.url || (f.response as any)?.data?.url || f.url || '',
          sortOrder: i,
        }))
        .filter((m) => m.url);

      if (multiSku) {
        // 多规格模式
        const skuList: SkuRow[] = values.skus || [];
        if (skuList.length === 0) {
          message.error('请至少添加一个商品规格');
          return;
        }
        const skus = skuList.map((sku) => ({
          title: sku.title?.trim() || '默认规格',
          cost: Number(sku.cost),
          price: Number(sku.price),
          stock: Math.floor(Number(sku.stock ?? 0)),
          weightGram: sku.weightGram ? Number(sku.weightGram) : undefined,
        }));

        await createRewardProduct({
          title: values.title,
          description: values.description || undefined,
          cost: skus[0].cost,
          basePrice: Math.min(...skus.map((s) => s.price)),
          skus,
          media: media.length > 0 ? media : undefined,
        });
      } else {
        // 单规格模式
        const cost = Number(values.cost);
        const price = Number(values.price);
        const stock = Math.floor(Number(values.stock ?? 0));
        const weightGram = values.weightGram ? Number(values.weightGram) : undefined;

        await createRewardProduct({
          title: values.title,
          description: values.description || undefined,
          cost,
          basePrice: price,
          skus: [{
            title: '默认规格',
            cost,
            price,
            stock,
            weightGram,
          }],
          media: media.length > 0 ? media : undefined,
        });
      }

      setSubmitSuccess(true);
      actionRef.current?.reload();
    } catch (err) {
      if (err instanceof Error) {
        message.error(err.message || '创建失败');
      }
      // 表单校验失败不额外提示
    } finally {
      setSubmitting(false);
    }
  };

  const closeDrawer = () => {
    setCreateDrawerOpen(false);
    setFileList([]);
    setSubmitSuccess(false);
    setMultiSku(false);
    createForm.resetFields();
  };

  const columns: ProColumns<RewardProduct>[] = [
    {
      title: '商品信息',
      width: 280,
      ellipsis: true,
      dataIndex: 'keyword',
      formItemProps: { label: '商品名称' },
      fieldProps: { placeholder: '搜索商品名称' },
      render: (_: unknown, r: RewardProduct) => {
        const firstImage = (r.media || []).find((m) => m.type === 'IMAGE');
        const skuCount = r.skus?.length ?? 0;
        const stock = getDisplayStock(r);
        const low = isLowStock(r);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {firstImage ? (
              <Image
                src={firstImage.url}
                width={48}
                height={48}
                style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                preview={{ mask: '预览' }}
              />
            ) : (
              <Avatar
                shape="square"
                size={48}
                icon={<FileImageOutlined />}
                style={{ flexShrink: 0, backgroundColor: '#f5f5f5', color: '#bbb' }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: '20px',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/reward-products/${r.id}/edit`)}
              >
                {r.title}
              </div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                {skuCount > 1 && <span>{skuCount} 规格</span>}
                {low && (
                  <span style={{ color: stock <= 0 ? '#ff4d4f' : '#fa8c16' }}>
                    <WarningOutlined style={{ marginRight: 2 }} />
                    库存 {stock}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: '价格',
      width: 150,
      search: false,
      render: (_: unknown, r: RewardProduct) => {
        const skus = r.skus || [];
        const prices = skus.map((s) => s.price).filter((v) => v > 0);
        const costs = skus.map((s) => s.cost).filter((v): v is number => typeof v === 'number' && v > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : r.basePrice;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : r.basePrice;
        const hasPriceRange = prices.length > 1 && minPrice !== maxPrice;
        return (
          <div>
            <div style={{ fontWeight: 500, fontFamily: 'monospace' }}>
              {hasPriceRange
                ? `¥${minPrice.toFixed(2)}~${maxPrice.toFixed(2)}`
                : `¥${r.basePrice.toFixed(2)}`}
            </div>
            {costs.length > 0 && (
              <div style={{ fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
                成本 ¥{Math.min(...costs).toFixed(2)}
                {costs.length > 1 && Math.min(...costs) !== Math.max(...costs)
                  ? `~${Math.max(...costs).toFixed(2)}`
                  : ''}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '毛利',
      width: 110,
      search: false,
      render: (_: unknown, r: RewardProduct) => {
        const skus = r.skus || [];
        const prices = skus.map((s) => s.price).filter((v) => v > 0);
        const costs = skus.map((s) => s.cost).filter((v): v is number => typeof v === 'number' && v > 0);
        if (prices.length === 0 || costs.length === 0) return <span style={{ color: '#999' }}>-</span>;
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
        if (avgPrice <= 0) return <span style={{ color: '#999' }}>-</span>;
        const profit = avgPrice - avgCost;
        const margin = (profit / avgPrice) * 100;
        const profitColor = profit > 0 ? '#52c41a' : profit < 0 ? '#ff4d4f' : '#999';
        return (
          <Tooltip title={`毛利额: ¥${profit.toFixed(2)}`}>
            <span style={{ color: profitColor, fontWeight: 500 }}>
              {margin.toFixed(1)}%
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '库存',
      width: 80,
      search: false,
      sorter: true,
      render: (_: unknown, r: RewardProduct) => {
        const stock = getDisplayStock(r);
        const low = isLowStock(r);
        return (
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: low ? 600 : 400,
              color: stock <= 0 ? '#ff4d4f' : low ? '#fa8c16' : undefined,
            }}
          >
            {stock}
          </span>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueType: 'select',
      valueEnum: {
        ACTIVE: { text: '上架', status: 'Success' },
        INACTIVE: { text: '下架', status: 'Default' },
      },
      render: (_: unknown, r: RewardProduct) => {
        const s = rewardProductStatusMap[r.status];
        return (
          <PermissionGate
            permission={PERMISSIONS.REWARD_PRODUCTS_UPDATE}
            fallback={<Tag color={s?.color}>{s?.text || r.status}</Tag>}
          >
            <Switch
              size="small"
              checkedChildren="上架"
              unCheckedChildren="下架"
              checked={r.status === 'ACTIVE'}
              loading={togglingId === r.id}
              onChange={(checked) => handleStatusToggle(r.id, checked)}
            />
          </PermissionGate>
        );
      },
    },
    {
      title: '活动引用',
      width: 120,
      search: false,
      render: (_: unknown, r: RewardProduct) => {
        const summary = r.referenceSummary;
        if (!summary || summary.totalReferences <= 0) {
          return <Text type="secondary">未引用</Text>;
        }
        return (
          <Tooltip
            title={`VIP赠品 ${summary.vipGiftOptionCount} 个，抽奖奖品 ${summary.lotteryPrizeCount} 个`}
          >
            <Tag color="gold" icon={<LinkOutlined />}>
              已引用 {summary.totalReferences}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      search: false,
      render: (_: unknown, r: RewardProduct) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.REWARD_PRODUCTS_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/reward-products/${r.id}/edit`)}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.REWARD_PRODUCTS_DELETE}>
            <Popconfirm title="确认删除该商品？" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  // 获取 admin token
  const token = localStorage.getItem('admin_token');

  return (
    <div style={{ padding: 24 }}>
      <ProTable<RewardProduct>
        headerTitle="奖励商品管理"
        actionRef={actionRef}
        columns={columns}
        rowKey="id"
        scroll={{ x: 1000 }}
        expandable={{
          rowExpandable: (r) => (r.skus?.length ?? 0) > 1,
          expandedRowRender: (r) => (
            <Table<RewardProductSku>
              dataSource={r.skus}
              rowKey="id"
              size="small"
              pagination={false}
              style={{ margin: '4px 0' }}
              columns={[
                {
                  title: '规格',
                  dataIndex: 'title',
                  width: 160,
                  render: (v) => v || '默认',
                },
                {
                  title: '成本',
                  dataIndex: 'cost',
                  width: 100,
                  render: (v) =>
                    typeof v === 'number' ? (
                      <span style={{ fontFamily: 'monospace' }}>¥{v.toFixed(2)}</span>
                    ) : '-',
                },
                {
                  title: '售价',
                  dataIndex: 'price',
                  width: 100,
                  render: (v: number) =>
                    v > 0 ? (
                      <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>¥{v.toFixed(2)}</span>
                    ) : '-',
                },
                {
                  title: '毛利率',
                  width: 90,
                  render: (_: unknown, sku: RewardProductSku) => {
                    if (!sku.cost || sku.price <= 0) return '-';
                    const margin = ((sku.price - sku.cost) / sku.price) * 100;
                    const color = margin > 0 ? '#52c41a' : margin < 0 ? '#ff4d4f' : '#999';
                    return <span style={{ color, fontWeight: 500 }}>{margin.toFixed(1)}%</span>;
                  },
                },
                {
                  title: '库存',
                  dataIndex: 'stock',
                  width: 80,
                  render: (v: number) => {
                    const stockIsLow = v < LOW_STOCK_THRESHOLD;
                    return (
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontWeight: stockIsLow ? 600 : 400,
                          color: v <= 0 ? '#ff4d4f' : stockIsLow ? '#fa8c16' : undefined,
                        }}
                      >
                        {stockIsLow && v > 0 && <WarningOutlined style={{ marginRight: 4 }} />}
                        {v}
                      </span>
                    );
                  },
                },
              ]}
            />
          ),
        }}
        request={async (params) => {
          const res = await getRewardProducts({
            page: params.current || 1,
            pageSize: params.pageSize || 20,
            keyword: params.keyword || undefined,
            status: params.status || undefined,
          });
          let items = res.items;
          if (lowStockOnly) {
            items = items.filter((p) => isLowStock(p));
          }
          return { data: items, total: lowStockOnly ? items.length : res.total, success: true };
        }}
        params={{ lowStockOnly }}
        pagination={{ defaultPageSize: 20 }}
        search={{ labelWidth: 'auto', collapsed: true, collapseRender: (collapsed) => collapsed ? '展开筛选' : '收起' }}
        toolBarRender={() => [
          <Space key="toolbar" align="center">
            <Tooltip title={`仅显示库存低于 ${LOW_STOCK_THRESHOLD} 的商品`}>
              <span style={{ fontSize: 14 }}>
                <WarningOutlined style={{ color: lowStockOnly ? '#fa8c16' : '#999', marginRight: 4 }} />
                仅低库存
                <Switch
                  size="small"
                  checked={lowStockOnly}
                  onChange={(checked) => setLowStockOnly(checked)}
                  style={{ marginLeft: 6 }}
                />
              </span>
            </Tooltip>
            <PermissionGate permission={PERMISSIONS.REWARD_PRODUCTS_CREATE}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => { setSubmitSuccess(false); setMultiSku(false); createForm.resetFields(); setCreateDrawerOpen(true); }}
              >
                新增商品
              </Button>
            </PermissionGate>
          </Space>,
        ]}
      />

      {/* 新增商品抽屉 - 单页表单 */}
      <Drawer
        title="新增奖励商品"
        width={640}
        open={createDrawerOpen}
        onClose={closeDrawer}
        destroyOnClose
        footer={
          !submitSuccess ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={closeDrawer}>取消</Button>
              <Button type="primary" onClick={handleCreateSubmit} loading={submitting}>
                提交创建
              </Button>
            </div>
          ) : null
        }
      >
        {submitSuccess ? (
          <Result
            status="success"
            title="商品创建成功"
            subTitle="您可以继续添加新商品，或关闭此窗口返回列表"
            extra={[
              <Button key="close" onClick={closeDrawer}>返回列表</Button>,
              <Button
                key="another"
                type="primary"
                onClick={() => { setSubmitSuccess(false); setFileList([]); setMultiSku(false); createForm.resetFields(); }}
              >
                继续添加
              </Button>,
            ]}
          />
        ) : (
          <Form form={createForm} layout="vertical" requiredMark="optional">
            {/* 基本信息 */}
            <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
              <Form.Item
                name="title"
                label="商品名称"
                rules={[{ required: true, message: '请输入商品名称' }]}
              >
                <Input placeholder="请输入商品名称" maxLength={120} showCount />
              </Form.Item>

              <Form.Item name="description" label="商品描述">
                <Input.TextArea
                  rows={3}
                  placeholder="详细的商品描述信息（选填）"
                  maxLength={2000}
                  showCount
                />
              </Form.Item>
            </Card>

            {/* 商品图片 */}
            <Card size="small" title="商品图片" style={{ marginBottom: 16 }}>
              <Dragger
                name="file"
                action={`${API_BASE}/upload?folder=products`}
                headers={{ Authorization: `Bearer ${token || ''}` }}
                listType="picture"
                fileList={fileList}
                onChange={({ fileList: newList }) => setFileList(newList)}
                multiple
                maxCount={9}
                accept="image/*"
              >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">点击或拖拽上传商品图片</p>
                <p className="ant-upload-hint">支持 JPG / PNG / WebP，最多 9 张</p>
              </Dragger>
            </Card>

            {/* 价格库存 */}
            <Card
              size="small"
              title="价格与库存"
              style={{ marginBottom: 16 }}
              extra={
                <Space>
                  <Text type="secondary">多规格商品</Text>
                  <Switch checked={multiSku} onChange={handleMultiSkuToggle} />
                </Space>
              }
            >
              {!multiSku ? (
                /* 单规格模式：直接显示字段 */
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="cost"
                        label="成本价（元）"
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
                        name="price"
                        label="售价（元）"
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
                        name="stock"
                        label="库存"
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
                      <Form.Item name="weightGram" label="重量（克）">
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
              ) : (
                /* 多规格模式：可重复的规格行 */
                <Form.List name="skus" initialValue={[{ title: '默认规格' }]}>
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...restField }) => (
                        <Card
                          key={key}
                          size="small"
                          style={{ marginBottom: 12, background: '#fafafa' }}
                          extra={
                            fields.length > 1 ? (
                              <MinusCircleOutlined
                                style={{ color: '#ff4d4f', cursor: 'pointer' }}
                                onClick={() => remove(name)}
                              />
                            ) : null
                          }
                        >
                          <Form.Item
                            {...restField}
                            name={[name, 'title']}
                            label="规格名称"
                            rules={[{ required: true, message: '请输入规格名称' }]}
                          >
                            <Input placeholder="如：500g装 / 大包装" maxLength={100} />
                          </Form.Item>
                          <Row gutter={16}>
                            <Col span={6}>
                              <Form.Item
                                {...restField}
                                name={[name, 'cost']}
                                label="成本价（元）"
                                rules={[{ required: true, message: '请输入' }]}
                              >
                                <InputNumber
                                  min={0}
                                  precision={2}
                                  step={0.01}
                                  style={{ width: '100%' }}
                                  prefix="¥"
                                  placeholder="40.00"
                                />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item
                                {...restField}
                                name={[name, 'price']}
                                label="售价（元）"
                                rules={[{ required: true, message: '请输入' }]}
                              >
                                <InputNumber
                                  min={0}
                                  precision={2}
                                  step={0.01}
                                  style={{ width: '100%' }}
                                  prefix="¥"
                                  placeholder="88.00"
                                />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item
                                {...restField}
                                name={[name, 'stock']}
                                label="库存"
                                rules={[{ required: true, message: '请输入' }]}
                              >
                                <InputNumber
                                  min={0}
                                  precision={0}
                                  style={{ width: '100%' }}
                                  placeholder="100"
                                />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item
                                {...restField}
                                name={[name, 'weightGram']}
                                label="重量（克）"
                              >
                                <InputNumber
                                  min={0}
                                  precision={0}
                                  style={{ width: '100%' }}
                                  placeholder="选填"
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                        </Card>
                      ))}
                      <Button
                        type="dashed"
                        onClick={() => add({ title: '' })}
                        icon={<PlusOutlined />}
                        style={{ width: '100%' }}
                      >
                        添加规格
                      </Button>
                    </>
                  )}
                </Form.List>
              )}
            </Card>
          </Form>
        )}
      </Drawer>
    </div>
  );
}
