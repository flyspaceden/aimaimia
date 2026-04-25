import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  App, Card, Button, Space, InputNumber, Input, Form,
  TreeSelect, Upload, Typography, Descriptions, Tag, Spin,
  Breadcrumb, Select, Collapse, Switch, Row, Col,
  Modal, Image,
} from 'antd';
import {
  MinusCircleOutlined, PlusOutlined, ArrowLeftOutlined,
  SaveOutlined, CloudUploadOutlined, DownloadOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import {
  getProduct,
  createProduct,
  updateProduct,
  updateProductSkus,
  getCategories,
  createDraft,
  updateDraft,
  submitDraft,
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

// 轻量 debounce（避免引入 lodash 类型依赖）
function makeDebounce<Args extends unknown[]>(fn: (...args: Args) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

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
    </>
  );
}

function AiSearchOptimizationContent() {
  return (
    <>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        只填写买家真实会说出来的搜索表达。标题写正式商品名，这里补充别名、俗称、常见说法和适用场景即可。
      </Text>
      <Form.Item
        label="别名 / 俗称 / 常见搜索词"
        name="aiKeywords"
        tooltip="用于补充买家常说的叫法、地方叫法、同义词。不要重复填写标题原词。"
      >
        <Input placeholder="逗号分隔，如：毛尖,绿茶,春茶" />
      </Form.Item>
      <SemanticTagFields />
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
                    <InputNumber placeholder="重量" min={0} style={{ width: '100%' }} addonAfter="克" />
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
// 自定义 onPreview：antd Upload 默认是 window.open(file.url) 直接跳新标签，
// 但 OSS / 上传服务的 URL 可能受 referer / 鉴权限制导致新标签瞬关；
// 改为弹 Modal + antd <Image>（带缩放/旋转/全屏交互）。
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
  const { message } = App.useApp();
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handlePreview = (file: UploadFile) => {
    const response = file.response as { url?: string; data?: { url?: string } } | undefined;
    const url = file.url
      || file.thumbUrl
      || response?.data?.url
      || response?.url;
    if (!url) return;
    setPreviewFile({ url, name: file.name || '商品图片' });
  };

  // 触发 anchor 下载（浏览器看到 Content-Disposition: attachment 会原生保存）
  const triggerAnchorDownload = (href: string, filename: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const deriveFilename = (preferredName: string, keyOrUrl: string) => {
    if (preferredName.includes('.')) return preferredName;
    const ext = keyOrUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[0] || '.jpg';
    return preferredName + ext;
  };

  const handleDownload = () => {
    if (!previewFile) return;
    setDownloading(true);
    try {
      const url = previewFile.url;

      // 私有签名 URL 模式：/api/v1/upload/private/<key>?expires=&sig=
      // 直接复用原 URL，加 &download=1 让后端切换到 attachment 响应头
      const privateMatch = url.match(/\/upload\/private\/(.+?)(?:\?|$)/);
      if (privateMatch) {
        const key = decodeURIComponent(privateMatch[1]);
        const filename = deriveFilename(previewFile.name, key);
        const sep = url.includes('?') ? '&' : '?';
        triggerAnchorDownload(
          `${url}${sep}download=1&filename=${encodeURIComponent(filename)}`,
          filename,
        );
        return;
      }

      // 公开 URL 模式：/uploads/<key>
      // 走后端 /api/v1/upload/download proxy 端点，带 attachment 头
      const publicMatch = url.match(/\/uploads\/(.+?)(?:\?|$)/);
      if (publicMatch) {
        const key = decodeURIComponent(publicMatch[1]);
        const filename = deriveFilename(previewFile.name, key);
        triggerAnchorDownload(
          `${API_BASE}/upload/download?key=${encodeURIComponent(key)}&filename=${encodeURIComponent(filename)}`,
          filename,
        );
        return;
      }

      // 非本地资源（外链 / OSS）：回退到打开 URL 让用户右键另存
      throw new Error('NON_LOCAL_UPLOAD');
    } catch (err) {
      message.warning('自动下载失败，已为你打开图片地址，可右键另存为');
      window.open(previewFile.url, '_blank', 'noopener');
      // eslint-disable-next-line no-console
      console.error('图片下载失败', err);
    } finally {
      // 浏览器接管下载流程，无需等待回调
      setTimeout(() => setDownloading(false), 500);
    }
  };

  return (
    <>
      <Upload
        name="file"
        action={`${API_BASE}/upload?folder=products`}
        headers={{ Authorization: `Bearer ${token || ''}` }}
        listType="picture-card"
        fileList={fileList}
        onChange={({ fileList: newList }) => setFileList(newList)}
        onPreview={handlePreview}
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

      <Modal
        title={previewFile ? `预览：${previewFile.name}` : '预览'}
        open={!!previewFile}
        onCancel={() => setPreviewFile(null)}
        footer={null}
        width={900}
        destroyOnClose
      >
        {previewFile && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloading}
                onClick={handleDownload}
              >
                下载到本地
              </Button>
            </div>
            <div style={{ textAlign: 'center', background: '#fafafa', borderRadius: 4, minHeight: 400, padding: 16 }}>
              <Image
                src={previewFile.url}
                alt={previewFile.name}
                style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
              />
            </div>
          </>
        )}
      </Modal>
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
      <Form.Item
        label="运营标签（选填）"
        name="tagIds"
        tooltip="用于后台运营和展示管理，不是 AI 搜索主字段。"
      >
        <Select
          mode="multiple"
          placeholder="请选择运营标签"
          options={productTagOptions}
          showSearch
          optionFilterProp="label"
        />
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
      <Text type="secondary">
        高级设置主要用于后台管理和补充展示信息，AI 搜索主字段请在上方“AI 搜索优化”里填写。
      </Text>
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
    returnPolicy: values.returnPolicy || 'INHERIT',
    origin: values.originText ? { text: values.originText } : undefined,
    tagIds,
    aiKeywords,
    attributes,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    flavorTags: (values.flavorTags as string[] | undefined) || undefined,
    seasonalMonths: (values.seasonalMonths as number[] | undefined) || undefined,
    usageScenarios: (values.usageScenarios as string[] | undefined) || undefined,
    dietaryTags: (values.dietaryTags as string[] | undefined) || undefined,
    originRegion: (values.originText as string | undefined) || undefined,
    skus,
  };
}

// ============================================================
// 入口：根据有无 ID 分发到 编辑 / 创建 组件
// DRAFT 商品转发到创建页（双按钮 + 自动保存 UI）
// ============================================================
export default function ProductEditPage() {
  const { id } = useParams<{ id: string }>();

  if (id) {
    return <ProductEditForm id={id} />;
  }
  return <ProductCreateForm />;
}

// ============================================================
// 编辑模式：卡片式直接编辑
// ============================================================
function ProductEditForm({ id }: { id: string }) {
  const { message } = App.useApp();
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
      : ((product as unknown as Record<string, unknown>).originRegion as string | undefined) || '';

    const attrPairs = product.attributes && typeof product.attributes === 'object'
      ? Object.entries(product.attributes as Record<string, string>)
          .filter(([key]) => key !== 'semanticMeta')
          .map(([key, value]) => ({ key, value }))
      : [];

    // 单规格时，将第一个 SKU 的数据直接放到主表单
    const firstSku = product.skus?.[0];

    form.setFieldsValue({
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      categoryId: product.categoryId,
      returnPolicy: (product as any).returnPolicy || 'INHERIT',
      originText,
      tagIds: product.tags?.map((t: any) => t.tag?.id || t.tagId) || [],
      aiKeywords: (product.aiKeywords || []).join(','),
      attributes: attrPairs.length > 0 ? attrPairs : [],
      // 单规格字段
      ...(!isMulti && firstSku ? {
        singleCost: firstSku.cost,
        singleStock: firstSku.stock,
        singleWeightGram: firstSku.weightGram,
        singleMaxPerOrder: firstSku.maxPerOrder ?? undefined,
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
          maxPerOrder: values.singleMaxPerOrder,
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

  // 草稿商品复用创建页 UI（双按钮 + 自动保存）
  if (product.status === 'DRAFT') {
    return <ProductCreateForm draftInitialId={product.id} />;
  }

  const status = productStatusMap[product.status];
  const auditStatus = auditStatusMap[product.auditStatus];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* 页头 */}
      <div
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 10,
          background: '#f5f5f5',
          padding: '12px 0',
          marginBottom: 4,
        }}
      >
        <Breadcrumb
          style={{ marginBottom: 8 }}
          items={[
            { title: <a onClick={() => navigate('/')}>首页</a> },
            { title: <a onClick={() => navigate('/products')}>商品管理</a> },
            { title: '编辑商品' },
          ]}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>
            返回列表
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} size="large">
            保存
          </Button>
        </div>
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
              {(product.submissionCount ?? 1) > 1 && (
                <Tag color="orange" style={{ marginLeft: 4 }}>
                  第 {product.submissionCount} 次提交
                </Tag>
              )}
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
          <Form.Item label="退货政策" name="returnPolicy" initialValue="INHERIT">
            <Select style={{ width: 300 }} options={[
              { label: '默认（跟随分类设置）', value: 'INHERIT' },
              { label: '7天无理由退换', value: 'RETURNABLE' },
              { label: '仅质量问题可退', value: 'NON_RETURNABLE' },
            ]} />
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
          <Form.Item
            label="产地 / 产区"
            name="originText"
            rules={[{ required: true, message: '请输入产地 / 产区' }]}
          >
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
                    const maxPerOrder = form.getFieldValue('singleMaxPerOrder');
                    if (cost || stock) {
                      form.setFieldsValue({
                        skus: [{ specName: '默认规格', cost, stock, weightGram, maxPerOrder }],
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
                        singleMaxPerOrder: first.maxPerOrder,
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
                  <InputNumber placeholder="重量" min={0} style={{ width: '100%' }} addonAfter="克" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item label="单笔限购" name="singleMaxPerOrder" rules={[{ type: 'number', min: 1, message: '最少为1' }]}>
                  <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            /* 多规格模式 */
            <MultiSpecRows markupRate={markupRate} />
          )}
        </Card>

        <Card title="AI 搜索优化" style={{ marginBottom: 16 }}>
          <AiSearchOptimizationContent />
        </Card>

        {/* 5. 更多设置 */}
        <Card style={{ marginBottom: 16 }}>
          <Collapse
            ghost
            defaultActiveKey={[]}
            items={[
              {
                key: 'advanced',
                label: <Text strong>高级设置</Text>,
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
// 创建模式：单页表单 + 草稿持久化
// draftInitialId 存在时视为"继续编辑草稿"
// ============================================================
function ProductCreateForm({ draftInitialId }: { draftInitialId?: string } = {}) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const token = useAuthStore((s) => s.token);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [multiSpec, setMultiSpec] = useState(false);

  // 草稿状态
  const [draftId, setDraftId] = useState<string | null>(draftInitialId ?? null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [draftLimitReached, setDraftLimitReached] = useState(false);
  // 自上次保存后是否有改动；驱动未保存提醒。
  // 不用 form.isFieldsTouched() 因为它只增不减，保存成功后无法复位。
  const [dirtySinceSave, setDirtySinceSave] = useState(false);
  // 防止表单从草稿填入时触发自动保存 / dirty 标记
  const hydratingRef = useRef(false);

  // 监听表单变化以驱动自动保存
  const watchedValues = Form.useWatch([], form);
  useUnsavedChanges(dirtySinceSave);

  // 包装 setFileList：图片增删也要标 dirty（fileList 不在 Form 内，onValuesChange 收不到）
  const updateFileList = useCallback((newList: UploadFile[]) => {
    setFileList(newList);
    if (!hydratingRef.current) setDirtySinceSave(true);
  }, []);

  // 加载草稿（若有 draftInitialId）
  const { data: draftProduct } = useQuery({
    queryKey: ['seller-product', draftInitialId],
    queryFn: () => getProduct(draftInitialId!),
    enabled: !!draftInitialId,
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

  // 草稿加载后回填表单（仅执行一次）
  useEffect(() => {
    if (!draftProduct) return;
    hydratingRef.current = true;

    const isMulti = (draftProduct.skus?.length ?? 0) > 1;
    setMultiSpec(isMulti);

    const originText = typeof draftProduct.origin === 'object' && draftProduct.origin
      ? (draftProduct.origin as Record<string, string>).text || ''
      : ((draftProduct as unknown as Record<string, unknown>).originRegion as string | undefined) || '';

    const attrPairs = draftProduct.attributes && typeof draftProduct.attributes === 'object'
      ? Object.entries(draftProduct.attributes as Record<string, string>)
          .filter(([key]) => key !== 'semanticMeta')
          .map(([key, value]) => ({ key, value }))
      : [];

    const firstSku = draftProduct.skus?.[0];

    form.setFieldsValue({
      title: draftProduct.title,
      subtitle: draftProduct.subtitle,
      description: draftProduct.description,
      categoryId: draftProduct.categoryId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      returnPolicy: (draftProduct as any).returnPolicy || 'INHERIT',
      originText,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tagIds: draftProduct.tags?.map((t: any) => t.tag?.id || t.tagId) || [],
      aiKeywords: (draftProduct.aiKeywords || []).join(','),
      attributes: attrPairs.length > 0 ? attrPairs : [],
      ...(!isMulti && firstSku ? {
        singleCost: firstSku.cost || undefined,
        singleStock: firstSku.stock,
        singleWeightGram: firstSku.weightGram,
        singleMaxPerOrder: firstSku.maxPerOrder ?? undefined,
      } : {}),
      ...(isMulti ? {
        skus: draftProduct.skus.map((s) => ({
          id: s.id,
          specName: s.title,
          cost: s.cost,
          stock: s.stock,
          weightGram: s.weightGram,
          maxPerOrder: s.maxPerOrder,
        })),
      } : {}),
      flavorTags: (draftProduct as unknown as Record<string, unknown>).flavorTags,
      seasonalMonths: (draftProduct as unknown as Record<string, unknown>).seasonalMonths,
      usageScenarios: (draftProduct as unknown as Record<string, unknown>).usageScenarios,
      dietaryTags: (draftProduct as unknown as Record<string, unknown>).dietaryTags,
    });

    if (draftProduct.media?.length > 0) {
      setFileList(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        draftProduct.media.map((m: any, i: number) => ({
          uid: m.id || `-${i}`,
          name: `图片${i + 1}`,
          status: 'done' as const,
          url: m.url,
        })),
      );
    }

    // 记录上次保存时间为草稿的 updatedAt
    if (draftProduct.updatedAt) {
      setLastSavedAt(new Date(draftProduct.updatedAt));
    }

    // 水合结束后下一个 tick 重置标志，避免阻断后续用户交互
    setTimeout(() => { hydratingRef.current = false; }, 0);
  }, [draftProduct, form]);

  // 构造草稿 payload（全量覆盖：表单当前状态 = 库里下次状态）
  // 数组始终发（空数组也发，让后端清空对应表）；字符串清空发空串；对象 / json 字段清空发 null。
  const numOrUndef = (v: unknown): number | undefined =>
    v !== undefined && v !== null && v !== '' ? Number(v) : undefined;

  const buildDraftPayload = useCallback((): Record<string, unknown> & { title?: string } => {
    const values = form.getFieldsValue();

    // SKU：保留 form 里的全部行（含只填了规格名的、空行），后端 DraftSkuDto 全字段可选
    let skuList: Array<Record<string, unknown>> = [];
    if (multiSpec) {
      skuList = (values.skus as Array<Record<string, unknown>>) || [];
    } else {
      const { singleCost, singleStock, singleWeightGram, singleMaxPerOrder } = values;
      const hasAnySingle =
        singleCost !== undefined && singleCost !== null && singleCost !== ''
        || singleStock !== undefined && singleStock !== null && singleStock !== ''
        || singleWeightGram !== undefined && singleWeightGram !== null && singleWeightGram !== ''
        || singleMaxPerOrder !== undefined && singleMaxPerOrder !== null && singleMaxPerOrder !== '';
      if (hasAnySingle) {
        skuList = [{
          specName: '默认规格',
          cost: singleCost,
          stock: singleStock,
          weightGram: singleWeightGram,
          maxPerOrder: singleMaxPerOrder,
        }];
      }
    }
    const skus = skuList.map((s) => ({
      id: (s.id as string | undefined) || undefined,
      specName: (s.specName as string | undefined) || undefined,
      cost: numOrUndef(s.cost),
      stock: numOrUndef(s.stock),
      weightGram: numOrUndef(s.weightGram),
      maxPerOrder: numOrUndef(s.maxPerOrder),
    }));

    // 自定义属性：始终发对象（清空发 {}）
    const attrPairs = (values.attributes as Array<{ key: string; value: string }> | undefined) || [];
    const attributes = Object.fromEntries(
      attrPairs.filter((p) => p.key).map((p) => [p.key, p.value]),
    );

    // 媒体：始终发数组（清空发 []）
    const mediaUrls = fileList
      .filter((f) => f.status === 'done')
      .map((f) => {
        const response = f.response as { url?: string; data?: { url?: string } } | undefined;
        return f.url || response?.data?.url || response?.url;
      })
      .filter(Boolean) as string[];

    const aiKeywords = typeof values.aiKeywords === 'string'
      ? values.aiKeywords.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];

    const originText = (values.originText as string | undefined) ?? '';

    return {
      title: (values.title as string | undefined) || undefined,
      subtitle: (values.subtitle as string | undefined) ?? '',
      description: (values.description as string | undefined) ?? '',
      categoryId: (values.categoryId as string | undefined) || null,
      returnPolicy: (values.returnPolicy as string | undefined) || 'INHERIT',
      // origin 是 Json? 字段：清空时发 null（后端 update 显式置 null）
      origin: originText ? { text: originText } : null,
      tagIds: (values.tagIds as string[] | undefined) ?? [],
      aiKeywords,
      attributes,
      mediaUrls,
      flavorTags: (values.flavorTags as string[] | undefined) ?? [],
      seasonalMonths: (values.seasonalMonths as number[] | undefined) ?? [],
      usageScenarios: (values.usageScenarios as string[] | undefined) ?? [],
      dietaryTags: (values.dietaryTags as string[] | undefined) ?? [],
      originRegion: originText || null,
      skus,
    };
  }, [form, fileList, multiSpec]);

  const handleSaveDraft = useCallback(async (silent = false) => {
    if (draftLimitReached && !draftId) {
      if (!silent) message.error('草稿数量已达上限（5 份），请先删除不再需要的草稿');
      return;
    }
    const payload = buildDraftPayload();
    if (!payload.title) {
      if (!silent) message.warning('请先填写商品标题，才能保存草稿');
      return;
    }
    setDraftSaving(true);
    try {
      if (draftId) {
        await updateDraft(draftId, payload);
      } else {
        const created = await createDraft(payload as Record<string, unknown> & { title: string });
        setDraftId(created.id);
        // 用 React Router navigate 替代 history.replaceState：直接 replaceState 只改地址栏，
        // React Router 内部 location 不同步，SellerLayout 的 useLocation() 拿到的还是
        // /products/create，导致菜单高亮等行为偏离。先把 product 数据预热到 React Query
        // cache，使 navigate 触发的 unmount/mount 后，新的 ProductCreateForm（由 ProductEditForm
        // 检测 DRAFT 状态后转发而来）能立即从 cache 命中，水合 form values（来自 createDraft 的
        // 响应即保存时的快照），用户感知一致。仅 fileList 中 status='uploading' 的项会丢失，
        // 边界情况，用户可重传。
        queryClient.setQueryData(['seller-product', created.id], created);
        navigate(`/products/${created.id}/edit`, { replace: true });
      }
      setLastSavedAt(new Date());
      // 保存成功后清 dirty，避免离开页面仍弹未保存提醒
      setDirtySinceSave(false);
      if (!silent) message.success('草稿已保存');
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      const status = e?.response?.status ?? e?.status;
      const msg = e?.response?.data?.message || e?.message || '保存草稿失败';
      if (status === 409) {
        setDraftLimitReached(true);
        message.error(msg);
      } else if (!silent) {
        message.error(msg);
      } else {
        // eslint-disable-next-line no-console
        console.warn('自动保存草稿失败', err);
      }
    } finally {
      setDraftSaving(false);
    }
  }, [draftId, draftLimitReached, buildDraftPayload, message, navigate, queryClient]);

  // 30 秒 debounce 自动保存（表单 dirty 才触发）
  const debouncedAutoSave = useMemo(
    () => makeDebounce(() => handleSaveDraft(true), 30_000),
    [handleSaveDraft],
  );

  useEffect(() => {
    if (hydratingRef.current) return;
    if (!dirtySinceSave) return; // 已保存到最新状态就不再触发自动保存
    debouncedAutoSave();
    return () => debouncedAutoSave.cancel();
  }, [watchedValues, fileList, debouncedAutoSave, dirtySinceSave]);

  // 卸载时取消未执行的 debounce
  useEffect(() => () => { debouncedAutoSave.cancel(); }, [debouncedAutoSave]);

  // 把后端字段路径（如 "skus.0.specName" / "origin"）映射到前端 form name 路径
  const mapBackendFieldToForm = useCallback(
    (path: string): (string | number)[] | null => {
      // origin → 前端用 originText 单输入
      if (path === 'origin' || path.startsWith('origin.')) return ['originText'];
      // skus 整体错误（如最少 1 项）→ 单规格映射到 singleCost，多规格无单一字段
      if (path === 'skus') return multiSpec ? null : ['singleCost'];
      // skus.<idx>.<field>
      const m = /^skus\.(\d+)\.(\w+)$/.exec(path);
      if (m) {
        const idx = Number(m[1]);
        const field = m[2];
        if (multiSpec) return ['skus', idx, field];
        // 单规格模式：只有 idx=0 有意义
        if (idx === 0) {
          const map: Record<string, string> = {
            cost: 'singleCost',
            stock: 'singleStock',
            weightGram: 'singleWeightGram',
            maxPerOrder: 'singleMaxPerOrder',
          };
          return map[field] ? [map[field]] : null;
        }
        return null;
      }
      // 顶层简单字段同名直传
      const TOP_LEVEL = new Set(['title', 'subtitle', 'description', 'categoryId', 'returnPolicy']);
      if (TOP_LEVEL.has(path)) return [path];
      return null;
    },
    [multiSpec],
  );

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();

      if (draftId) {
        // 草稿分支：用 buildDraftPayload（全量覆盖语义），否则被清空的字段会被
        // buildPayload 压成 undefined，updateDraft 跳过更新，旧值留库被一起提交。
        await updateDraft(draftId, buildDraftPayload());
        await submitDraft(draftId);
      } else {
        // 全新商品创建：用 buildPayload（含自动定价 basePrice 计算）
        let skuList: Array<Record<string, unknown>>;
        if (multiSpec) {
          skuList = values.skus as Array<Record<string, unknown>>;
        } else {
          skuList = [{
            specName: '默认规格',
            cost: values.singleCost,
            stock: values.singleStock,
            weightGram: values.singleWeightGram,
            maxPerOrder: values.singleMaxPerOrder,
          }];
        }
        const payload = buildPayload(values, skuList, markupRate, fileList);
        await createProduct(payload);
      }
      // 提交成功 → 清 dirty 防止跳转时弹未保存提醒
      setDirtySinceSave(false);
      message.success('商品已提交，等待管理员审核');
      navigate('/products');
    } catch (err) {
      // 后端字段级错误：高亮表单 + 滚动到第一个错误
      if (err instanceof ApiError && err.fieldErrors && err.fieldErrors.length > 0) {
        const firstHighlightable: string | null = (() => {
          const fieldsToSet: Array<{ name: (string | number)[]; errors: string[] }> = [];
          let firstName: string | null = null;
          for (const fe of err.fieldErrors) {
            const name = mapBackendFieldToForm(fe.field);
            if (!name) continue;
            fieldsToSet.push({ name, errors: [fe.message] });
            if (!firstName) firstName = name.join('.');
          }
          if (fieldsToSet.length > 0) form.setFields(fieldsToSet);
          return firstName;
        })();
        message.error(err.message || '提交失败');
        if (firstHighlightable) {
          // antd Form.scrollToField 接收 namePath
          const namePath = firstHighlightable.split('.').map((s) => /^\d+$/.test(s) ? Number(s) : s);
          form.scrollToField(namePath, { behavior: 'smooth', block: 'center' });
        }
        return;
      }
      if (err instanceof Error) {
        message.error(err.message || '提交失败');
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
          top: 56,
          zIndex: 10,
          background: '#f5f5f5',
          padding: '12px 0',
          marginBottom: 4,
        }}
      >
        <Breadcrumb
          style={{ marginBottom: 8 }}
          items={[
            { title: <a onClick={() => navigate('/')}>首页</a> },
            { title: <a onClick={() => navigate('/products')}>商品管理</a> },
            { title: draftId ? '继续编辑草稿' : '创建商品' },
          ]}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>
            返回列表
          </Button>
          <Space>
            {lastSavedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                最后保存于 {dayjs(lastSavedAt).format('HH:mm:ss')}
              </Text>
            )}
            <Button
              icon={<CloudUploadOutlined />}
              onClick={() => handleSaveDraft(false)}
              loading={draftSaving}
              disabled={draftLimitReached && !draftId}
            >
              保存草稿
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSubmit} loading={loading} size="large">
              提交审核
            </Button>
          </Space>
        </div>
      </div>

      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => {
          if (!hydratingRef.current) setDirtySinceSave(true);
        }}
      >
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
          <Form.Item label="退货政策" name="returnPolicy" initialValue="INHERIT">
            <Select style={{ width: 300 }} options={[
              { label: '默认（跟随分类设置）', value: 'INHERIT' },
              { label: '7天无理由退换', value: 'RETURNABLE' },
              { label: '仅质量问题可退', value: 'NON_RETURNABLE' },
            ]} />
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
          <Form.Item
            label="产地 / 产区"
            name="originText"
            rules={[{ required: true, message: '请输入产地 / 产区' }]}
          >
            <Input placeholder="如：黑龙江五常、山东烟台、云南昆明" style={{ width: 300 }} />
          </Form.Item>
        </Card>

        {/* 2. 商品图片 */}
        <Card title="商品图片" style={{ marginBottom: 16 }}>
          <ImageUploadSection fileList={fileList} setFileList={updateFileList} token={token} />
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
                    const maxPerOrder = form.getFieldValue('singleMaxPerOrder');
                    form.setFieldsValue({
                      skus: [{ specName: '默认规格', cost, stock, weightGram, maxPerOrder }],
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
                        singleMaxPerOrder: first.maxPerOrder,
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
                  <InputNumber placeholder="重量" min={0} style={{ width: '100%' }} addonAfter="克" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item label="单笔限购" name="singleMaxPerOrder" rules={[{ type: 'number', min: 1, message: '最少为1' }]}>
                  <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            /* 多规格模式 */
            <MultiSpecRows markupRate={markupRate} />
          )}
        </Card>

        <Card title="AI 搜索优化" style={{ marginBottom: 16 }}>
          <AiSearchOptimizationContent />
        </Card>

        {/* 4. 更多设置 */}
        <Card style={{ marginBottom: 16 }}>
          <Collapse
            ghost
            defaultActiveKey={[]}
            items={[
              {
                key: 'advanced',
                label: <Text strong>高级设置</Text>,
                children: <AdvancedSettingsContent productTagOptions={productTagOptions} />,
              },
            ]}
          />
        </Card>
      </Form>
    </div>
  );
}
