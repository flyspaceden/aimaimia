# 微信支付集成设计方案

> 日期：2026-05-10
> 范围：买家 App 微信支付主链路、退款链路、售后退货运费支付分发
> 前置依赖：[售后链路收口设计](2026-05-09-after-sale-chain-closure-design.md) 完成（支付/退款抽象层已就位）
> 结论：在现有支付抽象层基础上**新增一个 channel**，不动售后核心、不破坏现有支付宝链路。

## 1. 背景

v1.0 仅支持支付宝（沙箱已联通+生产凭据签约后即可上线）。但项目业务定位是
"农业电商平台"，目标用户群体微信使用率远高于支付宝（尤其下沉市场和中老年）。

幸运的是，本次售后链路收口（2026-05-09 完成）已经把**支付通道抽象**设计到位：

- `PaymentChannel` enum 已包含 `WECHAT_PAY` / `ALIPAY` / `UNIONPAY` / `AGGREGATOR`
- `Payment.channel` / `Refund.channel` / `CheckoutSession.paymentChannel` /
  `AfterSaleShippingPayment.provider` 字段都已落地
- `PaymentService.initiateRefund(orderId, amount, merchantRefundNo)` 签名 provider-agnostic
- `AfterSaleRefundService.startRefund` 完全不知道用的是哪家支付通道

因此加微信支付**不需要重构、不需要 schema 变更**，只需要在现有抽象层里
新增一个 provider 实现。

## 2. 现状盘点

### 2.1 已就绪（不需要改）

| 模块 | 现状 | 微信加入时是否需要改 |
|---|---|---|
| `PaymentChannel` enum | ✅ 已有 4 个值 | ❌ |
| `Payment` / `Refund` / `CheckoutSession` 字段 | ✅ 全部含 channel | ❌ |
| `PaymentService.initiateRefund` 抽象 | ✅ 签名 provider-agnostic | ⚠️ 加 channel 分支（10 行） |
| `AfterSaleRefundService` | ✅ 完全 channel-agnostic | ❌ |
| `AfterSaleReturnShippingService` 售后状态机 | ✅ 与支付无关 | ❌ |
| 售后单 UI（买家/卖家/管理）| ✅ 不读 channel | ❌ |
| 售后退款幂等键 `AS-${id}` | ✅ 不依赖 channel | ❌ |

### 2.2 需要新增

| 模块 | 工作量 | 说明 |
|---|---|---|
| `WechatPayService` 后端 service | 2-3 天 | createOrder / refund / verifyNotify / queryOrder |
| `PaymentController.handleWechatNotify` | 0.5 天 | 微信签名/参数格式跟支付宝完全不同，必须独立端点 |
| `PaymentService.handlePaymentCallback` 路由分发 | 0.5 天 | 在统一 callback 里按 channel 分发到 WechatPayService.parseNotify |
| `PaymentService.initiateRefund` 加分支 | 10 行 | `else if (channel === 'WECHAT_PAY')` |
| App 端微信 SDK 接入 | 2-3 天 | URL Scheme / Universal Link / replyApi 配置 |
| 结账页支付方式选择 UI | 1 天 | 当前只有支付宝按钮，改为 Tab 或单选列表 |
| App 重打 APK/IPA | 半天 | 微信 SDK 是 native 模块，**必须 `eas build`，不能 OTA** |

### 2.3 唯一需要修的现有代码（小坑）

`AfterSaleShippingPaymentService.createOrGetPayment` 当前硬编码 `provider: 'ALIPAY'`：

```ts
// backend/src/modules/after-sale/after-sale-shipping-payment.service.ts
{
  provider: 'ALIPAY',  // ← hardcoded，加微信时需要按订单 channel dispatch
  merchantPaymentNo: `AS_SHIP_PAY_${afterSaleId}`,
  ...
}
```

业务逻辑：买家付退货运费应该走**跟原订单同一支付通道**——不能原订单微信付
但运费让买家用支付宝。修复时：lookup Order 关联的 Payment 或 CheckoutSession
拿到 paymentChannel，写入 `provider` 字段。改动量 3-5 行。

## 3. 设计目标

1. 买家在结账页可以选"支付宝/微信"二选一付款
2. 微信支付的订单可以在售后链路完整闭环（包括退款 + 退货运费支付）
3. 售后核心服务**零改动**——这是本次设计的核心收益
4. 微信生产凭据通过 `.env` + `docs/operations/密码本.md` 管理，**绝不明文 commit**
5. App 端按 channel 动态文案（微信退款到账几分钟，跟支付宝时长基本一致）

