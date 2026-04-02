import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Button, message, Space, InputNumber, Input, Form,
  TreeSelect, Upload, Typography, Descriptions, Tag, Spin,
  Breadcrumb, Select, Collapse, Switch, Row, Col, Divider,
} from 'antd';
import {
  MinusCircleOutlined, PlusOutlined, ArrowLeftOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useQuery } from '@tanstack/react-query';
import {
  getProduct,
  createProduct,
  updateProduct,
  updateProductSkus,
  getCategories,
  type CategoryNode,
} from '@/api/products';
import { getMarkupRate } from '@/api/config';
import { getTagCategories } from '@/api/tags';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { productStatusMap, auditStatusMap } from '@/constants/statusMaps';
import useAuthStore from '@/store/useAuthStore';
import dayjs from 'dayjs';

const { Text } = Typography;

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// 将扁平分类列表转为 TreeSelect 需要的树形结构
interface TreeNode { title: string; value: string; children: TreeNode[] }
function buildCategoryTree(categories: CategoryNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const c of categories) {
    map.set(c.id, { title: c.name, value: c.id, children: [] });
  }
  for (const c of categories) {
    const node = map.get(c.id)!;
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ============================================================
// 共享：售价只读展示组件
// ============================================================
function SellingPriceDisplay({ cost, markupRate }: { cost: number | undefined; markupRate: number }) {
  const computed = cost && cost > 0 ? (cost * markupRate).toFixed(2) : undefined;
  return (
    <InputNumber
      value={computed ? Number(computed) : undefined}
      disabled
      prefix="¥"
      precision={2}
      style={{ width: '100%' }}
      placeholder="自动计算"
      addonAfter={`= 成本 × ${markupRate}`}
    />
  );
}

// ============================================================
// 共享：语义标签字段组
// ============================================================
function SemanticTagFields() {
  return (
    <>
      <Form.Item name="flavorTags" label="口味标签">
        <Select
          mode="tags"
          placeholder="如：甜、脆、鲜、香辣"
          tokenSeparators={[',', '，']}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item name="seasonalMonths" label="应季月份">
        <Select
          mode="multiple"
          placeholder="选择应季月份"
          options={Array.from({ length: 12 }, (_, i) => ({
            label: `${i + 1}月`,
            value: i + 1,
          }))}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item name="usageScenarios" label="适用场景">
        <Select
          mode="tags"
          placeholder="如：做饭、送礼、火锅、沙拉"
          tokenSeparators={[',', '，']}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item name="dietaryTags" label="饮食属性">
        <Select
          mode="tags"
          placeholder="如：有机、低糖、高蛋白、素食"
          tokenSeparators={[',', '，']}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item name="originRegion" label="产地区域">
        <Input placeholder="如：山东青岛、云南" />
      </Form.Item>
    </>
  );
}

// ============================================================
// 共享：多规格行列表
// ============================================================
function MultiSpecRows({ markupRate }: { markupRate: number }) {
  return (
    <Form.List name="skus" initialValue={[{ specName: '', stock: 0 }]}>
      {(fields, { add, remove }) => (
        <>
          {fields.map((field) => (
            <Card
              key={field.key}
              size="small"
              style={{ marginBottom: 8, background: '#fafafa' }}
            >
              <Row gutter={12} align="middle">
                <Col span={5}>
                  <Form.Item
                    {...field}
                    name={[field.name, 'id']}
                    hidden
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, 'specName']}
                    label="规格名称"
                    rules={[{ required: true, message: '请输入规格名称' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="如：5斤装" />
                  </Form.Item>
                </Col>
                <Col span={4}>
                  <Form.Item
                    {...field}
                    name={[field.name, 'cost']}
                    label="成本价"
                    rules={[
                      { required: true, message: '请输入成本' },
                      { type: 'number', min: 0.01, message: '成本必须大于 0' },
                    ]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber placeholder="元" min={0.01} precision={2} style={{ width: '100%' }} prefix="¥" />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item shouldUpdate noStyle>
                    {({ getFieldValue }) => {
                      const cost = getFieldValue(['skus', field.name, 'cost']);
                      return (
                        <Form.Item label="售价（自动计算）" style={{ marginBottom: 0 }}>
                          <SellingPriceDisplay cost={cost} markupRate={markupRate} />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                </Col>
                <Col span={3}>
                  <Form.Item
                    {...field}
                    name={[field.name, 'stock']}
                    label="库存"
                    rules={[
                      { required: true, message: '请输入库存' },
                      { type: 'number', min: 0, message: '库存不能为负数' },
                    ]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber placeholder="数量" min={0} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={3}>
                  <Form.Item
                    {...field}
                    name={[field.name, 'maxPerOrder']}
                    label="单笔限购"
                    rules={[
                      { type: 'number', min: 1, message: '最少为1' },
                    ]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={3}>
                  <Form.Item
                    {...field}
                    name={[field.name, 'weightGram']}
                    label="重量"
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber placeholder="克" min={0} style={{ width: '100%' }} addonAfter="g" />
                  </Form.Item>
                </Col>
                <Col span={1} style={{ textAlign: 'center', paddingTop: 28 }}>
                  {fields.length > 1 && (
                    <MinusCircleOutlined
                      style={{ fontSize: 18, color: '#999', cursor: 'pointer' }}
                      onClick={() => remove(field.name)}
                    />
                  )}
                </Col>
              </Row>
            </Card>
          ))}
          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
            添加规格
          </Button>
        </>
      )}
    </Form.List>
  );
}

// ============================================================
// 共享：图片上传区块
// ============================================================
function ImageUploadSection({
  fileList,
  setFileList,
  token,
}: {
  fileList: UploadFile[];
  setFileList: (list: UploadFile[]) => void;
  token: string | null;
}) {
  return (
    <>
      <Upload
        name="file"
        action={`${API_BASE}/upload?folder=products`}
        headers={{ Authorization: `Bearer ${token || ''}` }}
        listType="picture-card"
        fileList={fileList}
        onChange={({ fileList: newList }) => setFileList(newList)}
        multiple
        maxCount={9}
        accept="image/*"
      >
        {fileList.length >= 9 ? null : (
          <div>
            <PlusOutlined />
            <div style={{ marginTop: 8 }}>上传图片</div>
          </div>
        )}
      </Upload>
      <Text type="secondary">最多 9 张，支持 JPG / PNG / WebP，单张最大 10MB</Text>
    </>
  );
}

// ============================================================
// 共享：更多设置折叠面板内容
// ============================================================
function AdvancedSettingsContent({ productTagOptions }: { productTagOptions: { value: string; label: string }[] }) {
  return (
    <>
      <Form.Item label="副标题" name="subtitle">
        <Input placeholder="可选，补充商品卖点" maxLength={200} />
      </Form.Item>
      <Form.Item label="标签" name="tagIds">
        <Select
          mode="multiple"
          placeholder="请选择商品标签"
          options={productTagOptions}
          showSearch
          optionFilterProp="label"
        />
      </Form.Item>
      <Form.Item
        label="AI 搜索关键词"
        name="aiKeywords"
        tooltip="买家用语音搜索时，AI 会匹配这些关键词帮助找到您的商品"
      >
        <Input placeholder="逗号分隔，如：五常大米,稻花香,东北粳米" />
      </Form.Item>

      {/* 自定义属性 */}
      <Form.Item label="自定义属性">
        <Form.List name="attributes">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space key={field.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                  <Form.Item {...field} name={[field.name, 'key']} rules={[{ required: true, message: '属性名' }]}>
                    <Input placeholder="属性名（如：种植方式）" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'value']} rules={[{ required: true, message: '属性值' }]}>
                    <Input placeholder="属性值（如：有机种植）" style={{ width: 240 }} />
                  </Form.Item>
                  <MinusCircleOutlined style={{ marginTop: 8, color: '#999' }} onClick={() => remove(field.name)} />
                </Space>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                添加属性
              </Button>
            </>
          )}
        </Form.List>
      </Form.Item>

      <Divider />

      {/* 语义标签 */}
      <Text strong style={{ display: 'block', marginBottom: 12 }}>语义标签（AI 搜索优化）</Text>
      <SemanticTagFields />
    </>
  );
}

// ============================================================
// 共享：处理表单值转 API payload 的工具函数
// ============================================================
function buildPayload(
  values: Record<string, unknown>,
  skuList: Array<Record<string, unknown>>,
  markupRate: number,
  fileList: UploadFile[],
) {
  // 处理标签（使用标签池 ID 列表）
  const tagIds = (values.tagIds as string[] | undefined) || undefined;

  // 处理 AI 关键词
  const aiKeywords = typeof values.aiKeywords === 'string'
    ? values.aiKeywords.split(',').map((s: string) => s.trim()).filter(Boolean)
    : undefined;

  // 处理属性
  const attrPairs = values.attributes as Array<{ key: string; value: string }> | undefined;
  const attributes = attrPairs && attrPairs.length > 0
    ? Object.fromEntries(attrPairs.filter((p) => p.key).map((p) => [p.key, p.value]))
    : undefined;

  // 处理图片
  const mediaUrls = fileList
    .filter((f) => f.status === 'done')
    .map((f) => {
      const response = f.response as { url?: string; data?: { url?: string } } | undefined;
      return f.url || response?.data?.url || response?.url;
    })
    .filter(Boolean) as string[];

  // 计算 basePrice（取 SKU 中最低售价）
  const basePrice = Math.min(...skuList.map((s) => Number(s.cost) * markupRate));

  const skus = skuList.map((s) => ({
    id: s.id as string | undefined,
    specName: (s.specName as string) || '默认规格',
    cost: Number(s.cost),
    stock: Number(s.stock),
    weightGram: s.weightGram === undefined || s.weightGram === null ? undefined : Number(s.weightGram),
    maxPerOrder: s.maxPerOrder === undefined || s.maxPerOrder === null ? undefined : Number(s.maxPerOrder),
  }));

  return {
    title: values.title,
    subtitle: values.subtitle || undefined,
    description: values.description,
    basePrice,
    categoryId: values.categoryId,
    origin: values.originText ? { text: values.originText } : undefined,
    tagIds,
    aiKeywords,
    attributes,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    flavorTags: (values.flavorTags as string[] | undefined) || undefined,
    seasonalMonths: (values.seasonalMonths as number[] | undefined) || undefined,
    usageScenarios: (values.usageScenarios as string[] | undefined) || undefined,
    dietaryTags: (values.dietaryTags as string[] | undefined) || undefined,
    originRegion: (values.originRegion as string | undefined) || undefined,
    skus,
  };
}

// ============================================================
// 入口：根据有无 ID 分发到 编辑 / 创建 组件
// ============================================================
export default function ProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  if (isEdit) {
    return <ProductEditForm id={id} />;
  }
  return <ProductCreateForm />;
}

// ============================================================
// 编辑模式：卡片式直接编辑
// ============================================================
function ProductEditForm({ id }: { id: string }) {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const token = useAuthStore((s) => s.token);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [multiSpec, setMultiSpec] = useState(false);

  // 监听表单变化以跟踪未保存更改
  Form.useWatch([], form);
  useUnsavedChanges(form.isFieldsTouched());

  // 加载商品数据
  const { data: product, isLoading } = useQuery({
    queryKey: ['seller-product', id],
    queryFn: () => getProduct(id),
    enabled: !!id,
  });

  // 加载分类树
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  });
  const treeData = useMemo(() => buildCategoryTree(categories || []), [categories]);

  // 加价率（动态从 API 获取）
  const { data: configData } = useQuery({
    queryKey: ['seller-markup-rate'],
    queryFn: getMarkupRate,
  });
  const markupRate = configData?.markupRate ?? 1.3;

  // 商品标签选项（从标签池加载）
  const { data: productCategories = [] } = useQuery({
    queryKey: ['tag-categories-product'],
    queryFn: () => getTagCategories('PRODUCT'),
  });
  const productTagOptions = productCategories
    .flatMap(cat => cat.tags.map(t => ({ value: t.id, label: t.name })));

  // 商品数据加载后填充表单并判断是否多规格
  useEffect(() => {
    if (!product) return;

    const isMulti = (product.skus?.length ?? 0) > 1;
    setMultiSpec(isMulti);

    const originText = typeof product.origin === 'object' && product.origin
      ? (product.origin as Record<string, string>).text || ''
      : '';

    const attrPairs = product.attributes && typeof product.attributes === 'object'
      ? Object.entries(product.attributes as Record<string, string>).map(([key, value]) => ({ key, value }))
      : [];

    // 单规格时，将第一个 SKU 的数据直接放到主表单
    const firstSku = product.skus?.[0];

    form.setFieldsValue({
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      categoryId: product.categoryId,
      originText,
      tagIds: product.tags?.map((t: any) => t.tag?.id || t.tagId) || [],
      aiKeywords: (product.aiKeywords || []).join(','),
      attributes: attrPairs.length > 0 ? attrPairs : [],
      // 单规格字段
      ...(!isMulti && firstSku ? {
        singleCost: firstSku.cost,
        singleStock: firstSku.stock,
        singleWeightGram: firstSku.weightGram,
      } : {}),
      // 多规格字段
      ...(isMulti ? {
        skus: product.skus.map((s) => ({
          id: s.id,
          specName: s.title,
          cost: s.cost,
          stock: s.stock,
          weightGram: s.weightGram,
          maxPerOrder: s.maxPerOrder,
        })),
      } : {}),
      // 语义字段
      flavorTags: (product as unknown as Record<string, unknown>).flavorTags as string[] | undefined,
      seasonalMonths: (product as unknown as Record<string, unknown>).seasonalMonths as number[] | undefined,
      usageScenarios: (product as unknown as Record<string, unknown>).usageScenarios as string[] | undefined,
      dietaryTags: (product as unknown as Record<string, unknown>).dietaryTags as string[] | undefined,
      originRegion: (product as unknown as Record<string, unknown>).originRegion as string | undefined,
    });

    if (product.media?.length > 0) {
      setFileList(
        product.media.map((m, i) => ({
          uid: m.id || `-${i}`,
          name: `图片${i + 1}`,
          status: 'done' as const,
          url: m.url,
        })),
      );
    }
  }, [product, form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();

      // 构造 SKU 列表：单规格 vs 多规格
      let skuList: Array<Record<string, unknown>>;
      if (multiSpec) {
        skuList = values.skus as Array<Record<string, unknown>>;
      } else {
        // 单规格：使用主表单里的 singleCost/singleStock/singleWeightGram
        const firstSkuId = product?.skus?.[0]?.id;
        skuList = [{
          id: firstSkuId,
          specName: '默认规格',
          cost: values.singleCost,
          stock: values.singleStock,
          weightGram: values.singleWeightGram,
        }];
      }

      const payload = buildPayload(values, skuList, markupRate, fileList);
      const { skus, ...productData } = payload;

      await updateProduct(id, productData);
      await updateProductSkus(id, skus);
      message.success('商品已更新');
      navigate('/products');
    } catch (err) {
      if (err instanceof Error) {
        message.error(err.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!product) return null;

  const status = productStatusMap[product.status];
  const auditStatus = auditStatusMap[product.auditStatus];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* 页头 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#f5f5f5',
          padding: '12px 0',
          marginBottom: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <Breadcrumb
            style={{ marginBottom: 8 }}
            items={[
              { title: <a onClick={() => navigate('/')}>首页</a> },
              { title: <a onClick={() => navigate('/products')}>商品管理</a> },
              { title: '编辑商品' },
            ]}
          />
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>
            返回列表
          </Button>
        </div>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} size="large">
          保存
        </Button>
      </div>

      <Form form={form} layout="vertical">
        {/* 1. 商品状态（只读） */}
        <Card title="商品状态" style={{ marginBottom: 16 }}>
          <Descriptions column={{ xs: 1, sm: 3 }}>
            <Descriptions.Item label="商品 ID">
              <Text copyable={{ text: product.id }} style={{ fontSize: 12 }}>{product.id}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="上架状态">
              <Tag color={status?.color}>{status?.text}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="审核状态">
              <Tag color={auditStatus?.color}>{auditStatus?.text}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="商品分类">
              {product.category?.name || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {dayjs(product.createdAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {dayjs(product.updatedAt).format('YYYY-MM-DD HH:mm')}
            </Descriptions.Item>
            {product.auditNote && (
              <Descriptions.Item label="审核备注" span={3}>
                <Text type="danger">{product.auditNote}</Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        {/* 2. 基本信息 */}
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item
            label="商品标题"
            name="title"
            rules={[{ required: true, message: '请输入商品标题' }]}
          >
            <Input placeholder="请输入商品标题" maxLength={100} />
          </Form.Item>
          <Form.Item
            label="商品分类"
            name="categoryId"
            rules={[{ required: true, message: '请选择商品分类' }]}
          >
            <TreeSelect
              treeData={treeData}
              placeholder="请选择分类"
              treeDefaultExpandAll
              treeLine
              allowClear
              showSearch
              treeNodeFilterProp="title"
              style={{ width: 300 }}
            />
          </Form.Item>
          <Form.Item
            label="商品描述"
            name="description"
            rules={[
              { required: true, message: '请填写商品描述' },
              { min: 10, message: '描述至少 10 字' },
            ]}
          >
            <Input.TextArea rows={4} placeholder="请详细描述商品特点、产地、种植方式、口感等信息" />
          </Form.Item>
          <Form.Item label="产地（选填）" name="originText">
            <Input placeholder="如：黑龙江五常、山东烟台、云南昆明" style={{ width: 300 }} />
          </Form.Item>
        </Card>

        {/* 3. 商品图片 */}
        <Card title="商品图片" style={{ marginBottom: 16 }}>
          <ImageUploadSection fileList={fileList} setFileList={setFileList} token={token} />
        </Card>

        {/* 4. 价格与库存 */}
        <Card
          title="价格与库存"
          style={{ marginBottom: 16 }}
          extra={
            <Space>
              <Text type="secondary">多规格商品</Text>
              <Switch
                checked={multiSpec}
                onChange={(checked) => {
                  setMultiSpec(checked);
                  if (checked) {
                    // 切换到多规格：从单规格数据初始化一行
                    const cost = form.getFieldValue('singleCost');
                    const stock = form.getFieldValue('singleStock');
                    const weightGram = form.getFieldValue('singleWeightGram');
                    if (cost || stock) {
                      form.setFieldsValue({
                        skus: [{ specName: '默认规格', cost, stock, weightGram }],
                      });
                    }
                  } else {
                    // 切换到单规格：从第一行多规格数据恢复
                    const skus = form.getFieldValue('skus') as Array<Record<string, unknown>> | undefined;
                    const first = skus?.[0];
                    if (first) {
                      form.setFieldsValue({
                        singleCost: first.cost,
                        singleStock: first.stock,
                        singleWeightGram: first.weightGram,
                      });
                    }
                  }
                }}
              />
            </Space>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            售价由平台按成本 × 加价率（{markupRate}）自动计算，卖家只需填写成本价。
          </Text>

          {!multiSpec ? (
            /* 单规格模式 */
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item
                  label="成本价"
                  name="singleCost"
                  rules={[
                    { required: true, message: '请输入成本价' },
                    { type: 'number', min: 0.01, message: '成本必须大于 0' },
                  ]}
                >
                  <InputNumber placeholder="元" min={0.01} precision={2} style={{ width: '100%' }} prefix="¥" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item shouldUpdate noStyle>
                  {({ getFieldValue }) => {
                    const cost = getFieldValue('singleCost');
                    return (
                      <Form.Item label="售价（自动计算）">
                        <SellingPriceDisplay cost={cost} markupRate={markupRate} />
                      </Form.Item>
                    );
                  }}
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item
                  label="库存"
                  name="singleStock"
                  rules={[
                    { required: true, message: '请输入库存' },
                    { type: 'number', min: 0, message: '库存不能为负数' },
                  ]}
                >
                  <InputNumber placeholder="数量" min={0} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item label="重量" name="singleWeightGram">
                  <InputNumber placeholder="克" min={0} style={{ width: '100%' }} addonAfter="g" />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            /* 多规格模式 */
            <MultiSpecRows markupRate={markupRate} />
          )}
        </Card>

        {/* 5. 更多设置 */}
        <Card style={{ marginBottom: 16 }}>
          <Collapse
            ghost
            defaultActiveKey={[]}
            items={[
              {
                key: 'advanced',
                label: <Text strong>更多设置</Text>,
                children: <AdvancedSettingsContent productTagOptions={productTagOptions} />,
              },
            ]}
          />
        </Card>
      </Form>
    </div>
  );
}

// ============================================================
// 创建模式：单页表单（不再使用 StepsForm）
// ============================================================
function ProductCreateForm() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const token = useAuthStore((s) => s.token);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [multiSpec, setMultiSpec] = useState(false);

  // 监听表单变化以跟踪未保存更改
  Form.useWatch([], form);
  useUnsavedChanges(form.isFieldsTouched());

  // 加载分类树
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  });
  const treeData = useMemo(() => buildCategoryTree(categories || []), [categories]);

  // 加价率（动态从 API 获取）
  const { data: configData } = useQuery({
    queryKey: ['seller-markup-rate'],
    queryFn: getMarkupRate,
  });
  const markupRate = configData?.markupRate ?? 1.3;

  // 商品标签选项（从标签池加载）
  const { data: productCategories = [] } = useQuery({
    queryKey: ['tag-categories-product'],
    queryFn: () => getTagCategories('PRODUCT'),
  });
  const productTagOptions = productCategories
    .flatMap(cat => cat.tags.map(t => ({ value: t.id, label: t.name })));

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();

      // 构造 SKU 列表
      let skuList: Array<Record<string, unknown>>;
      if (multiSpec) {
        skuList = values.skus as Array<Record<string, unknown>>;
      } else {
        skuList = [{
          specName: '默认规格',
          cost: values.singleCost,
          stock: values.singleStock,
          weightGram: values.singleWeightGram,
        }];
      }

      const payload = buildPayload(values, skuList, markupRate, fileList);
      await createProduct(payload);
      message.success('商品已创建，等待管理员审核');
      navigate('/products');
    } catch (err) {
      if (err instanceof Error) {
        message.error(err.message || '创建失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* 页头 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#f5f5f5',
          padding: '12px 0',
          marginBottom: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <Breadcrumb
            style={{ marginBottom: 8 }}
            items={[
              { title: <a onClick={() => navigate('/')}>首页</a> },
              { title: <a onClick={() => navigate('/products')}>商品管理</a> },
              { title: '创建商品' },
            ]}
          />
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>
            返回列表
          </Button>
        </div>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSubmit} loading={loading} size="large">
          提交审核
        </Button>
      </div>

      <Form form={form} layout="vertical">
        {/* 1. 基本信息 */}
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item
            label="商品标题"
            name="title"
            rules={[{ required: true, message: '请输入商品标题' }]}
          >
            <Input placeholder="请输入商品标题" maxLength={100} />
          </Form.Item>
          <Form.Item
            label="商品分类"
            name="categoryId"
            rules={[{ required: true, message: '请选择商品分类' }]}
          >
            <TreeSelect
              treeData={treeData}
              placeholder="请选择分类"
              treeDefaultExpandAll
              treeLine
              allowClear
              showSearch
              treeNodeFilterProp="title"
              style={{ width: 300 }}
            />
          </Form.Item>
          <Form.Item
            label="商品描述"
            name="description"
            rules={[
              { required: true, message: '请填写商品描述' },
              { min: 10, message: '描述至少 10 字' },
            ]}
          >
            <Input.TextArea rows={4} placeholder="请详细描述商品特点、产地、种植方式、口感等信息" />
          </Form.Item>
          <Form.Item label="产地（选填）" name="originText">
            <Input placeholder="如：黑龙江五常、山东烟台、云南昆明" style={{ width: 300 }} />
          </Form.Item>
        </Card>

        {/* 2. 商品图片 */}
        <Card title="商品图片" style={{ marginBottom: 16 }}>
          <ImageUploadSection fileList={fileList} setFileList={setFileList} token={token} />
        </Card>

        {/* 3. 价格与库存 */}
        <Card
          title="价格与库存"
          style={{ marginBottom: 16 }}
          extra={
            <Space>
              <Text type="secondary">多规格商品</Text>
              <Switch
                checked={multiSpec}
                onChange={(checked) => {
                  setMultiSpec(checked);
                  if (checked) {
                    // 切换到多规格：从单规格数据初始化一行
                    const cost = form.getFieldValue('singleCost');
                    const stock = form.getFieldValue('singleStock');
                    const weightGram = form.getFieldValue('singleWeightGram');
                    form.setFieldsValue({
                      skus: [{ specName: '默认规格', cost, stock, weightGram }],
                    });
                  } else {
                    // 切换到单规格：从第一行多规格数据恢复
                    const skus = form.getFieldValue('skus') as Array<Record<string, unknown>> | undefined;
                    const first = skus?.[0];
                    if (first) {
                      form.setFieldsValue({
                        singleCost: first.cost,
                        singleStock: first.stock,
                        singleWeightGram: first.weightGram,
                      });
                    }
                  }
                }}
              />
            </Space>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            售价由平台按成本 × 加价率（{markupRate}）自动计算，卖家只需填写成本价。
          </Text>

          {!multiSpec ? (
            /* 单规格模式 */
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item
                  label="成本价"
                  name="singleCost"
                  rules={[
                    { required: true, message: '请输入成本价' },
                    { type: 'number', min: 0.01, message: '成本必须大于 0' },
                  ]}
                >
                  <InputNumber placeholder="元" min={0.01} precision={2} style={{ width: '100%' }} prefix="¥" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item shouldUpdate noStyle>
                  {({ getFieldValue }) => {
                    const cost = getFieldValue('singleCost');
                    return (
                      <Form.Item label="售价（自动计算）">
                        <SellingPriceDisplay cost={cost} markupRate={markupRate} />
                      </Form.Item>
                    );
                  }}
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item
                  label="库存"
                  name="singleStock"
                  rules={[
                    { required: true, message: '请输入库存' },
                    { type: 'number', min: 0, message: '库存不能为负数' },
                  ]}
                >
                  <InputNumber placeholder="数量" min={0} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item label="重量" name="singleWeightGram">
                  <InputNumber placeholder="克" min={0} style={{ width: '100%' }} addonAfter="g" />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            /* 多规格模式 */
            <MultiSpecRows markupRate={markupRate} />
          )}
        </Card>

        {/* 4. 更多设置 */}
        <Card style={{ marginBottom: 16 }}>
          <Collapse
            ghost
            defaultActiveKey={[]}
            items={[
              {
                key: 'advanced',
                label: <Text strong>更多设置</Text>,
                children: <AdvancedSettingsContent productTagOptions={productTagOptions} />,
              },
            ]}
          />
        </Card>
      </Form>
    </div>
  );
}
