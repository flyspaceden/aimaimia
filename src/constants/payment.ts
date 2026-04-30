import { PaymentMethod } from '../types';

/**
 * 支付方式列表
 * available=false 时 UI 灰掉，点击 toast 提示，禁止 setPaymentMethod
 *
 * 当前 v1.0 仅接通支付宝（沙箱测试中）：
 * - 微信支付：腾讯审核中，v1.1 上线
 * - 银行卡/信用卡：未接入网联通道，v1.2 评估
 *
 * 后端 backend/src/modules/order/checkout.service.ts:112 仅对 ALIPAY 渠道
 * 生成 orderStr，其他渠道走 simulatePayment 在生产/staging 必失败 → 弹"支付触发失败"。
 * UI 必须挡住未接入渠道，避免用户踩坑。
 */
export const paymentMethods: Array<{
  value: PaymentMethod;
  label: string;
  description: string;
  available: boolean;
  comingSoon?: string;
}> = [
  { value: 'alipay', label: '支付宝', description: '支持快捷支付（沙箱测试中）', available: true },
  { value: 'wechat', label: '微信支付', description: '微信账户余额或银行卡支付', available: false, comingSoon: 'v1.1 上线' },
  { value: 'bankcard', label: '银行卡/信用卡', description: '支持储蓄卡与信用卡', available: false, comingSoon: 'v1.2 上线' },
];
