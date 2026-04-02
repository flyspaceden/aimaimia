/**
 * 域模型：支付（Payment）
 *
 * 用途：
 * - 订单/参团/众筹/打赏等的支付方式选择（占位）
 *
 * 后端接入建议：
 * - 支付应由后端创建支付单并接入微信/支付宝回调
 */
/**
 * 前端支付方式标识（与后端 PaymentChannel 枚举映射）
 * - wechat → WECHAT_PAY
 * - alipay → ALIPAY
 * - bankcard → UNIONPAY
 * 前端统一使用小写格式，后端 DTO 只接受小写，由 CHANNEL_MAP 转换为 Prisma 枚举
 */
export type PaymentMethod = 'wechat' | 'alipay' | 'bankcard';
