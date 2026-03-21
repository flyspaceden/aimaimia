import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Button, message, Space, InputNumber, Input, Form,
  TreeSelect, Upload, Typography, Descriptions, Table, Tag, Spin,
  Breadcrumb, Select, Collapse,
} from 'antd';
import {
  MinusCircleOutlined, PlusOutlined, ArrowLeftOutlined,
  SaveOutlined, InboxOutlined,
} from '@ant-design/icons';
import {
  StepsForm,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import type { FormInstance } from 'antd';
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
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { productStatusMap, auditStatusMap } from '@/constants/statusMaps';
import useAuthStore from '@/store/useAuthStore';
import type { UploadFile } from 'antd/es/upload/interface';
import dayjs from 'dayjs';

const { Dragger } = Upload;
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

// 根据分类 ID 找到完整路径（如 "水果 / 浆果 / 蓝莓"）
function findCategoryPath(treeData: TreeNode[], id: string, path: string[] = []): string {
  for (const node of treeData) {
    const currentPath = [...path, node.title];
    if (node.value === id) return currentPath.join(' / ');
    const found = findCategoryPath(node.children, id, currentPath);
    if (found) return found;
  }
  return '';
}

export default function ProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  // 编辑模式和创建模式使用不同的组件
  if (isEdit) {
    return <ProductEditForm id={id} />;
  }
  return <ProductCreateForm />;
}

