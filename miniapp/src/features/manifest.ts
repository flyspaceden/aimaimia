/** 小程序渠道能力清单；不得用页面内临时判断绕过。 */
export const featureManifest = {
  delivery: false,
  alipayPayment: false,
  alipayWithdraw: false,
  wechatPayment: true,
  wechatWithdraw: true,
  vipPurchase: true,
  aiVoice: true,
  customerService: true,
} as const;