## 4. 非目标

- 不做"聚合支付"产品（如付呗、收钱吧）
- 不做"扫码支付"（线下场景）
- 不做 H5 微信支付（公众号场景），仅做 App 原生 SDK 支付
- 不做信用卡支付（v1.2+）
- 不做"分账"（微信支付分账接口）

## 5. 微信支付差异点（vs 支付宝）

### 5.1 支付方面

| 维度 | 支付宝 | 微信支付 |
|---|---|---|
| 客户端唤起 | `alipay.trade.app.pay` 返回字符串，App SDK 调起 | 后端调 `pay/transactions/app` 返回 prepay_id，前端签名后唤起 |
| 签名算法 | RSA2（SHA256withRSA）| HMAC-SHA256 或 RSA（v3 API 用 RSA-OAEP） |
| 凭据 | APP_ID + 应用私钥 + 支付宝公钥（或证书） | 商户号 mchid + AppID + 商户证书 + APIv3 密钥 |
| 网关 | `openapi.alipay.com/gateway.do` | `api.mch.weixin.qq.com/v3/pay/transactions/app` |
| Notify 验签 | sign 字段 RSA2 校验 | Wechatpay-Signature header + 平台证书校验 |
| 沙箱 | `openapi-sandbox.dl.alipaydev.com` | **无独立沙箱**——必须用真账号小金额测 |

### 5.2 退款方面

| 维度 | 支付宝 | 微信支付 |
|---|---|---|
| 接口 | `alipay.trade.refund` | `refund/domestic/refunds` |
| 幂等键字段 | `out_request_no` | `out_refund_no` |
| 退款查询 | 同接口 | `refund/domestic/refunds/{out_refund_no}` |
| 异步通知 | 不发推送（除非订阅） | **发送独立的退款 notify**（refund/notify） |
| 到账时间 | 沙箱即时 / 生产 1-2 小时 | 生产分钟级到账 |

### 5.3 App 端差异

| 维度 | 支付宝 | 微信支付 |
|---|---|---|
| iOS Universal Link | 可选（推荐） | **必须**（微信 7.0+ 强制） |
| Android Package Name 注册 | 不需要 | **必须**在微信开放平台注册 + 签名 MD5 |
| URL Scheme | `alipays://` | `wechat://` 或自定义 |
| App SDK | `react-native-alipay` 或 expo plugin | `react-native-wechat-lib` 或同等 |
| 调起后回跳 | 自动回 App | 需 onResp 监听 |

### 5.4 微信支付**没有沙箱**

支付宝有 `openapi-sandbox.dl.alipaydev.com` 测试网关，但**微信支付没有等价的沙箱环境**。
集成时只能：

1. 用真商户账号 + APIv3 密钥
2. 用小金额（0.01 元）真实支付测试
3. 退款也走真实通道（小金额会很快退回）
4. 商户后台可查所有测试流水

⚠️ 这意味着**联调阶段会有真实小金额流转**，需要商户账户预存几百元测试备金。

## 6. 数据层（已就绪，无需改动）

以下字段已经在 spec `2026-05-09-after-sale-chain-closure-design.md` 中预留：

```prisma
enum PaymentChannel {
  WECHAT_PAY
  ALIPAY
  UNIONPAY
  AGGREGATOR
}

model CheckoutSession {
  paymentChannel PaymentChannel   // 创建会话时记录用哪家
  merchantOrderNo String           // 商户订单号（CS-xxx，传给支付方作 out_trade_no）
  ...
}

model Payment {
  channel PaymentChannel
  merchantOrderNo String   // = CheckoutSession.merchantOrderNo
  ...
}

model Refund {
  channel PaymentChannel
  merchantRefundNo String  // = AS-${afterSaleId} 或其他
  ...
}

model AfterSaleShippingPayment {
  provider String   // 当前 hardcoded "ALIPAY"，加微信时按订单 channel dispatch
  merchantPaymentNo String  // = AS_SHIP_PAY_${afterSaleId}
  ...
}
```

## 7. 后端模块设计

### 7.1 WechatPayService（新建）

`backend/src/modules/payment/wechat-pay.service.ts`

