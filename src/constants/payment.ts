import { Platform } from 'react-native';
import { PaymentMethod } from '../types';

/**
 * 支付方式列表
 * available=false 时 UI 灰掉，点击 toast 提示，禁止 setPaymentMethod
 *
 * 排列顺序即页面展示顺序：微信 → 支付宝 → 银行卡；结算页默认选第一个 available 的方式（见 app/checkout.tsx）：
 * - 微信支付：Android 代码链路已接入，需显式开关；iOS 原生配置补齐前继续灰掉
 * - 银行卡/信用卡：未接入网联通道，v1.2 评估
 *
 * 后端按 paymentChannel 分流生成支付参数；前端开关必须与原生能力同步，
 * 避免 iOS 在未配置微信 SDK 回调时展示入口。
 * UI 必须挡住未接入渠道，避免用户踩坑。
 */
const wechatPayAvailable =
  Platform.OS === 'android' && process.env.EXPO_PUBLIC_WECHAT_PAY_AVAILABLE === 'true';

export const paymentMethods: Array<{
  value: PaymentMethod;
  label: string;
  description: string;
  available: boolean;
  comingSoon?: string;
}> = [
  {
    value: 'wechat',
    label: '微信支付',
    description: '微信账户余额或银行卡支付',
    available: wechatPayAvailable,
    comingSoon: wechatPayAvailable ? undefined : (Platform.OS === 'ios' ? 'iOS 稍后上线' : '待开通'),
  },
  {
    value: 'alipay',
    label: '支付宝',
    description:
      process.env.EXPO_PUBLIC_ALIPAY_SANDBOX === 'true'
        ? '支持快捷支付（沙箱测试中）'
        : '支持快捷支付',
    available: true,
  },
  { value: 'bankcard', label: '银行卡/信用卡', description: '支持储蓄卡与信用卡', available: false, comingSoon: 'v1.2 上线' },
];
