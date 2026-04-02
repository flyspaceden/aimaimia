/**
 * 域模型：支付（Payment）
 *
 * 用途：
 * - 订单/参团/众筹/打赏等的支付方式选择（占位）
 *
 * 后端接入建议：
 * - 支付应由后端创建支付单并接入微信/支付宝回调
 */
export type PaymentMethod = 'wechat' | 'alipay';
