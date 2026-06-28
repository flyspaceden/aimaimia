export function formatProductWeightGram(weightGram?: number | null): string | undefined {
  if (!Number.isFinite(weightGram) || !weightGram || weightGram <= 0) return undefined;
  if (weightGram >= 1000) {
    const kg = weightGram / 1000;
    return `${Number.parseFloat(kg.toFixed(3))}千克`;
  }
  return `${weightGram}克`;
}

export function buildProductUnitLabel(unit?: string | null): string | undefined {
  const normalized = unit?.trim();
  return normalized ? `单位 ${normalized}` : undefined;
}

export function buildProductWeightLabel(weightGram?: number | null): string | undefined {
  const weightText = formatProductWeightGram(weightGram);
  return weightText ? `包装重量 ${weightText}` : undefined;
}