```ts
@Injectable()
export class WechatPayService {
  private readonly mchId: string;
  private readonly appId: string;
  private readonly apiV3Key: string;
  private merchantPrivateKey: Buffer;
  private merchantCertSerial: string;
  private platformCert: Buffer;  // 自动下载并缓存

  // 创建预支付订单（返回 prepay_id 给 App）
  async createAppOrder(params: {
    outTradeNo: string;     // 商户订单号 = CheckoutSession.merchantOrderNo
    amount: number;          // 元
    description: string;
    notifyUrl: string;
    timeExpire?: Date;
  }): Promise<{
    prepayId: string;        // 给 App SDK 用
    paySign: string;         // 二次签名给 App SDK
    nonceStr: string;
    timestamp: string;
    package: string;
  }>;

  // 退款
  async refund(params: {
    outTradeNo: string;      // 原订单
    outRefundNo: string;     // 退款幂等键 AS-${id}
    refundAmount: number;
    totalAmount: number;     // 原订单总额，微信必填
    reason?: string;
    notifyUrl?: string;
  }): Promise<{
    success: boolean;
    providerRefundId?: string;
    message: string;
  }>;

  // 解析微信回调（支付/退款）
  parseNotify(body: any, signature: string, timestamp: string, nonce: string): {
    type: 'payment' | 'refund';
    outTradeNo: string;
    outRefundNo?: string;
    tradeState: 'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'REFUND';
    transactionId: string;
    amount: number;
    paidAt?: Date;
  };

  // 查询订单（兜底补偿）
  async queryOrder(outTradeNo: string): Promise<{
    tradeState: string;
    transactionId: string;
    totalAmount: number;
  } | null>;
}
```

### 7.2 PaymentController 端点扩展

```ts
// 新增微信支付回调端点（独立于 alipay notify）
@Public()
@Post('wechat/notify')
async handleWechatNotify(
  @Headers() headers: Record<string, string>,
  @Body() body: any,
  @Res() res: Response,
) {
  const signature = headers['wechatpay-signature'];
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const serial = headers['wechatpay-serial'];

  try {
    const result = this.wechatPay.parseNotify(body, signature, timestamp, nonce);
    if (result.type === 'payment') {
      // 委托 PaymentService 统一处理（与 alipay notify 同样的 handlePaymentCallback）
      await this.paymentService.handlePaymentCallback({
        merchantOrderNo: result.outTradeNo,
        providerTxnId: result.transactionId,
        status: result.tradeState === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        paidAt: result.paidAt,
        channel: 'WECHAT_PAY',
      });
    } else if (result.type === 'refund') {
      // 微信支付独有：退款异步通知
      await this.paymentService.handleRefundNotify({
        merchantRefundNo: result.outRefundNo!,
        providerRefundId: result.transactionId,
        status: 'SUCCESS',
      });
    }
    res.status(200).json({ code: 'SUCCESS' });
  } catch (err) {
    res.status(401).json({ code: 'FAIL', message: err.message });
  }
}
```

### 7.3 PaymentService.initiateRefund 加分支

```ts
if (channel === 'ALIPAY') {
  // 当前已实现
  ...
} else if (channel === 'WECHAT_PAY') {
  if (!this.wechatPay.isAvailable()) {
    return { success: false, message: '微信支付 SDK 未初始化' };
  }
  const result = await this.wechatPay.refund({
    outTradeNo: providerOrderNo!,
    outRefundNo: refundNo,
    refundAmount: amount,
    totalAmount: originalAmount,    // 需从 Payment.amount 拿
    reason: '用户退款',
  });
  return {
    success: result.success,
    providerRefundId: result.success ? refundNo : undefined,
    message: result.message,
  };
}

throw new NotImplementedException(`退款渠道 ${channel} 暂未接入`);
```

### 7.4 AfterSaleShippingPaymentService 修正（最小改动）

```ts
async createOrGetPayment(afterSaleId: string) {
  // ...
  // 查原订单的 paymentChannel 决定运费支付通道
  const order = await tx.order.findUnique({
    where: { id: afterSale.orderId },
    select: { checkoutSessionId: true, payments: { take: 1, orderBy: { createdAt: 'desc' } } }
  });
  const channel =
    order.payments[0]?.channel
    ?? (await tx.checkoutSession.findUnique({ where: { id: order.checkoutSessionId! } }))?.paymentChannel
    ?? 'ALIPAY';

  await tx.afterSaleShippingPayment.upsert({
    create: {
      ...,
      provider: channel,    // ← 不再 hardcoded
    },
    ...
  });
}
```

售后链路其他代码**不动**。

## 8. App 端集成

