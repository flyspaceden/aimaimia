export type DeliveryPricingRuleDraft = {
  scope?: string | null;
  ruleType?: string | null;
  merchantId?: string | null;
  productId?: string | null;
  skuId?: string | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  fixedPriceCents?: number | null;
  markupBps?: number | null;
  priority?: number | null;
  isActive?: boolean | null;
  note?: string | null;
};

export type DeliveryManifestCustomizationDraft = {
  key?: string | null;
  label?: string | null;
  value?: string | null;
  sortOrder?: number | null;
  visible?: boolean | null;
};

export type DeliveryManifestTemplateColumnDraft = {
  key?: string | null;
  label?: string | null;
  sortOrder?: number | null;
  visible?: boolean | null;
};

export type DeliveryManifestCustomizationType = 'BUYER_FULL' | 'SELLER_FULFILLMENT';
export type DeliveryManifestTemplateType = DeliveryManifestCustomizationType | 'SELLER_FINANCE';

const CUSTOM_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SELLER_FULFILLMENT_FORBIDDEN_TEXT_PATTERN =
  /(price|cost|amount|fee|markup|payment|settlement|supply|profit|margin|revenue|final|buyer|total|售价|价格|成本|金额|费用|运费|加价|支付|付款|结算|供货|供货价|利润|毛利|收入|应付|实付|总价|合计)/i;

const trimOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function validateDeliveryPricingRuleDraft(values: DeliveryPricingRuleDraft): string | null {
  const scope = values.scope;
  const ruleType = values.ruleType;
  const merchantId = trimOptional(values.merchantId);
  const productId = trimOptional(values.productId);
  const skuId = trimOptional(values.skuId);

  if (values.maxQuantity !== undefined && values.maxQuantity !== null) {
    if ((values.minQuantity ?? 0) > values.maxQuantity) {
      return '最大数量不能小于最小数量';
    }
  }

  if (ruleType === 'MARKUP_RATE' && (values.markupBps === undefined || values.markupBps === null)) {
    return '加价率规则必须填写加价率';
  }
  if (ruleType === 'FIXED_PRICE' && (values.fixedPriceCents === undefined || values.fixedPriceCents === null)) {
    return '固定价规则必须填写固定价';
  }

  if (scope === 'PLATFORM' && (merchantId || productId || skuId)) {
    return '平台级规则不要填写商家、商品或规格编号';
  }
  if (scope === 'MERCHANT' && !merchantId) {
    return '商家级规则必须填写商家编号';
  }
  if (scope === 'MERCHANT' && (productId || skuId)) {
    return '商家级规则不要填写商品编号或规格编号';
  }
  if (scope === 'PRODUCT' && !productId) {
    return '商品级规则必须填写商品编号';
  }
  if (scope === 'PRODUCT' && skuId) {
    return '商品级规则不要填写规格编号';
  }
  if (scope === 'SKU' && !skuId) {
    return '规格级规则必须填写规格编号';
  }

  return null;
}

export function normalizeDeliveryPricingRulePayload(values: DeliveryPricingRuleDraft) {
  return {
    scope: values.scope ?? '',
    ruleType: values.ruleType ?? '',
    merchantId: values.scope === 'MERCHANT' ? trimOptional(values.merchantId) : undefined,
    productId: values.scope === 'PRODUCT' ? trimOptional(values.productId) : undefined,
    skuId: values.scope === 'SKU' ? trimOptional(values.skuId) : undefined,
    minQuantity: values.minQuantity ?? 1,
    maxQuantity: values.maxQuantity === null ? null : values.maxQuantity ?? undefined,
    fixedPriceCents: values.ruleType === 'FIXED_PRICE' ? values.fixedPriceCents ?? undefined : undefined,
    markupBps: values.ruleType === 'MARKUP_RATE' ? values.markupBps ?? undefined : undefined,
    priority: values.priority ?? undefined,
    isActive: values.isActive ?? undefined,
    note: trimOptional(values.note),
  };
}

export function validateDeliveryManifestCustomizationEntries(
  entries: DeliveryManifestCustomizationDraft[],
  manifestType?: DeliveryManifestCustomizationType,
): string | null {
  const seenKeys = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    const rowNo = index + 1;
    const key = trimOptional(entry.key);
    const label = trimOptional(entry.label);
    const value = trimOptional(entry.value);

    if (!key) {
      return `第 ${rowNo} 行自定义列字段标识不能为空`;
    }
    if (!CUSTOM_KEY_PATTERN.test(key)) {
      return `第 ${rowNo} 行自定义列字段标识只能用字母开头，并包含字母、数字、下划线或短横线`;
    }
    if (seenKeys.has(key)) {
      return `自定义列字段标识重复: ${key}`;
    }
    seenKeys.add(key);

    if (!label) {
      return `第 ${rowNo} 行自定义列列名不能为空`;
    }
    if (!value) {
      return `第 ${rowNo} 行自定义列内容不能为空`;
    }
    if (manifestType === 'SELLER_FULFILLMENT') {
      const combined = `${key} ${label} ${value}`;
      if (SELLER_FULFILLMENT_FORBIDDEN_TEXT_PATTERN.test(combined)) {
        return `第 ${rowNo} 行卖家配货清单自定义列不能包含金额、成本、售价、结算或加价相关内容`;
      }
    }
  }

  return null;
}

export function validateDeliveryManifestTemplateColumns(
  columns: DeliveryManifestTemplateColumnDraft[],
  manifestType?: DeliveryManifestTemplateType | string,
): string | null {
  if (manifestType !== 'SELLER_FULFILLMENT') {
    return null;
  }

  for (const [index, column] of columns.entries()) {
    const rowNo = index + 1;
    const key = trimOptional(column.key);
    const label = trimOptional(column.label);
    const combined = `${key ?? ''} ${label ?? ''}`;
    if (SELLER_FULFILLMENT_FORBIDDEN_TEXT_PATTERN.test(combined)) {
      return `第 ${rowNo} 行卖家配货清单模板列不能包含金额、成本、售价、结算或加价相关内容`;
    }
  }

  return null;
}

export function normalizeDeliveryManifestCustomizationEntries(
  entries: DeliveryManifestCustomizationDraft[],
) {
  return entries.map((entry) => ({
    key: entry.key?.trim() ?? '',
    label: entry.label?.trim() ?? '',
    value: entry.value?.trim() ?? '',
    sortOrder: entry.sortOrder ?? 0,
    visible: entry.visible ?? true,
  }));
}
