export function getAwardedPrizeQuantity(
  prizeType: string | null | undefined,
  configuredQuantity: number | null | undefined,
): number {
  if (prizeType === 'DISCOUNT_BUY') {
    return 1;
  }

  const quantity = Number(configuredQuantity ?? 1);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return 1;
  }

  return Math.floor(quantity);
}