### 8.1 依赖

```json
{
  "dependencies": {
    "react-native-wechat-lib": "^3.0.0"     // 或 expo-wechat-pay
  }
}
```

⚠️ **这是原生模块**，必须 `eas build` 重打 APK/IPA。

### 8.2 Expo Plugin 配置

```js
// app.json
{
  "expo": {
    "plugins": [
      ["react-native-wechat-lib", {
        "appid": "wx*****",
        "universalLink": "https://app.ai-maimai.com/wechat/"
      }]
    ],
    "ios": {
      "bundleIdentifier": "com.aimaimai.app",
      "associatedDomains": ["applinks:app.ai-maimai.com"]
    },
    "android": {
      "package": "com.aimaimai.app"
    }
  }
}
```

### 8.3 结账页支付方式选择

```tsx
// app/checkout/[sessionId].tsx
const [channel, setChannel] = useState<'ALIPAY' | 'WECHAT_PAY'>('ALIPAY');

<View>
  <Pressable onPress={() => setChannel('ALIPAY')}>...支付宝...</Pressable>
  <Pressable onPress={() => setChannel('WECHAT_PAY')}>...微信...</Pressable>
</View>

<Button onPress={async () => {
  const session = await CheckoutRepo.create({ ..., paymentChannel: channel });
  if (channel === 'ALIPAY') {
    payWithAlipay(session.alipayOrderString);
  } else {
    payWithWechat(session.wechatPaySign);
  }
}} />
```

### 8.4 微信支付调起 + 回调

```tsx
import * as WeChat from 'react-native-wechat-lib';

async function payWithWechat(payload: {
  prepayId: string;
  paySign: string;
  nonceStr: string;
  timestamp: string;
  package: string;
}) {
  await WeChat.pay({
    partnerId: WECHAT_MCH_ID,
    prepayId: payload.prepayId,
    nonceStr: payload.nonceStr,
    timeStamp: payload.timestamp,
    package: payload.package,
    sign: payload.paySign,
  });

  // 监听支付结果（不依赖：以后端 notify 为准）
}
```

## 9. UX/文案差异

| 场景 | 支付宝文案 | 微信文案 |
|---|---|---|
| 结账页"立即支付" | "支付宝支付" | "微信支付" |
| 订单详情"支付方式" | "支付宝" | "微信支付" |
| 售后详情"退款方式" | "退至支付宝" | "退至微信钱包" |
| 退款进度 | "退款已完成" | "退款已完成"（同左，分钟级到账）|

不需要"退款 7-30 天到账"类长延迟文案（那是信用卡才需要）。

## 10. 配置项

### 10.1 `.env` 新增

```bash
# ━━━━━━━━━━ 微信支付 ━━━━━━━━━━
WECHAT_PAY_APP_ID="wx*****"
WECHAT_PAY_MCH_ID="1234567890"
WECHAT_PAY_API_V3_KEY="<32位字符>"
WECHAT_PAY_MERCHANT_CERT_SERIAL="<证书序列号>"
WECHAT_PAY_MERCHANT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
WECHAT_PAY_NOTIFY_URL="https://api.ai-maimai.com/api/v1/payments/wechat/notify"
WECHAT_PAY_REFUND_NOTIFY_URL="https://api.ai-maimai.com/api/v1/payments/wechat/notify"  # 微信退款 notify 走同一端点
```

⚠️ **凭据必须存到 `docs/operations/密码本.md`（gitignored）**，严禁明文写入任何会被 commit 的文件。
本 spec 文档中的示例全部用占位符。

### 10.2 App 端 EAS env

```json
// eas.json
{
  "build": {
    "preview": {
      "env": {
        "EXPO_PUBLIC_WECHAT_PAY_APP_ID": "wx_xxx",
        "EXPO_PUBLIC_WECHAT_PAY_MCH_ID": "1234567890"
      }
    }
  }
}
```

## 11. 实施 Phase 拆分

### Phase 1：申请凭据（用户线下，1-4 周）

- 注册微信支付商户号（mch.weixin.qq.com）
- 完成企业认证（营业执照 + 法人证件）
- 申请 APP 支付产品（需要先发布 App 到商店——这部分有鸡生蛋问题）
- 下载商户证书 + APIv3 密钥
- 微信开放平台注册移动应用 → 拿 AppID + 签名 MD5

### Phase 2：后端集成（4-5 天）

