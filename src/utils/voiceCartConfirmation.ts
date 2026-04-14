export type VoiceCartConfirmation = {
  message: string;
  toastDurationMs: number;
  overlayDurationMs: number;
};

export function buildVoiceCartConfirmation(input: {
  productName?: string;
  query?: string;
}): VoiceCartConfirmation {
  const label = input.productName?.trim() || input.query?.trim() || '商品';

  return {
    message: `已将${label}加入购物车`,
    toastDurationMs: 4200,
    overlayDurationMs: 2200,
  };
}
