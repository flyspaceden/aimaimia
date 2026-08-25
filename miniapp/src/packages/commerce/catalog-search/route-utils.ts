export function decodeRouteText(value: unknown, maxLength = 128): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  let decoded = normalized;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    // 非法百分号不应让搜索页崩溃；保留原始文本供用户修改。
  }
  const trimmed = decoded.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export function decodeRouteCsv(value: unknown, maxItems = 8): string[] {
  const normalized = decodeRouteText(value, 256);
  if (!normalized) return [];
  return Array.from(new Set(
    normalized.split(',').map((item) => item.trim().slice(0, 32)).filter(Boolean),
  )).slice(0, maxItems);
}
