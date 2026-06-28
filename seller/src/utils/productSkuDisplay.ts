const DEFAULT_SKU_TITLE = '默认规格';

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function normalizeSkuTitle(skuTitle?: string | null): string {
  const title = skuTitle?.trim();
  return title || DEFAULT_SKU_TITLE;
}

export function hasMeaningfulSingleSkuDraftInput({
  skuTitle,
  cost,
  stock,
  weightGram,
  maxPerOrder,
}: {
  skuTitle?: string | null;
  cost?: unknown;
  stock?: unknown;
  weightGram?: unknown;
  maxPerOrder?: unknown;
}): boolean {
  const title = skuTitle?.trim();
  return Boolean(title && title !== DEFAULT_SKU_TITLE)
    || hasValue(cost)
    || hasValue(stock)
    || hasValue(weightGram)
    || hasValue(maxPerOrder);
}

export function formatSkuWeight(weightGram?: number | null): string | undefined {
  if (!Number.isFinite(weightGram) || !weightGram || weightGram <= 0) return undefined;
  if (weightGram >= 1000) {
    const kg = weightGram / 1000;
    return `${Number.parseFloat(kg.toFixed(3))}千克`;
  }
  return `${weightGram}克`;
}

export function buildSkuMetaText({
  skuTitle,
  weightGram,
  unit,
}: {
  skuTitle?: string | null;
  weightGram?: number | null;
  unit?: string | null;
}): string {
  const parts = [normalizeSkuTitle(skuTitle)];
  const weightText = formatSkuWeight(weightGram);
  if (weightText) parts.push(`重量 ${weightText}`);
  const normalizedUnit = unit?.trim();
  if (normalizedUnit) parts.push(`单位 ${normalizedUnit}`);
  return parts.join(' · ');
}

export function buildBundleSkuOptionLabel({
  productTitle,
  skuTitle,
  weightGram,
  unit,
  approved,
}: {
  productTitle: string;
  skuTitle?: string | null;
  weightGram?: number | null;
  unit?: string | null;
  approved: boolean;
}): string {
  const label = `${productTitle} / ${buildSkuMetaText({ skuTitle, weightGram, unit })}`;
  return approved ? label : `${label}（未审核通过）`;
}
