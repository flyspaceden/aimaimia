import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  App, Card, Button, Space, InputNumber, Input, Form,
  TreeSelect, Upload, Typography, Descriptions, Tag, Spin, Alert,
  Breadcrumb, Select, Collapse, Switch, Row, Col, Checkbox,
  Modal, Image, Segmented, Table, Tooltip, Popover,
} from 'antd';
import type { FormInstance } from 'antd';
import {
  MinusCircleOutlined, PlusOutlined, ArrowLeftOutlined,
  SaveOutlined, CloudUploadOutlined, DownloadOutlined,
  DeleteOutlined, CopyOutlined, ArrowRightOutlined,
  CheckCircleOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import {
  getProduct,
  getProducts,
  createProduct,
  updateProduct,
  updateProductSkus,
  getCategories,
  createDraft,
  updateDraft,
  submitDraft,
  requestProductMediaRevision,
  type CategoryNode,
} from '@/api/products';
import { getMarkupRate, getPublicAppConfig } from '@/api/config';
import { getProductUnits } from '@/api/productUnits';
import { getTagCategories } from '@/api/tags';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { productStatusMap, auditStatusMap } from '@/constants/statusMaps';
import {
  buildBundleSkuOptionLabel,
  buildSkuMetaText,
  hasMeaningfulSingleSkuDraftInput,
  normalizeSkuTitle,
} from '@/utils/productSkuDisplay';
import { buildUploadDownloadRequest, triggerBrowserDownload } from '@/utils/uploadDownload';
import { prepareProductImageForUpload } from '@/utils/productImageUpload';
import { uploadProductImageAsset, type UploadedProductImageAsset } from '@/api/mediaAssets';
import {
  adoptProductImageOptimization,
  getProductImageOptimization,
  requestFreeTune,
  requestWhiteBackground,
  type ProductImageOptimizationTask,
} from '@/api/productImageOptimizations';
import {
  confirmProductVisualQuote,
  getProductVisualQuote,
  getProductImageFactScan,
  getProductVisualCreditAccount,
  ensureProductVisualTestAccess,
  issueProductVisualQuote,
  listProductVisualRateCards,
  pollProductVisualQuote,
  requestProductImageFactScan,
  requestProductVisualPlan,
  type ProductImageFactScan,
  type ProductVisualQuote,
  type ProductVisualQuoteStatus,
  type ProductVisualRateCard,
  type ProductVisualCreditAccount,
  type ProductVisualPlan,
  type ProductVisualMode,
} from '@/api/productImageVisualPlans';
import dayjs from 'dayjs';
import type { Product, ProductBundleItem, ProductType } from '@/types';
import { buildBundleCatalogQuery } from './bundleCatalog';

const { Text } = Typography;

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD = 10;
/** 新建商品时的默认计量单位 */
const DEFAULT_PRODUCT_UNIT = '斤';

function productFactScanFailure(error: unknown) {
  const raw = error instanceof Error ? error.message.trim() : '';
  const unavailable = (error instanceof ApiError && error.businessCode === 'PRODUCT_FACT_SCAN_OCR_DISABLED')
    || /(?:Qwen\s+OCR|OCR\s+Provider|OCR\s+disabled|文字识别服务.*未开启)/i.test(raw);
  if (unavailable) {
    return {
      unavailable: true,
      message: '商品文字识别服务暂未开启，当前不能进行免费实景调优。你仍可使用付费智能精修，或稍后再试。',
    };
  }
  return {
    unavailable: false,
    message: /[\u3400-\u9fff]/.test(raw) ? raw : '商品事实检查未能完成，请稍后重试',
  };
}

function visualPlanNeedsRefresh(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.includes('图片美化计划已过期')
    || error.message.includes('商品标题、分类或图片版本已变化');
}

function getManagedAsset(file: UploadFile): UploadedProductImageAsset | undefined {
  const response = file.response as UploadedProductImageAsset | undefined;
  return response?.asset?.id && response.displayUrl ? response : undefined;
}

function getFileUrl(file: UploadFile): string | undefined {
  const asset = getManagedAsset(file);
  const response = file.response as { url?: string; data?: { url?: string } } | undefined;
  return file.url || asset?.displayUrl || response?.data?.url || response?.url;
}

function buildMediaPayload(fileList: UploadFile[]) {
  const completed = fileList.filter((file) => file.status === 'done');
  const managedAssets = completed.map(getManagedAsset);
  if (completed.length > 0 && managedAssets.every(Boolean)) {
    return { mediaAssetIds: managedAssets.map((asset) => asset!.asset.id) };
  }
  if (managedAssets.some(Boolean)) {
    throw new Error('当前商品仍有历史图片。请将历史图片重新上传后，再与新图片一起保存，避免图片来源和排序丢失。');
  }
  return {};
}

function sameMediaAssetOrder(current: Array<{ assetId?: string | null }>, next: string[]): boolean {
  return current.length === next.length && current.every((media, index) => media.assetId === next[index]);
}

function omitMediaAssetIds<T extends { mediaAssetIds?: string[] }>(payload: T): Omit<T, 'mediaAssetIds'> {
  const copy = { ...payload };
  delete copy.mediaAssetIds;
  return copy;
}

const visualRiskLabels: Record<string, { label: string; color: string }> = {
  STRICT_FACTS: { label: '事实敏感', color: 'red' },
  CONSERVATIVE_FACTS: { label: '谨慎处理', color: 'orange' },
  STANDARD_FACTS: { label: '可评估优化', color: 'blue' },
  ORGANIC_FACTS: { label: '保留实景', color: 'green' },
  RETAKE_REQUIRED: { label: '建议重拍', color: 'volcano' },
  MARKETING_ONLY: { label: '仅营销图', color: 'purple' },
};

const visualModeLabels: Record<string, string> = {
  PRESERVE_REAL_SCENE: '保留真实场景',
  CATALOG_STUDIO: '商品棚拍风格',
  PRODUCT_RETOUCH: '受控细节修图',
  MARKETING_SCENE: '营销展示图',
};

function optimizationTitle(kind?: ProductImageOptimizationTask['kind'], candidateRole?: ProductImageOptimizationTask['candidateRole']) {
  if (candidateRole === 'MARKETING_IMAGE') return 'AI 营销场景候选（仅预览）';
  return kind === 'FREE_TUNE' ? '实景优化候选' : '真实白底候选';
}

function activePaidQuoteStorageKey(productId: string) {
  return `ai-visual-agent:active-quote:${productId}`;
}

type ProductImageUploadFeedback = {
  type: 'error' | 'info';
  message: string;
};

function paidExecutionPresentation(execution: ProductVisualQuoteStatus) {
  if (execution.status === 'REJECTED') return { type: 'error' as const, message: '候选未通过系统事实检查', description: '系统发现二维码、条码格式或构图存在明确不一致，候选已停止采用。' };
  if (execution.status === 'RELEASED') return { type: 'warning' as const, message: '模型未受理，本次冻结图片积分已释放', description: '你可以重新获取报价；系统不会为这次未受理任务扣除图片积分。' };
  if (execution.status === 'RECONCILING') return { type: 'info' as const, message: '模型结果或费用正在对账', description: '为避免重复扣费，系统不会重新提交同一个模型任务；平台完成对账后才能继续。' };
  if (execution.status === 'ALREADY_BOUND') return { type: 'info' as const, message: '任务已存在，正在恢复原任务状态', description: '系统不会重复冻结图片积分或重复提交模型。' };
  if (execution.status === 'PENDING_REVIEW') return { type: 'warning' as const, message: '旧候选仍在历史人工审核流程中', description: '此状态仅用于旧流程记录；新候选不会等待平台预审批。' };
  if (execution.status === 'SUCCEEDED') return { type: 'success' as const, message: '候选可采用；系统已保留验真摘要', description: '商家确认采用后会立即更新公开图片；未能完全自动验真的候选会进入平台事后巡检优先队列。' };
  return { type: 'info' as const, message: '模型任务处理中', description: '可以停留在本页等待；系统不会因为轮询或刷新重复扣费。' };
}

/**
 * 计量单位下拉选项。
 * 把启用字典里的单位转成 { label, value }（label=value=name）。
 * 若 currentUnit 不在启用列表里（例如管理员事后停用了该单位），仍把它兜底加进去，
 * 避免编辑/草稿水合时旧单位被静默清空。
 */
function buildUnitOptions(
  units: Array<{ name: string }> | undefined,
  currentUnit?: string,
): Array<{ label: string; value: string }> {
  const options = (units || []).map((u) => ({ label: u.name, value: u.name }));
  if (currentUnit && !options.some((o) => o.value === currentUnit)) {
    options.unshift({ label: currentUnit, value: currentUnit });
  }
  return options;
}
const DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE_PREFIX = '__DRAFT_WEIGHT_PLACEHOLDER__:';
const LEGACY_DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE = '__DRAFT_WEIGHT_PLACEHOLDER__';

function normalizeLowStockThreshold(value: unknown): number {
  const threshold = Number(value);
  return Number.isInteger(threshold) && threshold >= 0 && threshold <= 999
    ? threshold
    : DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD;
}

function getStockHint(stockValue: unknown, threshold: number): { type: 'danger' | 'warning'; text: string } | null {
  if (stockValue === undefined || stockValue === null || stockValue === '') return null;
  const stock = Number(stockValue);
  if (!Number.isFinite(stock)) return null;
  if (stock < 0) {
    return { type: 'danger', text: '当前为超卖欠货，请填写补货后的可售库存（不能保存负数）' };
  }
  if (stock === 0) {
    return { type: 'danger', text: '无库存，App 端不可购买/不可结算' };
  }
  if (threshold > 0 && stock <= threshold) {
    return { type: 'warning', text: `低库存：App 端显示仅剩 ${stock} 件` };
  }
  return null;
}

function StockHint({ value, threshold }: { value: unknown; threshold: number }) {
  const hint = getStockHint(value, threshold);
  if (!hint) return null;
  return (
    <Text type={hint.type} style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
      {hint.text}
    </Text>
  );
}

function isDraftWeightPlaceholderSkuCode(skuCode?: string | null) {
  return skuCode === LEGACY_DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE
    || skuCode?.startsWith(DRAFT_WEIGHT_PLACEHOLDER_SKU_CODE_PREFIX) === true;
}

function hydrateDraftWeightGram(sku: { skuCode?: string | null; weightGram?: number }) {
  return isDraftWeightPlaceholderSkuCode(sku.skuCode) ? undefined : sku.weightGram;
}

function productTypeOf(product?: Pick<Product, 'type'> | null): ProductType {
  return product?.type === 'BUNDLE' ? 'BUNDLE' : 'SIMPLE';
}

function normalizeBundleItems(items: ProductBundleItem[]): ProductBundleItem[] {
  const merged = new Map<string, ProductBundleItem>();
  for (const item of items) {
    if (!item.skuId) continue;
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const existing = merged.get(item.skuId);
    if (existing) {
      merged.set(item.skuId, {
        ...existing,
        ...item,
        quantity: existing.quantity + quantity,
      });
    } else {
      merged.set(item.skuId, { ...item, quantity });
    }
  }
  return Array.from(merged.values()).map((item, index) => ({
    ...item,
    sortOrder: index,
  }));
}

type BundleEditorItemSource = ProductBundleItem & {
  sku?: {
    id?: string;
    title?: string | null;
    price?: number | null;
    stock?: number | null;
    weightGram?: number | null;
    product?: {
      title?: string | null;
      unit?: string | null;
      imageUrl?: string | null;
      coverUrl?: string | null;
      media?: Array<{ url?: string | null }>;
    } | null;
  } | null;
};

function toBundleEditorItem(item: BundleEditorItemSource): ProductBundleItem {
  const sku = item.sku;
  const product = sku?.product;
  return {
    skuId: item.skuId || sku?.id || '',
    quantity: item.quantity,
    sortOrder: item.sortOrder,
    productTitle: item.productTitle ?? product?.title ?? undefined,
    skuTitle: item.skuTitle ?? sku?.title ?? undefined,
    unit: item.unit ?? product?.unit ?? undefined,
    imageUrl: item.imageUrl ?? product?.imageUrl ?? product?.coverUrl ?? product?.media?.[0]?.url ?? null,
    price: item.price ?? (sku?.price ?? undefined),
    stock: item.stock ?? (sku?.stock ?? undefined),
    weightGram: item.weightGram ?? (sku?.weightGram ?? undefined),
  };
}

function toBundleEditorItems(items?: BundleEditorItemSource[] | null): ProductBundleItem[] {
  return normalizeBundleItems((items || []).map(toBundleEditorItem));
}

function buildBundlePayloadItems(items: ProductBundleItem[]) {
  return normalizeBundleItems(items).map((item, index) => ({
    skuId: item.skuId,
    quantity: item.quantity,
    sortOrder: item.sortOrder ?? index,
  }));
}

function getBundleReferenceTotal(items: ProductBundleItem[]) {
  return items.reduce((sum, item) => sum + (Number(item.price) || 0) * item.quantity, 0);
}

function getBundleAvailableStock(items: ProductBundleItem[]) {
  if (items.length === 0) return null;
  return Math.min(
    ...items.map((item) => {
      const stock = Number(item.stock);
      if (!Number.isFinite(stock)) return 0;
      return Math.floor(stock / Math.max(1, item.quantity));
    }),
  );
}

function getBundleTotalWeightGram(items: ProductBundleItem[]) {
  return items.reduce((sum, item) => sum + (Number(item.weightGram) || 0) * item.quantity, 0);
}

function getProductCover(product: Product) {
  return product.media?.[0]?.url ?? product.bundleItems?.[0]?.imageUrl ?? null;
}

function mapBackendFieldToProductForm(path: string, multiSpec: boolean): (string | number)[] | null {
  // origin -> 前端用 originText 单输入
  if (path === 'origin' || path.startsWith('origin.')) return ['originText'];
  // skus 整体错误（如最少 1 项）-> 单规格映射到 singleCost，多规格无单一字段
  if (path === 'skus') return multiSpec ? null : ['singleCost'];
  if (path === 'bundleItems' || path.startsWith('bundleItems.')) return ['bundleItems'];
  // skus.<idx>.<field>
  const m = /^skus\.(\d+)\.(\w+)$/.exec(path);
  if (m) {
    const idx = Number(m[1]);
    const field = m[2];
    if (multiSpec) return ['skus', idx, field];
    // 单规格模式：只有 idx=0 有意义
    if (idx === 0) {
      const map: Record<string, string> = {
        specName: 'singleSpecName',
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
  const TOP_LEVEL = new Set(['title', 'subtitle', 'description', 'unit', 'categoryId', 'returnPolicy']);
  if (TOP_LEVEL.has(path)) return [path];
  return null;
}

function BundleItemsFormItem({
  form,
  children,
}: {
  form: FormInstance;
  children: ReactNode;
}) {
  return (
    <Form.Item shouldUpdate noStyle>
      {() => {
        const errors = form.getFieldError('bundleItems');
        return (
          <Form.Item
            label="组合内容"
            required
            validateStatus={errors.length > 0 ? 'error' : undefined}
            help={errors[0]}
          >
            {children}
          </Form.Item>
        );
      }}
    </Form.Item>
  );
}

function setBundleItemsFieldError(form: FormInstance, errorMessage: string) {
  form.setFields([{ name: ['bundleItems'], errors: [errorMessage] }]);
  return errorMessage;
}

function clearBundleItemsFieldError(form: FormInstance) {
  form.setFields([{ name: ['bundleItems'], errors: [] }]);
}

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
function SellingPriceDisplay({
  cost,
  markupRate,
  currentPrice,
}: {
  cost: number | undefined;
  markupRate: number;
  currentPrice?: number;
}) {
  const computed = cost && cost > 0 ? +(cost * markupRate).toFixed(2) : undefined;
  const hasCurrentPrice = Number.isFinite(currentPrice) && Number(currentPrice) > 0;
  if (hasCurrentPrice) {
    const aligned = computed !== undefined && Math.abs(Number(currentPrice) - computed) < 0.000001;
    return (
      <div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <PriceState label="当前实际售价" value={Number(currentPrice)} />
          <ArrowRightOutlined style={{ color: aligned ? '#52c41a' : '#d48806' }} />
          <PriceState label="保存后售价" value={computed} highlight={!aligned} />
        </div>
        <Text
          type={aligned ? 'secondary' : 'warning'}
          style={{ display: 'block', marginTop: 5, fontSize: 12 }}
        >
          {aligned ? (
            <><CheckCircleOutlined /> 当前售价与加价率一致</>
          ) : (
            <><WarningOutlined /> 保存后将按成本 × {markupRate} 更新真实成交价</>
          )}
        </Text>
      </div>
    );
  }
  return (
    <InputNumber
      value={computed}
      disabled
      prefix="¥"
      precision={2}
      style={{ width: '100%' }}
      placeholder="自动计算"
      addonAfter={`= 成本 × ${markupRate}`}
    />
  );
}

function PriceState({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value?: number;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: '7px 9px',
        borderRadius: 8,
        background: highlight ? '#fffbe6' : '#f6f8fa',
        border: `1px solid ${highlight ? '#ffe58f' : '#e5e7eb'}`,
      }}
    >
      <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{label}</Text>
      <Text strong style={{ display: 'block', fontFamily: 'monospace', marginTop: 1 }}>
        {value === undefined ? '-' : `¥${value.toFixed(2)}`}
      </Text>
    </div>
  );
}

// ============================================================
// 共享：组合商品内容编辑器
// ============================================================
function BundleItemsEditor({
  simpleProducts,
  bundleProducts,
  currentProductId,
  items,
  onChange,
  onCatalogSearch,
}: {
  simpleProducts: Product[];
  bundleProducts: Product[];
  currentProductId?: string;
  items: ProductBundleItem[];
  onChange: (items: ProductBundleItem[]) => void;
  onCatalogSearch?: (keyword: string) => void;
}) {
  const [skuSearchValue, setSkuSearchValue] = useState('');
  const [skuPickerResetKey, setSkuPickerResetKey] = useState(0);
  const [sourceSearchValue, setSourceSearchValue] = useState('');
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const ignoreNextSkuSearchRef = useRef(false);

  const simpleSkuOptions = useMemo(() => {
    return simpleProducts
      .filter((product) => product.id !== currentProductId)
      .filter((product) => productTypeOf(product) === 'SIMPLE')
      .filter((product) => product.status === 'ACTIVE')
      .flatMap((product) =>
        (product.skus || [])
          .filter((sku) => sku.status === 'ACTIVE')
          .map((sku) => {
            const approved = product.auditStatus === 'APPROVED';
            return {
              value: sku.id,
              label: buildBundleSkuOptionLabel({
                productTitle: product.title,
                skuTitle: sku.title,
                weightGram: sku.weightGram,
                unit: product.unit,
                approved,
              }),
              disabled: !approved,
              product,
              sku,
            };
          }),
      );
  }, [simpleProducts, currentProductId]);

  const skuMap = useMemo(
    () => new Map(simpleSkuOptions.map((option) => [option.value, option])),
    [simpleSkuOptions],
  );

  const bundleSourceOptions = useMemo(() => {
    return bundleProducts
      .filter((product) => product.id !== currentProductId)
      .filter((product) => productTypeOf(product) === 'BUNDLE')
      .filter((product) => product.status === 'ACTIVE')
      .filter((product) => (product.bundleItems?.length ?? 0) > 0)
      .map((product) => ({
        value: product.id,
        label: `${product.title}（${product.bundleItems?.length ?? 0} 项）`,
      }));
  }, [bundleProducts, currentProductId]);

  const productMap = useMemo(
    () => new Map(bundleProducts.map((product) => [product.id, product])),
    [bundleProducts],
  );

  const commitItems = (nextItems: ProductBundleItem[]) => {
    onChange(normalizeBundleItems(nextItems));
  };

  const addSku = (skuId: string) => {
    const option = skuMap.get(skuId);
    if (!option || option.disabled) return;
    commitItems([
      ...items,
      {
        skuId,
        quantity: 1,
        productTitle: option.product.title,
        skuTitle: normalizeSkuTitle(option.sku.title),
        unit: option.product.unit,
        imageUrl: getProductCover(option.product),
        price: option.sku.price,
        stock: option.sku.stock,
        weightGram: option.sku.weightGram,
      },
    ]);
  };

  const expandBundleSource = (productId: string) => {
    const source = productMap.get(productId);
    if (!source || productTypeOf(source) !== 'BUNDLE') return;
    commitItems([...(items || []), ...toBundleEditorItems(source.bundleItems)]);
  };

  const resetCatalogSearch = () => {
    setSkuSearchValue('');
    setSourceSearchValue('');
    onCatalogSearch?.('');
  };

  const resetSkuPickerAfterAdd = () => {
    ignoreNextSkuSearchRef.current = true;
    resetCatalogSearch();
    setSkuPickerResetKey((key) => key + 1);
    setTimeout(() => {
      ignoreNextSkuSearchRef.current = false;
    }, 0);
  };

  const updateQuantity = (skuId: string, quantity: number | null) => {
    commitItems(
      items.map((item) =>
        item.skuId === skuId
          ? { ...item, quantity: Math.max(1, Math.floor(Number(quantity) || 1)) }
          : item,
      ),
    );
  };

  const removeItem = (skuId: string) => {
    onChange(items.filter((item) => item.skuId !== skuId));
  };

  const referenceTotal = getBundleReferenceTotal(items);
  const availableStock = getBundleAvailableStock(items);
  const totalWeightGram = getBundleTotalWeightGram(items);

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          key={skuPickerResetKey}
          showSearch
          allowClear
          placeholder="搜索并添加单品规格"
          optionFilterProp="label"
          options={simpleSkuOptions.map(({ value, label, disabled }) => ({ value, label, disabled }))}
          filterOption={false}
          searchValue={skuSearchValue}
          onSearch={(value) => {
            if (ignoreNextSkuSearchRef.current) {
              setSkuSearchValue('');
              onCatalogSearch?.('');
              return;
            }
            setSkuSearchValue(value);
            onCatalogSearch?.(value);
          }}
          onClear={resetCatalogSearch}
          onChange={(value) => {
            if (value) {
              addSku(value);
              resetSkuPickerAfterAdd();
            }
          }}
          value={undefined}
          style={{ width: 320 }}
        />
        <Popover
          trigger="click"
          open={sourcePickerOpen}
          onOpenChange={(open) => {
            setSourcePickerOpen(open);
            if (!open) resetCatalogSearch();
          }}
          content={(
            <Select
              showSearch
              allowClear
              autoFocus
              placeholder="选择已有组合"
              optionFilterProp="label"
              options={bundleSourceOptions}
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
              filterOption={false}
              searchValue={sourceSearchValue}
              onSearch={(value) => {
                setSourceSearchValue(value);
                onCatalogSearch?.(value);
              }}
              onClear={resetCatalogSearch}
              onChange={(value) => {
                if (value) {
                  expandBundleSource(value);
                  setSourcePickerOpen(false);
                  resetCatalogSearch();
                }
              }}
              value={undefined}
              style={{ width: 280 }}
            />
          )}
        >
          <Button icon={<CopyOutlined />}>从已有组合复制</Button>
        </Popover>
        <Tooltip title="重复规格会自动合并数量">
          <Text type="secondary" style={{ fontSize: 12 }}>
            已添加 {items.length} 项
          </Text>
        </Tooltip>
      </Space>
      <Table<ProductBundleItem>
        rowKey="skuId"
        size="small"
        pagination={false}
        dataSource={items}
        locale={{ emptyText: '请选择组合内容' }}
        columns={[
          {
            title: '商品 / 规格',
            dataIndex: 'productTitle',
            render: (_, item) => (
              <Space size={8}>
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    width={32}
                    height={32}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    preview={false}
                  />
                ) : (
                  <div style={{ width: 32, height: 32, borderRadius: 4, background: '#f5f5f5' }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{item.productTitle || '-'}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {buildSkuMetaText({
                      skuTitle: item.skuTitle || item.skuId,
                      weightGram: item.weightGram,
                      unit: item.unit,
                    })}
                  </Text>
                </div>
              </Space>
            ),
          },
          {
            title: '参考售价',
            width: 100,
            align: 'right',
            render: (_, item) => (
              <span style={{ fontFamily: 'monospace' }}>
                ¥{(Number(item.price) || 0).toFixed(2)}
              </span>
            ),
          },
          {
            title: '库存',
            width: 80,
            align: 'right',
            render: (_, item) => Number(item.stock) || 0,
          },
          {
            title: '数量',
            width: 110,
            render: (_, item) => (
              <InputNumber
                min={1}
                precision={0}
                value={item.quantity}
                onChange={(value) => updateQuantity(item.skuId, value)}
                style={{ width: 82 }}
              />
            ),
          },
          {
            title: '小计',
            width: 110,
            align: 'right',
            render: (_, item) => (
              <span style={{ fontFamily: 'monospace' }}>
                ¥{((Number(item.price) || 0) * item.quantity).toFixed(2)}
              </span>
            ),
          },
          {
            title: '',
            width: 48,
            align: 'center',
            render: (_, item) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="移除组合规格"
                onClick={() => removeItem(item.skuId)}
              />
            ),
          },
        ]}
      />
      <Space size={16} wrap>
        <Text>
          参考合计 <Text strong style={{ fontFamily: 'monospace' }}>¥{referenceTotal.toFixed(2)}</Text>
        </Text>
        <Text>
          可组合库存 <Text strong>{availableStock ?? '-'}</Text>
        </Text>
        <Text>
          组合重量 <Text strong>{totalWeightGram || '-'}g</Text>
        </Text>
      </Space>
    </Space>
  );
}

// ============================================================
// 共享：语义标签字段组
// ============================================================
function SemanticTagFields() {
  return (
    <>
      <Form.Item name="flavorTags" label="标签">
        <Select
          mode="tags"
          placeholder="如：便携、防水、耐用、清甜"
          tokenSeparators={[',', '，']}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item name="seasonalMonths" label="月份（选填）">
        <Select
          mode="multiple"
          placeholder="选择月份"
          options={Array.from({ length: 12 }, (_, i) => ({
            label: `${i + 1}月`,
            value: i + 1,
          }))}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item name="usageScenarios" label="场景">
        <Select
          mode="tags"
          placeholder="如：通勤、运动、送礼、做饭"
          tokenSeparators={[',', '，']}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item name="dietaryTags" label="属性">
        <Select
          mode="tags"
          placeholder="如：蓝牙、防水、有机、低糖"
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
        只填写买家真实会说出来的搜索表达。标题写正式商品名，这里补充别名、常见说法和便于搜索的描述即可。
      </Text>
      <Form.Item
        label="别名 / 俗称 / 常见搜索词"
        name="aiKeywords"
        tooltip="用于补充买家常说的叫法、地方叫法、同义词。不要重复填写标题原词。"
      >
        <Input placeholder="逗号分隔，如：运动手表,腕带,礼盒" />
      </Form.Item>
      <SemanticTagFields />
    </>
  );
}

// ============================================================
// 共享：多规格行列表
// ============================================================
function MultiSpecRows({
  markupRate,
  lowStockThreshold,
  showCurrentPrice = false,
}: {
  markupRate: number;
  lowStockThreshold: number;
  showCurrentPrice?: boolean;
}) {
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
                    name={[field.name, 'price']}
                    hidden
                  >
                    <InputNumber />
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
                      const currentPrice = showCurrentPrice
                        ? getFieldValue(['skus', field.name, 'price'])
                        : undefined;
                      return (
                        <Form.Item label={showCurrentPrice ? '价格核对' : '售价（自动计算）'} style={{ marginBottom: 0 }}>
                          <SellingPriceDisplay
                            cost={cost}
                            markupRate={markupRate}
                            currentPrice={currentPrice}
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={6} lg={3}>
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
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.skus?.[field.name]?.stock !== cur.skus?.[field.name]?.stock}>
                    {({ getFieldValue }) => {
                      const stock = getFieldValue(['skus', field.name, 'stock']);
                      return <StockHint value={stock} threshold={lowStockThreshold} />;
                    }}
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
                    label="包装后重量（克）"
                    tooltip="包装后重量（克），用于计算运费和顺丰面单。"
                    rules={[
                      { required: true, message: '请输入包装后重量（克）' },
                      { type: 'number', min: 1, message: '包装后重量必须大于 0 克' },
                    ]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber placeholder="重量" min={1} precision={0} style={{ width: '100%' }} addonAfter="克" />
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
  productId,
  onOptimizationAdopted,
}: {
  fileList: UploadFile[];
  setFileList: (list: UploadFile[]) => void;
  productId?: string | null;
  onOptimizationAdopted?: () => void;
}) {
  const { message, modal } = App.useApp();
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [optimizationTask, setOptimizationTask] = useState<ProductImageOptimizationTask | null>(null);
  const [optimizationSource, setOptimizationSource] = useState<{ asset: UploadedProductImageAsset; url: string; name: string } | null>(null);
  const [optimizationSubmitting, setOptimizationSubmitting] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [truthChecks, setTruthChecks] = useState({ quantity: false, labels: false, facts: false });
  const [visualPlan, setVisualPlan] = useState<ProductVisualPlan | null>(null);
  const [selectedPaidDirection, setSelectedPaidDirection] = useState<ProductVisualMode | null>(null);
  const [visualPlanSource, setVisualPlanSource] = useState<{ asset: UploadedProductImageAsset; url: string; name: string } | null>(null);
  const [visualPlanSubmitting, setVisualPlanSubmitting] = useState(false);
  const [factScan, setFactScan] = useState<ProductImageFactScan | null>(null);
  const [factScanSubmitting, setFactScanSubmitting] = useState(false);
  const [factScanUnavailableReason, setFactScanUnavailableReason] = useState<string | null>(null);
  const [visualCreditAccount, setVisualCreditAccount] = useState<ProductVisualCreditAccount | null>(null);
  const [visualCreditAccountLoading, setVisualCreditAccountLoading] = useState(false);
  const [visualCreditAccountError, setVisualCreditAccountError] = useState<string | null>(null);
  const [rateCards, setRateCards] = useState<ProductVisualRateCard[] | null>(null);
  const [rateCardsLoading, setRateCardsLoading] = useState(false);
  const [visualQuote, setVisualQuote] = useState<{
    quote: ProductVisualQuote;
    availableCredits: number;
    reservedCredits: number;
    source: { asset: UploadedProductImageAsset; url: string; name: string };
  } | null>(null);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteConfirmed, setQuoteConfirmed] = useState(false);
  const [paidExecution, setPaidExecution] = useState<ProductVisualQuoteStatus | null>(null);
  const [paidPollWarning, setPaidPollWarning] = useState<string | null>(null);
  const [optimizationPollWarning, setOptimizationPollWarning] = useState<string | null>(null);
  const [factScanPollWarning, setFactScanPollWarning] = useState<string | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<Record<string, ProductImageUploadFeedback>>({});
  const restoredPaidQuoteRef = useRef<string | null>(null);
  const paidPollInFlightRef = useRef(false);
  const visualCreditRequestRef = useRef(0);
  const visualFlowGenerationRef = useRef(0);
  const fileListRef = useRef(fileList);
  const managedCount = fileList.filter((file) => file.status === 'done' && getManagedAsset(file)).length;
  const hasMixedSourceImages = managedCount > 0 && managedCount < fileList.filter((file) => file.status === 'done').length;

  useEffect(() => {
    fileListRef.current = fileList;
  }, [fileList]);

  const updateUploadFile = (uid: string, changes: Partial<UploadFile>) => {
    const next = fileListRef.current.map((item) => item.uid === uid ? { ...item, ...changes } : item);
    fileListRef.current = next;
    setFileList(next);
  };

  const uploadManagedProductImage = async (
    file: File & { uid?: string },
    feedbackUid = file.uid,
    onProgress?: (percent: number) => void,
  ) => {
    if (feedbackUid) {
      setUploadFeedback((current) => ({
        ...current,
        [feedbackUid]: { type: 'info', message: '正在检查图片尺寸，请不要重复选择同一文件。' },
      }));
    }
    onProgress?.(5);
    const prepared = await prepareProductImageForUpload(file);
    onProgress?.(15);
    if (feedbackUid) {
      setUploadFeedback((current) => ({
        ...current,
        [feedbackUid]: { type: 'info', message: '正在上传并完成安全扫描和素材登记。' },
      }));
    }
    let displayedPercent = 15;
    const processingProgress = window.setInterval(() => {
      displayedPercent = Math.min(95, displayedPercent + (displayedPercent < 80 ? 2 : 1));
      onProgress?.(displayedPercent);
    }, 1000);
    let result: UploadedProductImageAsset;
    try {
      result = await uploadProductImageAsset(prepared.file, (networkPercent) => {
        if (displayedPercent < 80) {
          displayedPercent = Math.max(displayedPercent, 15 + Math.round(networkPercent * 0.65));
          onProgress?.(Math.min(80, displayedPercent));
        }
      });
    } finally {
      window.clearInterval(processingProgress);
    }
    onProgress?.(100);
    if (feedbackUid) {
      setUploadFeedback((current) => ({
        ...current,
        [feedbackUid]: prepared.resized
          ? {
            type: 'info',
            message: `图片尺寸较大，已创建 ${prepared.width} × ${prepared.height} 的上传副本；你电脑里的原图没有被修改。`,
          }
          : { type: 'info', message: '图片上传成功，可以查看美化建议。' },
      }));
    }
    return result;
  };

  const recordUploadFailure = (uid: string | undefined, error: unknown) => {
    if (!uid) return;
    const raw = error instanceof Error && error.message ? error.message : '';
    const detail = /timeout|timed out|超时/i.test(raw)
      ? '图片安全处理时间较长，当前上传结果尚未确认。请稍后重试一次，系统会复用已成功处理的相同图片。'
      : raw || '上传失败，请检查图片后重试';
    setUploadFeedback((current) => ({
      ...current,
      [uid]: { type: 'error', message: detail },
    }));
  };

  const retryProductImageUpload = async (file: UploadFile) => {
    const original = file.originFileObj as (File & { uid?: string }) | undefined;
    if (!original) {
      message.warning('原始图片已不可用，请移除后重新选择图片');
      return;
    }
    updateUploadFile(file.uid, { status: 'uploading', percent: 0, error: undefined });
    try {
      const result = await uploadManagedProductImage(original, file.uid, (percent) => {
        updateUploadFile(file.uid, { percent });
      });
      updateUploadFile(file.uid, { status: 'done', percent: 100, response: result, url: result.displayUrl, error: undefined });
    } catch (error) {
      recordUploadFailure(file.uid, error);
      updateUploadFile(file.uid, { status: 'error', percent: 0, error: error as Error });
    }
  };

  const handlePreview = (file: UploadFile) => {
    const url = getFileUrl(file) || file.thumbUrl;
    if (!url) return;
    setPreviewFile({ url, name: file.name || '商品图片' });
  };

  const handleDownload = () => {
    if (!previewFile) return;
    setDownloading(true);
    try {
      const request = buildUploadDownloadRequest(previewFile.url, previewFile.name, API_BASE);
      triggerBrowserDownload(request.href, request.filename);
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

  const startWhiteBackground = async (file: UploadFile) => {
    const asset = getManagedAsset(file);
    const url = getFileUrl(file);
    if (!asset || !url) {
      message.warning('请等待图片上传完成后再优化');
      return;
    }
    if (!productId) {
      message.info('请先保存为草稿，再制作真实白底主图');
      return;
    }
    setOptimizationSubmitting(true);
    setOptimizationSource({ asset, url, name: file.name || '商品图片' });
    setOptimizationPollWarning(null);
    try {
      const task = await requestWhiteBackground({
        sourceAssetId: asset.asset.id,
        productId,
        idempotencyKey: crypto.randomUUID(),
      });
      setOptimizationTask(task);
      if (task.status === 'FAILED') message.warning(task.failureDetail || '当前图片不能在保真条件下制作白底图');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建真实白底任务失败');
      setOptimizationSource(null);
    } finally {
      setOptimizationSubmitting(false);
    }
  };

  const startVisualPlan = async (file: UploadFile, requestedMode?: ProductVisualMode) => {
    const asset = getManagedAsset(file);
    const url = getFileUrl(file);
    if (!asset || !url) {
      message.warning('请等待图片上传完成后再查看美化建议');
      return;
    }
    if (!productId) {
      message.info('请先保存为草稿，再生成可追溯的图片美化建议');
      return;
    }
    if (localStorage.getItem(activePaidQuoteStorageKey(productId))) {
      message.info('这个商品已有已确认的智能图片任务，系统正在恢复原任务；不会重复冻结图片积分。');
      return;
    }
    const flowGeneration = visualFlowGenerationRef.current + 1;
    visualFlowGenerationRef.current = flowGeneration;
    const sourceSnapshot = { asset, url, name: file.name || '商品图片' };
    setVisualPlanSubmitting(true);
    setVisualPlanSource(sourceSnapshot);
    setFactScan(null);
    setFactScanUnavailableReason(null);
    setRateCards(null);
    setVisualQuote(null);
    setPaidExecution(null);
    setQuoteConfirmed(false);
    setPaidPollWarning(null);
    setFactScanPollWarning(null);
    try {
      const plan = await requestProductVisualPlan(productId, { sourceAssetId: asset.asset.id, requestedMode });
      if (visualFlowGenerationRef.current !== flowGeneration) return;
      setVisualPlan(plan);
      setSelectedPaidDirection(requestedMode && plan.allowedModes.includes(requestedMode) ? requestedMode : plan.recommendedMode);
      void refreshVisualCreditAccount();
    } catch (error) {
      if (visualFlowGenerationRef.current !== flowGeneration) return;
      message.error(error instanceof Error ? error.message : '生成图片美化建议失败');
      setVisualPlanSource(null);
    } finally {
      if (visualFlowGenerationRef.current === flowGeneration) setVisualPlanSubmitting(false);
    }
  };

  const closeVisualPlan = () => {
    if (visualPlanSubmitting || factScanSubmitting || optimizationSubmitting || rateCardsLoading || quoteSubmitting) return;
    visualFlowGenerationRef.current += 1;
    setVisualPlan(null);
    setVisualPlanSource(null);
    setFactScan(null);
    setFactScanUnavailableReason(null);
    setRateCards(null);
    setVisualQuote(null);
    setQuoteConfirmed(false);
  };

  const applyVisualCreditAccount = useCallback((account: ProductVisualCreditAccount) => {
    visualCreditRequestRef.current += 1;
    setVisualCreditAccount(account);
    setVisualCreditAccountError(null);
    setVisualCreditAccountLoading(false);
  }, []);

  const refreshVisualCreditAccount = useCallback(async () => {
    if (!productId) return null;
    const requestId = visualCreditRequestRef.current + 1;
    visualCreditRequestRef.current = requestId;
    setVisualCreditAccountLoading(true);
    setVisualCreditAccountError(null);
    try {
      const account = await getProductVisualCreditAccount(productId);
      if (visualCreditRequestRef.current === requestId) {
        setVisualCreditAccount(account);
        setVisualCreditAccountError(null);
      }
      return account;
    } catch {
      if (visualCreditRequestRef.current === requestId) {
        setVisualCreditAccountError('图片积分余额暂时无法读取');
      }
      return null;
    } finally {
      if (visualCreditRequestRef.current === requestId) {
        setVisualCreditAccountLoading(false);
      }
    }
  }, [productId]);

  const showVisualCreditHelp = () => {
    modal.info({
      title: '获取图片积分',
      content: (
        <Space direction="vertical" size={8}>
          <Text>测试期间，首次查看可用方案会自动领取平台赠送的图片积分。</Text>
          <Text type="secondary">在线购买暂未开放；需要更多图片积分时，请联系平台管理员补充。</Text>
        </Space>
      ),
      okText: '知道了',
    });
  };

  const startFactScan = async () => {
    if (!productId || !visualPlanSource) return;
    setFactScanSubmitting(true);
    try {
      const scan = await requestProductImageFactScan(visualPlanSource.asset.asset.id, {
        productId,
        idempotencyKey: crypto.randomUUID(),
      });
      setFactScan(scan);
      setFactScanUnavailableReason(null);
      setFactScanPollWarning(null);
    } catch (error) {
      const feedback = productFactScanFailure(error);
      if (feedback.unavailable) setFactScanUnavailableReason(feedback.message);
      if (feedback.unavailable) message.warning(feedback.message);
      else message.error(feedback.message);
    } finally {
      setFactScanSubmitting(false);
    }
  };

  const startFreeTune = async () => {
    if (!productId || !visualPlan || !visualPlanSource || !factScan?.freeTuneEligible) return;
    setOptimizationSubmitting(true);
    setOptimizationSource(visualPlanSource);
    try {
      const task = await requestFreeTune({
        sourceAssetId: visualPlanSource.asset.asset.id,
        productId,
        planId: visualPlan.id,
        idempotencyKey: crypto.randomUUID(),
      });
      setOptimizationTask(task);
      setOptimizationPollWarning(null);
      setVisualPlan(null);
      if (task.status === 'FAILED') message.warning(task.failureDetail || '当前图片暂不能安全进行实景优化');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建实景优化候选失败');
    } finally {
      setOptimizationSubmitting(false);
    }
  };

  const paidDirection = (plan: ProductVisualPlan | null = visualPlan): ProductVisualMode => {
    if (selectedPaidDirection && plan?.allowedModes.includes(selectedPaidDirection)) return selectedPaidDirection;
    if (plan?.recommendedMode && plan.allowedModes.includes(plan.recommendedMode)) return plan.recommendedMode;
    return plan?.allowedModes[0] ?? 'PRESERVE_REAL_SCENE';
  };

  const loadPaidRateCards = async () => {
    if (!productId || !visualPlan || !visualPlanSource) return;
    const flowGeneration = visualFlowGenerationRef.current;
    const sourceAssetId = visualPlanSource.asset.asset.id;
    const planId = visualPlan.id;
    setRateCardsLoading(true);
    try {
      const request = {
        sourceAssetId,
        planId,
        direction: paidDirection(),
      };
      await ensureProductVisualTestAccess(productId, request);
      if (visualFlowGenerationRef.current !== flowGeneration) return;
      const [cards] = await Promise.all([
        listProductVisualRateCards(productId, request),
        refreshVisualCreditAccount(),
      ]);
      if (visualFlowGenerationRef.current !== flowGeneration) return;
      setRateCards(cards);
    } catch (error) {
      if (visualFlowGenerationRef.current !== flowGeneration) return;
      message.error(error instanceof Error ? error.message : '暂时无法取得图片美化报价');
    } finally {
      if (visualFlowGenerationRef.current === flowGeneration) setRateCardsLoading(false);
    }
  };

  const issuePaidQuote = async (rateCard: ProductVisualRateCard) => {
    if (!productId || !visualPlan || !visualPlanSource) return;
    const flowGeneration = visualFlowGenerationRef.current;
    const sourceSnapshot = visualPlanSource;
    const planSnapshot = visualPlan;
    setQuoteSubmitting(true);
    try {
      const selectedDirection = paidDirection(planSnapshot);
      const createQuote = (plan: ProductVisualPlan, direction: ProductVisualMode, rateCode = rateCard.code) => issueProductVisualQuote(productId, {
        sourceAssetId: sourceSnapshot.asset.asset.id,
        planId: plan.id,
        direction,
        rateCode,
        idempotencyKey: crypto.randomUUID(),
      });
      let result;
      try {
        result = await createQuote(planSnapshot, selectedDirection);
        if (visualFlowGenerationRef.current !== flowGeneration) return;
        if (result.quote.sourceAssetRef !== sourceSnapshot.asset.asset.id) {
          throw new Error('图片美化报价与当前图片不匹配，请重新查看美化建议');
        }
      } catch (error) {
        if (visualFlowGenerationRef.current !== flowGeneration) return;
        if (!visualPlanNeedsRefresh(error)) throw error;
        const refreshedPlan = await requestProductVisualPlan(productId, {
          sourceAssetId: sourceSnapshot.asset.asset.id,
          requestedMode: selectedDirection,
        });
        if (visualFlowGenerationRef.current !== flowGeneration) return;
        const refreshedDirection = paidDirection(refreshedPlan);
        const refreshedRequest = {
          sourceAssetId: sourceSnapshot.asset.asset.id,
          planId: refreshedPlan.id,
          direction: refreshedDirection,
        };
        await ensureProductVisualTestAccess(productId, refreshedRequest);
        if (visualFlowGenerationRef.current !== flowGeneration) return;
        const [refreshedCards] = await Promise.all([
          listProductVisualRateCards(productId, refreshedRequest),
          refreshVisualCreditAccount(),
        ]);
        if (visualFlowGenerationRef.current !== flowGeneration) return;
        setVisualPlan(refreshedPlan);
        setSelectedPaidDirection(refreshedDirection);
        setRateCards(refreshedCards);
        const refreshedCard = refreshedCards.find((card) => card.code === rateCard.code);
        if (!refreshedCard) {
          message.info('商品资料已变化，美化建议和可用方案已刷新，请重新选择方案');
          return;
        }
        result = await createQuote(refreshedPlan, refreshedDirection, refreshedCard.code);
        if (visualFlowGenerationRef.current !== flowGeneration) return;
        if (result.quote.sourceAssetRef !== sourceSnapshot.asset.asset.id) {
          throw new Error('图片美化报价与当前图片不匹配，请重新查看美化建议');
        }
        message.info('商品资料或图片版本已变化，系统已自动刷新并生成新报价');
      }
      setVisualQuote({ quote: result.quote, availableCredits: result.account.availableCredits, reservedCredits: result.account.reservedCredits, source: sourceSnapshot });
      applyVisualCreditAccount(result.account);
      setQuoteConfirmed(false);
      setPaidExecution(null);
      setPaidPollWarning(null);
    } catch (error) {
      if (visualFlowGenerationRef.current !== flowGeneration) return;
      message.error(error instanceof Error ? error.message : '创建图片美化报价失败');
    } finally {
      if (visualFlowGenerationRef.current === flowGeneration) setQuoteSubmitting(false);
    }
  };

  const confirmPaidQuote = async () => {
    if (!productId || !visualQuote || !quoteConfirmed) return;
    setQuoteSubmitting(true);
    try {
      const result = await confirmProductVisualQuote(productId, visualQuote.quote.id, visualQuote.quote.quoteHash);
      setPaidExecution(result.execution);
      setPaidPollWarning(null);
      localStorage.setItem(activePaidQuoteStorageKey(productId), visualQuote.quote.id);
      message.success('已确认图片积分，正在提交受控模型任务');
      void refreshVisualCreditAccount();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模型任务未能提交，未接受的任务会自动释放图片积分');
    } finally {
      setQuoteSubmitting(false);
    }
  };

  useEffect(() => {
    if (!optimizationTask) return;
    if (['REQUESTED', 'QUEUED', 'RUNNING', 'RECONCILING'].includes(optimizationTask.status)) {
      const timer = window.setInterval(async () => {
        try {
          setOptimizationTask(await getProductImageOptimization(optimizationTask.id));
          setOptimizationPollWarning(null);
        } catch (error) {
          setOptimizationPollWarning(error instanceof Error ? error.message : '候选状态刷新失败，请稍后重试');
        }
      }, 1500);
      return () => window.clearInterval(timer);
    }
    if (optimizationTask.status !== 'SUCCEEDED' || !optimizationTask.candidate?.expiresAt) return;
    const renewInMs = Math.max(1000, new Date(optimizationTask.candidate.expiresAt).getTime() - Date.now() - 30_000);
    const timer = window.setTimeout(async () => {
      try {
        setOptimizationTask(await getProductImageOptimization(optimizationTask.id));
      } catch {
        // Keep the displayed comparison; a later retry will obtain a new URL.
      }
    }, renewInMs);
    return () => window.clearTimeout(timer);
  }, [optimizationTask]);

  useEffect(() => {
    if (!factScan || !['SCANNING', 'RECONCILING'].includes(factScan.status)) return;
    const timer = window.setInterval(async () => {
      try {
        setFactScan(await getProductImageFactScan(factScan.id));
        setFactScanPollWarning(null);
      } catch (error) {
        setFactScanPollWarning(error instanceof Error ? error.message : '商品事实检查状态刷新失败');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [factScan]);

  useEffect(() => {
    if (!productId || !visualQuote || !paidExecution || !['QUEUED', 'RUNNING', 'VERIFYING', 'ALREADY_BOUND'].includes(paidExecution.status)) return;
    const timer = window.setInterval(async () => {
      if (paidPollInFlightRef.current) return;
      paidPollInFlightRef.current = true;
      try {
        const next = await pollProductVisualQuote(productId, visualQuote.quote.id);
        setPaidExecution(next);
        setPaidPollWarning(null);
        if (!['QUEUED', 'RUNNING', 'VERIFYING', 'ALREADY_BOUND'].includes(next.status)) {
          void refreshVisualCreditAccount();
        }
        if (next.status === 'SUCCEEDED' && next.optimizationId) {
          setOptimizationSource(visualQuote.source);
          setOptimizationTask(await getProductImageOptimization(next.optimizationId));
          setVisualPlan(null);
        }
      } catch (error) {
        setPaidPollWarning(error instanceof Error ? error.message : '模型任务状态刷新失败；系统不会重复提交或重复扣费');
      } finally {
        paidPollInFlightRef.current = false;
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [paidExecution, productId, refreshVisualCreditAccount, visualQuote]);

  useEffect(() => {
    if (!productId) return;
    const quoteId = localStorage.getItem(activePaidQuoteStorageKey(productId));
    const loadingMarker = `loading:${quoteId}`;
    if (!quoteId || restoredPaidQuoteRef.current === quoteId || restoredPaidQuoteRef.current === loadingMarker) return;
    restoredPaidQuoteRef.current = loadingMarker;
    let cancelled = false;
    let completed = false;
    void (async () => {
      try {
        const result = await getProductVisualQuote(productId, quoteId);
        if (cancelled) return;
        const sourceFile = fileList.find((file) => getManagedAsset(file)?.asset.id === result.quote.sourceAssetRef);
        const sourceAsset = sourceFile ? getManagedAsset(sourceFile) : undefined;
        const sourceUrl = sourceFile ? getFileUrl(sourceFile) : undefined;
        if (!sourceFile || !sourceAsset || !sourceUrl) {
          restoredPaidQuoteRef.current = null;
          return;
        }
        completed = true;
        restoredPaidQuoteRef.current = quoteId;
        setVisualPlanSource({ asset: sourceAsset, url: sourceUrl, name: sourceFile.name || '商品图片' });
        setVisualQuote({
          quote: result.quote,
          availableCredits: result.billingAccount.availableCredits,
          reservedCredits: result.billingAccount.reservedCredits,
          source: { asset: sourceAsset, url: sourceUrl, name: sourceFile.name || '商品图片' },
        });
        applyVisualCreditAccount(result.billingAccount);
        if (result.optimization?.status === 'SUCCEEDED') {
          setOptimizationSource({ asset: sourceAsset, url: sourceUrl, name: sourceFile.name || '商品图片' });
          setOptimizationTask(await getProductImageOptimization(result.optimization.id));
          setPaidExecution({ quoteId, optimizationId: result.optimization.id, status: 'SUCCEEDED' });
          return;
        }
        if (result.optimization?.status === 'ADOPTED') {
          localStorage.removeItem(activePaidQuoteStorageKey(productId));
          return;
        }
        if (result.optimization?.status === 'REJECTED') {
          setPaidExecution({ quoteId, optimizationId: result.optimization.id, status: 'REJECTED' });
          localStorage.removeItem(activePaidQuoteStorageKey(productId));
          return;
        }
        if (result.quote.status === 'RELEASED' || result.quote.status === 'EXPIRED' || result.quote.status === 'CANCELLED') {
          setPaidExecution({ quoteId, status: 'RELEASED' });
          localStorage.removeItem(activePaidQuoteStorageKey(productId));
          return;
        }
        setPaidExecution({ quoteId, status: result.quote.status === 'RECONCILING' ? 'RECONCILING' : 'ALREADY_BOUND' });
      } catch (error) {
        if (cancelled) return;
        localStorage.removeItem(activePaidQuoteStorageKey(productId));
        setPaidPollWarning(error instanceof Error ? error.message : '无法恢复之前的智能图片任务');
      }
    })();
    return () => {
      cancelled = true;
      if (!completed && restoredPaidQuoteRef.current === loadingMarker) restoredPaidQuoteRef.current = null;
    };
  }, [applyVisualCreditAccount, fileList, productId]);

  useEffect(() => {
    if (!productId || !paidExecution || !['REJECTED', 'RELEASED'].includes(paidExecution.status)) return;
    localStorage.removeItem(activePaidQuoteStorageKey(productId));
  }, [paidExecution, productId]);

  const adoptOptimization = async () => {
    if (!optimizationTask || !productId) return;
    if (fileList.filter((file) => file.status === 'done').length >= 9) {
      message.warning('采用候选会保留原实拍证据图，当前已达 9 张上限。请先移除一张非证据图片。');
      return;
    }
    setAdopting(true);
    try {
      const result = await adoptProductImageOptimization(optimizationTask.id, {
        productId,
        quantityConfirmed: truthChecks.quantity,
        labelsConfirmed: truthChecks.labels,
        factsConfirmed: truthChecks.facts,
      });
      if (result.mode === 'APPLIED') {
        message.success('公开商品图已更新；系统已保留历史版本，平台可事后巡检并在必要时回滚。');
      } else {
        const candidate = optimizationTask.candidate;
        if (candidate?.assetId && candidate.displayUrl) {
          if (!fileList.some((file) => getManagedAsset(file)?.asset.id === candidate.assetId)) {
            setFileList([{
              uid: `optimization-${optimizationTask.id}`,
              name: `${optimizationTitle(optimizationTask.kind)}.png`,
              status: 'done',
              url: candidate.displayUrl,
              response: {
                asset: { id: candidate.assetId, status: 'ADOPTED' },
                displayUrl: candidate.displayUrl,
                expiresAt: candidate.expiresAt || null,
              },
            } as UploadFile, ...fileList]);
          }
        }
        message.success('已采用候选，并保留原实拍证据图');
      }
      setOptimizationTask(null);
      setOptimizationSource(null);
      setTruthChecks({ quantity: false, labels: false, facts: false });
      localStorage.removeItem(activePaidQuoteStorageKey(productId));
      onOptimizationAdopted?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '采用候选失败');
    } finally {
      setAdopting(false);
    }
  };

  const freeTuneAvailable = visualPlan?.riskProfile === 'STANDARD_FACTS'
    && visualPlan.allowedModes.includes('PRESERVE_REAL_SCENE')
    && factScan?.sourceAssetId === visualPlan.sourceAssetId
    && factScan.freeTuneEligible === true;
  const risk = visualPlan ? visualRiskLabels[visualPlan.riskProfile] : null;
  const candidateTitle = optimizationTitle(optimizationTask?.kind, optimizationTask?.candidateRole);
  const marketingPreviewOnly = optimizationTask?.candidateRole === 'MARKETING_IMAGE' || optimizationTask?.adoptionAllowed === false;
  const candidateCanBeAdopted = optimizationTask?.status === 'SUCCEEDED' && !marketingPreviewOnly;
  const paidPresentation = paidExecution ? paidExecutionPresentation(paidExecution) : null;

  return (
    <>
      <Upload
        name="file"
        customRequest={async ({ file, onSuccess, onError, onProgress }) => {
          const uploadFile = file as File & { uid?: string };
          try {
            const result = await uploadManagedProductImage(uploadFile, uploadFile.uid, (percent) => {
              onProgress?.({ percent });
            });
            onSuccess?.(result);
          } catch (error) {
            recordUploadFailure(uploadFile.uid, error);
            onError?.(error as Error);
          }
        }}
        listType="picture-card"
        fileList={fileList}
        onChange={({ file, fileList: newList }) => {
          fileListRef.current = newList;
          setFileList(newList);
          if (file.status === 'removed') {
            setUploadFeedback((current) => {
              const next = { ...current };
              delete next[file.uid];
              return next;
            });
          }
        }}
        onPreview={handlePreview}
        multiple
        maxCount={9}
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
      >
        {fileList.length >= 9 ? null : (
          <div>
            <PlusOutlined />
            <div style={{ marginTop: 8 }}>上传图片</div>
          </div>
        )}
      </Upload>
      <Text type="secondary">最多 9 张，支持 JPG / PNG / WebP，单张最大 10MB</Text>
      {fileList.filter((file) => file.status === 'error').map((file) => (
        <Alert
          key={`upload-error-${file.uid}`}
          style={{ marginTop: 10 }}
          type="error"
          showIcon
          message={`${file.name || '商品图片'}上传失败`}
          description={uploadFeedback[file.uid]?.message || '图片没有进入商品素材库，因此暂时不能美化。'}
          action={<Button size="small" danger onClick={() => retryProductImageUpload(file)}>重新上传</Button>}
        />
      ))}
      {fileList.filter((file) => file.status === 'done' && uploadFeedback[file.uid]?.type === 'info').map((file) => (
        <Alert
          key={`upload-info-${file.uid}`}
          style={{ marginTop: 10 }}
          type="success"
          showIcon
          message={uploadFeedback[file.uid].message}
        />
      ))}
      {fileList.filter((file) => file.status === 'uploading' && uploadFeedback[file.uid]?.type === 'info').map((file) => (
        <Alert
          key={`upload-progress-${file.uid}`}
          style={{ marginTop: 10 }}
          type="info"
          showIcon
          message={uploadFeedback[file.uid].message}
        />
      ))}
      <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: 'linear-gradient(135deg, #f6ffed 0%, #ffffff 72%)', border: '1px solid #b7eb8f', borderLeft: '4px solid #52c41a' }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space align="center" wrap>
            <Text strong style={{ color: '#1f5f2c', letterSpacing: '0.02em' }}>智能图片美化</Text>
            <Tag color="green">先建议，后生成</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>原图始终保留，候选不会自动发布</Text>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>选择图片查看建议或生成效果。原图不会被自动替换。</Text>
          <Space wrap>
            {fileList.filter((file) => file.status === 'done' && getManagedAsset(file) && getManagedAsset(file)?.asset.status !== 'ADOPTED').map((file) => (
              <Space key={`visual-actions-${file.uid}`} size={4} wrap>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  loading={visualPlanSubmitting && visualPlanSource?.asset.asset.id === getManagedAsset(file)?.asset.id}
                  disabled={!productId || visualPlanSubmitting || optimizationSubmitting || rateCardsLoading || quoteSubmitting}
                  onClick={() => startVisualPlan(file)}
                >
                  查看美化建议：{file.name || '图片'}
                </Button>
                <Tooltip title={!productId
                  ? '先保存草稿后再处理图片'
                  : getManagedAsset(file)?.asset.diagnosis?.hasTransparentPixels
                    ? '透明前景图可免费合成白底'
                    : '普通照片使用智能白底或棚拍方案，确认报价后生成'}>
                  <Button
                    size="small"
                    loading={optimizationSubmitting && optimizationSource?.asset.asset.id === getManagedAsset(file)?.asset.id}
                    disabled={!productId || optimizationSubmitting || visualPlanSubmitting || rateCardsLoading || quoteSubmitting}
                    onClick={() => getManagedAsset(file)?.asset.diagnosis?.hasTransparentPixels
                      ? startWhiteBackground(file)
                      : startVisualPlan(file, 'CATALOG_STUDIO')}
                  >
                    {getManagedAsset(file)?.asset.diagnosis?.hasTransparentPixels ? '免费合成白底图' : '智能白底 / 棚拍'}
                  </Button>
                </Tooltip>
              </Space>
            ))}
          </Space>
          {paidExecution && !visualPlan && paidPresentation && <Alert type={paidPresentation.type} showIcon message={paidPresentation.message} description={paidPresentation.description} />}
          {paidPollWarning && !visualPlan && <Alert type="warning" showIcon message="智能图片任务状态需要刷新" description={paidPollWarning} />}
          {!productId && <Text type="warning" style={{ fontSize: 12 }}>先保存草稿，才能创建可审计的图片建议和候选。</Text>}
        </Space>
      </div>
      {hasMixedSourceImages && (
        <Text type="warning" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          当前同时存在历史图片和新上传图片。请重新上传历史图片后再保存，才能保留每张图片的来源和审核记录。
        </Text>
      )}
      {fileList.some((file) => getManagedAsset(file)?.asset.diagnosis?.advisories?.length) && (
        <div style={{ marginTop: 10 }}>
          {fileList.map((file) => {
            const advisories = getManagedAsset(file)?.asset.diagnosis?.advisories || [];
            if (advisories.length === 0) return null;
            const labels: Record<string, string> = {
              IMAGE_TOO_SMALL: '分辨率偏低，建议补拍更清晰的原图',
              PORTRAIT_CROP_RISK: '竖图在商品流可能裁掉主体，建议查看 4:5 裁切效果',
              TOO_DARK: '画面偏暗，建议补光后重拍',
              TOO_BRIGHT: '画面偏亮，建议避免强反光后重拍',
              LOW_CONTRAST: '主体与背景对比偏低，建议换更干净的背景补拍',
            };
            return <Text key={file.uid} type="warning" style={{ display: 'block', fontSize: 12 }}>{file.name}：{advisories.map((item) => labels[item.code]).join('；')}</Text>;
          })}
        </div>
      )}

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

      <Modal
        title="智能图片美化建议"
        open={!!visualPlan}
        onCancel={closeVisualPlan}
        closable={!visualPlanSubmitting && !factScanSubmitting && !optimizationSubmitting && !rateCardsLoading && !quoteSubmitting}
        maskClosable={!visualPlanSubmitting && !factScanSubmitting && !optimizationSubmitting && !rateCardsLoading && !quoteSubmitting}
        footer={<Button
          disabled={visualPlanSubmitting || factScanSubmitting || optimizationSubmitting || rateCardsLoading || quoteSubmitting}
          onClick={closeVisualPlan}
        >返回图片</Button>}
        width={760}
        destroyOnClose
      >
        {visualPlan && visualPlanSource && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: '#f7f8fa', borderLeft: `4px solid ${risk?.color === 'green' ? '#52c41a' : risk?.color === 'red' ? '#ff4d4f' : '#1677ff'}` }}>
              <Space wrap>
                <Text strong>{visualPlanSource.name}</Text>
                {risk && <Tag color={risk.color}>{risk.label}</Tag>}
                {visualPlan.recommendedMode && <Tag>{visualModeLabels[visualPlan.recommendedMode]}</Tag>}
              </Space>
            </div>

            {visualPlan.riskProfile === 'RETAKE_REQUIRED' ? (
              <Alert type="warning" showIcon message="建议补拍原图" description="当前清晰度不足，继续处理可能制造不存在的细节。请在更稳定的光线下重新拍摄商品。" />
            ) : (
              <Alert type="info" showIcon message="当前建议" description={visualPlan.recommendedMode === 'PRESERVE_REAL_SCENE'
                ? '保留真实场景，改善画面即可。'
                : `建议使用${visualPlan.recommendedMode ? visualModeLabels[visualPlan.recommendedMode] : '原图'}。`} />
            )}

            {visualPlan.riskProfile === 'STANDARD_FACTS' && visualPlan.allowedModes.includes('PRESERVE_REAL_SCENE') && (
              <Card size="small" title="免费实景调优" styles={{ body: { background: '#fcfcfc' } }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Text type="secondary">
                    免费改善亮度、对比度和清晰度，不更换背景。开始前需要检查图片中的商品信息。
                  </Text>
                  {!factScan && (
                    <Button loading={factScanSubmitting} disabled={Boolean(factScanUnavailableReason)} onClick={startFactScan}>
                      检查图片中的商品事实
                    </Button>
                  )}
                  {factScanUnavailableReason && (
                    <Alert type="warning" showIcon message="免费实景调优暂不可用" description={factScanUnavailableReason} />
                  )}
                  {factScan && ['SCANNING', 'RECONCILING'].includes(factScan.status) && (
                    <Alert type="info" showIcon message="正在核对商品事实" description="检查尚未得出可靠结论前，不会生成美化候选。" />
                  )}
                  {factScanPollWarning && <Alert type="warning" showIcon message="商品事实检查状态暂时无法刷新" description={factScanPollWarning} />}
                  {factScan?.status === 'VERIFIED_EMPTY' && factScan.freeTuneEligible && (
                    <Alert type="success" showIcon message="可进行免费实景调优" description="没有发现需要保护的文字、二维码或条码。仍会保留原图，并在生成后要求你逐项核对。" />
                  )}
                  {factScan && !['SCANNING', 'RECONCILING', 'VERIFIED_EMPTY'].includes(factScan.status) && (
                    <Alert type="warning" showIcon message="这张图暂不自动调优" description={factScan.status === 'FACTS_DETECTED'
                      ? '检测到需要保护的商品事实。请保留原实拍图，或使用适用的白底候选。'
                      : '当前无法可靠证明图片没有需保护的信息，因此不会自动调优。'} />
                  )}
                  <Button
                    type="primary"
                    loading={optimizationSubmitting}
                    disabled={!freeTuneAvailable || optimizationSubmitting}
                    onClick={startFreeTune}
                  >
                    生成免费实景优化候选
                  </Button>
                  {!freeTuneAvailable && factScan?.status === 'VERIFIED_EMPTY' && !factScan.freeTuneEligible && (
                    <Text type="warning" style={{ fontSize: 12 }}>扫描结论尚未完成对账，暂不生成候选。</Text>
                  )}
                </Space>
              </Card>
            )}

            {visualPlan.riskProfile !== 'RETAKE_REQUIRED' && (
              <Card size="small" title="付费智能精修" extra={<Tag color="gold">先报价，后生成</Tag>} styles={{ body: { background: 'linear-gradient(135deg, #fffbe6 0%, #ffffff 80%)' } }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ padding: '10px 12px', border: '1px solid #f0d77c', borderRadius: 8, background: '#fffdf2' }}>
                    <Space wrap size={12}>
                      <Text strong>图片积分</Text>
                      {visualCreditAccountLoading ? <Spin size="small" /> : <>
                        <Text>可用 {visualCreditAccount?.availableCredits ?? 0}</Text>
                        <Text type="secondary">冻结 {visualCreditAccount?.reservedCredits ?? 0}</Text>
                      </>}
                      <Button type="link" size="small" onClick={showVisualCreditHelp}>获取图片积分</Button>
                    </Space>
                    {visualCreditAccountError && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={visualCreditAccountError} action={<Button size="small" onClick={() => void refreshVisualCreditAccount()}>重新加载</Button>} />}
                  </div>
                  <Text type="secondary">选择效果并查看价格，确认后才会扣除图片积分。</Text>
                  <Space wrap>
                    <Text strong>生成方向</Text>
                    <Select
                      value={paidDirection()}
                      style={{ minWidth: 200 }}
                      disabled={Boolean(paidExecution) || rateCardsLoading || quoteSubmitting}
                      options={visualPlan.allowedModes.map((mode) => ({ value: mode, label: visualModeLabels[mode] || mode }))}
                      onChange={(mode: ProductVisualMode) => {
                        visualFlowGenerationRef.current += 1;
                        setSelectedPaidDirection(mode);
                        setRateCards(null);
                        setVisualQuote(null);
                        setQuoteConfirmed(false);
                        setPaidPollWarning(null);
                      }}
                    />
                  </Space>
                  {paidDirection() === 'MARKETING_SCENE' && <Alert type="warning" showIcon message="营销场景图仅供展示" description="不能替换商品事实主图。" />}
                  {!rateCards && !visualQuote && <Button type="primary" ghost loading={rateCardsLoading} onClick={loadPaidRateCards}>查看可用方案与图片积分</Button>}
                  {rateCards && rateCards.length === 0 && <Alert type="info" showIcon message="当前没有可用的付费方案" description="平台尚未为这类图片配置可执行模型。" />}
                  {rateCards && rateCards.length > 0 && !visualQuote && (
                    <Row gutter={[10, 10]}>
                      {rateCards.map((card) => (
                        <Col key={card.code} xs={24} md={12}>
                          <Card size="small" style={{ height: '100%', borderColor: '#f0d77c' }}>
                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                              <Space wrap><Text strong>{card.displayName}</Text><Tag color="gold">{card.creditCost} 图片积分</Tag><Tag>{card.candidateCount} 张候选</Tag></Space>
                              <Text type="secondary" style={{ fontSize: 12 }}>{card.description}</Text>
                              {visualCreditAccount && <Text type="secondary" style={{ fontSize: 12 }}>生成后预计剩余 {Math.max(0, visualCreditAccount.availableCredits - card.creditCost)} 图片积分</Text>}
                              <Button size="small" type="primary" loading={quoteSubmitting} onClick={() => issuePaidQuote(card)}>获取本方案报价</Button>
                            </Space>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  )}
                  {visualQuote && (
                    <div style={{ borderLeft: '4px solid #d4a72c', padding: '10px 12px', background: '#fffdf2', borderRadius: 8 }}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap><Text strong>{visualQuote.quote.rateCardSnapshot.displayName || '智能图片美化报价'}</Text><Tag color="gold">本次 {visualQuote.quote.creditCost} 图片积分</Tag><Tag>当前可用 {visualQuote.availableCredits} 图片积分</Tag><Tag>生成后预计 {Math.max(0, visualQuote.availableCredits - visualQuote.quote.creditCost)} 图片积分</Tag>{!paidExecution && <Button type="link" size="small" onClick={() => { setVisualQuote(null); setQuoteConfirmed(false); }}>重新选择方案</Button>}</Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>{visualQuote.quote.rateCardSnapshot.description || '将按当前受控图片计划生成候选。'} 报价有效至 {new Date(visualQuote.quote.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}。</Text>
                        {visualQuote.availableCredits < visualQuote.quote.creditCost ? <Alert type="warning" showIcon message="图片积分不足" description="请联系平台管理员补充图片积分。" /> : <>
                          <Checkbox checked={quoteConfirmed} onChange={(event) => setQuoteConfirmed(event.target.checked)}>我确认使用 {visualQuote.quote.creditCost} 图片积分生成 {visualQuote.quote.candidateCount} 张候选；模型已生成的结果即使未采用也可能产生费用。</Checkbox>
                          <Button type="primary" loading={quoteSubmitting} disabled={!quoteConfirmed} onClick={confirmPaidQuote}>确认图片积分并生成候选</Button>
                        </>}
                      </Space>
                    </div>
                  )}
                  {paidExecution && paidPresentation && <Alert type={paidPresentation.type} showIcon message={paidPresentation.message} description={paidPresentation.description} />}
                  {paidPollWarning && <Alert type="warning" showIcon message="模型任务状态暂时无法刷新" description={paidPollWarning} />}
                </Space>
              </Card>
            )}

          </Space>
        )}
      </Modal>

      <Modal
        title={candidateTitle}
        open={!!optimizationTask}
        onCancel={() => {
          if (!adopting) {
            setOptimizationTask(null);
            setOptimizationSource(null);
          }
        }}
        okText={candidateCanBeAdopted ? '确认采用候选' : '关闭'}
        cancelText="返回图片"
        okButtonProps={{
          loading: adopting,
          disabled: candidateCanBeAdopted && (!truthChecks.quantity || !truthChecks.labels || !truthChecks.facts),
        }}
        onOk={candidateCanBeAdopted ? adoptOptimization : () => {
          setOptimizationTask(null);
          setOptimizationSource(null);
        }}
        width={920}
        destroyOnClose
      >
        {optimizationTask && optimizationSource && (
          <>
            {optimizationPollWarning && <Alert type="warning" showIcon message="候选状态暂时无法刷新" description={optimizationPollWarning} style={{ marginBottom: 12 }} />}
            {['REQUESTED', 'QUEUED', 'RUNNING'].includes(optimizationTask.status) && <Alert type="info" showIcon message={optimizationTask.kind === 'FREE_TUNE' ? '正在生成实景优化候选…' : '正在进行保真白底合成…'} description={optimizationTask.kind === 'FREE_TUNE' ? '只会执行固定的轻量调优，不会调用生成模型或修改商品结构。' : '只会在透明前景基础上合成固定白底，不会调用生成模型。'} />}
            {optimizationTask.status === 'RECONCILING' && <Alert type="info" showIcon message="候选任务正在核对状态" description="系统不会重复执行同一任务；状态确认后会继续显示结果。" />}
            {optimizationTask.status === 'FAILED' && <Alert type="warning" showIcon message={`这张图片暂不能安全${optimizationTask.kind === 'FREE_TUNE' ? '进行实景优化' : '制作白底图'}`} description={optimizationTask.failureDetail || (optimizationTask.kind === 'FREE_TUNE' ? '请保留原图，或重新生成图片美化建议。' : '请上传带透明背景的 PNG/WebP，或等待分割能力开放。')} />}
            {['REJECTED', 'EXPIRED', 'CANCELLED'].includes(optimizationTask.status) && <Alert type="warning" showIcon message="该候选任务不能继续采用" description={optimizationTask.failureDetail || '请返回图片重新获取美化建议。'} />}
            {optimizationTask.status === 'ADOPTED' && <Alert type="success" showIcon message="该候选已经采用" description="商品图片已按当时的商品状态完成更新。" />}
            {optimizationTask.status === 'SUCCEEDED' && marketingPreviewOnly && <Alert type="warning" showIcon message="这是 AI 营销场景图，只能预览" description="场景、摆放方式和展示数量可能由模型重构，不能作为商品数量、包装规格或事实主图证据。原图始终保留。" style={{ marginBottom: 12 }} />}
            {optimizationTask.status === 'SUCCEEDED' && optimizationTask.candidate && (
              <>
                <Row gutter={16} style={{ marginTop: 4 }}>
                  <Col span={12}>
                    <Card size="small" title="规范安全源">
                      <Image src={optimizationSource.url} alt={optimizationSource.name} style={{ width: '100%', maxHeight: 360, objectFit: 'contain' }} />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small" title={candidateTitle} styles={{ body: { background: '#fafafa' } }}>
                      <Image src={optimizationTask.candidate.displayUrl || ''} alt={candidateTitle} style={{ width: '100%', maxHeight: 360, objectFit: 'contain' }} />
                    </Card>
                  </Col>
                </Row>
                {marketingPreviewOnly ? <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                  候选保持私有，仅用于评估营销效果；当前不能采用或替换商品公开图片。
                </Text> : <>
                  <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                    候选尚未发布。采用后会保留原实拍证据图；已上架商品会立即更新公开图片，并保留历史版本供平台事后巡检和必要时回滚。
                  </Text>
                  <Space direction="vertical" style={{ marginTop: 12 }}>
                    <Checkbox checked={truthChecks.quantity} onChange={(event) => setTruthChecks((value) => ({ ...value, quantity: event.target.checked }))}>商品数量、配件和比例完整</Checkbox>
                    <Checkbox checked={truthChecks.labels} onChange={(event) => setTruthChecks((value) => ({ ...value, labels: event.target.checked }))}>包装、型号、文字和二维码未变化</Checkbox>
                    <Checkbox checked={truthChecks.facts} onChange={(event) => setTruthChecks((value) => ({ ...value, facts: event.target.checked }))}>颜色、规格、材质和实物一致</Checkbox>
                  </Space>
                </>}
              </>
            )}
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
                    <Input placeholder="属性名（如：材质）" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'value']} rules={[{ required: true, message: '属性值' }]}>
                    <Input placeholder="属性值（如：铝合金）" style={{ width: 240 }} />
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
  fileList: UploadFile[],
  productType: ProductType,
  bundleItems: ProductBundleItem[],
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
  const media = buildMediaPayload(fileList);

  const skus = skuList.map((s) => ({
    id: s.id as string | undefined,
    specName: normalizeSkuTitle(s.specName as string | undefined),
    cost: Number(s.cost),
    stock: Number(s.stock),
    weightGram: s.weightGram === undefined || s.weightGram === null ? undefined : Number(s.weightGram),
    maxPerOrder: s.maxPerOrder === undefined || s.maxPerOrder === null ? undefined : Number(s.maxPerOrder),
  }));

  return {
    title: values.title,
    subtitle: values.subtitle || undefined,
    description: values.description,
    unit: (values.unit as string | undefined) || undefined,
    categoryId: values.categoryId,
    returnPolicy: values.returnPolicy || 'INHERIT',
    origin: values.originText ? { text: values.originText } : undefined,
    tagIds,
    aiKeywords,
    attributes,
    ...(media.mediaAssetIds ? { mediaAssetIds: media.mediaAssetIds } : {}),
    flavorTags: (values.flavorTags as string[] | undefined) || undefined,
    seasonalMonths: (values.seasonalMonths as number[] | undefined) || undefined,
    usageScenarios: (values.usageScenarios as string[] | undefined) || undefined,
    dietaryTags: (values.dietaryTags as string[] | undefined) || undefined,
    originRegion: (values.originText as string | undefined) || undefined,
    skus,
    productType,
    bundleItems: productType === 'BUNDLE' ? buildBundlePayloadItems(bundleItems) : undefined,
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
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [multiSpec, setMultiSpec] = useState(false);
  const [productType, setProductType] = useState<ProductType>('SIMPLE');
  const [bundleItems, setBundleItems] = useState<ProductBundleItem[]>([]);
  const [bundleCatalogKeyword, setBundleCatalogKeyword] = useState('');
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const [revisionChecks, setRevisionChecks] = useState({ quantity: false, labels: false, facts: false });

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

  const { data: appConfig } = useQuery({
    queryKey: ['app-config'],
    queryFn: getPublicAppConfig,
    staleTime: 1000 * 60 * 60,
  });
  const lowStockThreshold = normalizeLowStockThreshold(appConfig?.lowStockDisplayThreshold);

  // 商品标签选项（从标签池加载）
  const { data: productCategories = [] } = useQuery({
    queryKey: ['tag-categories-product'],
    queryFn: () => getTagCategories('PRODUCT'),
  });
  const productTagOptions = productCategories
    .flatMap(cat => cat.tags.map(t => ({ value: t.id, label: t.name })));

  // 计量单位字典（启用项，已排序）
  const { data: productUnits } = useQuery({
    queryKey: ['product-units'],
    queryFn: getProductUnits,
  });
  // 编辑态：若商品当前单位被管理员事后停用，仍兜底加入选项，避免静默丢失
  const unitOptions = useMemo(
    () => buildUnitOptions(productUnits, product?.unit),
    [productUnits, product?.unit],
  );

  const { data: bundleSimpleCatalogData } = useQuery({
    queryKey: ['seller-products-bundle-catalog', 'SIMPLE', bundleCatalogKeyword],
    queryFn: () => getProducts(buildBundleCatalogQuery(bundleCatalogKeyword, 'SIMPLE')),
    staleTime: 60_000,
  });
  const { data: bundleSourceCatalogData } = useQuery({
    queryKey: ['seller-products-bundle-catalog', 'BUNDLE', bundleCatalogKeyword],
    queryFn: () => getProducts(buildBundleCatalogQuery(bundleCatalogKeyword, 'BUNDLE')),
    staleTime: 60_000,
  });
  const bundleSimpleCatalog = bundleSimpleCatalogData?.items ?? [];
  const bundleSourceCatalog = bundleSourceCatalogData?.items ?? [];

  // 商品数据加载后填充表单并判断是否多规格
  useEffect(() => {
    if (!product) return;

    const nextProductType = productTypeOf(product);
    const nextBundleItems = toBundleEditorItems(product.bundleItems);
    setProductType(nextProductType);
    setBundleItems(nextBundleItems);

    const isMulti = nextProductType === 'SIMPLE' && (product.skus?.length ?? 0) > 1;
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
      unit: product.unit || DEFAULT_PRODUCT_UNIT,
      productType: nextProductType,
      bundleItems: nextBundleItems,
      categoryId: product.categoryId,
      returnPolicy: (product as any).returnPolicy || 'INHERIT',
      originText,
      tagIds: product.tags?.map((t: any) => t.tag?.id || t.tagId) || [],
      aiKeywords: (product.aiKeywords || []).join(','),
      attributes: attrPairs.length > 0 ? attrPairs : [],
      // 单规格字段
      ...(!isMulti && firstSku ? {
        singleSpecName: firstSku.title,
        singleCost: firstSku.cost,
        singleStock: nextProductType === 'BUNDLE' ? 0 : firstSku.stock,
        singleWeightGram: nextProductType === 'BUNDLE'
          ? (product.bundleTotalWeightGram ?? getBundleTotalWeightGram(nextBundleItems))
          : firstSku.weightGram,
        singleMaxPerOrder: firstSku.maxPerOrder ?? undefined,
      } : {}),
      // 多规格字段
      ...(isMulti ? {
        skus: product.skus.map((s) => ({
          id: s.id,
          price: s.price,
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
          response: m.assetId ? { asset: { id: m.assetId, status: m.assetStatus }, displayUrl: m.url } : undefined,
        })),
      );
    }
  }, [product, form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      if (productType === 'BUNDLE' && bundleItems.length === 0) {
        message.error(setBundleItemsFieldError(form, '请先添加组合内容'));
        return;
      }

      // 构造 SKU 列表：单规格 vs 多规格
      let skuList: Array<Record<string, unknown>>;
      if (productType === 'BUNDLE') {
        skuList = [{
          id: product?.skus?.[0]?.id,
          specName: '默认规格',
          cost: values.singleCost,
          stock: 0,
          weightGram: getBundleTotalWeightGram(bundleItems),
          maxPerOrder: values.singleMaxPerOrder,
        }];
      } else if (multiSpec) {
        skuList = values.skus as Array<Record<string, unknown>>;
      } else {
        // 单规格：使用主表单里的 singleCost/singleStock/singleWeightGram
        const firstSkuId = product?.skus?.[0]?.id;
        skuList = [{
          id: firstSkuId,
          specName: values.singleSpecName || product?.skus?.[0]?.title || '默认规格',
          cost: values.singleCost,
          stock: values.singleStock,
          weightGram: values.singleWeightGram,
          maxPerOrder: values.singleMaxPerOrder,
        }];
      }

      const payload = buildPayload(values, skuList, fileList, productType, bundleItems);
      const activePublicProduct = product?.status === 'ACTIVE' && product?.auditStatus === 'APPROVED';
      if (activePublicProduct && payload.mediaAssetIds && !sameMediaAssetOrder(product.media ?? [], payload.mediaAssetIds)) {
        message.warning('商品图片已变化。请先在“商品图片”卡片中确认“更新公开图片”；更新成功后再保存其他商品信息。');
        setRevisionModalOpen(true);
        return;
      }
      // Public image changes use the dedicated versioned endpoint. Keeping an
      // unchanged mediaAssetIds array in the ordinary product update would
      // make every title/SKU save fail as if the merchant had changed images.
      const productPayload = activePublicProduct ? omitMediaAssetIds(payload) : payload;
      if (productType === 'BUNDLE') {
        await updateProduct(id, productPayload);
      } else {
        const { skus, ...productData } = productPayload;
        await updateProduct(id, productData);
        await updateProductSkus(id, skus);
      }
      message.success('商品已更新');
      navigate('/products');
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && err.fieldErrors.length > 0) {
        const fieldsToSet: Array<{ name: (string | number)[]; errors: string[] }> = [];
        let firstName: (string | number)[] | null = null;
        for (const fe of err.fieldErrors) {
          const name = mapBackendFieldToProductForm(fe.field, multiSpec);
          if (!name) continue;
          fieldsToSet.push({ name, errors: [fe.message] });
          if (!firstName) firstName = name;
        }
        if (fieldsToSet.length > 0) form.setFields(fieldsToSet);
        message.error(err.message || '保存失败');
        if (firstName) {
          form.scrollToField(firstName, { behavior: 'smooth', block: 'center' });
        }
        return;
      }
      if (err instanceof Error) {
        message.error(err.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const submitMediaRevision = async () => {
    const assetIds = fileList.filter((file) => file.status === 'done').map((file) => getManagedAsset(file)?.asset.id);
    if (assetIds.length === 0 || assetIds.some((assetId) => !assetId)) {
      message.warning('请先将当前全部商品图片重新上传为受管图片后，再更新公开商品图片');
      return;
    }
    setRevisionSubmitting(true);
    try {
      await requestProductMediaRevision(id, {
        mediaAssetIds: assetIds as string[],
        idempotencyKey: crypto.randomUUID(),
        quantityConfirmed: revisionChecks.quantity,
        labelsConfirmed: revisionChecks.labels,
        factsConfirmed: revisionChecks.facts,
      });
      message.success('公开商品图已更新；系统已保留历史版本，平台可事后巡检并在必要时回滚。');
      await queryClient.invalidateQueries({ queryKey: ['seller-product', id] });
      setRevisionModalOpen(false);
      setRevisionChecks({ quantity: false, labels: false, facts: false });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新公开商品图片失败');
    } finally {
      setRevisionSubmitting(false);
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
          <Form.Item label="商品类型" name="productType">
            <Segmented
              disabled
              value={productType}
              options={[
                { label: '普通商品', value: 'SIMPLE' },
                { label: '组合商品', value: 'BUNDLE' },
              ]}
            />
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
            <Input.TextArea rows={4} placeholder="请详细描述商品特点、功能、材质、使用方式等信息" />
          </Form.Item>
          <Form.Item
            label="来源地 / 生产地"
            name="originText"
            rules={[{ required: true, message: '请输入来源地 / 生产地' }]}
          >
            <Input placeholder="如：广东深圳、浙江杭州" style={{ width: 300 }} />
          </Form.Item>
        </Card>

        {/* 3. 价格与库存 */}
        <Card
          title="价格与库存"
          style={{ marginBottom: 16 }}
          extra={
            <Space size="middle">
              <Space size={4}>
                <Text type="secondary">计量单位</Text>
                <Form.Item
                  name="unit"
                  noStyle
                  rules={[{ required: true, message: '请选择计量单位' }]}
                >
                  <Select
                    size="small"
                    placeholder="单位"
                    options={unitOptions}
                    showSearch
                    optionFilterProp="label"
                    style={{ width: 120 }}
                  />
                </Form.Item>
              </Space>
              {productType === 'SIMPLE' && (
                <>
                  <Text type="secondary">多规格商品</Text>
                  <Switch
                    checked={multiSpec}
                    onChange={(checked) => {
                      setMultiSpec(checked);
                      if (checked) {
                        // 切换到多规格：从单规格数据初始化一行
                        const specName = form.getFieldValue('singleSpecName');
                        const cost = form.getFieldValue('singleCost');
                        const stock = form.getFieldValue('singleStock');
                        const weightGram = form.getFieldValue('singleWeightGram');
                        const maxPerOrder = form.getFieldValue('singleMaxPerOrder');
                        if (cost || stock) {
                          form.setFieldsValue({
                            skus: [{
                              id: product?.skus?.[0]?.id,
                              price: product?.skus?.[0]?.price,
                              specName: specName || '默认规格',
                              cost,
                              stock,
                              weightGram,
                              maxPerOrder,
                            }],
                          });
                        }
                      } else {
                        // 切换到单规格：从第一行多规格数据恢复
                        const skus = form.getFieldValue('skus') as Array<Record<string, unknown>> | undefined;
                        const first = skus?.[0];
                        if (first) {
                          form.setFieldsValue({
                            singleSpecName: first.specName || '默认规格',
                            singleCost: first.cost,
                            singleStock: first.stock,
                            singleWeightGram: first.weightGram,
                            singleMaxPerOrder: first.maxPerOrder,
                          });
                        }
                      }
                    }}
                  />
                </>
              )}
            </Space>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            当前实际售价来自商品数据库；保存后售价由平台按成本 × 加价率（{markupRate}）重新计算。
          </Text>

          {productType === 'BUNDLE' ? (
            <>
              <BundleItemsFormItem form={form}>
                <BundleItemsEditor
                  simpleProducts={bundleSimpleCatalog}
                  bundleProducts={bundleSourceCatalog}
                  currentProductId={id}
                  items={bundleItems}
                  onCatalogSearch={setBundleCatalogKeyword}
                  onChange={(nextItems) => {
                    setBundleItems(nextItems);
                    form.setFieldValue('bundleItems', nextItems);
                    if (nextItems.length > 0) {
                      clearBundleItemsFieldError(form);
                    }
                  }}
                />
              </BundleItemsFormItem>
              <Row gutter={16}>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item
                    label="组合成本价"
                    name="singleCost"
                    rules={[
                      { required: true, message: '请输入组合成本价' },
                      { type: 'number', min: 0.01, message: '成本必须大于 0' },
                    ]}
                  >
                    <InputNumber placeholder="元" min={0.01} precision={2} style={{ width: '100%' }} prefix="¥" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Form.Item shouldUpdate noStyle>
                    {({ getFieldValue }) => {
                      const cost = getFieldValue('singleCost');
                      return (
                        <Form.Item label="价格核对">
                          <SellingPriceDisplay
                            cost={cost}
                            markupRate={markupRate}
                            currentPrice={product?.skus?.[0]?.price}
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item label="可组合库存">
                    <InputNumber
                      value={getBundleAvailableStock(bundleItems) ?? undefined}
                      disabled
                      style={{ width: '100%' }}
                      placeholder="-"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item label="单笔限购" name="singleMaxPerOrder" rules={[{ type: 'number', min: 1, message: '最少为1' }]}>
                    <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : !multiSpec ? (
            /* 单规格模式 */
            <Row gutter={16}>
              <Col xs={24} sm={12} md={6}>
                <Form.Item
                  label="规格名称"
                  name="singleSpecName"
                  initialValue="默认规格"
                  rules={[{ required: true, message: '请输入规格名称' }]}
                >
                  <Input placeholder="如：400g装" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={5}>
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
              <Col xs={24} sm={12} md={7}>
                <Form.Item shouldUpdate noStyle>
                  {({ getFieldValue }) => {
                    const cost = getFieldValue('singleCost');
                    return (
                      <Form.Item label="价格核对">
                        <SellingPriceDisplay
                          cost={cost}
                          markupRate={markupRate}
                          currentPrice={product?.skus?.[0]?.price}
                        />
                      </Form.Item>
                    );
                  }}
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={4}>
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
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.singleStock !== cur.singleStock}>
                  {({ getFieldValue }) => (
                    <StockHint value={getFieldValue('singleStock')} threshold={lowStockThreshold} />
                  )}
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={4}>
                <Form.Item
                  label="包装后重量（克）"
                  name="singleWeightGram"
                  tooltip="包装后重量（克），用于计算运费和顺丰面单。"
                  rules={[
                    { required: true, message: '请输入包装后重量（克）' },
                    { type: 'number', min: 1, message: '包装后重量必须大于 0 克' },
                  ]}
                >
                  <InputNumber placeholder="重量" min={1} precision={0} style={{ width: '100%' }} addonAfter="克" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={4}>
                <Form.Item label="单笔限购" name="singleMaxPerOrder" rules={[{ type: 'number', min: 1, message: '最少为1' }]}>
                  <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            /* 多规格模式 */
            <MultiSpecRows
              markupRate={markupRate}
              lowStockThreshold={lowStockThreshold}
              showCurrentPrice
            />
          )}
        </Card>

        {/* 4. 商品图片 */}
        <Card
          title="商品图片"
          extra={product?.status === 'ACTIVE' && product?.auditStatus === 'APPROVED' ? (
            <Button onClick={() => setRevisionModalOpen(true)}>更新公开图片</Button>
          ) : null}
          style={{ marginBottom: 16 }}
        >
          <ImageUploadSection
            fileList={fileList}
            setFileList={setFileList}
            productId={product?.id}
            onOptimizationAdopted={() => { void queryClient.invalidateQueries({ queryKey: ['seller-product', id] }); }}
          />
        </Card>

        <Modal
          title="更新公开商品图片"
          open={revisionModalOpen}
          onCancel={() => setRevisionModalOpen(false)}
          okText="立即更新"
          okButtonProps={{
            loading: revisionSubmitting,
            disabled: !revisionChecks.quantity || !revisionChecks.labels || !revisionChecks.facts,
          }}
          onOk={submitMediaRevision}
        >
          <Text type="secondary">确认后会立即替换买家看到的图片，并保留当前版本供平台事后巡检和必要时回滚。</Text>
          <Space direction="vertical" style={{ marginTop: 16 }}>
            <Checkbox checked={revisionChecks.quantity} onChange={(event) => setRevisionChecks((value) => ({ ...value, quantity: event.target.checked }))}>商品数量、配件和比例完整</Checkbox>
            <Checkbox checked={revisionChecks.labels} onChange={(event) => setRevisionChecks((value) => ({ ...value, labels: event.target.checked }))}>包装、型号、文字和二维码未变化</Checkbox>
            <Checkbox checked={revisionChecks.facts} onChange={(event) => setRevisionChecks((value) => ({ ...value, facts: event.target.checked }))}>颜色、规格、材质和实物一致</Checkbox>
          </Space>
        </Modal>

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
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [multiSpec, setMultiSpec] = useState(false);
  const [productType, setProductType] = useState<ProductType>('SIMPLE');
  const [bundleItems, setBundleItems] = useState<ProductBundleItem[]>([]);
  const [bundleCatalogKeyword, setBundleCatalogKeyword] = useState('');

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

  const { data: appConfig } = useQuery({
    queryKey: ['app-config'],
    queryFn: getPublicAppConfig,
    staleTime: 1000 * 60 * 60,
  });
  const lowStockThreshold = normalizeLowStockThreshold(appConfig?.lowStockDisplayThreshold);

  // 商品标签选项（从标签池加载）
  const { data: productCategories = [] } = useQuery({
    queryKey: ['tag-categories-product'],
    queryFn: () => getTagCategories('PRODUCT'),
  });
  const productTagOptions = productCategories
    .flatMap(cat => cat.tags.map(t => ({ value: t.id, label: t.name })));

  // 计量单位字典（启用项，已排序）
  const { data: productUnits } = useQuery({
    queryKey: ['product-units'],
    queryFn: getProductUnits,
  });
  // 草稿可能携带一个事后被停用的单位，兜底加入选项避免静默丢失
  const unitOptions = useMemo(
    () => buildUnitOptions(productUnits, draftProduct?.unit),
    [productUnits, draftProduct?.unit],
  );

  const { data: bundleSimpleCatalogData } = useQuery({
    queryKey: ['seller-products-bundle-catalog', 'SIMPLE', bundleCatalogKeyword],
    queryFn: () => getProducts(buildBundleCatalogQuery(bundleCatalogKeyword, 'SIMPLE')),
    staleTime: 60_000,
  });
  const { data: bundleSourceCatalogData } = useQuery({
    queryKey: ['seller-products-bundle-catalog', 'BUNDLE', bundleCatalogKeyword],
    queryFn: () => getProducts(buildBundleCatalogQuery(bundleCatalogKeyword, 'BUNDLE')),
    staleTime: 60_000,
  });
  const bundleSimpleCatalog = bundleSimpleCatalogData?.items ?? [];
  const bundleSourceCatalog = bundleSourceCatalogData?.items ?? [];

  // 草稿加载后回填表单（仅执行一次）
  useEffect(() => {
    if (!draftProduct) return;
    hydratingRef.current = true;

    const nextProductType = productTypeOf(draftProduct);
    const nextBundleItems = toBundleEditorItems(draftProduct.bundleItems);
    setProductType(nextProductType);
    setBundleItems(nextBundleItems);

    const isMulti = nextProductType === 'SIMPLE' && (draftProduct.skus?.length ?? 0) > 1;
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
      unit: draftProduct.unit || DEFAULT_PRODUCT_UNIT,
      productType: nextProductType,
      bundleItems: nextBundleItems,
      categoryId: draftProduct.categoryId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      returnPolicy: (draftProduct as any).returnPolicy || 'INHERIT',
      originText,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tagIds: draftProduct.tags?.map((t: any) => t.tag?.id || t.tagId) || [],
      aiKeywords: (draftProduct.aiKeywords || []).join(','),
      attributes: attrPairs.length > 0 ? attrPairs : [],
      ...(!isMulti && firstSku ? {
        singleSpecName: firstSku.title,
        singleCost: firstSku.cost || undefined,
        singleStock: nextProductType === 'BUNDLE' ? 0 : firstSku.stock,
        singleWeightGram: nextProductType === 'BUNDLE'
          ? (draftProduct.bundleTotalWeightGram ?? getBundleTotalWeightGram(nextBundleItems))
          : hydrateDraftWeightGram(firstSku),
        singleMaxPerOrder: firstSku.maxPerOrder ?? undefined,
      } : {}),
      ...(isMulti ? {
        skus: draftProduct.skus.map((s) => ({
          id: s.id,
          specName: s.title,
          cost: s.cost,
          stock: s.stock,
          weightGram: hydrateDraftWeightGram(s),
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
          response: m.assetId ? { asset: { id: m.assetId, status: m.assetStatus }, displayUrl: m.url } : undefined,
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
    if (productType === 'BUNDLE') {
      const { singleCost, singleMaxPerOrder } = values;
      const hasAnyBundleSku =
        singleCost !== undefined && singleCost !== null && singleCost !== ''
        || singleMaxPerOrder !== undefined && singleMaxPerOrder !== null && singleMaxPerOrder !== '';
      if (hasAnyBundleSku) {
        skuList = [{
          specName: '默认规格',
          cost: singleCost,
          stock: 0,
          weightGram: getBundleTotalWeightGram(bundleItems),
          maxPerOrder: singleMaxPerOrder,
        }];
      }
    } else if (multiSpec) {
      skuList = (values.skus as Array<Record<string, unknown>>) || [];
    } else {
      const { singleSpecName, singleCost, singleStock, singleWeightGram, singleMaxPerOrder } = values;
      const hasAnySingle = hasMeaningfulSingleSkuDraftInput({
        skuTitle: singleSpecName as string | undefined,
        cost: singleCost,
        stock: singleStock,
        weightGram: singleWeightGram,
        maxPerOrder: singleMaxPerOrder,
      });
      if (hasAnySingle) {
        skuList = [{
          specName: normalizeSkuTitle(singleSpecName as string | undefined),
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
    const media = buildMediaPayload(fileList);

    const aiKeywords = typeof values.aiKeywords === 'string'
      ? values.aiKeywords.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];

    const originText = (values.originText as string | undefined) ?? '';

    return {
      title: (values.title as string | undefined) || undefined,
      subtitle: (values.subtitle as string | undefined) ?? '',
      description: (values.description as string | undefined) ?? '',
      unit: (values.unit as string | undefined) || DEFAULT_PRODUCT_UNIT,
      categoryId: (values.categoryId as string | undefined) || null,
      returnPolicy: (values.returnPolicy as string | undefined) || 'INHERIT',
      // origin 是 Json? 字段：清空时发 null（后端 update 显式置 null）
      origin: originText ? { text: originText } : null,
      tagIds: (values.tagIds as string[] | undefined) ?? [],
      aiKeywords,
      attributes,
      ...(media.mediaAssetIds ? { mediaAssetIds: media.mediaAssetIds } : {}),
      flavorTags: (values.flavorTags as string[] | undefined) ?? [],
      seasonalMonths: (values.seasonalMonths as number[] | undefined) ?? [],
      usageScenarios: (values.usageScenarios as string[] | undefined) ?? [],
      dietaryTags: (values.dietaryTags as string[] | undefined) ?? [],
      originRegion: originText || null,
      skus,
      productType,
      bundleItems: productType === 'BUNDLE' ? buildBundlePayloadItems(bundleItems) : [],
    };
  }, [form, fileList, multiSpec, productType, bundleItems]);

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
      if (err instanceof ApiError && err.fieldErrors && err.fieldErrors.length > 0) {
        const firstHighlightable: string | null = (() => {
          const fieldsToSet: Array<{ name: (string | number)[]; errors: string[] }> = [];
          let firstName: string | null = null;
          for (const fe of err.fieldErrors) {
            const name = mapBackendFieldToProductForm(fe.field, multiSpec);
            if (!name) continue;
            if (name.length === 1 && name[0] === 'bundleItems') {
              setBundleItemsFieldError(form, fe.message);
            } else {
              fieldsToSet.push({ name, errors: [fe.message] });
            }
            if (!firstName) firstName = name.join('.');
          }
          if (fieldsToSet.length > 0) {
            form.setFields(fieldsToSet);
          }
          return firstName;
        })();
        if (!silent) {
          if (firstHighlightable) {
            const namePath = firstHighlightable.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
            form.scrollToField(namePath, { behavior: 'smooth', block: 'center' });
          }
          message.error(err.message || '保存草稿失败');
        } else {
          // eslint-disable-next-line no-console
          console.warn('自动保存草稿失败', err);
        }
        return;
      }
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
  }, [draftId, draftLimitReached, buildDraftPayload, message, multiSpec, navigate, queryClient]);

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
  }, [watchedValues, fileList, bundleItems, debouncedAutoSave, dirtySinceSave]);

  // 卸载时取消未执行的 debounce
  useEffect(() => () => { debouncedAutoSave.cancel(); }, [debouncedAutoSave]);

  // 把后端字段路径（如 "skus.0.specName" / "origin"）映射到前端 form name 路径
  const mapBackendFieldToForm = useCallback(
    (path: string): (string | number)[] | null => mapBackendFieldToProductForm(path, multiSpec),
    [multiSpec],
  );

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const values = await form.validateFields();
      if (productType === 'BUNDLE' && bundleItems.length === 0) {
        message.error(setBundleItemsFieldError(form, '请先添加组合内容'));
        return;
      }

      if (draftId) {
        // 草稿分支：用 buildDraftPayload（全量覆盖语义），否则被清空的字段会被
        // buildPayload 压成 undefined，updateDraft 跳过更新，旧值留库被一起提交。
        await updateDraft(draftId, buildDraftPayload());
        await submitDraft(draftId);
      } else {
        // 全新商品创建：只提交成本，basePrice 与 SKU 售价由后端统一计算。
        let skuList: Array<Record<string, unknown>>;
        if (productType === 'BUNDLE') {
          skuList = [{
            specName: '默认规格',
            cost: values.singleCost,
            stock: 0,
            weightGram: getBundleTotalWeightGram(bundleItems),
            maxPerOrder: values.singleMaxPerOrder,
          }];
        } else if (multiSpec) {
          skuList = values.skus as Array<Record<string, unknown>>;
        } else {
          skuList = [{
            specName: values.singleSpecName || '默认规格',
            cost: values.singleCost,
            stock: values.singleStock,
            weightGram: values.singleWeightGram,
            maxPerOrder: values.singleMaxPerOrder,
          }];
        }
        const payload = buildPayload(values, skuList, fileList, productType, bundleItems);
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
          <Form.Item label="商品类型" name="productType" initialValue="SIMPLE">
            <Segmented
              disabled={!!draftId}
              value={productType}
              onChange={(value) => {
                const nextType = value as ProductType;
                setProductType(nextType);
                form.setFieldValue('productType', nextType);
                if (nextType === 'BUNDLE') setMultiSpec(false);
                if (!hydratingRef.current) setDirtySinceSave(true);
              }}
              options={[
                { label: '普通商品', value: 'SIMPLE' },
                { label: '组合商品', value: 'BUNDLE' },
              ]}
            />
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
            <Input.TextArea rows={4} placeholder="请详细描述商品特点、功能、材质、使用方式等信息" />
          </Form.Item>
          <Form.Item
            label="来源地 / 生产地"
            name="originText"
            rules={[{ required: true, message: '请输入来源地 / 生产地' }]}
          >
            <Input placeholder="如：广东深圳、浙江杭州" style={{ width: 300 }} />
          </Form.Item>
        </Card>

        {/* 2. 价格与库存 */}
        <Card
          title="价格与库存"
          style={{ marginBottom: 16 }}
          extra={
            <Space size="middle">
              <Space size={4}>
                <Text type="secondary">计量单位</Text>
                <Form.Item
                  name="unit"
                  noStyle
                  initialValue={DEFAULT_PRODUCT_UNIT}
                  rules={[{ required: true, message: '请选择计量单位' }]}
                >
                  <Select
                    size="small"
                    placeholder="单位"
                    options={unitOptions}
                    showSearch
                    optionFilterProp="label"
                    style={{ width: 120 }}
                  />
                </Form.Item>
              </Space>
              {productType === 'SIMPLE' && (
                <>
                  <Text type="secondary">多规格商品</Text>
                  <Switch
                    checked={multiSpec}
                    onChange={(checked) => {
                      setMultiSpec(checked);
                      if (checked) {
                        // 切换到多规格：从单规格数据初始化一行
                        const specName = form.getFieldValue('singleSpecName');
                        const cost = form.getFieldValue('singleCost');
                        const stock = form.getFieldValue('singleStock');
                        const weightGram = form.getFieldValue('singleWeightGram');
                        const maxPerOrder = form.getFieldValue('singleMaxPerOrder');
                        form.setFieldsValue({
                          skus: [{ specName: specName || '默认规格', cost, stock, weightGram, maxPerOrder }],
                        });
                      } else {
                        // 切换到单规格：从第一行多规格数据恢复
                        const skus = form.getFieldValue('skus') as Array<Record<string, unknown>> | undefined;
                        const first = skus?.[0];
                        if (first) {
                          form.setFieldsValue({
                            singleSpecName: first.specName || '默认规格',
                            singleCost: first.cost,
                            singleStock: first.stock,
                            singleWeightGram: first.weightGram,
                            singleMaxPerOrder: first.maxPerOrder,
                          });
                        }
                      }
                    }}
                  />
                </>
              )}
            </Space>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            售价由平台按成本 × 加价率（{markupRate}）自动计算，卖家只需填写成本价。
          </Text>

          {productType === 'BUNDLE' ? (
            <>
              <BundleItemsFormItem form={form}>
                <BundleItemsEditor
                  simpleProducts={bundleSimpleCatalog}
                  bundleProducts={bundleSourceCatalog}
                  currentProductId={draftId ?? undefined}
                  items={bundleItems}
                  onCatalogSearch={setBundleCatalogKeyword}
                  onChange={(nextItems) => {
                    setBundleItems(nextItems);
                    form.setFieldValue('bundleItems', nextItems);
                    if (nextItems.length > 0) {
                      clearBundleItemsFieldError(form);
                    }
                    if (!hydratingRef.current) setDirtySinceSave(true);
                  }}
                />
              </BundleItemsFormItem>
              <Row gutter={16}>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item
                    label="组合成本价"
                    name="singleCost"
                    rules={[
                      { required: true, message: '请输入组合成本价' },
                      { type: 'number', min: 0.01, message: '成本必须大于 0' },
                    ]}
                  >
                    <InputNumber placeholder="元" min={0.01} precision={2} style={{ width: '100%' }} prefix="¥" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8}>
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
                <Col xs={24} sm={12} md={5}>
                  <Form.Item label="可组合库存">
                    <InputNumber
                      value={getBundleAvailableStock(bundleItems) ?? undefined}
                      disabled
                      style={{ width: '100%' }}
                      placeholder="-"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item label="单笔限购" name="singleMaxPerOrder" rules={[{ type: 'number', min: 1, message: '最少为1' }]}>
                    <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : !multiSpec ? (
            /* 单规格模式 */
            <Row gutter={16}>
              <Col xs={24} sm={12} md={6}>
                <Form.Item
                  label="规格名称"
                  name="singleSpecName"
                  initialValue="默认规格"
                  rules={[{ required: true, message: '请输入规格名称' }]}
                >
                  <Input placeholder="如：400g装" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={5}>
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
              <Col xs={24} sm={12} md={7}>
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
              <Col xs={24} sm={12} md={4}>
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
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.singleStock !== cur.singleStock}>
                  {({ getFieldValue }) => (
                    <StockHint value={getFieldValue('singleStock')} threshold={lowStockThreshold} />
                  )}
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={4}>
                <Form.Item
                  label="包装后重量（克）"
                  name="singleWeightGram"
                  tooltip="包装后重量（克），用于计算运费和顺丰面单。"
                  rules={[
                    { required: true, message: '请输入包装后重量（克）' },
                    { type: 'number', min: 1, message: '包装后重量必须大于 0 克' },
                  ]}
                >
                  <InputNumber placeholder="重量" min={1} precision={0} style={{ width: '100%' }} addonAfter="克" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12} md={4}>
                <Form.Item label="单笔限购" name="singleMaxPerOrder" rules={[{ type: 'number', min: 1, message: '最少为1' }]}>
                  <InputNumber placeholder="不限" min={1} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            /* 多规格模式 */
            <MultiSpecRows markupRate={markupRate} lowStockThreshold={lowStockThreshold} />
          )}
        </Card>

        {/* 3. 商品图片 */}
        <Card title="商品图片" style={{ marginBottom: 16 }}>
          <ImageUploadSection
            fileList={fileList}
            setFileList={updateFileList}
            productId={draftId}
            onOptimizationAdopted={() => { if (draftId) void queryClient.invalidateQueries({ queryKey: ['seller-product', draftId] }); }}
          />
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
