import { PaymentMethod } from '../types';

export const paymentMethods: Array<{ value: PaymentMethod; label: string; description: string }> = [
  { value: 'wechat', label: '微信支付', description: '推荐使用微信支付' },
  { value: 'alipay', label: '支付宝', description: '支持快捷支付' },
];