// ============================================================
// 编辑模式：卡片式直接编辑（类似管理后台）
// ============================================================
function ProductEditForm({ id }: { id: string }) {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [skuForm] = Form.useForm();
  const token = useAuthStore((s) => s.token);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [saving, setSaving] = useState(false);

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

  // 加价率
  const { data: configData } = useQuery({
    queryKey: ['seller-markup-rate'],
    queryFn: getMarkupRate,
  });
  const markupRate = configData?.markupRate ?? 1.3;

  // 商品数据加载后填充表单
  useEffect(() => {
    if (!product) return;

    const originText = typeof product.origin === 'object' && product.origin
      ? (product.origin as Record<string, string>).text || ''
      : '';

    const attrPairs = product.attributes && typeof product.attributes === 'object'
      ? Object.entries(product.attributes as Record<string, string>).map(([key, value]) => ({ key, value }))
      : [];

    form.setFieldsValue({
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      categoryId: product.categoryId,
      originText,
      tags: product.tags?.map((t) => t.tag.name).join(',') || '',
      aiKeywords: (product.aiKeywords || []).join(','),
      attributes: attrPairs.length > 0 ? attrPairs : [],
      // 语义字段
      flavorTags: (product as unknown as Record<string, unknown>).flavorTags as string[] | undefined,
      seasonalMonths: (product as unknown as Record<string, unknown>).seasonalMonths as number[] | undefined,
      usageScenarios: (product as unknown as Record<string, unknown>).usageScenarios as string[] | undefined,
      dietaryTags: (product as unknown as Record<string, unknown>).dietaryTags as string[] | undefined,
      originRegion: (product as unknown as Record<string, unknown>).originRegion as string | undefined,
    });

    skuForm.setFieldsValue({
      skus: product.skus.map((s) => ({
        id: s.id,
        specName: s.title,
        cost: s.cost,
        stock: s.stock,
        weightGram: s.weightGram,
      })),
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
  }, [product, form, skuForm]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const skuValues = await skuForm.validateFields();

      // 处理标签
      const tags = typeof values.tags === 'string'
        ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

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

      // 处理 SKU
      const skuList = skuValues.skus as Array<Record<string, unknown>>;
      const basePrice = Math.min(...skuList.map((s) => Number(s.cost) * markupRate));

      const skus = skuList.map((s) => ({
        id: s.id as string | undefined,
        specName: s.specName as string,
        cost: Number(s.cost),
        stock: Number(s.stock),
        weightGram: s.weightGram === undefined || s.weightGram === null ? undefined : Number(s.weightGram),
      }));

      const data = {
        title: values.title,
        subtitle: values.subtitle,
        description: values.description,
        basePrice,
        categoryId: values.categoryId,
        origin: values.originText ? { text: values.originText } : undefined,
        tags,
        aiKeywords,
        attributes,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        // 语义标签字段
        flavorTags: (values.flavorTags as string[] | undefined) || undefined,
        seasonalMonths: (values.seasonalMonths as number[] | undefined) || undefined,
        usageScenarios: (values.usageScenarios as string[] | undefined) || undefined,
        dietaryTags: (values.dietaryTags as string[] | undefined) || undefined,
        originRegion: (values.originRegion as string | undefined) || undefined,
      };

      await updateProduct(id, data);
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
    <div style={{ padding: 24 }}>
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

      {/* 2. 基本信息（可编辑） */}
      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item
            label="商品标题"
            name="title"
            rules={[{ required: true, message: '请输入商品标题' }]}
          >
            <Input placeholder="请输入商品标题" maxLength={100} />
          </Form.Item>
          <Form.Item label="副标题" name="subtitle">
            <Input placeholder="可选" maxLength={200} />
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
            label="详情描述"
            name="description"
            rules={[
              { required: true, message: '请填写商品详情描述' },
              { min: 20, message: '描述至少 20 字' },
            ]}
          >
            <Input.TextArea rows={5} placeholder="请详细描述商品特点、产地、种植方式、口感等信息" />
          </Form.Item>
          <Form.Item
            label="产地"
            name="originText"
            rules={[{ required: true, message: '请填写产地信息' }]}
          >
            <Input placeholder="如：黑龙江五常、山东烟台、云南昆明" style={{ width: 300 }} />
          </Form.Item>
          <Form.Item label="标签" name="tags">
            <Input placeholder="多个标签用逗号分隔，如：有机,新米,东北" />
          </Form.Item>
          <Form.Item label="AI 搜索关键词" name="aiKeywords" tooltip="买家用语音搜索时，AI 会匹配这些关键词">
            <Input placeholder="逗号分隔，如：五常大米,稻花香,东北粳米" />
          </Form.Item>

          {/* 商品属性 */}
          <Form.Item label="商品属性">
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

          {/* 语义标签（AI 搜索优化） */}
          <Form.Item style={{ marginBottom: 0 }}>
            <Collapse
              ghost
              defaultActiveKey={[]}
              items={[
                {
                  key: 'semantic',
                  label: <Text strong>语义标签（AI 搜索优化）</Text>,
                  children: (
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
                      <Form.Item name="originRegion" label="产地">
                        <Input placeholder="如：山东青岛、云南" />
                      </Form.Item>
                    </>
                  ),
                },
              ]}
            />
          </Form.Item>
        </Form>
      </Card>

      {/* 3. 商品图片（可编辑） */}
      <Card title="商品图片" style={{ marginBottom: 16 }}>
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
      </Card>

      {/* 4. 规格定价（可编辑） */}
      <Card title="规格定价" style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          售价由平台按成本 × 加价率（{markupRate}）自动计算。
        </Text>
        <Form form={skuForm} layout="vertical">
          <Form.List name="skus">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item {...field} name={[field.name, 'id']} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'specName']} rules={[{ required: true, message: '请输入规格名称' }]}>
                      <Input placeholder="规格名称（如：5斤装）" style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, 'cost']}
                      rules={[
                        { required: true, message: '请输入成本' },
                        { type: 'number', min: 0.01, message: '成本必须大于 0' },
                      ]}
                    >
                      <InputNumber placeholder="成本价（元）" min={0.01} precision={2} style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item shouldUpdate noStyle>
                      {({ getFieldValue }) => {
                        const cost = getFieldValue(['skus', field.name, 'cost']);
                        const computed = cost ? (Number(cost) * markupRate).toFixed(2) : '--';
                        return (
                          <Form.Item>
                            <Text type="secondary" style={{ lineHeight: '32px', width: 130, display: 'inline-block' }}>
                              售价: {computed !== '--' ? `${computed} 元` : '--'}（自动）
                            </Text>
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, 'stock']}
                      rules={[
                        { required: true, message: '请输入库存' },
                        { type: 'number', min: 0, message: '库存不能为负数' },
                      ]}
                    >
                      <InputNumber placeholder="库存数量" min={0} precision={0} style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'weightGram']}>
                      <InputNumber placeholder="重量（克）" min={0} style={{ width: 100 }} />
                    </Form.Item>
                    {fields.length > 1 && (
                      <MinusCircleOutlined style={{ marginTop: 8, color: '#999' }} onClick={() => remove(field.name)} />
                    )}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                  添加更多规格
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Card>
    </div>
  );
}

// ============================================================
// 创建模式：保持多步骤向导
// ============================================================

// SKU 预览列定义（确认步骤使用）
interface SkuPreviewRow {
  key: number;
  specName: string;
  cost: number;
  price: string;
  stock: number;
  weightGram?: number;
}

function ProductCreateForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const token = useAuthStore((s) => s.token);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const formMapRef = useRef<React.MutableRefObject<FormInstance | undefined>[]>([]);
  const [confirmData, setConfirmData] = useState<Record<string, unknown>>({});

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  });
  const treeData = useMemo(() => buildCategoryTree(categories || []), [categories]);

  const { data: configData } = useQuery({
    queryKey: ['seller-markup-rate'],
    queryFn: getMarkupRate,
  });
  const markupRate = configData?.markupRate ?? 1.3;

  const collectAllValues = useCallback(() => {
    const forms = formMapRef.current;
    const step1 = forms[0]?.current?.getFieldsValue() ?? {};
    const step3 = forms[2]?.current?.getFieldsValue() ?? {};
    return { ...step1, ...step3 };
  }, []);

  const handleConfirmStepEnter = useCallback(() => {
    const all = collectAllValues();
    setConfirmData(all);
  }, [collectAllValues]);

  const handleFinish = async (values: Record<string, unknown>) => {
    setLoading(true);
    try {
      const allValues = { ...collectAllValues(), ...values };

      const tags = typeof allValues.tags === 'string'
        ? (allValues.tags as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      const aiKeywords = typeof allValues.aiKeywords === 'string'
        ? (allValues.aiKeywords as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      const attrPairs = allValues.attributes as Array<{ key: string; value: string }> | undefined;
      const attributes = attrPairs && attrPairs.length > 0
        ? Object.fromEntries(attrPairs.filter((p) => p.key).map((p) => [p.key, p.value]))
        : undefined;

      const mediaUrls = fileList
        .filter((f) => f.status === 'done')
        .map((f) => {
          const response = f.response as { url?: string; data?: { url?: string } } | undefined;
          return f.url || response?.data?.url || response?.url;
        })
        .filter(Boolean) as string[];

      const skuList = allValues.skus as Array<Record<string, unknown>>;
      const basePrice = Math.min(...skuList.map((s) => Number(s.cost) * markupRate));

      const data = {
        title: allValues.title,
        subtitle: allValues.subtitle,
        description: allValues.description,
        basePrice,
        categoryId: allValues.categoryId,
        origin: allValues.origin ? { text: allValues.origin } : undefined,
        tags,
        aiKeywords,
        attributes,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        // 语义标签字段
        flavorTags: (allValues.flavorTags as string[] | undefined) || undefined,
        seasonalMonths: (allValues.seasonalMonths as number[] | undefined) || undefined,
        usageScenarios: (allValues.usageScenarios as string[] | undefined) || undefined,
        dietaryTags: (allValues.dietaryTags as string[] | undefined) || undefined,
        originRegion: (allValues.originRegion as string | undefined) || undefined,
        skus: skuList.map((s) => ({
          specName: s.specName as string,
          cost: Number(s.cost),
          stock: Number(s.stock),
          weightGram: s.weightGram === undefined || s.weightGram === null ? undefined : Number(s.weightGram),
        })),
      };

      await createProduct(data);
      message.success('商品已创建，等待管理员审核');
      navigate('/products');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const skuColumns = [
    { title: '规格名称', dataIndex: 'specName', key: 'specName' },
    {
      title: '成本价',
      dataIndex: 'cost',
      key: 'cost',
      render: (v: number) => v != null ? `${Number(v).toFixed(2)} 元` : '--',
    },
    { title: '售价（自动）', dataIndex: 'price', key: 'price' },
    {
      title: '库存',
      dataIndex: 'stock',
      key: 'stock',
      render: (v: number) => v ?? '--',
    },
    {
      title: '重量（克）',
      dataIndex: 'weightGram',
      key: 'weightGram',
      render: (v: number | undefined) => v != null ? v : '--',
    },
  ];

  const skuPreviewData: SkuPreviewRow[] = useMemo(() => {
    const skus = confirmData.skus as Array<Record<string, unknown>> | undefined;
    if (!skus) return [];
    return skus.map((s, i) => ({
      key: i,
      specName: (s.specName as string) || '--',
      cost: Number(s.cost) || 0,
      price: s.cost ? `${(Number(s.cost) * markupRate).toFixed(2)} 元` : '--',
      stock: Number(s.stock) || 0,
      weightGram: s.weightGram != null ? Number(s.weightGram) : undefined,
    }));
  }, [confirmData.skus, markupRate]);

  return (
    <Card
      title={
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')} />
          创建商品
        </Space>
      }
    >
      <div style={{ maxWidth: '75vw', margin: '0 auto' }}>
        <StepsForm
          formMapRef={formMapRef}
          onFinish={handleFinish}
          submitter={{
            render: (props, dom) => {
              if (props.step === 3) {
                return (
                  <Space>
                    <Button onClick={() => props.onPre?.()}>上一步</Button>
                    <Button onClick={() => navigate('/products')}>取消</Button>
                    <Button type="primary" loading={loading} onClick={() => props.form?.submit?.()}>
                      提交审核
                    </Button>
                  </Space>
                );
              }
              return (
                <Space>
                  {dom}
                  {props.step === 0 && (
                    <Button onClick={() => navigate('/products')}>取消</Button>
                  )}
                </Space>
              );
            },
          }}
          stepsProps={{ direction: 'horizontal' }}
        >
          {/* 步骤 1：基本信息 */}
          <StepsForm.StepForm
            name="basicInfo"
            title="基本信息"
            stepProps={{ description: '填写商品基本信息' }}
            layout="vertical"
          >
            <ProFormText
              name="title"
              label="商品标题"
              rules={[{ required: true, message: '请输入商品标题' }]}
              placeholder="请输入商品标题"
            />
            <ProFormText name="subtitle" label="副标题" placeholder="可选" />

            <Form.Item
              name="categoryId"
              label="商品分类"
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
              />
            </Form.Item>

            <ProFormTextArea
              name="description"
              label="详情描述"
              rules={[
                { required: true, message: '请填写商品详情描述' },
                { min: 20, message: '描述至少 20 字，让 AI 能更好地帮买家找到您的商品' },
              ]}
              placeholder="请详细描述商品特点、产地、种植方式、口感等信息。AI 语音助手会根据描述帮助买家找到您的商品"
              fieldProps={{ rows: 5 }}
            />

            <ProFormText
              name="origin"
              label="产地"
              rules={[{ required: true, message: '请填写产地信息' }]}
              placeholder="如：黑龙江五常、山东烟台、云南昆明"
            />

            <ProFormText
              name="tags"
              label="标签"
              placeholder="多个标签用逗号分隔，如：有机,新米,东北"
            />

            <ProFormText
              name="aiKeywords"
              label="AI 搜索关键词"
              placeholder="逗号分隔，如：五常大米,稻花香,东北粳米,有机种植"
              tooltip="买家用语音搜索时，AI 会匹配这些关键词帮助找到您的商品"
            />

            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              商品属性：帮助 AI 精准匹配买家需求（如"我要3斤装的有机大米"）
            </Text>
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
                  <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} style={{ marginBottom: 16 }}>
                    添加属性（如规格、种植方式、保质期等）
                  </Button>
                </>
              )}
            </Form.List>

            {/* 语义标签（AI 搜索优化） */}
            <Form.Item style={{ marginBottom: 0 }}>
              <Collapse
                ghost
                defaultActiveKey={[]}
                items={[
                  {
                    key: 'semantic',
                    label: <Text strong>语义标签（AI 搜索优化）</Text>,
                    children: (
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
                        <Form.Item name="originRegion" label="产地">
                          <Input placeholder="如：山东青岛、云南" />
                        </Form.Item>
                      </>
                    ),
                  },
                ]}
              />
            </Form.Item>
          </StepsForm.StepForm>

          {/* 步骤 2：商品图片 */}
          <StepsForm.StepForm
            name="productImages"
            title="商品图片"
            stepProps={{ description: '上传商品展示图片' }}
            layout="vertical"
          >
            <Form.Item label="商品图片（最多 9 张）">
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
                <p className="ant-upload-hint">支持 JPG / PNG / WebP，单张最大 10MB</p>
              </Dragger>
            </Form.Item>
          </StepsForm.StepForm>

          {/* 步骤 3：规格定价 */}
          <StepsForm.StepForm
            name="skuPricing"
            title="规格定价"
            stepProps={{ description: '设置规格和定价' }}
            layout="vertical"
          >
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              每个商品至少填写一个规格。如果商品只有一种规格，填写"默认"或"标准装"即可。
              <br />
              售价由平台按成本 x 加价率自动计算。
            </Text>

            <Form.List name="skus" initialValue={[{ specName: '', stock: 0 }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item {...field} name={[field.name, 'specName']} rules={[{ required: true, message: '请输入规格名称' }]}>
                        <Input placeholder="规格名称（如：5斤装）" style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'cost']}
                        rules={[
                          { required: true, message: '请输入成本' },
                          { type: 'number', min: 0.01, message: '成本必须大于 0' },
                        ]}
                      >
                        <InputNumber placeholder="成本价（元）" min={0.01} precision={2} style={{ width: 110 }} />
                      </Form.Item>
                      <Form.Item shouldUpdate noStyle>
                        {({ getFieldValue }) => {
                          const cost = getFieldValue(['skus', field.name, 'cost']);
                          const computed = cost ? (Number(cost) * markupRate).toFixed(2) : '--';
                          return (
                            <Form.Item>
                              <Text type="secondary" style={{ lineHeight: '32px', width: 130, display: 'inline-block' }}>
                                售价: {computed !== '--' ? `${computed} 元` : '--'}（自动）
                              </Text>
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'stock']}
                        rules={[
                          { required: true, message: '请输入库存' },
                          { type: 'number', min: 0, message: '库存不能为负数' },
                        ]}
                      >
                        <InputNumber placeholder="库存数量" min={0} precision={0} style={{ width: 100 }} />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'weightGram']}>
                        <InputNumber placeholder="重量（克）" min={0} style={{ width: 100 }} />
                      </Form.Item>
                      {fields.length > 1 && (
                        <MinusCircleOutlined style={{ marginTop: 8, color: '#999' }} onClick={() => remove(field.name)} />
                      )}
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    添加更多规格（如不同重量、包装）
                  </Button>
                </>
              )}
            </Form.List>
          </StepsForm.StepForm>

          {/* 步骤 4：确认提交 */}
          <StepsForm.StepForm
            name="confirmSubmit"
            title="确认提交"
            stepProps={{ description: '确认信息并提交' }}
            layout="vertical"
            onFinish={async () => {
              await handleFinish(collectAllValues());
              return false;
            }}
          >
            <ConfirmStepContent
              confirmData={confirmData}
              treeData={treeData}
              fileList={fileList}
              skuPreviewData={skuPreviewData}
              skuColumns={skuColumns}
              onRefresh={handleConfirmStepEnter}
            />
          </StepsForm.StepForm>
        </StepsForm>
      </div>
    </Card>
  );
}