- [ ] 写 `WechatPayService`（含签名/验签/createOrder/refund/parseNotify）
- [ ] 写单元测试（mock SDK）
- [ ] `PaymentController.handleWechatNotify` 端点
- [ ] `PaymentService.handlePaymentCallback` 加 channel 分发
- [ ] `PaymentService.initiateRefund` 加 WECHAT_PAY 分支
- [ ] `AfterSaleShippingPaymentService` 改 provider dispatch（3-5 行）
- [ ] `.env.example` 加新变量；`密码本.md` 写真实凭据
- [ ] Nginx 配置 `/api/v1/payments/wechat/notify` 公网可达

### Phase 3：App 端集成（3-4 天）

- [ ] 装 `react-native-wechat-lib` + Expo Plugin
- [ ] `app.json` 配 universalLink / bundleIdentifier
- [ ] `src/utils/wechat-pay.ts` 封装调起逻辑
- [ ] `src/repos/CheckoutRepo.ts` createSession 加 channel 参数
- [ ] 结账页加支付方式选择 UI
- [ ] **`eas build --profile preview` 重打 APK**（必须）
- [ ] iOS Universal Link 验证（apple-app-site-association）
- [ ] 真机扫小金额测试（0.01 元）

### Phase 4：联调（1-2 天）

- [ ] 真机支付 → 后端收到 notify → Order 状态推到 PAID
- [ ] 真机申请售后 → 卖家通过 → 退款触发 → 微信收到退款异步通知
- [ ] 售后退货运费支付（微信通道）→ 取消面单退还运费
- [ ] 验证 sub_code 错误码透出（类比支付宝那次修复）

### Phase 5：上线检查 + 灰度（1 天）

- [ ] 商户后台开启 APP 支付权限
- [ ] 生产 `.env` 写凭据 + 重启
- [ ] Nginx 配生产 notify URL
- [ ] App 重打 production AAB
- [ ] 灰度 10 个用户验证 1-2 天
- [ ] 全量切换

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **微信无沙箱**，必须真账号小金额测 | 商户预存几百元测试备金；每次测完手动退款 |
| 商户证书过期（默认 5 年）| 部署文档加证书过期监控；提前 30 天告警 |
| APIv3 密钥重置导致旧签名失效 | 重置流程需停服切换；写明操作手册 |
| 微信回调签名校验失败被刷接口 | 必须做白名单 + 签名 + 时间戳防重放 |
| Universal Link 配置错误导致 iOS 回跳失败 | 上线前用真机 + safari 验证 .well-known/apple-app-site-association |
| App 没上架商店但需要 APP 支付权限 | 用 testflight / 内测包先申请；或者先做 H5 支付过渡 |
| 商户余额不足导致退款失败 | 上线前预存 + 监控告警 |

## 13. 上线 Checklist（合并到 staging-to-production.md）

参考 `docs/operations/staging-to-production.md` 同样形式增补：

- [ ] 微信支付商户号已开通 APP 支付权限
- [ ] 商户证书未过期（≥ 30 天）
- [ ] `.env` 凭据已与 `密码本.md` 一致
- [ ] Nginx 已配 `/api/v1/payments/wechat/notify` 路由
- [ ] 微信开放平台 → APP → 签名 MD5 与 APK 实际签名一致
- [ ] Universal Link 验证通过（iOS）
- [ ] App 已重打 production AAB 含 wechat-lib 原生模块
- [ ] 商户账户余额 ≥ 5000 元（覆盖前 100 单退款备金）

## 14. 验收标准

- 买家在结账页可选支付宝/微信
- 微信支付订单可完整走完售后链路（退款 + 退货运费）
- 售后链路代码改动 = 0（除 AfterSaleShippingPaymentService 的 3-5 行 dispatch）
- `RefundStatusHistory.remark` 在微信退款失败时也能展示真实错误码
- 管理后台/卖家中心售后详情区分显示 channel（"支付宝" / "微信支付"）
- 沙箱测试无依赖（已知微信无沙箱，文档明确）

## 15. 后续延伸

完成微信支付后，可按相同模式追加：

- **银联（UNIONPAY）**：补 `UnionpayService` + initiateRefund 分支
- **信用卡（AGGREGATOR）**：对接 Stripe / Adyen，但要警惕**信用卡退款 7-30 天到账**，App 文案需特别处理
- **分账**：v1.2 商户结算自动化（微信支付分账 / 支付宝商家转账）

每加一个新 channel，售后链路依然是 0 改动——这是本次抽象的长期红利。