// 确认步骤的内容组件
function ConfirmStepContent({
  confirmData,
  treeData,
  fileList,
  skuPreviewData,
  skuColumns,
  onRefresh,
}: {
  confirmData: Record<string, unknown>;
  treeData: TreeNode[];
  fileList: UploadFile[];
  skuPreviewData: SkuPreviewRow[];
  skuColumns: Array<Record<string, unknown>>;
  onRefresh: () => void;
}) {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  const description = confirmData.description as string | undefined;
  const descPreview = description
    ? (description.length > 100 ? description.slice(0, 100) + '...' : description)
    : '--';

  const doneImages = fileList.filter((f) => f.status === 'done');

  return (
    <>
      <Descriptions
        title="商品基本信息"
        bordered
        column={1}
        size="small"
        style={{ marginBottom: 24 }}
      >
        <Descriptions.Item label="商品标题">
          {(confirmData.title as string) || '--'}
        </Descriptions.Item>
        <Descriptions.Item label="副标题">
          {(confirmData.subtitle as string) || '--'}
        </Descriptions.Item>
        <Descriptions.Item label="商品分类">
          {confirmData.categoryId
            ? findCategoryPath(treeData, confirmData.categoryId as string) || '--'
            : '--'}
        </Descriptions.Item>
        <Descriptions.Item label="详情描述">
          {descPreview}
        </Descriptions.Item>
        <Descriptions.Item label="产地">
          {(confirmData.origin as string) || '--'}
        </Descriptions.Item>
        <Descriptions.Item label="标签">
          {(confirmData.tags as string) || '--'}
        </Descriptions.Item>
        <Descriptions.Item label="AI 搜索关键词">
          {(confirmData.aiKeywords as string) || '--'}
        </Descriptions.Item>
        <Descriptions.Item label="商品图片">
          {doneImages.length > 0 ? `${doneImages.length} 张` : '未上传'}
        </Descriptions.Item>
      </Descriptions>

      <Text strong style={{ display: 'block', marginBottom: 12 }}>规格与定价</Text>
      <Table
        dataSource={skuPreviewData}
        columns={skuColumns}
        pagination={false}
        size="small"
        bordered
      />
    </>
  );
}
