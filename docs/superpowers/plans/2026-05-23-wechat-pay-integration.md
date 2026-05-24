# 微信支付接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有支付宝主链路之外，新增微信支付通道，覆盖普通商品下单、VIP 礼包下单、续付、主动查单兜底、取消/过期关单、退款（含 PROCESSING 二态闭环）、售后退货运费支付/退款等全链路；支付宝已通过沙箱验证的行为必须保持不变，并用回归测试锁住。

**Architecture:** 走 "**支付宝行为不变，微信并列分支**" 路线。后端新建独立 `WechatPayService`（镜像 `AlipayService` 结构，含 createAppOrder / refund / queryRefund / parseNotify / queryOrder / closeOrder 全套），所有改动用支付宝回归测试证明现有行为未变。**资金链路 7 道安全门**：(1) `WechatPayService.isAvailable()` 守门凭据未配齐场景；(2) `wechat/notify` 使用 raw body 验签，解密后强校验 amount.total + appid + mchid；(3) 退款 `pending` 二态——HTTP 200 仅"受理"，真实结果由退款申请响应 `data.status`、`queryRefund`、refund.notify 三路闭环；(4) `confirmCheckout`（原 `confirmAlipayCheckout`）按 channel 派发到对应 `queryOrder`，notify 慢/丢失时仍能落单；(5) `cancelSession` / `CheckoutExpireService` 对 WECHAT_PAY 也必须先 `queryOrder`，未支付再 `closeOrder`，已支付则主动建单；(6) `AfterSaleShippingPaymentService` 退货运费支付与退款都按原订单 paymentChannel dispatch；(7) 微信所有商户订单号控制在官方 32 字符限制内。App 端新建 `src/utils/wechat-pay.ts`，并补 Android `WXPayEntryActivity`；在 `app/checkout.tsx`（普通+VIP）/ `app/checkout-pending.tsx` / `src/components/overlay/PendingCheckoutBanner.tsx` / 售后详情页四处现有 alipay 分支后插入并列的 wechat 分支。

**范围限定（v1.0）：Android only**。`plugins/withWechat.js` 注释明确"iOS 部分待 Apple Developer 账号（U06）就绪后再补"——微信登录目前也是 Android-only，支付沿用同一原生模块和同一 plugin，**与登录同步**到 U06 后再补 iOS 配置（CFBundleURLTypes / LSApplicationQueriesSchemes / Universal Link 等）。

**Tech Stack:** NestJS 11 + Prisma 6 + PostgreSQL；npm + `package-lock.json`（本仓库无 pnpm）；`wechatpay-node-v3@^2.2.1`（SDK 返回统一为 `{ status, data }`，业务字段必须从 `result.data` 读取；构造函数需 `apiclient_cert.pem` + `apiclient_key.pem` 两份 Buffer；APP 支付用 `transactions_app`，查单用 `query`，关单用 `close`，退款用 `refunds` / `find_refunds`）；React Native 0.81 + Expo Router；`react-native-wechat-lib@1.1.27`（已装，登录在用，支付复用同一原生模块，但 Android 支付必须额外生成 `WXPayEntryActivity`）；Jest + ts-jest。

---

## Scope Check

本计划覆盖 `docs/superpowers/specs/2026-05-10-wechat-pay-integration-design.md` 的"v1.0 App 支付主链路 + 主动查单 + 取消/过期关单 + 退款 + 售后退货运费支付分发"范围，**不包括**：
- 微信提现（`initiateTransfer` 的 WECHAT_PAY 分支）—— v1.0 提现仅支付宝
- H5 / 公众号 / 小程序 / 扫码支付 —— spec 第 4 节明确非目标
- 微信分账 —— v1.2+ 评估
- 翻 `paymentMethods` 的 `available: true` —— 必须等 APP 支付权限审核通过 + 真小金额联调全通过后由用户手动开启

任务全部围绕一套支付通道抽象，不拆成多个独立计划。

---

## 前置事实

1. **微信支付 V3 没有沙箱**——所有"真实调起微信收银台"的测试必须等微信开放平台 + 微信支付商户平台审核完毕（依赖 App 先上架）。本计划全部代码可在审核期间完成，单元测试通过 SDK Mock 验证。
2. **现有支付宝沙箱已通过测试，禁止改变支付宝行为**：以下代码区域属于"高风险区"，可以为了 channel dispatch 做最小必要改造，但必须保留支付宝分支逻辑等价，并用回归测试证明：
   - `backend/src/modules/payment/alipay.service.ts` 整文件
   - `backend/src/modules/payment/payment.service.ts:420-437`（`if (channel === 'ALIPAY')` 退款分支，允许仅补 `pending:false`）
   - `backend/src/modules/payment/payment.controller.ts:72-281`（alipay/notify + alipay/transfer-notify 整段）
   - `backend/src/modules/order/checkout.service.ts:141-168 / 1080-1101 / 1423-1442` 内的 `if (paymentChannel === 'ALIPAY' && ...)` 块本身
   - `src/utils/alipay.ts` 整文件
   - `app/checkout.tsx:579-609`（alipay 分支体）
3. **Prisma `PaymentChannel` enum 已含 `WECHAT_PAY`**（`backend/prisma/schema.prisma:201-206`），无需 schema 变更，无需 migration。
4. **`react-native-wechat-lib` 已经初始化**（`src/services/wechat.ts:67`），支付复用同一 `_initialized` 注册。
5. **金额单位约束**：CLAUDE.md 规定项目内部全部用 `Float / 元`；微信 V3 API 要求 `Int / 分`，转换**只在 `WechatPayService` 内部发生**，对外接口仍是元。
6. **Android 支付回调约束**：`plugins/withWechat.js` 当前只生成 `WXEntryActivity`（登录/分享回调用），微信支付还需要同包名下的 `WXPayEntryActivity`，否则原生支付结果无法稳定回传到 JS。
7. **取消/过期资金安全约束**：现有支付宝已在 `CheckoutService.cancelSession` 和 `CheckoutExpireService.expireSession` 做了"先查单、已支付主动建单、未支付关单后再过期"。微信必须补同等分支，不能只补下单和 notify。

---

## File Structure

后端新增：

- Create `backend/src/modules/payment/wechat-pay.service.ts`：微信支付 V3 服务（createAppOrder / refund / queryRefund / parseNotify / queryOrder / closeOrder / isAvailable）。
- Create `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`：Mock `wechatpay-node-v3` SDK 的单元测试。
- Create `backend/src/modules/payment/__tests__/payment.service.wechat-refund.spec.ts`：`PaymentService.initiateRefund` WECHAT_PAY 分支的单元测试。
- Create `backend/src/modules/payment/__tests__/wechat-notify.controller.spec.ts`：`PaymentController.handleWechatNotify` 端点的单元测试。
- Create `backend/src/modules/order/__tests__/checkout-wechat-close.spec.ts`：`cancelSession` / `CheckoutExpireService` 的 WECHAT_PAY 查单 + 关单 + 已支付主动建单回归测试。
- Create `backend/src/modules/after-sale/__tests__/after-sale-shipping-payment.provider-dispatch.spec.ts`：售后退货运费支付单 provider dispatch 回归测试（含支付宝订单回归 + 微信订单新路径）。

后端修改：

- Modify `backend/src/modules/payment/payment.service.ts`：
  - 构造函数增加 `@Optional() WechatPayService` 注入
  - `initiateRefund` 加 WECHAT_PAY 分支 + 返回类型新增 `pending` 字段
  - 新增 `assertWechatAmountMatchesSession` / `assertWechatAfterSaleShippingPaymentAmountMatches` / `handleWechatRefundNotify` 三个 helper
  - **重命名** `confirmAlipayCheckout` → `confirmCheckout` 加 channel dispatch（保留旧名兼容包装）
  - `retryStaleAutoRefunds` cron 对 `REFUNDING + providerRefundId` 的微信 pending 退款先走 `queryRefund`，不能重复发起退款，也不能从 candidates 排除
- Modify `backend/src/modules/payment/payment.controller.ts`：新增 `@Post('wechat/notify')` 独立端点（用 `req.rawBody` 验签 + 支付通知 appid/mchid 校验 + 退款通知 mchid 校验 + 金额校验 + 退款真实闭环）
- Modify `backend/src/modules/payment/payment.module.ts`：注册并导出 `WechatPayService`。
- Modify `backend/src/modules/order/order.controller.ts`：active-query 调用点改为 `confirmCheckout`。
- Modify `backend/src/modules/order/checkout.service.ts`：三处现有 `if (session.paymentChannel === 'ALIPAY' && ...)` 块后各插入并列的 `else if (session.paymentChannel === 'WECHAT_PAY' && ...)` 块；`cancelSession` 增加 WECHAT_PAY 查单/关单资金安全分支；可选注入 `WechatPayService`。
- Modify `backend/src/modules/order/checkout-expire.service.ts`：过期任务增加 WECHAT_PAY 查单/关单资金安全分支，保持和支付宝同等语义。
- Modify `backend/src/modules/order/order.module.ts`：通过 `ModuleRef` 同时把 `WechatPayService` set 到 `CheckoutService` 和 `CheckoutExpireService`。
- Modify `backend/src/modules/order/order.service.ts`：PAID 未发货取消退款 / 整 session 取消退款消费 `result.pending`，微信 PROCESSING 只保存 providerRefundId 并保持 REFUNDING，不能立即标 REFUNDED。
- Modify `backend/src/modules/after-sale/after-sale-shipping-payment.service.ts`：退货运费支付单 `provider` 按原订单 paymentChannel 动态 dispatch；支付参数和退款按 provider 生成；微信商户单号短码化以满足 32 字符限制；新增微信退款通知处理。
- Modify `backend/src/modules/after-sale/after-sale.module.ts`：把 `WechatPayService` 通过 `ModuleRef` 注入到 `AfterSaleShippingPaymentService`。
- Modify `backend/src/modules/after-sale/after-sale-refund.service.ts`：新增 `dispatchRefundResult` 内部方法，`startRefund` / `retryStaleRefund` 改走统一分发（按 `result.pending` 区分立即完成 / 等通知）。
- Modify `backend/.env.example`：补 8 个 `WECHAT_PAY_*` 占位变量（含 `WECHAT_PAY_MERCHANT_CERT` + `_PATH`，全部占位符，**绝不写真实值**）。

买家 App 新增/修改：

- Modify `plugins/withWechat.js`：Android 额外生成并注册 `WXPayEntryActivity.java`，支付回调用；保留现有 `WXEntryActivity` 登录能力不变。
- Create `src/utils/wechat-pay.ts`：`payWithWechat(payload)` 封装，结构镜像 `src/utils/alipay.ts`；用 `react-native-wechat-lib` 的 `pay()` API。**Android only**（与登录同步）。
- Modify `src/repos/OrderRepo.ts`：新增 `WechatPaymentParams` / `AlipayPaymentParams` union，修正 `CheckoutSessionResult.paymentParams` 和 `resumeCheckout` 返回类型。
- Modify `src/repos/AfterSaleRepo.ts`：售后退货运费 `paymentParams` 类型新增 wechat 分支。
- Modify `app/checkout.tsx`：**两处** alipay 分支后各插入并列的 wechat 分支——普通结算 `handleCheckout`（≈ 行 579-628）+ VIP 礼包 `handleVipCheckout`（≈ 行 707-770，含 6001 二次确认逻辑镜像）。同时在 `paymentMethod === 'alipay'` 兜底文案后并列 `paymentMethod === 'wechat'` 兜底文案（修 bug：选了微信但后端没返 prepayId 时会落到"请使用支付宝"）。
- Modify `app/checkout-pending.tsx`：在 `handleResume` 里把 alipay-only 逻辑改成按 channel dispatch。
- Modify `src/components/overlay/PendingCheckoutBanner.tsx`：首页/购物车顶部"未完成订单"横幅的 `handleResume` 同样按 channel dispatch（**v1.0 必备 — 这是用户最常用的续付入口之一**）。
- Modify `app/orders/after-sale-detail/[id].tsx`：买家售后退货运费支付按 `paymentParams.channel` dispatch 到 alipay/wechat，并保持 `merchantPaymentNo` active-query 兜底。
- Modify `src/constants/payment.ts`：把 `wechat.available` 翻 true + 同步注释——**条件触发**，仅在用户明确"APP 支付权限已批 + 真金联调通过"后执行。
- Modify `src/content/legal/privacyPolicy.ts`：微信支付从"拟集成"更新为实际集成，并补 SDK 名称 `react-native-wechat-lib` / 共享字段说明。

管理后台修改：

- Modify `admin/src/pages/orders/detail.tsx`：第 20-25 行**局部** `paymentChannelLabel` 表把遗留 `WECHAT` key 改成 `WECHAT_PAY`，并补 `UNIONPAY/AGGREGATOR` 中文 label。（admin 中央 `statusMaps.ts:117-119` 已正确，无需改。）

卖家后台：

- **无改动**。`grep` 全文确认 `seller/src/` 不展示支付方式 / 退款方式（卖家只关心订单是否已付款，不关心通过什么渠道），所以加微信通道不影响卖家端。

原生配置：

- **Android v1.0 必须改**：`plugins/withWechat.js` 当前只生成 `WXEntryActivity`。微信支付需要同包名下额外 `WXPayEntryActivity`，内容同样调用 `WeChatModule.handleIntent(getIntent())`，并在 AndroidManifest 注册。
- **iOS v1.0 不在范围**：`plugins/withWechat.js:9-12` 头注释明确"iOS 部分待 Apple Developer 账号（U06）就绪后再补"；微信登录目前也是 Android-only。iOS 与登录同步到 U06 后补 CFBundleURLTypes / LSApplicationQueriesSchemes / Universal Link / AppDelegate.continueUserActivity / openURL。**不在本计划新增 iOS 任务**。

文档：

- Modify `docs/operations/密码本.md`：新增"微信支付"段落（gitignored），占位 8 个真实凭据字段。
- Modify `CLAUDE.md`：在"关键架构决策"表追加"微信支付集成"行，在"相关文档"加上本计划。
- Modify `AGENTS.md`：在文档列表追加本计划（项目规则要求所有新文档必须登记）。
- Modify `plan.md`：追加 v1.1 "微信支付接入"条目并打上未完成 checkbox。

---

## Execution Rules

- 每个 Task 一个本地 commit，commit message 用 `type(scope): 描述`，例如 `feat(payment/wechat): add WechatPayService skeleton with isAvailable guard`。
- 本仓库使用 npm + `package-lock.json`，不要新增 `pnpm-lock.yaml` / `yarn.lock`。
- 支付宝高风险区允许为 channel dispatch 做最小改造，但每次必须跑对应支付宝回归测试，确认行为不变。
- 后端每个 Task 提交前跑：`cd backend && npx tsc --noEmit && npm test -- <changed-test-file>`。
- App 端 Task 提交前跑：`npx tsc -b --noEmit`。
- **绝不在任何 .env.example 或 commit 文件里写真实凭据**——真实值只去 `docs/operations/密码本.md`（gitignored）。
- 凭据未配齐时 `WechatPayService.isAvailable()` 必返 false，保证测试和生产启动都不挂。

---

## Task 1: 安装依赖 + 写 .env.example 占位

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/.env.example`

- [ ] **Step 1: 进入 backend 目录安装 SDK**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npm install wechatpay-node-v3
```

Expected:
- `backend/package.json` 的 `dependencies` 多一行 `"wechatpay-node-v3": "^x.y.z"`
- `backend/package-lock.json` 更新

- [ ] **Step 2: 在 `backend/.env.example` 末尾追加微信支付段**

Append to `backend/.env.example`:

```bash

# ━━━━━━━━━━ 微信支付（v1.1） ━━━━━━━━━━
# 真实凭据见 docs/operations/密码本.md（gitignored），此处仅占位
# 申请流程：详见 docs/superpowers/specs/2026-05-10-wechat-pay-integration-design.md
WECHAT_PAY_APP_ID=""
WECHAT_PAY_MCH_ID=""
WECHAT_PAY_API_V3_KEY=""
WECHAT_PAY_MERCHANT_CERT_SERIAL=""
# 商户证书（apiclient_cert.pem）支持两种方式（任一）：
#   1) 内联：apiclient_cert.pem 全文（含 BEGIN/END）作为单行字符串（\n 转义）
#   2) 路径：指向 PEM 文件（相对 backend/）— 优先级低于内联
WECHAT_PAY_MERCHANT_CERT=""
WECHAT_PAY_MERCHANT_CERT_PATH=""
# 商户私钥（apiclient_key.pem）支持两种方式：
#   1) 内联：apiclient_key.pem 全文（含 BEGIN/END）作为单行字符串（\n 转义）
#   2) 路径：指向 PEM 文件（相对 backend/）— 优先级低于内联
WECHAT_PAY_MERCHANT_PRIVATE_KEY=""
WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH=""
WECHAT_PAY_NOTIFY_URL="https://api.ai-maimai.com/api/v1/payments/wechat/notify"
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npx tsc --noEmit
```

Expected: 无错误（仅装包不会触发任何类型问题）。

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.env.example
git commit -m "chore(payment/wechat): install wechatpay-node-v3 and add env placeholders"
```

---

## Task 2: WechatPayService 骨架 + isAvailable 守门测试

**Files:**
- Create: `backend/src/modules/payment/wechat-pay.service.ts`
- Create: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`

- [ ] **Step 1: 先写失败测试**

Create `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WechatPayService } from '../wechat-pay.service';

jest.mock('wechatpay-node-v3', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    transactions_app: jest.fn(),
    refunds: jest.fn(),
    verifySign: jest.fn(),
    decipher_gcm: jest.fn(),
  })),
}));

describe('WechatPayService', () => {
  const buildModule = async (envOverrides: Record<string, string | undefined>) => {
    const fakeConfig = {
      get: (key: string) => envOverrides[key],
    } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      providers: [
        WechatPayService,
        { provide: ConfigService, useValue: fakeConfig },
      ],
    }).compile();
    const svc = moduleRef.get(WechatPayService);
    await svc.onModuleInit();
    return svc;
  };

  describe('isAvailable', () => {
    it('returns false when WECHAT_PAY_APP_ID missing', async () => {
      const svc = await buildModule({});
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns false when only partial credentials configured', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        // missing API V3 key + serial + private key
      });
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns true when all required credentials present', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });
      expect(svc.isAvailable()).toBe(true);
    });
  });
});
```

注：所有后续测试的 `buildModule({ ... })` 的"凭据齐全"版本都要带上这两行：
```ts
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npm test -- wechat-pay.service.spec
```

Expected: FAIL，错误形如 `Cannot find module '../wechat-pay.service'`。

- [ ] **Step 3: 写最小实现**

Create `backend/src/modules/payment/wechat-pay.service.ts`:

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class WechatPayService implements OnModuleInit {
  private readonly logger = new Logger(WechatPayService.name);
  private client: any = null;
  private appId: string | null = null;
  private mchId: string | null = null;
  private apiV3Key: string | null = null;
  private certSerial: string | null = null;
  private merchantCert: string | null = null;
  private privateKey: string | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const appId = this.configService.get<string>('WECHAT_PAY_APP_ID');
    const mchId = this.configService.get<string>('WECHAT_PAY_MCH_ID');
    const apiV3Key = this.configService.get<string>('WECHAT_PAY_API_V3_KEY');
    const certSerial = this.configService.get<string>('WECHAT_PAY_MERCHANT_CERT_SERIAL');
    const merchantCert = this.loadPemFromEnv('WECHAT_PAY_MERCHANT_CERT', 'WECHAT_PAY_MERCHANT_CERT_PATH');
    const privateKey = this.loadPemFromEnv('WECHAT_PAY_MERCHANT_PRIVATE_KEY', 'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH');

    if (!appId || !mchId || !apiV3Key || !certSerial || !merchantCert || !privateKey) {
      this.logger.warn(
        '微信支付凭据未配齐（缺 APP_ID / MCH_ID / API_V3_KEY / CERT_SERIAL / MERCHANT_CERT / PRIVATE_KEY 其一），微信支付不可用',
      );
      return;
    }

    this.appId = appId;
    this.mchId = mchId;
    this.apiV3Key = apiV3Key;
    this.certSerial = certSerial;
    this.merchantCert = merchantCert;
    this.privateKey = privateKey;

    try {
      const WxPay = (await import('wechatpay-node-v3')).default;
      this.client = new (WxPay as any)({
        appid: appId,
        mchid: mchId,
        publicKey: Buffer.from(merchantCert),   // apiclient_cert.pem（商户证书）
        privateKey: Buffer.from(privateKey),    // apiclient_key.pem（商户私钥，签名用）
        key: apiV3Key,                          // APIv3 密钥（用于解密 notify body）
        serial_no: certSerial,                  // 商户证书序列号
      });
      this.logger.log(`微信支付 SDK 初始化成功，AppID: ${appId}, MchID: ${mchId}`);
    } catch (err: any) {
      this.logger.error(`微信支付 SDK 初始化失败: ${err.message}`);
      this.client = null;
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
    }
  }

  private loadPemFromEnv(inlineKey: string, pathKey: string): string | null {
    const inline = this.configService.get<string>(inlineKey);
    if (inline && inline.trim()) {
      return inline.replace(/\\n/g, '\n').trim();
    }
    const filePath = this.configService.get<string>(pathKey);
    if (filePath) {
      try {
        return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf-8').trim();
      } catch {
        return null;
      }
    }
    return null;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** 暴露给上层做金额校验、防伪造（notify 路径用） */
  getAppId(): string | null { return this.appId; }
  getMchId(): string | null { return this.mchId; }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npm test -- wechat-pay.service.spec
```

Expected: 3 passed。

- [ ] **Step 5: TypeScript 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts
git commit -m "feat(payment/wechat): add WechatPayService skeleton with isAvailable guard"
```

---

## Task 3: WechatPayService.createAppOrder

**Files:**
- Modify: `backend/src/modules/payment/wechat-pay.service.ts`
- Modify: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`

- [ ] **Step 1: 加测试**

Append to `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`:

```ts
  describe('createAppOrder', () => {
    it('throws when SDK not available', async () => {
      const svc = await buildModule({});
      await expect(
        svc.createAppOrder({
          outTradeNo: 'CS-123',
          amount: 9.99,
          description: 'test',
        }),
      ).rejects.toThrow('微信支付 SDK 未初始化');
    });

    it('converts amount yuan to fen and returns signed app payload', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });
      const client = (svc as any).client;
      // ⚠️ wechatpay-node-v3 SDK 实际返回 { status, data }，APP 支付字段在 data 内且为全小写
      // 参考 https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/transactions_app.md
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          appid: 'wxtest',
          partnerid: '1234567890',
          prepayid: 'wx2024xxxxxxxxxxxxxxxx',
          package: 'Sign=WXPay',
          noncestr: 'NONCESTRX',
          timestamp: '1700000000',
          sign: 'SIGNED',
        },
      });

      const result = await svc.createAppOrder({
        outTradeNo: 'CS-456',
        amount: 9.99,
        description: 'unit test',
      });

      expect(client.transactions_app).toHaveBeenCalledWith(
        expect.objectContaining({
          out_trade_no: 'CS-456',
          description: 'unit test',
          amount: { total: 999, currency: 'CNY' },
          notify_url: expect.any(String),
        }),
      );
      // Service 对外（给 App 用）统一 camelCase，方便和 alipay 路径对齐
      expect(result).toEqual({
        appId: 'wxtest',
        partnerId: '1234567890',
        timestamp: '1700000000',
        nonceStr: 'NONCESTRX',
        prepayId: 'wx2024xxxxxxxxxxxxxxxx',
        packageVal: 'Sign=WXPay',
        signType: 'RSA',
        paySign: 'SIGNED',
      });
    });

    it('throws on non-200 SDK response', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });
      const client = (svc as any).client;
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 400,
        error: JSON.stringify({ code: 'PARAM_ERROR', message: 'amount invalid' }),
      });
      await expect(
        svc.createAppOrder({ outTradeNo: 'CS-789', amount: 1, description: 't' }),
      ).rejects.toThrow(/PARAM_ERROR/);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: FAIL（`createAppOrder` 方法不存在）。

- [ ] **Step 3: 实现 createAppOrder**

Append inside `WechatPayService` class in `backend/src/modules/payment/wechat-pay.service.ts`:

```ts
  async createAppOrder(params: {
    outTradeNo: string;
    amount: number;
    description: string;
    timeExpire?: Date;
  }): Promise<{
    appId: string;
    partnerId: string;
    timestamp: string;
    nonceStr: string;
    prepayId: string;
    packageVal: string;
    signType: string;
    paySign: string;
  }> {
    if (!this.client) {
      throw new Error('微信支付 SDK 未初始化');
    }

    const notifyUrl = this.configService.get<string>(
      'WECHAT_PAY_NOTIFY_URL',
      'https://api.ai-maimai.com/api/v1/payments/wechat/notify',
    );

    const result = await this.client.transactions_app({
      appid: this.appId!,
      mchid: this.mchId!,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: notifyUrl,
      amount: {
        total: Math.round(params.amount * 100),
        currency: 'CNY',
      },
      ...(params.timeExpire ? { time_expire: params.timeExpire.toISOString() } : {}),
    });

    if (result?.status !== 200) {
      let parsedError: any = {};
      try {
        parsedError = result?.error ? JSON.parse(result.error) : {};
      } catch {
        parsedError = {};
      }
      const code = parsedError?.code || result?.code || 'UNKNOWN';
      const message = parsedError?.message || result?.message || result?.error || JSON.stringify(result);
      this.logger.error(`微信支付下单失败: code=${code} message=${message}`);
      throw new Error(`微信支付下单失败 [${code}] ${message}`);
    }

    const data = result.data;
    if (!data?.prepayid || !data?.sign) {
      throw new Error(`微信支付下单返回缺少 prepayid/sign: ${JSON.stringify(result)}`);
    }

    // SDK 返回 { status, data }；data 内为全小写字段：appid/partnerid/prepayid/package/noncestr/timestamp/sign
    // 服务对外统一 camelCase，方便消费方与 alipay 路径对齐
    return {
      appId: data.appid,
      partnerId: data.partnerid ?? this.mchId!,
      timestamp: data.timestamp,
      nonceStr: data.noncestr,
      prepayId: data.prepayid,
      packageVal: data.package,
      signType: 'RSA',  // V3 固定 RSA，SDK 不返回该字段
      paySign: data.sign,
    };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: 6 passed（前 3 + 新 3）。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts
git commit -m "feat(payment/wechat): add createAppOrder with yuan-to-fen conversion"
```

---

## Task 4: WechatPayService.refund

**Files:**
- Modify: `backend/src/modules/payment/wechat-pay.service.ts`
- Modify: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`

**关键差异 vs 支付宝**：微信 V3 退款 API HTTP 200 仅表示**受理成功**，**不等于退款已完成**。`wechatpay-node-v3` 返回结构为 `{ status, data }`，真实退款状态在 `result.data.status`（`SUCCESS / PROCESSING / CLOSED / ABNORMAL`）+ 退款异步通知（refund.notify）+ `queryRefund` 查单兜底中确认：
- `SUCCESS` 即时完成（小额秒到）→ 当退款完成
- `PROCESSING` 受理中（大额或风控）→ 必须等 notify
- `CLOSED / ABNORMAL` 业务失败 → 当退款失败
- 官方语义参考：https://pay.wechatpay.cn/doc/v3/merchant/4013071034

因此 `refund()` 返回新增 `pending: boolean` 字段，调用方（Task 7 / `AfterSaleRefundService`）按 pending 区分"立即标完成"vs"等通知"。

- [ ] **Step 1: 加测试（覆盖 SDK 未初始化 / SUCCESS 立即完成 / PROCESSING 等通知 / 非 200 业务失败 / CLOSED 业务失败）**

Append to `wechat-pay.service.spec.ts`:

```ts
  describe('refund', () => {
    const buildOkSvc = async () =>
      buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });

    it('returns failure when SDK not initialized', async () => {
      const svc = await buildModule({});
      const r = await svc.refund({
        outTradeNo: 'CS-1',
        outRefundNo: 'AS-1',
        refundAmount: 1,
        totalAmount: 10,
        reason: '退款',
      });
      expect(r).toEqual({ success: false, pending: false, message: '微信支付 SDK 未初始化' });
    });

    it('returns immediate success when refund status = SUCCESS', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          refund_id: '50000000000000001',
          out_refund_no: 'AS-2',
          status: 'SUCCESS',
        },
      });
      const r = await svc.refund({
        outTradeNo: 'CS-1',
        outRefundNo: 'AS-2',
        refundAmount: 3.5,
        totalAmount: 10,
        reason: '退款',
      });
      expect(client.refunds).toHaveBeenCalledWith(
        expect.objectContaining({
          out_trade_no: 'CS-1',
          out_refund_no: 'AS-2',
          reason: '退款',
          amount: { refund: 350, total: 1000, currency: 'CNY' },
          notify_url: expect.any(String),
        }),
      );
      expect(r).toEqual({
        success: true,
        pending: false,
        providerRefundId: '50000000000000001',
        message: '退款成功',
      });
    });

    it('returns pending when refund status = PROCESSING (await notify)', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          refund_id: '50000000000000002',
          out_refund_no: 'AS-3',
          status: 'PROCESSING',
        },
      });
      const r = await svc.refund({
        outTradeNo: 'CS-2',
        outRefundNo: 'AS-3',
        refundAmount: 50,
        totalAmount: 100,
        reason: '退款',
      });
      expect(r).toEqual({
        success: true,
        pending: true,
        providerRefundId: '50000000000000002',
        message: '退款受理中，等待结果通知',
      });
    });

    it('returns failure when refund status = CLOSED or ABNORMAL', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          refund_id: '50000000000000003',
          out_refund_no: 'AS-4',
          status: 'ABNORMAL',
        },
      });
      const r = await svc.refund({
        outTradeNo: 'CS-3',
        outRefundNo: 'AS-4',
        refundAmount: 1,
        totalAmount: 10,
        reason: '退款',
      });
      expect(r).toEqual({
        success: false,
        pending: false,
        providerRefundId: '50000000000000003',
        message: expect.stringMatching(/ABNORMAL/),
      });
    });

    it('returns failure with code/message on non-200', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 400,
        error: JSON.stringify({ code: 'TRADE_NOT_EXIST', message: '交易不存在' }),
      });
      const r = await svc.refund({
        outTradeNo: 'CS-2',
        outRefundNo: 'AS-3',
        refundAmount: 1,
        totalAmount: 10,
        reason: '退款',
      });
      expect(r.success).toBe(false);
      expect(r.pending).toBe(false);
      expect(r.message).toContain('TRADE_NOT_EXIST');
      expect(r.message).toContain('交易不存在');
    });

    it('treats missing refund status as pending, never as success', async () => {
      // 资金安全兜底：HTTP 200 只有"受理"语义；缺少 data.status 时不能默认 SUCCESS
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          refund_id: '50000000000000004',
          out_refund_no: 'AS-5',
        },
      });
      const r = await svc.refund({
        outTradeNo: 'CS-4',
        outRefundNo: 'AS-5',
        refundAmount: 1,
        totalAmount: 10,
        reason: '退款',
      });
      expect(r.success).toBe(true);
      expect(r.pending).toBe(true);
      expect(r.message).toContain('状态待确认');
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: FAIL（`refund` 方法不存在）。

- [ ] **Step 3: 实现 refund（按官方语义区分 pending）**

Append inside `WechatPayService` class:

```ts
  async refund(params: {
    outTradeNo: string;
    outRefundNo: string;
    refundAmount: number;
    totalAmount: number;
    reason: string;
  }): Promise<{
    success: boolean;
    pending: boolean;
    providerRefundId?: string;
    message: string;
  }> {
    if (!this.client) {
      return { success: false, pending: false, message: '微信支付 SDK 未初始化' };
    }

    const notifyUrl = this.configService.get<string>(
      'WECHAT_PAY_NOTIFY_URL',
      'https://api.ai-maimai.com/api/v1/payments/wechat/notify',
    );

    try {
      const result = await this.client.refunds({
        out_trade_no: params.outTradeNo,
        out_refund_no: params.outRefundNo,
        reason: params.reason,
        notify_url: notifyUrl,
        amount: {
          refund: Math.round(params.refundAmount * 100),
          total: Math.round(params.totalAmount * 100),
          currency: 'CNY',
        },
      });

      if (result?.status !== 200) {
        let parsedError: any = {};
        try {
          parsedError = result?.error ? JSON.parse(result.error) : {};
        } catch {
          parsedError = {};
        }
        const code = parsedError?.code || result?.code || 'UNKNOWN';
        const message = parsedError?.message || result?.message || result?.error || JSON.stringify(result);
        this.logger.warn(
          `微信退款被拒（非 200）: code=${code}, message=${message}, outRefundNo=${params.outRefundNo}`,
        );
        return {
          success: false,
          pending: false,
          message: `${code} ${message}`.trim(),
        };
      }

      // HTTP 200 = 受理成功，真实结果看 result.data.status；缺字段时按 pending 处理，等待 notify/queryRefund 兜底
      const data = result.data ?? {};
      const refundStatus: string | undefined = data.status;
      if (!refundStatus) {
        this.logger.warn(
          `微信退款受理但未返回状态，按 pending 处理: outRefundNo=${params.outRefundNo}, raw=${JSON.stringify(result)}`,
        );
        return {
          success: true,
          pending: true,
          providerRefundId: data.refund_id,
          message: '退款受理成功，状态待确认',
        };
      }

      if (refundStatus === 'SUCCESS') {
        return {
          success: true,
          pending: false,
          providerRefundId: data.refund_id,
          message: '退款成功',
        };
      }
      if (refundStatus === 'PROCESSING') {
        // 受理但未完成 — 调用方应保留 Refund.status=REFUNDING，等 notify 闭环
        return {
          success: true,
          pending: true,
          providerRefundId: data.refund_id,
          message: '退款受理中，等待结果通知',
        };
      }
      // CLOSED / ABNORMAL / 其他
      this.logger.warn(
        `微信退款业务失败: status=${refundStatus}, outRefundNo=${params.outRefundNo}, raw=${JSON.stringify(result)}`,
      );
      return {
        success: false,
        pending: false,
        providerRefundId: data.refund_id,
        message: `微信退款失败 [${refundStatus}]`,
      };
    } catch (err: any) {
      this.logger.error(`微信退款异常: ${err.message}, outRefundNo=${params.outRefundNo}`);
      return { success: false, pending: false, message: err.message || '微信退款异常' };
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: 11 passed（前 6 + 新 5；其中"missing refund status → pending"覆盖资金安全兜底）。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts
git commit -m "feat(payment/wechat): refund returns pending=true on PROCESSING to await notify"
```

---

## Task 5: WechatPayService.parseNotify

**Files:**
- Modify: `backend/src/modules/payment/wechat-pay.service.ts`
- Modify: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`

- [ ] **Step 1: 加测试**

Append to `wechat-pay.service.spec.ts`:

```ts
  describe('parseNotify', () => {
    const buildSignedSvc = async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });
      return svc;
    };

    it('throws when signature verification fails', async () => {
      const svc = await buildSignedSvc();
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockResolvedValue(false);
      await expect(
        svc.parseNotify({
          body: { resource: { ciphertext: 'X', nonce: 'N', associated_data: '' } },
          rawBody: '{"resource":{"ciphertext":"X","nonce":"N","associated_data":""}}',
          signature: 'badsig',
          timestamp: '1700000000',
          nonce: 'N',
          serial: 'S',
        }),
      ).rejects.toThrow('微信通知签名校验失败');
    });

    it('decrypts and returns payment success payload', async () => {
      const svc = await buildSignedSvc();
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockResolvedValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-1',
        transaction_id: 'WX-TXN-1',
        trade_state: 'SUCCESS',
        amount: { total: 999 },
        success_time: '2026-05-23T10:00:00+08:00',
      });
      const result = await svc.parseNotify({
        body: {
          event_type: 'TRANSACTION.SUCCESS',
          resource: { original_type: 'transaction', ciphertext: 'X', nonce: 'N', associated_data: '' },
        },
        rawBody: '{"event_type":"TRANSACTION.SUCCESS","resource":{"original_type":"transaction","ciphertext":"X","nonce":"N","associated_data":""}}',
        signature: 'sig',
        timestamp: '1700000000',
        nonce: 'N',
        serial: 'S',
      });
      expect(result).toEqual({
        type: 'payment',
        outTradeNo: 'CS-1',
        outRefundNo: undefined,
        providerTxnId: 'WX-TXN-1',
        tradeState: 'SUCCESS',
        amount: 9.99,
        paidAt: new Date('2026-05-23T10:00:00+08:00'),
      });
    });

    it('detects refund notify event', async () => {
      const svc = await buildSignedSvc();
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockResolvedValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-1',
        out_refund_no: 'AS-2',
        refund_id: 'WX-REFUND-1',
        refund_status: 'SUCCESS',
        amount: { refund: 500, payer_refund: 500, total: 1000 },
        success_time: '2026-05-23T11:00:00+08:00',
      });
      const result = await svc.parseNotify({
        body: {
          event_type: 'REFUND.SUCCESS',
          resource: { original_type: 'refund', ciphertext: 'X', nonce: 'N', associated_data: '' },
        },
        rawBody: '{"event_type":"REFUND.SUCCESS","resource":{"original_type":"refund","ciphertext":"X","nonce":"N","associated_data":""}}',
        signature: 'sig',
        timestamp: '1700000000',
        nonce: 'N',
        serial: 'S',
      });
      expect(result.type).toBe('refund');
      expect(result.outRefundNo).toBe('AS-2');
      expect(result.tradeState).toBe('SUCCESS');
      expect(result.amount).toBe(5);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: FAIL（`parseNotify` 不存在）。

- [ ] **Step 3: 实现 parseNotify**

Append inside `WechatPayService` class:

```ts
	  async parseNotify(args: {
	    body: {
      event_type?: string;
	      resource: {
	        original_type?: 'transaction' | 'refund';
	        ciphertext: string;
	        nonce: string;
	        associated_data?: string;
		      };
	    };
	    rawBody: string;
	    signature: string;
    timestamp: string;
    nonce: string;
    serial: string;
  }): Promise<{
    type: 'payment' | 'refund';
    outTradeNo: string;
    outRefundNo?: string;
    providerTxnId: string;
    tradeState: string;
    amount: number;
    paidAt?: Date;
  }> {
    if (!this.client) {
      throw new Error('微信支付 SDK 未初始化');
    }

    const verified = await this.client.verifySign({
	      timestamp: args.timestamp,
	      nonce: args.nonce,
	      body: args.rawBody,
	      serial: args.serial,
      signature: args.signature,
    });
    if (!verified) {
      this.logger.error('微信通知签名校验失败');
      throw new Error('微信通知签名校验失败');
    }

	    const decrypted = this.client.decipher_gcm(
	      args.body.resource.ciphertext,
	      args.body.resource.associated_data ?? '',
	      args.body.resource.nonce,
	      this.apiV3Key!,
	    );

	    const isRefund =
	      args.body.event_type?.startsWith('REFUND.') ||
	      args.body.resource.original_type === 'refund' ||
	      typeof decrypted.out_refund_no === 'string';

    if (isRefund) {
      return {
        type: 'refund',
        outTradeNo: decrypted.out_trade_no,
        outRefundNo: decrypted.out_refund_no,
        providerTxnId: decrypted.refund_id,
        tradeState: decrypted.refund_status,
        amount: (decrypted.amount?.refund ?? 0) / 100,
        paidAt: decrypted.success_time ? new Date(decrypted.success_time) : undefined,
      };
    }

    return {
      type: 'payment',
      outTradeNo: decrypted.out_trade_no,
      outRefundNo: undefined,
      providerTxnId: decrypted.transaction_id,
      tradeState: decrypted.trade_state,
      amount: (decrypted.amount?.total ?? 0) / 100,
      paidAt: decrypted.success_time ? new Date(decrypted.success_time) : undefined,
    };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: 12 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts
git commit -m "feat(payment/wechat): add parseNotify with payment/refund event dispatch"
```

---

## Task 5b: WechatPayService.queryOrder（主动查单兜底，**v1.0 必备**）

**为什么是 v1.0 必备而不是 v1.1**：

买家 App 支付完成后调 `OrderRepo.activeQueryPayment(sessionId)` → 后端 `OrderController.activeQueryCheckout` → `PaymentService.confirmAlipayCheckout`。当前该方法在 `paymentChannel !== 'ALIPAY'` 时直接 `throw new BadRequestException('当前会话不是支付宝渠道，无需主动查询')`（`payment.service.ts:155-157`）。**没有 queryOrder + 没有 channel dispatch，微信 notify 慢/丢失时订单永远落不下来**。

本任务先把 `WechatPayService.queryOrder` 写完整；Task 9b 再做 `confirmAlipayCheckout → confirmCheckout` 重命名 + channel dispatch。

**Files:**
- Modify: `backend/src/modules/payment/wechat-pay.service.ts`
- Modify: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`

- [ ] **Step 1: 加测试**

Append to `wechat-pay.service.spec.ts`:

```ts
  describe('queryOrder', () => {
    const buildOkSvc = async () =>
      buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });

    it('returns null when SDK not initialized', async () => {
      const svc = await buildModule({});
      const r = await svc.queryOrder('CS-1');
      expect(r).toBeNull();
    });

    it('returns parsed payload for SUCCESS', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          trade_state: 'SUCCESS',
          transaction_id: 'WX-T-100',
          out_trade_no: 'CS-1',
          amount: { total: 1234, payer_total: 1234 },
          success_time: '2026-05-23T10:00:00+08:00',
        },
      });
      const r = await svc.queryOrder('CS-1');
      expect(client.query).toHaveBeenCalledWith({ out_trade_no: 'CS-1' });
      expect(r).toEqual({
        tradeState: 'SUCCESS',
        transactionId: 'WX-T-100',
        outTradeNo: 'CS-1',
        totalAmount: 12.34,
        paidAt: new Date('2026-05-23T10:00:00+08:00'),
      });
    });

    it('returns parsed payload with no paidAt for NOTPAY', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          trade_state: 'NOTPAY',
          out_trade_no: 'CS-2',
          amount: { total: 500 },
        },
      });
      const r = await svc.queryOrder('CS-2');
      expect(r?.tradeState).toBe('NOTPAY');
      expect(r?.paidAt).toBeUndefined();
    });

    it('returns null on non-200 (treats as transient, let caller fallback)', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.query = jest.fn().mockResolvedValue({
        status: 500,
        code: 'SYSTEM_ERROR',
        message: 'wechat busy',
      });
      const r = await svc.queryOrder('CS-3');
      expect(r).toBeNull();
    });

    it('returns null on thrown exception (let caller fallback to polling)', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.query = jest.fn().mockRejectedValue(new Error('network'));
      const r = await svc.queryOrder('CS-4');
      expect(r).toBeNull();
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: FAIL（`queryOrder` 不存在）。

- [ ] **Step 3: 实现 queryOrder**

Append inside `WechatPayService` class:

```ts
  /**
   * 按商户单号主动查支付状态（兜底 notify 丢失）。
   * 异常 / 非 200 一律返回 null —— 让上层走 polling 兜底，与 alipay queryOrder 对齐。
   */
  async queryOrder(outTradeNo: string): Promise<{
    tradeState: string;
    transactionId: string;
    outTradeNo: string;
    totalAmount: number;
    paidAt?: Date;
  } | null> {
    if (!this.client) {
      this.logger.warn('微信支付 SDK 未初始化，queryOrder 返 null');
      return null;
    }
    try {
      const result = await this.client.query({ out_trade_no: outTradeNo });
      if (result?.status !== 200) {
        this.logger.warn(
          `微信 queryOrder 非 200: status=${result?.status}, code=${result?.code}, message=${result?.message}, outTradeNo=${outTradeNo}`,
        );
        return null;
      }
      const data = result.data ?? {};
      return {
        tradeState: data.trade_state,
        transactionId: data.transaction_id,
        outTradeNo: data.out_trade_no,
        totalAmount: (data.amount?.total ?? 0) / 100,
        paidAt: data.success_time ? new Date(data.success_time) : undefined,
      };
    } catch (err: any) {
      this.logger.warn(`微信 queryOrder 异常 outTradeNo=${outTradeNo}: ${err.message}`);
      return null;
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: 17 passed（12 + 新 5）。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts
git commit -m "feat(payment/wechat): add queryOrder for active-query fallback (parity with alipay)"
```

---

## Task 5c: WechatPayService.queryRefund（退款通知丢失兜底，**v1.0 必备**）

**为什么必须**：

微信退款申请 HTTP 200 只代表退款单受理成功；如果 refund.notify 丢失，`Refund.status=REFUNDING` 或退货运费退款 `status=REFUNDING` 会永久卡住。`queryRefund(outRefundNo)` 是 cron / 人工重试 / notify 异常后的权威兜底。

**Files:**
- Modify: `backend/src/modules/payment/wechat-pay.service.ts`
- Modify: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`

- [ ] **Step 1: 加测试**

Append to `wechat-pay.service.spec.ts`:

```ts
  describe('queryRefund', () => {
    const buildOkSvc = async () =>
      buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });

    it('returns null when SDK not initialized', async () => {
      const svc = await buildModule({});
      await expect(svc.queryRefund('AS-1')).resolves.toBeNull();
    });

    it('returns parsed refund status from result.data', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          refund_id: '50000000000000001',
          out_refund_no: 'AS-1',
          out_trade_no: 'CS-1',
          status: 'SUCCESS',
          amount: { refund: 500, total: 1000 },
          success_time: '2026-05-23T11:00:00+08:00',
        },
      });

      const r = await svc.queryRefund('AS-1');
      expect(client.find_refunds).toHaveBeenCalledWith('AS-1');
      expect(r).toEqual({
        outRefundNo: 'AS-1',
        outTradeNo: 'CS-1',
        providerRefundId: '50000000000000001',
        status: 'SUCCESS',
        refundAmount: 5,
        totalAmount: 10,
        successAt: new Date('2026-05-23T11:00:00+08:00'),
      });
    });

    it('returns null on non-200 so caller can retry later', async () => {
      const svc = await buildOkSvc();
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 500,
        error: JSON.stringify({ code: 'SYSTEM_ERROR', message: 'busy' }),
      });
      await expect(svc.queryRefund('AS-2')).resolves.toBeNull();
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: FAIL（`queryRefund` 方法不存在）。

- [ ] **Step 3: 实现 queryRefund**

Append inside `WechatPayService` class:

```ts
  async queryRefund(outRefundNo: string): Promise<{
    outRefundNo: string;
    outTradeNo: string;
    providerRefundId: string;
    status: string;
    refundAmount: number;
    totalAmount: number;
    successAt?: Date;
  } | null> {
    if (!this.client) {
      this.logger.warn('微信支付 SDK 未初始化，queryRefund 返 null');
      return null;
    }
    try {
      const result = await this.client.find_refunds(outRefundNo);
      if (result?.status !== 200) {
        this.logger.warn(
          `微信 queryRefund 非 200: status=${result?.status}, error=${result?.error}, outRefundNo=${outRefundNo}`,
        );
        return null;
      }
      const data = result.data ?? {};
      if (!data.status || !data.out_refund_no) {
        this.logger.warn(`微信 queryRefund 返回缺字段: outRefundNo=${outRefundNo}, raw=${JSON.stringify(result)}`);
        return null;
      }
      return {
        outRefundNo: data.out_refund_no,
        outTradeNo: data.out_trade_no,
        providerRefundId: data.refund_id,
        status: data.status,
        refundAmount: (data.amount?.refund ?? 0) / 100,
        totalAmount: (data.amount?.total ?? 0) / 100,
        successAt: data.success_time ? new Date(data.success_time) : undefined,
      };
    } catch (err: any) {
      this.logger.warn(`微信 queryRefund 异常 outRefundNo=${outRefundNo}: ${err.message}`);
      return null;
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: 20 passed（17 + 新 3）。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts
git commit -m "feat(payment/wechat): add queryRefund fallback for pending refunds"
```

---

## Task 5d: WechatPayService.closeOrder（取消/过期会话关单兜底，**v1.0 必备**）

**为什么必须**：

现有支付宝链路在 `CheckoutService.cancelSession` / `CheckoutExpireService.expireSession` 里已经做到：取消或过期前先查单，若已付款则主动建单；若未付款则调用 `alipay.trade.close` 关单，再把 session 标记为 EXPIRED。微信接入后必须有同等能力。微信官方关单接口用于"用户取消订单"和"订单超时未支付"场景，请求路径为 `POST /v3/pay/transactions/out-trade-no/{out_trade_no}/close`，请求体包含 `mchid`；`wechatpay-node-v3` 对应函数名为 `close`。

**Files:**
- Modify: `backend/src/modules/payment/wechat-pay.service.ts`
- Modify: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`

- [ ] **Step 1: 加 closeOrder 测试**

Append to `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`：

```ts
  describe('closeOrder', () => {
    it('returns terminal success when SDK not initialized', async () => {
      const svc = await buildModule({});
      await expect(svc.closeOrder('CS-1')).resolves.toEqual({
        success: true,
        terminal: true,
        alreadyPaid: false,
        message: '微信支付 SDK 未初始化，按未建单处理',
      });
    });

    it('returns success on 204 close response', async () => {
      const svc = await buildSignedSvc();
      mockClient.close.mockResolvedValue({ status: 204, data: null });
      await expect(svc.closeOrder('CS-2')).resolves.toEqual({
        success: true,
        terminal: false,
        alreadyPaid: false,
        message: '关单成功',
      });
      expect(mockClient.close).toHaveBeenCalledWith('CS-2', { mchid: '1234567890' });
    });

    it('returns terminal success when order already closed or not exists', async () => {
      const svc = await buildSignedSvc();
      mockClient.close.mockResolvedValue({
        status: 404,
        error: JSON.stringify({ code: 'ORDERNOTEXIST', message: '订单不存在' }),
      });
      await expect(svc.closeOrder('CS-3')).resolves.toEqual({
        success: true,
        terminal: true,
        alreadyPaid: false,
        message: '订单不存在或已关闭',
      });
    });

    it('marks alreadyPaid when close says order was paid', async () => {
      const svc = await buildSignedSvc();
      mockClient.close.mockResolvedValue({
        status: 400,
        error: JSON.stringify({ code: 'ORDERPAID', message: '订单已支付' }),
      });
      await expect(svc.closeOrder('CS-4')).resolves.toEqual({
        success: false,
        terminal: false,
        alreadyPaid: true,
        message: '订单已支付',
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: FAIL（`closeOrder` 方法不存在）。

- [ ] **Step 3: 实现 closeOrder**

Append to `backend/src/modules/payment/wechat-pay.service.ts` class：

```ts
  async closeOrder(outTradeNo: string): Promise<{
    success: boolean;
    terminal: boolean;
    alreadyPaid: boolean;
    message: string;
  }> {
    if (!this.client || !this.mchId) {
      return {
        success: true,
        terminal: true,
        alreadyPaid: false,
        message: '微信支付 SDK 未初始化，按未建单处理',
      };
    }

    try {
      const result = await this.client.close(outTradeNo, { mchid: this.mchId });
      if (result?.status === 204 || result?.status === 200) {
        return { success: true, terminal: false, alreadyPaid: false, message: '关单成功' };
      }

      const parsedError = this.parseSdkError(result);
      const code = parsedError.code || result?.code;
      const message = parsedError.message || result?.message || '微信关单失败';
      if (code === 'ORDERNOTEXIST' || code === 'ORDERCLOSED') {
        return { success: true, terminal: true, alreadyPaid: false, message: '订单不存在或已关闭' };
      }
      if (code === 'ORDERPAID') {
        return { success: false, terminal: false, alreadyPaid: true, message };
      }

      this.logger.warn(
        `微信关单失败: status=${result?.status}, code=${code || 'N/A'}, message=${message}, outTradeNo=${outTradeNo}`,
      );
      return { success: false, terminal: false, alreadyPaid: false, message };
    } catch (err: any) {
      this.logger.warn(`微信关单异常 outTradeNo=${outTradeNo}: ${err.message}`);
      return { success: false, terminal: false, alreadyPaid: false, message: err.message || '微信关单异常' };
    }
  }
```

如果 Task 4 已经实现 `parseSdkError(result)`，复用它；如果没有，把下面 helper 加到 class 内：

```ts
  private parseSdkError(result: any): { code?: string; message?: string } {
    if (!result?.error || typeof result.error !== 'string') return {};
    try {
      const parsed = JSON.parse(result.error);
      return { code: parsed.code, message: parsed.message };
    } catch {
      return {};
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- wechat-pay.service.spec`
Expected: closeOrder 新增 4 个测试 passed，原测试仍 passed。

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts
git commit -m "feat(payment/wechat): add closeOrder for checkout cancel and expiry"
```

---

## Task 6: 注册 WechatPayService 到 PaymentModule

**Files:**
- Modify: `backend/src/modules/payment/payment.module.ts`

- [ ] **Step 1: 修改 payment.module.ts**

Edit `backend/src/modules/payment/payment.module.ts`：

```ts
import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { AlipayService } from './alipay.service';
import { WechatPayService } from './wechat-pay.service';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { OrderModule } from '../order/order.module';
import { CouponModule } from '../coupon/coupon.module';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [forwardRef(() => OrderModule), CouponModule, InboxModule],
  controllers: [PaymentController],
  providers: [PaymentService, AlipayService, WechatPayService, WebhookIpGuard],
  exports: [PaymentService, AlipayService, WechatPayService],
})
export class PaymentModule {}
```

- [ ] **Step 2: 验证后端启动不挂**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/payment/payment.module.ts
git commit -m "feat(payment/wechat): register WechatPayService in PaymentModule"
```

---

## Task 7: PaymentService.initiateRefund 加 WECHAT_PAY 分支

**Files:**
- Modify: `backend/src/modules/payment/payment.service.ts`
- Create: `backend/src/modules/payment/__tests__/payment.service.wechat-refund.spec.ts`

- [ ] **Step 1: 先写失败测试**

Create `backend/src/modules/payment/__tests__/payment.service.wechat-refund.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotImplementedException } from '@nestjs/common';
import { PaymentService } from '../payment.service';
import { AlipayService } from '../alipay.service';
import { WechatPayService } from '../wechat-pay.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('PaymentService.initiateRefund — WECHAT_PAY branch', () => {
  let svc: PaymentService;
  let wechatPay: jest.Mocked<WechatPayService>;
  let prisma: any;

  beforeEach(async () => {
    wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      refund: jest.fn(),
    } as any;
    prisma = {
      payment: { findFirst: jest.fn() },
      order: { findUnique: jest.fn() },
      checkoutSession: { findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: AlipayService, useValue: { isAvailable: () => false } },
        { provide: WechatPayService, useValue: wechatPay },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(PaymentService);
  });

  it('returns failure when wechat SDK unavailable', async () => {
    wechatPay.isAvailable.mockReturnValue(false);
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'O1',
      status: 'PAID',
      channel: 'WECHAT_PAY',
      merchantOrderNo: 'CS-1',
      amount: 100,
    });

    const r = await svc.initiateRefund('O1', 50, 'AS-1');
    expect(r).toEqual({ success: false, pending: false, message: '微信支付 SDK 未初始化' });
  });

  it('immediate SUCCESS: success=true pending=false', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'O1',
      status: 'PAID',
      channel: 'WECHAT_PAY',
      merchantOrderNo: 'CS-1',
      amount: 99.5,
    });
    wechatPay.refund.mockResolvedValue({
      success: true,
      pending: false,
      providerRefundId: 'WX-R-1',
      message: '退款成功',
    });

    const r = await svc.initiateRefund('O1', 30, 'AS-2');

    expect(wechatPay.refund).toHaveBeenCalledWith({
      outTradeNo: 'CS-1',
      outRefundNo: 'AS-2',
      refundAmount: 30,
      totalAmount: 99.5,
      reason: '用户退款',
    });
    expect(r).toEqual({
      success: true,
      pending: false,
      providerRefundId: 'AS-2',
      message: '退款成功',
    });
  });

  it('PROCESSING: success=true pending=true (caller must NOT mark refund SUCCESS yet)', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'O1',
      status: 'PAID',
      channel: 'WECHAT_PAY',
      merchantOrderNo: 'CS-1',
      amount: 99.5,
    });
    wechatPay.refund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'WX-R-2',
      message: '退款受理中，等待结果通知',
    });

    const r = await svc.initiateRefund('O1', 30, 'AS-3');
    expect(r).toEqual({
      success: true,
      pending: true,
      providerRefundId: 'AS-3',
      message: '退款受理中，等待结果通知',
    });
  });

  it('falls back to CheckoutSession path when no Payment row', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'CS-ID' });
    prisma.checkoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'CS-1',
      paymentChannel: 'WECHAT_PAY',
      status: 'COMPLETED',
    });
    wechatPay.refund.mockResolvedValue({
      success: true,
      pending: false,
      providerRefundId: 'WX-R-3',
      message: '退款成功',
    });

    const r = await svc.initiateRefund('O2', 12.34, 'AS-4');

    expect(wechatPay.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        outTradeNo: 'CS-1',
        outRefundNo: 'AS-4',
        refundAmount: 12.34,
        totalAmount: 12.34, // CheckoutSession 路径没 Payment 行 → fallback 用退款金额
      }),
    );
    expect(r.success).toBe(true);
  });

  it('alipay branch still returns pending=false (regression for alipay sync semantics)', async () => {
    // 注：alipay 分支的 mock 在另一个测试文件，这里只断言 wechat 行为
    // 确认 alipay 不会被本任务影响
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'CS-ID' });
    prisma.checkoutSession.findUnique.mockResolvedValue(null);
    const r = await svc.initiateRefund('O5', 5, 'AS-6');
    expect(r.success).toBe(false);
  });

  it('non-wechat non-alipay channel still throws NotImplementedException', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'O3',
      status: 'PAID',
      channel: 'UNIONPAY',
      merchantOrderNo: 'CS-3',
      amount: 5,
    });
    await expect(svc.initiateRefund('O3', 5, 'AS-7')).rejects.toThrow(NotImplementedException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- payment.service.wechat-refund`
Expected: FAIL（要么 wechat 分支不存在抛 NotImplementedException，要么注入失败）。

- [ ] **Step 3: 改 PaymentService 构造函数 + 加分支**

Edit `backend/src/modules/payment/payment.service.ts`：

1) 在 import 段加：
```ts
import { WechatPayService } from './wechat-pay.service';
```

2) 修改构造函数（27-34 行）：
```ts
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private alipayService: AlipayService,
    @Optional() private checkoutService?: CheckoutService,
    @Optional() private couponService?: CouponService,
    @Optional() private inboxService?: InboxService,
    @Optional() private wechatPayService?: WechatPayService,
  ) {}
```

注意：`WechatPayService` 必须追加在 constructor 末尾，不能插到 `checkoutService` 前面。当前测试里有多处 `new PaymentService(prisma, config, alipayService, checkoutService)` 手工构造，插中间会导致参数错位。

3) 修改 `initiateRefund` **返回类型**（约第 366-370 行的方法签名）：

```ts
  async initiateRefund(
    orderId: string,
    amount: number,
    merchantRefundNo?: string,
  ): Promise<{
    success: boolean;
    pending?: boolean;   // 新增：通道受理但未完成（如微信 PROCESSING）— 调用方应保留 REFUNDING 等通知
    providerRefundId?: string;
    message: string;
  }> {
```

4) 在原有 ALIPAY 分支返回处补 `pending: false`，**保持现有行为不变**（alipay 是同步语义）：

替换 alipay 分支末尾的 `return` 块（行 432-436）：

```ts
      return {
        success: result.success,
        providerRefundId: result.success ? refundNo : undefined,
        message: result.message,
      };
```

为：

```ts
      return {
        success: result.success,
        pending: false,
        providerRefundId: result.success ? refundNo : undefined,
        message: result.message,
      };
```

5) 在 ALIPAY 分支结束（行 437 的 `}`）之后、`// 微信支付暂未接入` 注释之前，插入 WECHAT_PAY 分支：

```ts
    if (channel === 'WECHAT_PAY') {
      if (!this.wechatPayService?.isAvailable()) {
        this.logger.error(`微信支付 SDK 未初始化，无法退款: orderId=${this.maskBizId(orderId)}`);
        return { success: false, pending: false, message: '微信支付 SDK 未初始化' };
      }
      const refundNo = merchantRefundNo || `REFUND-${Date.now()}`;
      // 微信 V3 退款 API 必填原订单总额
      const totalAmount = payment?.amount ?? amount;
      const result = await this.wechatPayService.refund({
        outTradeNo: providerOrderNo!,
        outRefundNo: refundNo,
        refundAmount: amount,
        totalAmount,
        reason: '用户退款',
      });
      // 关键：透传 pending 给上层（AfterSaleRefundService Task 7b 会按 pending 区分立即完成 vs 等通知）
      return {
        success: result.success,
        pending: result.pending,
        providerRefundId: result.success ? refundNo : undefined,
        message: result.message,
      };
    }
```

6) 删掉原 `// 微信支付暂未接入，v1.0 仅支持支付宝` 注释（现在已经接入了）：

替换:
```ts
    // 微信支付暂未接入，v1.0 仅支持支付宝
    throw new NotImplementedException(`退款渠道 ${channel} 暂未接入`);
```
为:
```ts
    throw new NotImplementedException(`退款渠道 ${channel} 暂未接入`);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- payment.service.wechat-refund`
Expected: 6 passed。

- [ ] **Step 5: 跑全套 payment 测试确认不破坏 alipay**

Run: `cd backend && npm test -- --testPathPattern=payment`
Expected: 所有原 alipay 相关测试仍 passed。

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payment/payment.service.ts backend/src/modules/payment/__tests__/payment.service.wechat-refund.spec.ts
git commit -m "feat(payment/wechat): wire WECHAT_PAY branch into PaymentService.initiateRefund"
```

---

## Task 7b: AfterSaleRefundService 消费 `pending` 标志

**为什么必须有这一步**：

`AfterSaleRefundService.startRefund`（`after-sale-refund.service.ts:149-173`）当前逻辑是"`success=true → handleRefundSuccess`（推到 REFUNDED）/ `false → handleRefundFailure`"。如果不处理 `pending`，微信 `PROCESSING` 会被当成 SUCCESS 立即标 REFUNDED——这就是评审者 C1 指出的"退款 200 当成退款成功"bug。

正确语义：`pending=true` 时**保留 `Refund.status=REFUNDING`**，把 `providerRefundId` 存上，等 wechat notify（Task 8 加的退款通知路径）或 `queryRefund` 补偿查单来调用 `handleRefundSuccess` 才真正推到 REFUNDED。

**Files:**
- Modify: `backend/src/modules/after-sale/after-sale-refund.service.ts`
- Modify: `backend/src/modules/payment/payment.service.ts`（retryStaleAutoRefunds 对微信 pending 退款查单闭环，不能重复发起退款）
- Create: `backend/src/modules/after-sale/__tests__/after-sale-refund.pending.spec.ts`

- [ ] **Step 1: 写测试**

Create `backend/src/modules/after-sale/__tests__/after-sale-refund.pending.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AfterSaleRefundService } from '../after-sale-refund.service';
import { PaymentService } from '../../payment/payment.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AfterSaleStatusHistoryService } from '../after-sale-status-history.service';

describe('AfterSaleRefundService — pending refund handling', () => {
  let svc: AfterSaleRefundService;
  let paymentSvc: jest.Mocked<PaymentService>;
  let prisma: any;
  let handleRefundSuccess: jest.SpyInstance;

  beforeEach(async () => {
    paymentSvc = {
      initiateRefund: jest.fn(),
    } as any;
    prisma = {
      refund: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AfterSaleRefundService,
        { provide: PaymentService, useValue: paymentSvc },
        { provide: PrismaService, useValue: prisma },
        { provide: AfterSaleStatusHistoryService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    svc = moduleRef.get(AfterSaleRefundService);
    handleRefundSuccess = jest.spyOn(svc, 'handleRefundSuccess').mockResolvedValue(undefined as any);
    jest.spyOn(svc, 'handleRefundFailure').mockResolvedValue(undefined as any);
  });

  // 这里仅 spy 关键内部方法，验证 pending 路径行为
  // 真实实现的私有 refund 触发路径在 startRefund 中，这里写一个 helper 模拟即可
  // ⚠️ Step 3 实现时需要在 AfterSaleRefundService 内暴露一个内部 `dispatchRefundResult(refund, result)`
  //    或修改 startRefund 的 success / failure 分发逻辑（见 Step 3）

  it('on pending=true, saves providerRefundId and does NOT call handleRefundSuccess', async () => {
    const refund = { id: 'refund-1', merchantRefundNo: 'AS-1' };
    const result = { success: true, pending: true, providerRefundId: 'AS-1', message: '受理中' };

    // 调用即将由 Step 3 在 startRefund 内插入的逻辑（同等效果）
    await (svc as any).dispatchRefundResult(refund, result);

    expect(prisma.refund.update).toHaveBeenCalledWith({
      where: { id: 'refund-1' },
      data: expect.objectContaining({
        providerRefundId: 'AS-1',
        // status 保持 REFUNDING（不主动改）
      }),
    });
    expect(handleRefundSuccess).not.toHaveBeenCalled();
  });

  it('on pending=false success=true, calls handleRefundSuccess as before', async () => {
    const refund = { id: 'refund-2', merchantRefundNo: 'AS-2' };
    const result = { success: true, pending: false, providerRefundId: 'AS-2', message: '退款成功' };

    await (svc as any).dispatchRefundResult(refund, result);

    expect(handleRefundSuccess).toHaveBeenCalledWith('refund-2', 'AS-2');
  });

  it('on success=false, calls handleRefundFailure as before', async () => {
    const refund = { id: 'refund-3', merchantRefundNo: 'AS-3' };
    const result = { success: false, pending: false, message: 'TRADE_NOT_EXIST' };

    await (svc as any).dispatchRefundResult(refund, result);

    expect((svc as any).handleRefundFailure).toHaveBeenCalledWith('refund-3', 'TRADE_NOT_EXIST');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- after-sale-refund.pending`
Expected: FAIL（`dispatchRefundResult` 方法不存在）。

- [ ] **Step 3: 在 AfterSaleRefundService 抽出 dispatchRefundResult 并改写 startRefund 调用**

Edit `backend/src/modules/after-sale/after-sale-refund.service.ts`。

a) 在类内（建议放在 `handleRefundSuccess` / `handleRefundFailure` 附近）新增 private 方法：

```ts
  /**
   * 把 PaymentService.initiateRefund 的返回值分发到正确路径：
   *   - pending=true → 仅保存 providerRefundId，Refund.status 保持 REFUNDING，等通道异步通知
   *   - success=true (pending=false) → 立即标 SUCCESS（与原 alipay 行为一致）
   *   - success=false → 标 FAILED
   */
  private async dispatchRefundResult(
    refund: { id: string; merchantRefundNo: string },
    result: { success: boolean; pending?: boolean; providerRefundId?: string; message: string },
  ): Promise<void> {
    if (result.success && result.pending) {
      // 微信 PROCESSING 路径：保存 providerRefundId，状态保持 REFUNDING
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          providerRefundId: result.providerRefundId ?? refund.merchantRefundNo,
          // 不动 status（让它保持 REFUNDING）
        },
      });
      this.logger.log(
        `售后退款受理中：refundId=${refund.id}, 等待通道异步通知`,
      );
      return;
    }
    if (result.success) {
      await this.handleRefundSuccess(refund.id, result.providerRefundId ?? null);
      return;
    }
    await this.handleRefundFailure(refund.id, result.message);
  }
```

b) 替换 `startRefund` 内**两处**调用 success/failure 的位置（行 149-173 + 171-173 区域），改成调 `dispatchRefundResult`：

替换：
```ts
        await this.handleRefundSuccess(refund.id, refund.providerRefundId ?? null);
        ...
        await this.handleRefundFailure(refund.id, `售后退款发起异常: ${msg}`);
```

为（保留原结构，只换分发调用 + 异常分支不变）：
```ts
        await this.dispatchRefundResult(refund, result);  // ← 原 handleRefundSuccess/Failure 改为统一分发
        ...
        await this.handleRefundFailure(refund.id, `售后退款发起异常: ${msg}`);  // 异常路径保留
```

具体改法：找到 `const result = await this.paymentService.initiateRefund(...)` 后紧跟的 if/else 分支，把：
```ts
if (result.success) {
  await this.handleRefundSuccess(refund.id, result.providerRefundId || null);
} else {
  await this.handleRefundFailure(refund.id, result.message);
}
```
换成：
```ts
await this.dispatchRefundResult(refund, result);
```

同样修改 `retryStaleRefund` 内的对应 if/else（约行 488-490）。

- [ ] **Step 4: 在 PaymentService.retryStaleAutoRefunds 对微信 pending 退款先查单，不能重复发起**

Edit `backend/src/modules/payment/payment.service.ts`。

a) 在 `retryStaleAutoRefunds` 的 `for (const refund of candidates)` 循环里，`claim = await this.claimAutoRefundRetry(refund.id); if (!claim) continue;` 后、`this.initiateRefund(...)` 前插入：

```ts
        // 微信 PROCESSING 退款：providerRefundId 已存在说明通道已受理，不能重复发起退款。
        // 先 queryRefund 查真实状态；仍 PROCESSING/查不到则保留 REFUNDING 等下一轮。
        if (refund.status === 'REFUNDING' && refund.providerRefundId && this.wechatPayService?.isAvailable()) {
          const queried = await this.wechatPayService.queryRefund(claim.merchantRefundNo);
          if (queried) {
            await this.handleWechatRefundNotify({
              outTradeNo: queried.outTradeNo,
              outRefundNo: queried.outRefundNo,
              tradeState: queried.status,
              providerRefundId: queried.providerRefundId,
            });
            continue;
          }
          this.logger.warn(
            `微信 pending 退款查单无结果，保留 REFUNDING: refundId=${this.maskBizId(refund.id)}, merchantRefundNo=${this.maskBizId(claim.merchantRefundNo)}`,
          );
          continue;
        }
```

b) 注意：不要把 `REFUNDING + providerRefundId` 从 candidates 里排除。排除会导致 notify 丢失时永久卡住。原 `where.status: { in: ['FAILED', 'REFUNDING'] }` 保持不变。

c) `handleWechatRefundNotify` 在 Task 8 会同时支持 `AS-*` 售后退款、`AUTO-*` 自动退款、`AS_SHIP_PAY_*` 退货运费退款；因此这里统一调用该方法，不在 cron 里重复写状态机。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd backend && npm test -- after-sale-refund.pending`
Expected: 3 passed。

- [ ] **Step 6: 跑全套售后 + payment 测试确认不破坏**

Run: `cd backend && npm test -- --testPathPattern="after-sale|payment"`
Expected: 全部 passed（特别确认 alipay 退款仍走原 success/failure 路径）。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/after-sale/after-sale-refund.service.ts \
        backend/src/modules/after-sale/__tests__/after-sale-refund.pending.spec.ts \
        backend/src/modules/payment/payment.service.ts
git commit -m "feat(after-sale/refund): handle wechat PROCESSING via dispatchRefundResult"
```

---

## Task 7c: OrderService 未发货取消退款消费 `pending` 标志

**为什么必须**：

`OrderService.cancelUnshippedOrder` 和 `cancelEntireSessionUnshipped` 当前在事务外调用 `paymentService.initiateRefund(...)` 后，只要 `result.success` 就立即把 `Refund.status` 改成 `REFUNDED`。支付宝沙箱这是同步语义，可以保持；微信 `PROCESSING` 只代表退款受理中，必须保持 `REFUNDING`，等 Task 8 refund.notify 或 Task 7b cron `queryRefund` 闭环。

**Files:**
- Modify: `backend/src/modules/order/order.service.ts`
- Modify: `backend/src/modules/order/order.service.cancel.spec.ts`

- [ ] **Step 1: 写失败测试**

Edit `backend/src/modules/order/order.service.cancel.spec.ts`，在现有 "PAID 未发货单订单取消会恢复库存、红包并在退款成功后返还抵扣积分" 用例后追加两个失败用例，和支付宝同步成功路径形成对照：

```ts
  it('PAID 未发货单订单取消遇到微信退款 pending 时保持 REFUNDING', async () => {
    const { service, prisma } = makeService();
    const order = {
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs1',
      totalAmount: 65,
      goodsAmount: 60,
      discountAmount: 0,
      items: [{ skuId: 'sku1', quantity: 2, companyId: 'c1' }],
    };
    const refund = {
      id: 'r1',
      merchantRefundNo: 'AUTO-CANCEL-o1',
    };
    const tx = {
      $executeRaw: jest.fn(),
      checkoutSession: { findUnique: jest.fn().mockResolvedValue(null) },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn().mockResolvedValue(refund),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    prisma.order.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...order, createdAt: new Date(), afterSaleRequests: [], refunds: [], shipments: [] });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.refund.update = jest.fn();
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const paymentService = {
      initiateRefund: jest.fn().mockResolvedValue({
        success: true,
        pending: true,
        providerRefundId: 'AUTO-CANCEL-o1',
        message: '退款受理中',
      }),
    };
    service.setPaymentService(paymentService as any);

    await service.cancelOrder('o1', 'u1');

    expect(prisma.refund.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { providerRefundId: 'AUTO-CANCEL-o1' },
    });
    expect(tx.refund.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(tx.refundStatusHistory.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ toStatus: 'REFUNDED' }),
    }));
  });

  it('整 session 未发货取消遇到微信退款 pending 时每笔退款保持 REFUNDING', async () => {
    const { service, prisma } = makeService();
    const orders = [
      {
        id: 'o1',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs1',
        totalAmount: 65,
        goodsAmount: 60,
        items: [{ skuId: 'sku1', quantity: 2, companyId: 'c1' }],
      },
      {
        id: 'o2',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs1',
        totalAmount: 30,
        goodsAmount: 30,
        items: [{ skuId: 'sku2', quantity: 1, companyId: 'c2' }],
      },
    ];
    const tx = {
      $executeRaw: jest.fn(),
      checkoutSession: { findUnique: jest.fn().mockResolvedValue(null) },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: data.orderId === 'o1' ? 'r1' : 'r2',
          merchantRefundNo: data.merchantRefundNo,
        })),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    prisma.order.findMany.mockResolvedValue(orders);
    prisma.order.findUnique.mockResolvedValue({ ...orders[0], createdAt: new Date(), afterSaleRequests: [], refunds: [], shipments: [] });
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.refund.update = jest.fn();
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    (service as any).mapOrder = jest.fn().mockReturnValue({ id: 'o1' });
    const paymentService = {
      initiateRefund: jest.fn()
        .mockResolvedValueOnce({ success: true, pending: true, providerRefundId: 'AUTO-CANCEL-o1' })
        .mockResolvedValueOnce({ success: true, pending: true, providerRefundId: 'AUTO-CANCEL-o2' }),
    };
    service.setPaymentService(paymentService as any);

    await (service as any).cancelEntireSessionUnshipped('cs1', 'u1');

    expect(prisma.refund.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'r1' },
      data: { providerRefundId: 'AUTO-CANCEL-o1' },
    });
    expect(prisma.refund.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'r2' },
      data: { providerRefundId: 'AUTO-CANCEL-o2' },
    });
    expect(tx.refund.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });
```

这两个用例必须先失败：现有代码会因为 `result.success === true` 直接写 `REFUNDED`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- order.service.cancel`
Expected: FAIL（现有代码会把 pending 退款立即标 REFUNDED）。

- [ ] **Step 3: 修改单订单取消退款分发**

Edit `backend/src/modules/order/order.service.ts`，找到 `cancelUnshippedOrder` 中事务外调用 `this.paymentService.initiateRefund(...)` 后的 `if (result?.success) { ... status: 'REFUNDED' ... }` 分支，改为：

```ts
          if (result?.success && result.pending) {
            await this.prisma.refund.update({
              where: { id: refundData.refundId },
              data: { providerRefundId: result.providerRefundId },
            });
            this.logger.log(
              `退款已受理，等待通道结果通知: refundId=${refundData.refundId}, providerRefundId=${result.providerRefundId ?? 'N/A'}`,
            );
          } else if (result?.success) {
            await this.prisma.$transaction(async (tx) => {
              await tx.refund.update({
                where: { id: refundData.refundId },
                data: {
                  status: 'REFUNDED',
                  providerRefundId: result.providerRefundId,
                },
              });
              await tx.refundStatusHistory.create({
                data: {
                  refundId: refundData.refundId,
                  fromStatus: 'REFUNDING',
                  toStatus: 'REFUNDED',
                  remark: '渠道退款成功',
                  operatorId: userId,
                },
              });
              await this.restoreDeductionForRefund(tx, refundData.deductionRestore);
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
          } else {
            this.logger.warn(
              `退款发起失败，cron 将重试: refundId=${refundData.refundId}, msg=${result?.message ?? 'unknown'}`,
            );
          }
```

保留原支付宝同步成功行为：支付宝返回 `pending:false`，仍走 `REFUNDED` 分支。

- [ ] **Step 4: 修改整 session 取消退款分发**

在 `cancelEntireSessionUnshipped` 的 `for (const r of refundData.refunds)` 循环里，同样把 `if (result?.success) { status:'REFUNDED' ... }` 改为先判断 `result.pending`：

```ts
          if (result?.success && result.pending) {
            await this.prisma.refund.update({
              where: { id: r.refundId },
              data: { providerRefundId: result.providerRefundId },
            });
            continue;
          }
          if (result?.success) {
            // 保留原有 REFUNDED + statusHistory + restoreDeductionForRefund 逻辑
          } else {
            this.logger.warn(
              `整 session 退款发起失败，cron 将重试: refundId=${r.refundId}, msg=${result?.message ?? 'unknown'}`,
            );
          }
```

注意：pending 分支不要累计 `successfulGoodsRefundAmount`，因为消费积分返还必须等真实退款到账后再做；后续由 `PaymentService.handleWechatRefundNotify` / `retryStaleAutoRefunds` 闭环时调用统一返还逻辑。

- [ ] **Step 5: 跑测试**

Run: `cd backend && npm test -- order.service.cancel`
Expected: 2 passed。

- [ ] **Step 6: 跑订单 + payment 回归**

Run: `cd backend && npm test -- --testPathPattern="order|payment"`
Expected: 全部 passed；支付宝未发货取消退款仍同步标 REFUNDED。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/order/order.service.ts backend/src/modules/order/order.service.cancel.spec.ts
git commit -m "fix(order/refund): keep wechat pending refunds in REFUNDING on cancel"
```

---

## Task 8: PaymentController wechat/notify 端点（含金额校验 + 防伪造 + 真实退款闭环）

**这是资金链路核心**，三件事一起做：

1. **金额校验**：解密后的 `amount.total / 100` 必须等于 `session.expectedTotal`（或 `AfterSaleShippingPayment.amount`）—— 镜像 `alipay/notify` 的 `assertAlipayAmountMatchesSession` 防恶意篡改逻辑（参考 `payment.controller.ts:108-156`）
2. **防伪造**：支付通知解密 body 里的 `appid` 必须等于 `WechatPayService.getAppId()`、`mchid` 必须等于 `getMchId()`；退款通知官方解密字段只有 `mchid`，没有 `appid`，因此退款通知只强校验 `mchid` + `out_refund_no` 业务归属（防止重放别家商户的 notify）
3. **退款闭环**：refund 类型 notify 必须**真实**调 `paymentService.handleWechatRefundNotify` → 内部委托 `AfterSaleRefundService.handleRefundSuccess/Failure`，把 `Refund.status` 推到 SUCCESS/FAILED + 同步 AfterSaleRequest 状态。**不是只 ack 200**。

参考微信官方：[支付通知文档](https://pay.wechatpay.cn/doc/v3/merchant/4013070368) + [退款通知文档](https://pay.wechatpay.cn/doc/v3/merchant/4013070388)

**Files:**
- Modify: `backend/src/modules/payment/wechat-pay.service.ts`（parseNotify 返回值补 appId?/mchId；退款通知没有 appid）
- Modify: `backend/src/modules/payment/payment.service.ts`（加 `assertWechatAmountMatchesSession` + `handleWechatRefundNotify`）
- Modify: `backend/src/modules/payment/payment.controller.ts`（实装 `handleWechatNotify`）
- Modify: `backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts`（parseNotify 支付测试加 appId/mchId；退款测试只加 mchId）
- Create: `backend/src/modules/payment/__tests__/wechat-notify.controller.spec.ts`

- [ ] **Step 1: 扩 parseNotify 返回 appId?/mchId，并按通知类型校验字段**

Edit `backend/src/modules/payment/wechat-pay.service.ts`，在 `parseNotify` 方法里：

a) 修改返回类型，加 `appId?` 和 `mchId`。注意：微信官方 APP 支付通知解密字段包含 `appid` + `mchid`；退款通知解密字段只包含 `mchid`，不包含 `appid`，所以 `appId` 必须是可选字段：

```ts
  async parseNotify(args: { ... }): Promise<{
    type: 'payment' | 'refund';
    appId?: string;      // ← 新增；退款通知官方不返回 appid
    mchId: string;       // ← 新增
    outTradeNo: string;
    outRefundNo?: string;
    providerTxnId: string;
    tradeState: string;
    amount: number;
    paidAt?: Date;
  }> {
```

b) 在两个 `return` 块加商户身份字段：payment 分支加 `appId: decrypted.appid` + `mchId: decrypted.mchid`；refund 分支只加 `mchId: decrypted.mchid`，不要伪造或强制要求 `appId`：

```ts
    if (isRefund) {
      return {
        type: 'refund',
        mchId: decrypted.mchid,
        outTradeNo: decrypted.out_trade_no,
        outRefundNo: decrypted.out_refund_no,
        ...
      };
    }
    return {
      type: 'payment',
      appId: decrypted.appid,
      mchId: decrypted.mchid,
      outTradeNo: decrypted.out_trade_no,
      ...
    };
```

c) 更新现有 `parseNotify` 测试（Task 5 写的）— 在每个 `decipher_gcm.mockReturnValue` 加 `appid: 'wxtest', mchid: '1234567890'`，并在 expect 里加这两个字段断言。

退款通知测试只加 `mchid: '1234567890'`，不要加 `appid`，并断言返回值没有强依赖 `appId`。另外 `resource.associated_data` 用空字符串，类型判断依赖 `event_type` / `resource.original_type` / 解密后的 `out_refund_no`，不要依赖 `associated_data === 'refund'`。

- [ ] **Step 2: 在 PaymentService 加金额校验 helper + 退款 notify 处理**

Edit `backend/src/modules/payment/payment.service.ts`：

a) 仿 `assertAlipayAmountMatchesSession`（行 61-75）加微信版本：

```ts
  /**
   * 微信版金额校验 —— 调用方：wechat/notify
   * 参数 totalAmountFen 是分（微信 V3 通知返回 amount.total 单位是分）
   */
  assertWechatAmountMatchesSession(
    session: { expectedTotal: number; merchantOrderNo: string | null },
    claimedAmountFen: number,
    source: 'active-query' | 'notify',
  ): void {
    const expectedFen = Math.round(session.expectedTotal * 100);
    if (claimedAmountFen !== expectedFen) {
      this.logger.error(
        `[wechat ${source}] 金额校验失败：微信=${claimedAmountFen}分 session=${expectedFen}分 ` +
        `merchantOrderNo=${session.merchantOrderNo ? this.maskBizId(session.merchantOrderNo) : 'N/A'} ` +
        `→ 拒绝建单，请人工核查（可能为恶意篡改）`,
      );
      throw new BadRequestException('支付金额校验失败，请联系客服');
    }
  }

  /** AS_SHIP_PAY_ 路径金额校验（微信版） */
  async assertWechatAfterSaleShippingPaymentAmountMatches(
    outTradeNo: string,
    claimedAmountFen: number,
  ): Promise<void> {
    const payment = await this.prisma.afterSaleShippingPayment.findUnique({
      where: { merchantPaymentNo: outTradeNo },
      select: { amount: true },
    });
    if (!payment) {
      throw new NotFoundException('售后退货运费支付单不存在');
    }
    const expectedFen = Math.round(payment.amount * 100);
    if (claimedAmountFen !== expectedFen) {
      this.logger.error(
        `[wechat notify] 售后退货运费金额校验失败：微信=${claimedAmountFen}分 expected=${expectedFen}分 outTradeNo=${outTradeNo}`,
      );
      throw new BadRequestException('支付金额校验失败');
    }
  }
```

	b) 加 `handleWechatRefundNotify`，同时覆盖普通自动退款、售后退款、售后退货运费退款：

```ts
  /**
   * 微信退款异步通知 / queryRefund 补偿查单统一处理
   * - AS_SHIP_PAY_*：退货运费退款，委托 AfterSaleShippingPaymentService
   * - AS-*：售后退款，委托 AfterSaleRefundService
   * - AUTO-*：自动退款，直接更新 Refund 状态
   * - PROCESSING：保持 REFUNDING，等待下一次 notify/queryRefund
   */
  async handleWechatRefundNotify(args: {
    outTradeNo: string;
    outRefundNo: string;
    tradeState: string;
    providerRefundId?: string;
  }): Promise<void> {
    if (args.outTradeNo?.startsWith('AS_SHIP_PAY_')) {
      if (!this.afterSaleShippingPaymentService?.handleWechatRefundNotify) {
        this.logger.error('微信退货运费退款通知：AfterSaleShippingPaymentService 未注入，无法闭环');
        return;
      }
      await this.afterSaleShippingPaymentService.handleWechatRefundNotify({
        merchantPaymentNo: args.outTradeNo,
        outRefundNo: args.outRefundNo,
        tradeState: args.tradeState,
        providerRefundId: args.providerRefundId,
      });
      return;
    }

    const refund = await this.prisma.refund.findFirst({
      where: { merchantRefundNo: args.outRefundNo, deletedAt: null },
      select: { id: true, status: true, merchantRefundNo: true },
    });
    if (!refund) {
      this.logger.warn(`微信退款通知：未找到 Refund 记录, outRefundNo=${args.outRefundNo}`);
      return; // 幂等：找不到记录不报错，让微信 ack 200 不重试
    }
    if (refund.status === 'REFUNDED') {
      this.logger.log(`微信退款通知：refund=${refund.id} 已 REFUNDED，幂等忽略`);
      return;
    }
    if (args.tradeState === 'PROCESSING') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { providerRefundId: args.providerRefundId ?? args.outRefundNo },
      });
      return;
    }

    const isAfterSaleRefund = refund.merchantRefundNo.startsWith('AS-');
    if (args.tradeState === 'SUCCESS') {
      if (isAfterSaleRefund) {
        if (!this.afterSaleRefundService) {
          this.logger.error(`微信售后退款通知：AfterSaleRefundService 未注入，无法闭环`);
          return;
        }
        await this.afterSaleRefundService.handleRefundSuccess(refund.id, args.providerRefundId || null);
        return;
      }
      await this.updateAutoRefundRecord({
        refundId: refund.id,
        toStatus: 'REFUNDED',
        fromStatuses: ['REFUNDING'],
        providerRefundId: args.providerRefundId || args.outRefundNo,
        remark: '微信退款通知成功',
      });
      return;
    }

    if (isAfterSaleRefund) {
      if (!this.afterSaleRefundService) {
        this.logger.error(`微信售后退款失败通知：AfterSaleRefundService 未注入，无法闭环`);
        return;
      }
      await this.afterSaleRefundService.handleRefundFailure(refund.id, `微信退款失败 [${args.tradeState}]`);
      return;
    }
    await this.updateAutoRefundRecord({
      refundId: refund.id,
      toStatus: 'FAILED',
      fromStatuses: ['REFUNDING'],
      remark: `微信退款失败 [${args.tradeState}]`,
    });
  }
```

- [ ] **Step 3: 写 wechat/notify controller 失败测试**

Create `backend/src/modules/payment/__tests__/wechat-notify.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PaymentController } from '../payment.controller';
import { PaymentService } from '../payment.service';
import { AlipayService } from '../alipay.service';
import { WechatPayService } from '../wechat-pay.service';
import { CheckoutService } from '../../order/checkout.service';
import { BadRequestException } from '@nestjs/common';

describe('PaymentController.handleWechatNotify', () => {
  let controller: PaymentController;
  let wechatPay: any;
  let paymentSvc: any;
  let checkoutSvc: any;

	  const buildRes = () => {
	    const res: any = {};
	    res.status = jest.fn().mockReturnValue(res);
	    res.json = jest.fn().mockReturnValue(res);
	    res.send = jest.fn().mockReturnValue(res);
	    return res;
	  };
	  const buildReq = (body: any) => ({
	    rawBody: Buffer.from(JSON.stringify(body)),
	  });

  const makeHeaders = () => ({
    'wechatpay-signature': 'sig',
    'wechatpay-timestamp': '1700000000',
    'wechatpay-nonce': 'N',
    'wechatpay-serial': 'S',
  });

  beforeEach(async () => {
    wechatPay = {
      parseNotify: jest.fn(),
      getAppId: jest.fn().mockReturnValue('wxtest'),
      getMchId: jest.fn().mockReturnValue('1234567890'),
    };
    paymentSvc = {
      handlePaymentCallback: jest.fn(),
      handleWechatRefundNotify: jest.fn(),
      assertWechatAmountMatchesSession: jest.fn(),
      assertWechatAfterSaleShippingPaymentAmountMatches: jest.fn(),
    };
    checkoutSvc = {
      findByMerchantOrderNo: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: paymentSvc },
        { provide: AlipayService, useValue: {} },
        { provide: WechatPayService, useValue: wechatPay },
        { provide: CheckoutService, useValue: checkoutSvc },
      ],
    }).compile();
    controller = moduleRef.get(PaymentController);
  });

  it('returns FAIL 401 on bad signature', async () => {
	    wechatPay.parseNotify.mockRejectedValue(new Error('微信通知签名校验失败'));
	    const res = buildRes();
	    const body = {};
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);
	    expect(res.status).toHaveBeenCalledWith(401);
	  });

  it('rejects mismatched appid (防伪造)', async () => {
    wechatPay.parseNotify.mockResolvedValue({
      type: 'payment',
      appId: 'wxFAKE',
      mchId: '1234567890',
      outTradeNo: 'CS-1',
      providerTxnId: 'WX-T-1',
      tradeState: 'SUCCESS',
      amount: 9.99,
      paidAt: new Date(),
	    });
	    const res = buildRes();
	    const body = {};
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(paymentSvc.handlePaymentCallback).not.toHaveBeenCalled();
  });

  it('rejects mismatched mchid (防伪造)', async () => {
    wechatPay.parseNotify.mockResolvedValue({
      type: 'payment',
      appId: 'wxtest',
      mchId: '9999999999',
      outTradeNo: 'CS-1',
      providerTxnId: 'WX-T-1',
      tradeState: 'SUCCESS',
      amount: 9.99,
      paidAt: new Date(),
	    });
	    const res = buildRes();
	    const body = {};
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects payment with mismatched amount (镜像 alipay)', async () => {
    wechatPay.parseNotify.mockResolvedValue({
      type: 'payment',
      appId: 'wxtest',
      mchId: '1234567890',
      outTradeNo: 'CS-1',
      providerTxnId: 'WX-T-1',
      tradeState: 'SUCCESS',
      amount: 9.99,   // 注：amount 元，对应 fen=999
      paidAt: new Date(),
    });
    checkoutSvc.findByMerchantOrderNo.mockResolvedValue({
      expectedTotal: 99.99,    // session 期望 99.99 元，与微信 9.99 不符
      merchantOrderNo: 'CS-1',
    });
    paymentSvc.assertWechatAmountMatchesSession.mockImplementation(() => {
      throw new BadRequestException('支付金额校验失败');
	    });
	    const res = buildRes();
	    const body = {};
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);
    // 镜像 alipay：返 200 给微信不让重试，错误已记日志 + 拒绝建单
    expect(res.status).toHaveBeenCalledWith(200);
    expect(paymentSvc.handlePaymentCallback).not.toHaveBeenCalled();
  });

  it('happy path: valid payment delegates to handlePaymentCallback', async () => {
    wechatPay.parseNotify.mockResolvedValue({
      type: 'payment',
      appId: 'wxtest',
      mchId: '1234567890',
      outTradeNo: 'CS-1',
      providerTxnId: 'WX-T-1',
      tradeState: 'SUCCESS',
      amount: 9.99,
      paidAt: new Date('2026-05-23T10:00:00+08:00'),
    });
    checkoutSvc.findByMerchantOrderNo.mockResolvedValue({
      expectedTotal: 9.99,
      merchantOrderNo: 'CS-1',
    });
	    paymentSvc.handlePaymentCallback.mockResolvedValue({ code: 'SUCCESS' });

	    const res = buildRes();
	    const body = { resource: { ciphertext: 'X' } };
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);

	    expect(wechatPay.parseNotify).toHaveBeenCalledWith(
	      expect.objectContaining({ body, rawBody: JSON.stringify(body) }),
	    );

    expect(paymentSvc.assertWechatAmountMatchesSession).toHaveBeenCalled();
    expect(paymentSvc.handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: 'CS-1',
        providerTxnId: 'WX-T-1',
        status: 'SUCCESS',
        skipSignatureVerification: true,
      }),
	    );
	    expect(res.status).toHaveBeenCalledWith(200);
	    expect(res.send).toHaveBeenCalled();
  });

  it('AS_SHIP_PAY_ payment notify uses shipping payment amount check', async () => {
    wechatPay.parseNotify.mockResolvedValue({
      type: 'payment',
      appId: 'wxtest',
      mchId: '1234567890',
      outTradeNo: 'AS_SHIP_PAY_AS-1',
      providerTxnId: 'WX-T-2',
      tradeState: 'SUCCESS',
      amount: 8,
      paidAt: new Date(),
	    });
	    paymentSvc.handlePaymentCallback.mockResolvedValue({ code: 'SUCCESS' });
	    const res = buildRes();
	    const body = { resource: { ciphertext: 'X' } };
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);
    expect(paymentSvc.assertWechatAfterSaleShippingPaymentAmountMatches).toHaveBeenCalledWith(
      'AS_SHIP_PAY_AS-1',
      800,   // 8 元 = 800 分
    );
    expect(paymentSvc.handlePaymentCallback).toHaveBeenCalled();
  });

  it('refund notify delegates to handleWechatRefundNotify (NOT just ack)', async () => {
    wechatPay.parseNotify.mockResolvedValue({
      type: 'refund',
      mchId: '1234567890',
      outTradeNo: 'CS-1',
      outRefundNo: 'AS-2',
      providerTxnId: 'WX-R-1',
      tradeState: 'SUCCESS',
      amount: 5,
	    });
	    paymentSvc.handleWechatRefundNotify.mockResolvedValue(undefined);
	    const res = buildRes();
	    const body = { resource: { ciphertext: 'X' } };
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);

	    expect(paymentSvc.handleWechatRefundNotify).toHaveBeenCalledWith({
	      outTradeNo: 'CS-1',
	      outRefundNo: 'AS-2',
	      tradeState: 'SUCCESS',
	      providerRefundId: 'WX-R-1',
	    });
	    expect(res.status).toHaveBeenCalledWith(200);
	    expect(res.send).toHaveBeenCalled();
  });

  it('refund notify with CLOSED state propagates failure', async () => {
    wechatPay.parseNotify.mockResolvedValue({
      type: 'refund',
      mchId: '1234567890',
      outTradeNo: 'CS-1',
      outRefundNo: 'AS-3',
      providerTxnId: 'WX-R-2',
      tradeState: 'CLOSED',
      amount: 5,
	    });
	    const res = buildRes();
	    const body = { resource: { ciphertext: 'X' } };
	    await controller.handleWechatNotify(makeHeaders(), body, buildReq(body), res);
	    expect(paymentSvc.handleWechatRefundNotify).toHaveBeenCalledWith({
	      outTradeNo: 'CS-1',
	      outRefundNo: 'AS-3',
      tradeState: 'CLOSED',
      providerRefundId: 'WX-R-2',
    });
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd backend && npm test -- wechat-notify.controller`
Expected: FAIL（多个，含 `handleWechatNotify` 不存在）。

- [ ] **Step 5: 修改 PaymentController 实装 handleWechatNotify**

Edit `backend/src/modules/payment/payment.controller.ts`：

1) 在 import 段加：
```ts
import { WechatPayService } from './wechat-pay.service';
import { BadRequestException, NotFoundException, Req } from '@nestjs/common';
import { Request } from 'express';
```

2) 修改构造函数（28-35 行），把 `WechatPayService` 追加到末尾：
```ts
  constructor(
    private paymentService: PaymentService,
    private alipayService: AlipayService,
    private checkoutService: CheckoutService,
    @Optional() private moduleRef?: ModuleRef,
    @Optional() private prisma?: PrismaService,
    @Optional() private wechatPayService?: WechatPayService,
  ) {}
```

注意：`WechatPayService` 必须追加在末尾，不能插到 `checkoutService` 前面。现有 `payment.controller.spec.ts` 有 `new PaymentController(paymentService, alipayService, checkoutService)` 手工构造，插中间会让测试参数错位。

3) 在 `handleAlipayNotify` 方法结束（第 175 行 `}`）后、`handleAlipayTransferNotify` 之前插入 wechat 端点：

```ts
  /**
	   * 微信支付异步通知（V3）
	   * - body 含加密的 resource；签名必须使用 req.rawBody 原文，解密使用解析后的 body.resource
	   * - 防伪造：支付通知校验 appid + mchid；退款通知官方没有 appid，只校验 mchid + outRefundNo 业务归属
	   * - 金额校验：amount.total 必须等于 session.expectedTotal（普通） 或 AfterSaleShippingPayment.amount（运费）
   * - 微信 V3 成功通知返回 HTTP 200 空 body；失败返回 4xx/5xx + {"code":"FAIL","message":"..."}
   * - 支付通知 → handlePaymentCallback（channel-agnostic）
   * - 退款通知 → handleWechatRefundNotify → AfterSaleRefundService.handleRefundSuccess/Failure
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('wechat/notify')
  async handleWechatNotify(
	    @Headers() headers: Record<string, string>,
	    @Body() body: any,
	    @Req() req: Request & { rawBody?: Buffer },
	    @Res() res: Response,
	  ) {
    const signature = headers['wechatpay-signature'];
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const serial = headers['wechatpay-serial'];

    this.logger.log(
      `收到微信通知: event_type=${body?.event_type || 'N/A'} serial=${serial || 'N/A'}`,
    );

	    // 1. 验签 + 解密
	    let parsed: Awaited<ReturnType<WechatPayService['parseNotify']>>;
	    try {
	      if (!this.wechatPayService) {
	        throw new Error('微信支付 SDK 未初始化');
	      }
	      const rawBody = req.rawBody?.toString('utf8');
	      if (!rawBody) {
	        throw new Error('微信通知缺少 rawBody，无法验签');
	      }
	      parsed = await this.wechatPayService.parseNotify({
	        body,
	        rawBody,
	        signature,
	        timestamp,
	        nonce,
        serial,
      });
    } catch (err: any) {
      this.logger.error(`微信通知解析失败: ${err.message}`);
      res.status(401).json({ code: 'FAIL', message: err.message });
      return;
    }

	    // 2. 防伪造：payment 校验 appid + mchid；refund 官方不返回 appid，只校验 mchid
	    const expectedAppId = this.wechatPayService.getAppId();
	    const expectedMchId = this.wechatPayService.getMchId();
	    const identityMismatch =
	      parsed.mchId !== expectedMchId ||
	      (parsed.type === 'payment' && parsed.appId !== expectedAppId);
	    if (identityMismatch) {
	      this.logger.error(
	        `微信通知身份不匹配（可能为重放/伪造）: type=${parsed.type} notify=${parsed.appId ?? 'N/A'}/${parsed.mchId} expected=${expectedAppId}/${expectedMchId}`,
	      );
	      res.status(401).json({ code: 'FAIL', message: '微信通知身份不匹配' });
	      return;
	    }

    // 3a. 退款通知
    if (parsed.type === 'refund') {
      this.logger.log(
        `微信退款通知: outRefundNo=${parsed.outRefundNo} state=${parsed.tradeState}`,
      );
      try {
	        await this.paymentService.handleWechatRefundNotify({
	          outTradeNo: parsed.outTradeNo,
	          outRefundNo: parsed.outRefundNo!,
          tradeState: parsed.tradeState,
          providerRefundId: parsed.providerTxnId,
        });
	        res.status(200).send();
      } catch (err: any) {
        this.logger.error(`微信退款通知处理异常: ${err.message}`);
        res.status(500).json({ code: 'FAIL', message: err.message });
      }
      return;
    }

    // 3b. 支付通知 — 金额校验
    const amountFen = Math.round(parsed.amount * 100);
    try {
      if (parsed.outTradeNo.startsWith('AS_SHIP_PAY_')) {
        await this.paymentService.assertWechatAfterSaleShippingPaymentAmountMatches(
          parsed.outTradeNo,
          amountFen,
        );
      } else {
        const session = await this.checkoutService.findByMerchantOrderNo(parsed.outTradeNo);
        if (session) {
          this.paymentService.assertWechatAmountMatchesSession(
            { expectedTotal: session.expectedTotal, merchantOrderNo: session.merchantOrderNo },
            amountFen,
            'notify',
          );
        }
        // session 不存在时跳过校验（旧 Order 流程，由 handlePaymentCallback 自行处理）
      }
    } catch (amountErr: any) {
      // 镜像 alipay notify：金额不一致不建单 + 仍返 200 给微信避免重试 + 日志告警
      this.logger.error(
        `微信 notify 金额校验失败，已拒绝处理: ${amountErr.message} outTradeNo=${parsed.outTradeNo}`,
      );
	      res.status(200).send();
      return;
    }

    // 4. 委托 handlePaymentCallback（已 channel-agnostic）
    try {
      await this.paymentService.handlePaymentCallback({
        merchantOrderNo: parsed.outTradeNo,
        providerTxnId: parsed.providerTxnId,
        status: parsed.tradeState === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        paidAt: parsed.paidAt ? parsed.paidAt.toISOString() : undefined,
        rawPayload: body,
        skipSignatureVerification: true,
      });
	      res.status(200).send();
    } catch (err: any) {
      this.logger.error(`处理微信支付通知异常: ${err.message}`);
      // 返 500 让微信重试（微信默认重试 15 次）
      res.status(500).json({ code: 'FAIL', message: err.message });
    }
  }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && npm test -- "wechat-notify.controller|wechat-pay.service"`
Expected: 全部 passed（含 Step 1 修改的 parseNotify 测试 + Step 3 新测试）。

- [ ] **Step 7: 跑全套 payment 测试确认未破坏 alipay**

Run: `cd backend && npm test -- --testPathPattern=payment`
Expected: 所有 alipay/wechat 测试 passed。

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/payment/wechat-pay.service.ts \
        backend/src/modules/payment/payment.service.ts \
        backend/src/modules/payment/payment.controller.ts \
        backend/src/modules/payment/__tests__/wechat-pay.service.spec.ts \
        backend/src/modules/payment/__tests__/wechat-notify.controller.spec.ts
git commit -m "feat(payment/wechat): wechat/notify with amount check, anti-forgery, real refund closure"
```

---

## Task 9: CheckoutService 三处加 WECHAT_PAY 分支（普通 / VIP / 续付）

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`

- [ ] **Step 1: 读 checkout.service.ts:71-90 确认 alipayService 注入方式**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && sed -n '70,95p' backend/src/modules/order/checkout.service.ts
```

Expected: 看到 `private alipayService: any = null;` 在 class 字段，OrderModule.onModuleInit 里做 setter 注入。

- [ ] **Step 2: 在 CheckoutService class 加 wechatPayService 字段**

Find the line:
```ts
  // AlipayService 通过可选注入（支付宝下单用）
  private alipayService: any = null;
```

Append immediately after:
```ts
  // WechatPayService 通过可选注入（微信支付下单用）— 与 alipayService 完全独立
  private wechatPayService: any = null;
```

- [ ] **Step 3: 加 setter**

在 class 内（找到现有 `setAlipayService` 或类似 setter），紧邻其后加：

```ts
  setWechatPayService(service: any) {
    this.wechatPayService = service;
  }
```

如果找不到 alipay 的 setter，在 class 末尾任何 public 方法之前加：

```ts
  setAlipayService(service: any) {
    this.alipayService = service;
  }

  setWechatPayService(service: any) {
    this.wechatPayService = service;
  }
```

注：若已有 `setAlipayService` 则只加 wechat 那个。

- [ ] **Step 4: 在 OrderModule 通过 ModuleRef 注入 WechatPayService**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && grep -n "setAlipayService\|alipayService" backend/src/modules/order/order.module.ts
```

当前 `OrderModule.onModuleInit()` 用 `this.moduleRef.get(AlipayService, { strict:false })` 取得支付宝服务。按同样模式处理微信：先在顶部加 import：

```ts
import { WechatPayService } from '../payment/wechat-pay.service';
```

然后在现有"注入支付宝服务"块后追加：

```ts
    // 注入微信支付服务（生成 APP 支付参数用）
    const wechatPayService = this.moduleRef.get(WechatPayService, { strict: false });
    if (wechatPayService) {
      this.checkoutService.setWechatPayService(wechatPayService);
    }
```

不要改 `OrderModule` constructor 参数顺序；当前模块已经通过 `ModuleRef` 解析跨模块服务，继续沿用这个模式。

- [ ] **Step 5: 在 createSession（普通商品）加 wechat 分支**

Find `backend/src/modules/order/checkout.service.ts:144` 附近 alipay 分支。

替换 144-153 行的：
```ts
      // 支付宝渠道：生成 APP 支付参数
      if (session.paymentChannel === 'ALIPAY' && this.alipayService?.isAvailable() && session.merchantOrderNo) {
        try {
          const orderStr = await this.alipayService.createAppPayOrder({
            merchantOrderNo: session.merchantOrderNo,
            totalAmount: session.expectedTotal,
            subject: `爱买买订单-${session.merchantOrderNo}`,
          });
          paymentParams = { channel: 'alipay', orderStr };
        } catch (err: any) {
          this.logger.error(`生成支付宝支付参数失败: ${err.message}`);
        }
      }
```

为（保留原 alipay 块完全不动，在其后追加 else if）：
```ts
      // 支付宝渠道：生成 APP 支付参数
      if (session.paymentChannel === 'ALIPAY' && this.alipayService?.isAvailable() && session.merchantOrderNo) {
        try {
          const orderStr = await this.alipayService.createAppPayOrder({
            merchantOrderNo: session.merchantOrderNo,
            totalAmount: session.expectedTotal,
            subject: `爱买买订单-${session.merchantOrderNo}`,
          });
          paymentParams = { channel: 'alipay', orderStr };
        } catch (err: any) {
          this.logger.error(`生成支付宝支付参数失败: ${err.message}`);
        }
      } else if (session.paymentChannel === 'WECHAT_PAY' && this.wechatPayService?.isAvailable() && session.merchantOrderNo) {
        try {
          const wxParams = await this.wechatPayService.createAppOrder({
            outTradeNo: session.merchantOrderNo,
            amount: session.expectedTotal,
            description: `爱买买订单-${session.merchantOrderNo}`,
          });
          paymentParams = { channel: 'wechat', ...wxParams };
        } catch (err: any) {
          this.logger.error(`生成微信支付参数失败: ${err.message}`);
        }
      }
```

- [ ] **Step 6: 在 createVipCheckoutSession（VIP 礼包）加 wechat 分支**

同样模式替换 `checkout.service.ts:1081-1092` 那段，把 alipay block 后追加 else if 块，subject/description 改成 `爱买买VIP礼包-${giftOption.title}`，`amount` 用 `vipPrice`。

- [ ] **Step 7: 在 resumeCheckout 加 wechat 分支**

同样模式替换 `checkout.service.ts:1424-1434` 那段（注意此处 alipay 失败抛 `ServiceUnavailableException`，wechat 分支保持同样错误语义）：

```ts
    if (session.paymentChannel === 'ALIPAY' && this.alipayService?.isAvailable() && session.merchantOrderNo) {
      try {
        const orderStr = await this.alipayService.createAppPayOrder({
          merchantOrderNo: session.merchantOrderNo,
          totalAmount: session.expectedTotal,
          subject: `爱买买订单-${session.merchantOrderNo}`,
        });
        paymentParams = { channel: 'alipay', orderStr };
      } catch (err: any) {
        this.logger.error(`续付生成支付宝参数失败: ${err.message}`);
        throw new ServiceUnavailableException('支付服务暂不可用，请稍后重试');
      }
    } else if (session.paymentChannel === 'WECHAT_PAY' && this.wechatPayService?.isAvailable() && session.merchantOrderNo) {
      try {
        const wxParams = await this.wechatPayService.createAppOrder({
          outTradeNo: session.merchantOrderNo,
          amount: session.expectedTotal,
          description: `爱买买订单-${session.merchantOrderNo}`,
        });
        paymentParams = { channel: 'wechat', ...wxParams };
      } catch (err: any) {
        this.logger.error(`续付生成微信支付参数失败: ${err.message}`);
        throw new ServiceUnavailableException('支付服务暂不可用，请稍后重试');
      }
    }
```

- [ ] **Step 8: 跑 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 9: 跑现有 checkout 测试**

Run: `cd backend && npm test -- --testPathPattern=checkout`
Expected: 全部 passed（确认 alipay 分支未被破坏）。

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/order/checkout.service.ts backend/src/modules/order/order.module.ts
git commit -m "feat(checkout/wechat): generate wechat paymentParams at three checkout entry points"
```

---

## Task 9b: 主动查单端点重命名 + 加 channel dispatch（**v1.0 必备**）

**为什么必须**：

`backend/src/modules/payment/payment.service.ts:136-157` 的 `confirmAlipayCheckout` 在第 155-157 行显式 `if (session.paymentChannel !== 'ALIPAY') throw BadRequestException('当前会话不是支付宝渠道，无需主动查询')`。App 端 `OrderRepo.activeQueryPayment` 是支付完成后**必走**的兜底路径（src/utils/alipay.ts 内 SDK 90s 超时 + checkout.tsx 的 `confirmPaymentAndNavigate`），不解决就微信永远落不下来。

**改造原则**：保留 alipay 行为等价不变，并用回归测试锁住；把 alipay-only 检查改成"按 channel 派发到对应 query"，方法重命名为 `confirmCheckout`。Controller 路由保持不变（`/orders/checkout/:sessionId/active-query`）。

**Files:**
- Modify: `backend/src/modules/payment/payment.service.ts`
- Modify: `backend/src/modules/order/order.controller.ts`
- Create: `backend/src/modules/payment/__tests__/payment.service.confirm-checkout.spec.ts`

- [ ] **Step 1: 写测试**

Create `backend/src/modules/payment/__tests__/payment.service.confirm-checkout.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from '../payment.service';
import { AlipayService } from '../alipay.service';
import { WechatPayService } from '../wechat-pay.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CheckoutService } from '../../order/checkout.service';

describe('PaymentService.confirmCheckout — channel dispatch', () => {
  let svc: PaymentService;
  let alipay: any;
  let wechat: any;
  let prisma: any;
  let checkout: any;

  beforeEach(async () => {
    alipay = { queryOrder: jest.fn(), isAvailable: jest.fn().mockReturnValue(true) };
    wechat = { queryOrder: jest.fn(), isAvailable: jest.fn().mockReturnValue(true) };
    prisma = {
      checkoutSession: { findUnique: jest.fn() },
    };
    checkout = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: AlipayService, useValue: alipay },
        { provide: WechatPayService, useValue: wechat },
        { provide: PrismaService, useValue: prisma },
        { provide: CheckoutService, useValue: checkout },
      ],
    }).compile();
    svc = moduleRef.get(PaymentService);
  });

  it('ALIPAY session still calls alipay queryOrder (regression)', async () => {
    prisma.checkoutSession.findUnique.mockResolvedValue({
      id: 'S1',
      userId: 'U1',
      paymentChannel: 'ALIPAY',
      status: 'ACTIVE',
      expectedTotal: 10,
      merchantOrderNo: 'CS-1',
      orders: [],
    });
    alipay.queryOrder.mockResolvedValue(null);
    const r = await svc.confirmCheckout('S1', 'U1');
    expect(alipay.queryOrder).toHaveBeenCalledWith('CS-1');
    expect(wechat.queryOrder).not.toHaveBeenCalled();
    expect(r.confirmedBy).toBe('not-found');
  });

  it('WECHAT_PAY session calls wechat queryOrder', async () => {
    prisma.checkoutSession.findUnique.mockResolvedValue({
      id: 'S2',
      userId: 'U1',
      paymentChannel: 'WECHAT_PAY',
      status: 'ACTIVE',
      expectedTotal: 10,
      merchantOrderNo: 'CS-2',
      orders: [],
    });
    wechat.queryOrder.mockResolvedValue({
      tradeState: 'NOTPAY',
      transactionId: '',
      outTradeNo: 'CS-2',
      totalAmount: 10,
    });
    const r = await svc.confirmCheckout('S2', 'U1');
    expect(wechat.queryOrder).toHaveBeenCalledWith('CS-2');
    expect(alipay.queryOrder).not.toHaveBeenCalled();
    expect(r.confirmedBy).toMatch(/wechat-notpay/);
  });

  it('WECHAT_PAY SUCCESS triggers handlePaymentCallback', async () => {
    prisma.checkoutSession.findUnique.mockResolvedValue({
      id: 'S3',
      userId: 'U1',
      paymentChannel: 'WECHAT_PAY',
      status: 'ACTIVE',
      expectedTotal: 9.99,
      merchantOrderNo: 'CS-3',
      orders: [],
    });
    wechat.queryOrder.mockResolvedValue({
      tradeState: 'SUCCESS',
      transactionId: 'WX-T-3',
      outTradeNo: 'CS-3',
      totalAmount: 9.99,
    });
    const handlePaymentCallback = jest
      .spyOn(svc, 'handlePaymentCallback')
      .mockResolvedValue(undefined as any);
    const r = await svc.confirmCheckout('S3', 'U1');
    expect(handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: 'CS-3',
        providerTxnId: 'WX-T-3',
        status: 'SUCCESS',
        skipSignatureVerification: true,
      }),
    );
  });

  it('WECHAT_PAY amount mismatch throws BadRequest (mirror alipay)', async () => {
    prisma.checkoutSession.findUnique.mockResolvedValue({
      id: 'S4',
      userId: 'U1',
      paymentChannel: 'WECHAT_PAY',
      status: 'ACTIVE',
      expectedTotal: 9.99,
      merchantOrderNo: 'CS-4',
      orders: [],
    });
    wechat.queryOrder.mockResolvedValue({
      tradeState: 'SUCCESS',
      transactionId: 'WX-T-4',
      outTradeNo: 'CS-4',
      totalAmount: 1.00,   // 不一致
    });
    await expect(svc.confirmCheckout('S4', 'U1')).rejects.toThrow('支付金额校验失败');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- payment.service.confirm-checkout`
Expected: FAIL（`confirmCheckout` 方法不存在）。

- [ ] **Step 3: 重命名 + 加 channel dispatch（保留兼容包装函数）**

Edit `backend/src/modules/payment/payment.service.ts`：

a) 把原 `confirmAlipayCheckout(sessionId, userId)` 方法的方法名改为 `confirmCheckout(sessionId, userId)`。

a0) 把方法顶部售后退货运费支付单分支从支付宝专用改成通用：

```ts
    if (sessionId?.startsWith('AS_SHIP_PAY_')) {
      return this.confirmAfterSaleShippingPayment(sessionId, userId);
    }
```

并把原 `confirmAfterSaleShippingAlipayPayment` 重命名为 `confirmAfterSaleShippingPayment`。该方法内部的微信 provider dispatch 在 Task 10 完成；本 Task 只负责 normal checkout active-query 的 channel dispatch。

b) 把行 154-157 的：
```ts
    // 2. 校验支付渠道
    if (session.paymentChannel !== 'ALIPAY') {
      throw new BadRequestException('当前会话不是支付宝渠道，无需主动查询');
    }
```

替换为：
```ts
    // 2. 按 channel 派发到对应通道的 query
    if (session.paymentChannel !== 'ALIPAY' && session.paymentChannel !== 'WECHAT_PAY') {
      throw new BadRequestException(`渠道 ${session.paymentChannel} 暂不支持主动查询`);
    }
```

c) 把行 189-202 的 alipay 调用块：
```ts
    let queryResult: { tradeStatus: string; tradeNo: string; totalAmount: string } | null = null;
    try {
      queryResult = await this.alipayService.queryOrder(session.merchantOrderNo);
    } catch (err: any) {
      this.logger.error(`active-query 调用支付宝异常: ${err.message}`);
      ...
    }
```

替换为统一 query（按 channel 派发）：
```ts
    let queryResult: { tradeStatus: string; tradeNo: string; totalAmount: string } | null = null;
    try {
      if (session.paymentChannel === 'ALIPAY') {
        queryResult = await this.alipayService.queryOrder(session.merchantOrderNo);
      } else if (session.paymentChannel === 'WECHAT_PAY') {
        if (!this.wechatPayService?.isAvailable()) {
          this.logger.warn(`active-query: 微信 SDK 未初始化，session=${this.maskBizId(sessionId)}`);
          return {
            status: session.status,
            orderIds: session.orders.map((o) => o.id),
            expectedTotal: session.expectedTotal,
            confirmedBy: 'query-error' as const,
          };
        }
        const wxResult = await this.wechatPayService.queryOrder(session.merchantOrderNo);
        if (wxResult) {
          // 统一映射成 alipay 风格的 { tradeStatus, tradeNo, totalAmount }，复用后续代码
          // 微信 SUCCESS → 等价 alipay TRADE_SUCCESS
          queryResult = {
            tradeStatus: wxResult.tradeState === 'SUCCESS' ? 'TRADE_SUCCESS' : `WECHAT_${wxResult.tradeState}`,
            tradeNo: wxResult.transactionId,
            totalAmount: wxResult.totalAmount.toFixed(2),
          };
        }
      }
    } catch (err: any) {
      this.logger.error(`active-query 调用 ${session.paymentChannel} 异常: ${err.message}`);
      return {
        status: session.status,
        orderIds: session.orders.map((o) => o.id),
        expectedTotal: session.expectedTotal,
        confirmedBy: 'query-error' as const,
      };
    }
```

d) 把行 217-226 alipay 中间态返回里的 `` `alipay-${tradeStatus.toLowerCase()}` `` 改成按 channel 动态：
```ts
        confirmedBy: `${session.paymentChannel === 'WECHAT_PAY' ? 'wechat' : 'alipay'}-${tradeStatus.toLowerCase()}` as const,
```

e) 注意 `assertAlipayAmountMatchesSession` 当前接受字符串金额；通过上面映射 `totalAmount.toFixed(2)` 转换可以**复用**这个 helper（金额校验跨渠道字符串语义统一）。**保留 alipay 代码不动**。

f) 保留**旧方法名兼容**：在 class 内加一个简短的转发函数，让任何老调用者仍能用：
```ts
  /** @deprecated 用 confirmCheckout 替代；保留以兼容旧调用者 */
  async confirmAlipayCheckout(sessionId: string, userId: string) {
    return this.confirmCheckout(sessionId, userId);
  }
```

- [ ] **Step 4: 改 OrderController 调用点（推荐）**

Edit `backend/src/modules/order/order.controller.ts:85-89`，把：
```ts
    return this.paymentService.confirmAlipayCheckout(sessionId, userId);
```
改成：
```ts
    return this.paymentService.confirmCheckout(sessionId, userId);
```

（也可以保留旧名走兼容；建议直接迁移，避免 deprecation 长期遗留。）

- [ ] **Step 5: 跑测试确认通过**

Run: `cd backend && npm test -- payment.service.confirm-checkout`
Expected: 4 passed。

- [ ] **Step 6: 跑全套 payment + order 测试确认未破坏**

Run: `cd backend && npm test -- --testPathPattern="payment|order"`
Expected: 全部 passed（特别确认 alipay active-query 全部测试仍通过）。

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/payment/payment.service.ts \
        backend/src/modules/order/order.controller.ts \
        backend/src/modules/payment/__tests__/payment.service.confirm-checkout.spec.ts
git commit -m "feat(payment/active-query): rename confirmAlipayCheckout to confirmCheckout with channel dispatch"
```

---

## Task 9c: 取消/过期 CheckoutSession 时补 WECHAT_PAY 查单 + 关单

**为什么必须**：

微信官方关单接口适用于用户取消订单、订单超时未支付等场景。当前 `cancelSession` / `CheckoutExpireService` 只对支付宝做"查单 → 已支付主动建单 / 未支付关单 → EXPIRED"。如果微信只做下单和 notify，用户点取消或 cron 过期时会把本地 session 改掉，但微信侧预支付单仍可能继续可支付，形成"本地已过期、微信后付成功"的资金风险。

**Files:**
- Modify: `backend/src/modules/order/checkout.service.ts`
- Modify: `backend/src/modules/order/checkout-expire.service.ts`
- Modify: `backend/src/modules/order/order.module.ts`
- Create: `backend/src/modules/order/__tests__/checkout-wechat-close.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `backend/src/modules/order/__tests__/checkout-wechat-close.spec.ts` with the same Prisma mock style as `checkout-money-safety.spec.ts`：

```ts
describe('Checkout WECHAT_PAY cancel/expire money safety', () => {
  it('cancelSession queries wechat and builds order when tradeState SUCCESS', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'SUCCESS',
        transactionId: 'WX-T-1',
        outTradeNo: 'CS-1',
        totalAmount: 88,
      }),
      closeOrder: jest.fn(),
    };
    const svc = buildCheckoutServiceForMoneySafety({ wechatPay });
    svc.setWechatPayService(wechatPay);
    jest.spyOn(svc, 'handlePaymentSuccess').mockResolvedValue({ orderIds: ['O1'] } as any);

    await expect(svc.cancelSession('U1', 'S1')).rejects.toThrow('支付已完成，订单已自动创建');

    expect(wechatPay.queryOrder).toHaveBeenCalledWith('CS-1');
    expect(wechatPay.closeOrder).not.toHaveBeenCalled();
    expect(svc.handlePaymentSuccess).toHaveBeenCalledWith('CS-1', 'WX-T-1', expect.any(String));
  });

  it('cancelSession closes wechat order before expiring when NOTPAY', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue({
        tradeState: 'NOTPAY',
        transactionId: '',
        outTradeNo: 'CS-2',
        totalAmount: 88,
      }),
      closeOrder: jest.fn().mockResolvedValue({
        success: true,
        terminal: false,
        alreadyPaid: false,
        message: '关单成功',
      }),
    };
    const svc = buildCheckoutServiceForMoneySafety({ wechatPay });
    svc.setWechatPayService(wechatPay);

    await svc.cancelSession('U1', 'S2');

    expect(wechatPay.queryOrder).toHaveBeenCalledWith('CS-2');
    expect(wechatPay.closeOrder).toHaveBeenCalledWith('CS-2');
  });

  it('expireSession skips local expiry when wechat close reports alreadyPaid', async () => {
    const wechatPay = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest
        .fn()
        .mockResolvedValueOnce({ tradeState: 'NOTPAY', outTradeNo: 'CS-3', transactionId: '', totalAmount: 88 })
        .mockResolvedValueOnce({ tradeState: 'SUCCESS', outTradeNo: 'CS-3', transactionId: 'WX-T-3', totalAmount: 88 }),
      closeOrder: jest.fn().mockResolvedValue({
        success: false,
        terminal: false,
        alreadyPaid: true,
        message: '订单已支付',
      }),
    };
    const expireSvc = buildCheckoutExpireServiceForMoneySafety({ wechatPay });
    expireSvc.setWechatPayService(wechatPay);

    await (expireSvc as any).expireSession({
      id: 'S3',
      merchantOrderNo: 'CS-3',
      paymentChannel: 'WECHAT_PAY',
      expectedTotal: 88,
      rewardId: null,
      couponInstanceIds: [],
      bizType: 'NORMAL_GOODS',
      itemsSnapshot: [],
    });

    expect(wechatPay.closeOrder).toHaveBeenCalledWith('CS-3');
    expect(wechatPay.queryOrder).toHaveBeenCalledTimes(2);
  });
});
```

`buildCheckoutServiceForMoneySafety` / `buildCheckoutExpireServiceForMoneySafety` 直接从 `checkout-money-safety.spec.ts` 抽本地 helper 到同文件顶部；不要引入真实数据库。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- checkout-wechat-close`
Expected: FAIL（`setWechatPayService` / WECHAT_PAY cancel/expire 分支不存在）。

- [ ] **Step 3: 给 CheckoutExpireService 加 WechatPayService setter**

Edit `backend/src/modules/order/checkout-expire.service.ts`：

```ts
  private wechatPayService: any = null;

  setWechatPayService(service: any) {
    this.wechatPayService = service;
  }
```

放在现有 `alipayService` 字段和 `setAlipayService` 附近，保持同一模式。

- [ ] **Step 4: 在 OrderModule 注入到 CheckoutExpireService**

Edit `backend/src/modules/order/order.module.ts`，在 Task 9 Step 4 添加的微信注入块里补一行：

```ts
    if (wechatPayService) {
      this.checkoutService.setWechatPayService(wechatPayService);
      this.checkoutExpireService.setWechatPayService(wechatPayService);
    }
```

支付宝注入块不改。

- [ ] **Step 5: 在 cancelSession 增加 WECHAT_PAY 分支**

Edit `backend/src/modules/order/checkout.service.ts`。在现有支付宝资金安全块后、CAS 改 EXPIRED 前，加入同构微信块：

```ts
    if (
      session.merchantOrderNo &&
      session.paymentChannel === 'WECHAT_PAY' &&
      this.wechatPayService?.isAvailable()
    ) {
      let queryResult: { tradeState: string; transactionId: string; totalAmount: number } | null = null;
      try {
        queryResult = await this.wechatPayService.queryOrder(session.merchantOrderNo);
      } catch (err: any) {
        this.logger.warn(
          `cancelSession 查微信异常，拒绝取消：sessionId=${sessionId}, error=${err.message}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }

      if (queryResult?.tradeState === 'SUCCESS') {
        if (queryResult.totalAmount.toFixed(2) !== session.expectedTotal.toFixed(2)) {
          this.logger.error(
            `cancelSession 微信金额校验失败：wechat=${queryResult.totalAmount.toFixed(2)} session=${session.expectedTotal.toFixed(2)} sessionId=${sessionId}`,
          );
          throw new BadRequestException('支付金额校验失败，请联系客服');
        }
        const buildResult = await this.handlePaymentSuccess(
          session.merchantOrderNo,
          queryResult.transactionId,
          new Date().toISOString(),
        );
        if (buildResult?.orderIds?.length > 0) {
          void this.notifyMerchantsAfterCheckoutBuild(buildResult.orderIds, 'cancel-paid-wechat');
        }
        throw new BadRequestException('支付已完成，订单已自动创建，请稍后查看订单');
      }

      const closeResult = await this.wechatPayService.closeOrder(session.merchantOrderNo);
      if (closeResult?.alreadyPaid) {
        const queryAfterClose = await this.wechatPayService.queryOrder(session.merchantOrderNo);
        if (queryAfterClose?.tradeState === 'SUCCESS') {
          const closePaidResult = await this.handlePaymentSuccess(
            session.merchantOrderNo,
            queryAfterClose.transactionId,
            new Date().toISOString(),
          );
          if (closePaidResult?.orderIds?.length > 0) {
            void this.notifyMerchantsAfterCheckoutBuild(closePaidResult.orderIds, 'cancel-close-paid-wechat');
          }
        }
        throw new BadRequestException('支付已完成，订单已自动创建，请稍后查看订单');
      }
      if (closeResult && closeResult.success === false && !closeResult.terminal) {
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }
    }
```

不改支付宝块；微信块是并列分支。

- [ ] **Step 6: 在 CheckoutExpireService.expireSession 增加 WECHAT_PAY 分支**

Edit `backend/src/modules/order/checkout-expire.service.ts`。在支付宝资金安全块后、真正 EXPIRED 事务前加入同构微信块；异常时只 log + return，保持 cron 语义：

```ts
    if (
      session.merchantOrderNo &&
      session.paymentChannel === 'WECHAT_PAY' &&
      this.wechatPayService?.isAvailable()
    ) {
      let queryResult: { tradeState: string; transactionId: string; totalAmount: number } | null = null;
      try {
        queryResult = await this.wechatPayService.queryOrder(session.merchantOrderNo);
      } catch (err: any) {
        this.logger.warn(`expireSession 查微信异常，跳过本次 sessionId=${session.id}：${err.message}`);
        return;
      }

      if (queryResult?.tradeState === 'SUCCESS') {
        if (!this.checkoutService) {
          this.logger.error(`expireSession 微信已支付但 CheckoutService 未注入，sessionId=${session.id}`);
          return;
        }
        if (queryResult.totalAmount.toFixed(2) !== session.expectedTotal.toFixed(2)) {
          this.logger.error(
            `expireSession 微信金额校验失败：wechat=${queryResult.totalAmount.toFixed(2)} session=${session.expectedTotal.toFixed(2)} sessionId=${session.id}`,
          );
          return;
        }
        const buildResult = await this.checkoutService.handlePaymentSuccess(
          session.merchantOrderNo,
          queryResult.transactionId,
          new Date().toISOString(),
        );
        if (buildResult?.orderIds?.length > 0) {
          void this.notifyMerchantsAfterCheckoutBuild(buildResult.orderIds, 'expire-paid-wechat');
        }
        return;
      }

      const closeResult = await this.wechatPayService.closeOrder(session.merchantOrderNo);
      if (closeResult?.alreadyPaid) {
        const queryAfterClose = await this.wechatPayService.queryOrder(session.merchantOrderNo);
        if (queryAfterClose?.tradeState === 'SUCCESS' && this.checkoutService) {
          const closePaidResult = await this.checkoutService.handlePaymentSuccess(
            session.merchantOrderNo,
            queryAfterClose.transactionId,
            new Date().toISOString(),
          );
          if (closePaidResult?.orderIds?.length > 0) {
            void this.notifyMerchantsAfterCheckoutBuild(closePaidResult.orderIds, 'expire-close-paid-wechat');
          }
        }
        return;
      }
      if (closeResult && closeResult.success === false && !closeResult.terminal) {
        this.logger.warn(`expireSession 微信关单失败，跳过本次 sessionId=${session.id}`);
        return;
      }
    }
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd backend && npm test -- checkout-wechat-close`
Expected: 3 passed。

- [ ] **Step 8: 跑 checkout money safety 回归**

Run: `cd backend && npm test -- checkout-money-safety`
Expected: 现有支付宝 cancel/expire 测试仍 passed。

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/order/checkout.service.ts \
        backend/src/modules/order/checkout-expire.service.ts \
        backend/src/modules/order/order.module.ts \
        backend/src/modules/order/__tests__/checkout-wechat-close.spec.ts
git commit -m "feat(checkout/wechat): close wechat orders before cancel or expiry"
```

---

## Task 10: 售后退货运费微信支付全链路（provider / paymentParams / refund / App）

**Files:**
- Modify: `backend/src/modules/after-sale/after-sale-shipping-payment.service.ts`
- Modify: `backend/src/modules/after-sale/after-sale.module.ts`
- Modify: `backend/src/modules/payment/payment.service.ts`
- Modify: `src/repos/AfterSaleRepo.ts`
- Modify: `app/orders/after-sale-detail/[id].tsx`
- Create: `backend/src/modules/after-sale/__tests__/after-sale-shipping-payment.provider-dispatch.spec.ts`

- [ ] **Step 1: 写测试覆盖 provider dispatch + 微信支付参数 + 微信退款通知**

Create `backend/src/modules/after-sale/__tests__/after-sale-shipping-payment.provider-dispatch.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AfterSaleShippingPaymentService } from '../after-sale-shipping-payment.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AfterSaleShippingPaymentService — provider dispatch and wechat params', () => {
  let svc: AfterSaleShippingPaymentService;
  let tx: any;
  let alipayService: any;
  let wechatPayService: any;

  beforeEach(async () => {
    tx = {
      afterSaleShippingPayment: { upsert: jest.fn() },
      order: { findUnique: jest.fn() },
    };
    alipayService = {
      isAvailable: jest.fn().mockReturnValue(true),
      createAppPayOrder: jest.fn().mockResolvedValue('alipay-order-str'),
      refund: jest.fn(),
    };
    wechatPayService = {
      isAvailable: jest.fn().mockReturnValue(true),
      createAppOrder: jest.fn().mockResolvedValue({
        appId: 'wxtest',
        partnerId: '1234567890',
        timestamp: '1700000000',
        nonceStr: 'NONCE',
        prepayId: 'wx-prepay',
        packageVal: 'Sign=WXPay',
        signType: 'RSA',
        paySign: 'SIGN',
      }),
      refund: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AfterSaleShippingPaymentService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    svc = moduleRef.get(AfterSaleShippingPaymentService);
    (svc as any).alipayService = alipayService;
    (svc as any).setWechatPayService(wechatPayService);
  });

  it('passes ALIPAY when original order paid via alipay (regression)', async () => {
    tx.order.findUnique.mockResolvedValue({
      checkoutSession: { paymentChannel: 'ALIPAY' },
    });
    tx.afterSaleShippingPayment.upsert.mockResolvedValue({});
    jest.spyOn(svc as any, 'resolveReturnShippingFeeInTx').mockResolvedValue(8);

    await (svc as any).upsertPaymentInTx(tx, {
      id: 'AS-1',
      orderId: 'O-1',
      returnShippingFee: 8,
    });

    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provider: 'ALIPAY' }),
      }),
    );
  });

  it('passes WECHAT_PAY when original order paid via wechat', async () => {
    tx.order.findUnique.mockResolvedValue({
      checkoutSession: { paymentChannel: 'WECHAT_PAY' },
    });
    tx.afterSaleShippingPayment.upsert.mockResolvedValue({});
    jest.spyOn(svc as any, 'resolveReturnShippingFeeInTx').mockResolvedValue(8);

    await (svc as any).upsertPaymentInTx(tx, {
      id: 'AS-2',
      orderId: 'O-2',
      returnShippingFee: 8,
    });

    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provider: 'WECHAT_PAY' }),
      }),
    );
  });

  it('falls back to ALIPAY when checkoutSession missing (legacy orders)', async () => {
    tx.order.findUnique.mockResolvedValue({ checkoutSession: null });
    tx.afterSaleShippingPayment.upsert.mockResolvedValue({});
    jest.spyOn(svc as any, 'resolveReturnShippingFeeInTx').mockResolvedValue(8);

    await (svc as any).upsertPaymentInTx(tx, {
      id: 'AS-3',
      orderId: 'O-3',
      returnShippingFee: 8,
    });

    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provider: 'ALIPAY' }),
      }),
    );
  });

  it('returns wechat paymentParams when provider is WECHAT_PAY', async () => {
    const payment = {
      id: 'ship_pay_001',
      afterSaleId: 'after_sale_with_long_id_001',
      merchantPaymentNo: 'AS_SHIP_PAY_ABCDEF1234567890',
      amount: 8,
      status: 'UNPAID',
      provider: 'WECHAT_PAY',
    };
    const params = await (svc as any).buildPaymentParams(payment);
    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: 'AS_SHIP_PAY_ABCDEF1234567890',
      amount: 8,
      description: '爱买买退货运费-after_sale_with_long_id_001',
    });
    expect(params).toEqual(expect.objectContaining({
      channel: 'wechat',
      prepayId: 'wx-prepay',
      partnerId: '1234567890',
    }));
  });

  it('keeps merchantPaymentNo within wechat out_trade_no 32 char limit', () => {
    const no = (svc as any).getMerchantPaymentNo('cmf1abcdefghijklmnopqrstuvwxyz1234567890');
    expect(no.startsWith('AS_SHIP_PAY_')).toBe(true);
    expect(no.length).toBeLessThanOrEqual(32);
  });

  it('wechat refund PROCESSING keeps shipping payment REFUNDING', async () => {
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb({
        afterSaleShippingPayment: {
          findUnique: jest.fn().mockResolvedValue({
            afterSaleId: 'as_001',
            merchantPaymentNo: 'AS_SHIP_PAY_as_001',
            provider: 'WECHAT_PAY',
            amount: 8,
            status: 'PAID',
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      })),
    };
    (svc as any).prisma = prisma;
    wechatPayService.refund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'WX-R-1',
      message: '退款受理中，等待结果通知',
    });
    await svc.refundShippingPayment('as_001', '售后状态变更');
    expect(wechatPayService.refund).toHaveBeenCalledWith(expect.objectContaining({
      outTradeNo: 'AS_SHIP_PAY_as_001',
      outRefundNo: expect.stringMatching(/^AS_SHIP_REF_/),
      refundAmount: 8,
      totalAmount: 8,
    }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- after-sale-shipping-payment.provider-dispatch`
Expected: FAIL（`setWechatPayService` / `buildPaymentParams` / 微信分支不存在）。

- [ ] **Step 3: 修改 AfterSaleShippingPaymentService**

Edit `backend/src/modules/after-sale/after-sale-shipping-payment.service.ts`：

a) 顶部新增 import：
```ts
import * as crypto from 'crypto';
import { Cron } from '@nestjs/schedule';
import type { WechatPayService } from '../payment/wechat-pay.service';
```

b) 扩展 `paymentParams` 类型：
```ts
  paymentParams: {
    channel?: 'alipay' | 'wechat';
    orderStr?: string;
    appId?: string;
    partnerId?: string;
    timestamp?: string;
    nonceStr?: string;
    prepayId?: string;
    packageVal?: string;
    signType?: string;
    paySign?: string;
  };
```

c) 类字段和 setter：
```ts
  private wechatPayService: WechatPayService | null = null;

  setWechatPayService(service: WechatPayService) {
    this.wechatPayService = service;
  }
```

d) `createOrGetPaymentForBuyer` 中把：
```ts
const paymentParams = await this.buildAlipayPaymentParams(payment);
```
替换为：
```ts
const paymentParams = await this.buildPaymentParams(payment);
```

e) 替换 `upsertPaymentInTx`：
```ts
  private async upsertPaymentInTx(
    tx: Tx,
    request: AfterSaleRequest,
  ): Promise<AfterSaleShippingPayment> {
    const amount = await this.resolveReturnShippingFeeInTx(tx, request);
    const merchantPaymentNo = this.getMerchantPaymentNo(request.id);

    // 退货运费支付通道必须与原订单一致——不能让微信付的订单走支付宝退货运费
    const order = await tx.order.findUnique({
      where: { id: request.orderId },
      select: { checkoutSession: { select: { paymentChannel: true } } },
    });
    const provider = order?.checkoutSession?.paymentChannel === 'WECHAT_PAY' ? 'WECHAT_PAY' : 'ALIPAY';

    return tx.afterSaleShippingPayment.upsert({
      where: { merchantPaymentNo },
      create: {
        afterSaleId: request.id,
        amount,
        status: 'UNPAID',
        merchantPaymentNo,
        provider,
      },
      update: {},
    });
  }
```

f) 替换 `getMerchantPaymentNo` / `getMerchantRefundNo`，保证微信商户单号不超过 32 字符：
```ts
  private shortToken(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16).toUpperCase();
  }

  private getMerchantPaymentNo(afterSaleId: string): string {
    const legacy = `AS_SHIP_PAY_${afterSaleId}`;
    return legacy.length <= 32 ? legacy : `AS_SHIP_PAY_${this.shortToken(afterSaleId)}`;
  }

  private getMerchantRefundNo(afterSaleId: string): string {
    return `AS_SHIP_REF_${this.shortToken(afterSaleId)}`;
  }
```

g) 新增通用支付参数方法，并保留原支付宝方法不变：
```ts
  private async buildPaymentParams(
    payment: AfterSaleShippingPayment,
  ): Promise<AfterSaleShippingPaymentBuyerResponse['paymentParams']> {
    if (payment.provider === 'WECHAT_PAY') {
      return this.buildWechatPaymentParams(payment);
    }
    return this.buildAlipayPaymentParams(payment);
  }

  private async buildWechatPaymentParams(
    payment: AfterSaleShippingPayment,
  ): Promise<AfterSaleShippingPaymentBuyerResponse['paymentParams']> {
    if (payment.status !== 'UNPAID' && payment.status !== 'PENDING' && payment.status !== 'FAILED') {
      return {};
    }
    if (!this.wechatPayService?.isAvailable()) {
      return {};
    }
    const wxParams = await this.wechatPayService.createAppOrder({
      outTradeNo: payment.merchantPaymentNo,
      amount: payment.amount,
      description: `爱买买退货运费-${payment.afterSaleId}`,
    });
    return { channel: 'wechat', ...wxParams };
  }
```

h) 在 `refundShippingPayment` 内，把单一 `alipayService.refund` 分支替换为 provider dispatch：
```ts
    let result: { success: boolean; pending?: boolean; message: string };
    try {
      if (paymentToRefund.provider === 'WECHAT_PAY') {
        if (!this.wechatPayService?.isAvailable()) {
          throw new Error('微信退款服务不可用');
        }
        result = await this.wechatPayService.refund({
          outTradeNo: paymentToRefund.merchantPaymentNo,
          outRefundNo: merchantRefundNo,
          refundAmount: paymentToRefund.amount,
          totalAmount: paymentToRefund.amount,
          reason,
        });
      } else {
        if (!this.alipayService?.refund) {
          throw new Error('支付宝退款服务不可用');
        }
        result = await this.alipayService.refund({
          merchantOrderNo: paymentToRefund.merchantPaymentNo,
          refundAmount: paymentToRefund.amount,
          merchantRefundNo,
          refundReason: reason,
        });
      }
    } catch (err: any) {
      result = { success: false, pending: false, message: err?.message || '退货运费退款异常' };
    }
```

i) `refundShippingPayment` 更新状态时，`result.success && result.pending` 必须保持 `REFUNDING`：
```ts
          data: result.success
            ? result.pending
              ? {
                  status: 'REFUNDING',
                  failureReason: `退货运费退款受理中: ${reason}`,
                }
              : {
                  status: 'REFUNDED',
                  refundedAt: new Date(),
                  failureReason: null,
                }
            : {
                status: 'FAILED',
                failureReason: `退货运费退款失败: ${result.message || '退款失败'}`,
              },
```

j) 新增微信退货运费退款 notify/queryRefund 闭环：
```ts
  async handleWechatRefundNotify(args: {
    merchantPaymentNo: string;
    outRefundNo: string;
    tradeState: string;
    providerRefundId?: string;
  }): Promise<void> {
    await this.withSerializableRetry(async (tx) => {
      const payment = await tx.afterSaleShippingPayment.findUnique({
        where: { merchantPaymentNo: args.merchantPaymentNo },
      });
      if (!payment) throw new NotFoundException('售后退货运费支付单不存在');
      if (payment.status === 'REFUNDED') return;
      if (args.tradeState === 'PROCESSING') {
        await tx.afterSaleShippingPayment.updateMany({
          where: { merchantPaymentNo: args.merchantPaymentNo, status: 'REFUNDING' },
          data: { failureReason: `退货运费退款受理中: ${args.outRefundNo}` },
        });
        return;
      }
      if (args.tradeState === 'SUCCESS') {
        await tx.afterSaleShippingPayment.updateMany({
          where: { merchantPaymentNo: args.merchantPaymentNo, status: { in: ['REFUNDING', 'FAILED'] } },
          data: { status: 'REFUNDED', refundedAt: new Date(), failureReason: null },
        });
        return;
      }
      await tx.afterSaleShippingPayment.updateMany({
        where: { merchantPaymentNo: args.merchantPaymentNo, status: 'REFUNDING' },
        data: { status: 'FAILED', failureReason: `微信退货运费退款失败 [${args.tradeState}]` },
      });
    });
  }
```

k) 新增微信退货运费退款查单补偿，避免 refund.notify 丢失后永久卡在 `REFUNDING`：
```ts
  @Cron('30 */10 * * * *')
  async retryStaleWechatShippingRefunds(): Promise<void> {
    if (!this.wechatPayService?.isAvailable()) return;
    const cutoff = new Date(Date.now() - 10 * 60_000);
    const payments = await this.prisma.afterSaleShippingPayment.findMany({
      where: {
        provider: 'WECHAT_PAY',
        status: 'REFUNDING',
        updatedAt: { lte: cutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });
    for (const payment of payments) {
      const outRefundNo = this.getMerchantRefundNo(payment.afterSaleId);
      const queried = await this.wechatPayService.queryRefund(outRefundNo);
      if (!queried) continue;
      await this.handleWechatRefundNotify({
        merchantPaymentNo: payment.merchantPaymentNo,
        outRefundNo: queried.outRefundNo,
        tradeState: queried.status,
        providerRefundId: queried.providerRefundId,
      });
    }
  }
```

- [ ] **Step 4: 在 AfterSaleModule 注入 WechatPayService**

Edit `backend/src/modules/after-sale/after-sale.module.ts`：

```ts
import { WechatPayService } from '../payment/wechat-pay.service';
```

在 `onModuleInit()` 中 `shippingRuleService` 注入附近追加：
```ts
    const wechatPayService = this.moduleRef.get(WechatPayService, { strict: false });
    if (wechatPayService && this.afterSaleShippingPaymentService.setWechatPayService) {
      this.afterSaleShippingPaymentService.setWechatPayService(wechatPayService);
    }
```

- [ ] **Step 5: PaymentService active-query / refund notify 接入退货运费微信路径**

Edit `backend/src/modules/payment/payment.service.ts`：

1. 把 `confirmAlipayCheckout`/`confirmCheckout` 顶部的 `AS_SHIP_PAY_` 分支改为：
```ts
    if (sessionId?.startsWith('AS_SHIP_PAY_')) {
      return this.confirmAfterSaleShippingPayment(sessionId, userId);
    }
```

2. 把 `confirmAfterSaleShippingAlipayPayment` 重命名为 `confirmAfterSaleShippingPayment`，在里面按 `payment.provider` dispatch：
```ts
      if (payment.provider === 'WECHAT_PAY') {
        if (!this.wechatPayService?.isAvailable()) {
          return { status: payment.status, orderIds: [], expectedTotal: payment.amount, confirmedBy: 'query-error' as const };
        }
        const wx = await this.wechatPayService.queryOrder(merchantPaymentNo);
        queryResult = wx
          ? {
              tradeStatus: wx.tradeState === 'SUCCESS' ? 'TRADE_SUCCESS' : `WECHAT_${wx.tradeState}`,
              tradeNo: wx.transactionId,
              totalAmount: wx.totalAmount.toFixed(2),
            }
          : null;
      } else {
        queryResult = await this.alipayService.queryOrder(merchantPaymentNo);
      }
```

3. Task 8 的 `handleWechatRefundNotify` 已有 `AS_SHIP_PAY_` 分支，确认它调用：
```ts
await this.afterSaleShippingPaymentService.handleWechatRefundNotify({ ... });
```

- [ ] **Step 6: App 售后详情页按 channel 支付**

Edit `src/repos/AfterSaleRepo.ts` 的 `paymentParams` 类型，补 wechat 字段：
```ts
paymentParams?: {
  channel?: 'alipay' | 'wechat';
  orderStr?: string;
  appId?: string;
  partnerId?: string;
  timestamp?: string;
  nonceStr?: string;
  prepayId?: string;
  packageVal?: string;
  signType?: string;
  paySign?: string;
};
```

Edit `app/orders/after-sale-detail/[id].tsx`：

1. import：
```ts
import { payWithWechat } from '../../../src/utils/wechat-pay';
```

2. 把当前 `orderStr + payWithAlipay` 块改成：
```tsx
      const params = result.data.paymentParams;
      if (params?.channel === 'alipay' && params.orderStr) {
        const payResult = await payWithAlipay(params.orderStr);
        if (payResult.resultStatus === '6001') return;
      } else if (params?.channel === 'wechat' && params.prepayId) {
        const payResult = await payWithWechat({
          appId: params.appId!,
          partnerId: params.partnerId!,
          timestamp: params.timestamp!,
          nonceStr: params.nonceStr!,
          prepayId: params.prepayId,
          packageVal: params.packageVal!,
          signType: params.signType!,
          paySign: params.paySign!,
        });
        if (payResult.resultStatus === '6001') return;
      } else {
        show({ message: '支付参数获取失败，请稍后重试', type: 'error' });
        return;
      }

      const activeQueryResult = await OrderRepo.activeQueryPayment(result.data.merchantPaymentNo);
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd backend && npm test -- after-sale-shipping-payment.provider-dispatch`
Expected: provider dispatch / wechat params / wechat refund tests passed。

- [ ] **Step 8: 跑全套售后 + payment + App TS**

Run: `cd backend && npm test -- --testPathPattern=after-sale`
Expected: 全部 passed。

Run: `cd backend && npm test -- --testPathPattern=payment`
Expected: 全部 passed。

Run: `npx tsc -b --noEmit`
Expected: 无错误。

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/after-sale/after-sale-shipping-payment.service.ts \
        backend/src/modules/after-sale/after-sale.module.ts \
        backend/src/modules/payment/payment.service.ts \
        backend/src/modules/after-sale/__tests__/after-sale-shipping-payment.provider-dispatch.spec.ts \
        src/repos/AfterSaleRepo.ts \
        app/orders/after-sale-detail/[id].tsx
git commit -m "feat(after-sale/shipping-payment): support wechat return-shipping payment and refund"
```

---

## Task 11: 后端联调烟雾测试 + 全套 backend 测试

**Files:** （no code change, verification only）

- [ ] **Step 1: 跑 prisma validate**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npx prisma validate
```

Expected: schema valid。

- [ ] **Step 2: 跑全套 backend 测试**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npm test
```

Expected: 所有 suite 通过，无 fail，无 hang。

- [ ] **Step 3: 启动后端确认 wechat 凭据未配时 graceful warn 而非 crash**

Run（确保 `backend/.env` 里没真实 WECHAT_PAY_* 值）：
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend" && npm run start:dev 2>&1 | head -50
```

Expected: 看到日志 `微信支付凭据未配齐 ... 微信支付不可用`；后端正常起来；按 Ctrl+C 停止。

- [ ] **Step 4: 无 commit**

本步骤仅验证。若验证失败，回退到对应 Task 修复。

---

## Task 11b: 前端支付参数类型补齐（避免 wechat 分支 TS 报 unknown）

**Files:**
- Modify: `src/repos/OrderRepo.ts`

**为什么必须**：

当前 `CheckoutSessionResult.paymentParams` 是 `Record<string, unknown>`，`resumeCheckout` 返回类型只有 `{ channel?: string; orderStr?: string }`。Task 13/14 直接读取 `params.appId/prepayId/paySign` 会触发 TypeScript 错误。

- [ ] **Step 1: 新增支付参数 union type**

Edit `src/repos/OrderRepo.ts`，在 `CheckoutSessionResult` 前新增：

```ts
export interface AlipayPaymentParams {
  channel: 'alipay';
  orderStr: string;
}

export interface WechatPaymentParams {
  channel: 'wechat';
  appId: string;
  partnerId: string;
  timestamp: string;
  nonceStr: string;
  prepayId: string;
  packageVal: string;
  signType: string;
  paySign: string;
}

export type CheckoutPaymentParams =
  | AlipayPaymentParams
  | WechatPaymentParams
  | Record<string, never>;
```

- [ ] **Step 2: 替换 CheckoutSessionResult.paymentParams 类型**

Find:
```ts
  paymentParams?: Record<string, unknown>;
```

Replace with:
```ts
  paymentParams?: CheckoutPaymentParams;
```

- [ ] **Step 3: 替换 resumeCheckout 返回类型**

Find:
```ts
  resumeCheckout: async (sessionId: string): Promise<Result<{ sessionId: string; merchantOrderNo: string | null; expectedTotal: number; paymentParams: { channel?: string; orderStr?: string } }>> => {
```

Replace with:
```ts
  resumeCheckout: async (sessionId: string): Promise<Result<{
    sessionId: string;
    merchantOrderNo: string | null;
    expectedTotal: number;
    paymentParams: CheckoutPaymentParams;
  }>> => {
```

- [ ] **Step 4: 验证 TS 编译**

Run:
```bash
npx tsc -b --noEmit
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/repos/OrderRepo.ts
git commit -m "feat(app/payment): type checkout payment params for alipay and wechat"
```

---

## Task 11c: Android 原生回调补 `WXPayEntryActivity`

**为什么必须**：

`react-native-wechat-lib` 登录/分享回调用 `WXEntryActivity`，支付回调需要同包名下 `WXPayEntryActivity`。当前 `plugins/withWechat.js` 只生成并注册 `WXEntryActivity`；如果不补，微信收银台返回 App 后 JS 层可能拿不到 `pay()` 结果，续付/取消 UX 会不稳定。

**Files:**
- Modify: `plugins/withWechat.js`

- [ ] **Step 1: 修改 withWechatEntryActivity 同时生成 WXPayEntryActivity**

Edit `plugins/withWechat.js`。在 `withWechatEntryActivity` 中当前 `const wxEntryCode = ...` 和 `fs.writeFileSync(path.join(wxapiDir, 'WXEntryActivity.java'), wxEntryCode);` 后追加：

```js
      const wxPayEntryCode = `package ${androidPackage}.wxapi;

import android.app.Activity;
import android.os.Bundle;
import com.theweflex.react.WeChatModule;

public class WXPayEntryActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WeChatModule.handleIntent(getIntent());
    finish();
  }
}
`;
      fs.writeFileSync(path.join(wxapiDir, 'WXPayEntryActivity.java'), wxPayEntryCode);
```

- [ ] **Step 2: 修改 AndroidManifest 注册函数**

在 `withWechatAndroidManifest` 中当前注册 `.wxapi.WXEntryActivity` 的逻辑后追加：

```js
    const payActivityExists = application.activity.some(
      (a) => a.$?.['android:name'] === '.wxapi.WXPayEntryActivity',
    );
    if (!payActivityExists) {
      application.activity.push({
        $: {
          'android:name': '.wxapi.WXPayEntryActivity',
          'android:label': '@string/app_name',
          'android:exported': 'true',
          'android:launchMode': 'singleTask',
          'android:taskAffinity': cfg.android?.package || 'com.aimaimai.shop',
        },
      });
    }
```

不要删除或改名 `.wxapi.WXEntryActivity`，微信登录仍依赖它。

- [ ] **Step 3: 运行 Expo config 预检**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && npx expo config --json >/tmp/aimaimai-expo-config.json
```

Expected: 命令退出码 0；不要求生成 android 目录。

- [ ] **Step 4: Commit**

```bash
git add plugins/withWechat.js
git commit -m "fix(app/wechat): add Android WXPayEntryActivity for payment callback"
```

---

## Task 12: App 端 src/utils/wechat-pay.ts

**Files:**
- Create: `src/utils/wechat-pay.ts`

- [ ] **Step 1: 写文件**

Create `src/utils/wechat-pay.ts`:

```ts
import { Platform } from 'react-native';
import { initWechat } from '../services/wechat';

/**
 * 调起微信 App 支付。
 *
 * 流程：
 * 1. 复用 initWechat()（与登录同一个 SDK 注册，不重复 registerApp）
 * 2. 调 WeChat.pay() 触发原生收银台
 * 3. 返回结果由 useConfirmPayment 兜底（active-query + polling）
 *
 * resultStatus 映射（对齐 useConfirmPayment 的支付宝语义，避免改 hook）：
 *   - 用户取消（errCode -2）→ '6001'
 *   - 其他 → ''（统一走 active-query）
 *
 * @param payload 后端 WechatPayService.createAppOrder 返回的字段
 * @returns { success, resultStatus, errCode, errStr }
 */
export async function payWithWechat(payload: {
  appId: string;
  partnerId: string;
  timestamp: string;
  nonceStr: string;
  prepayId: string;
  packageVal: string;
  signType: string;
  paySign: string;
}): Promise<{
  success: boolean;
  resultStatus: string;
  errCode?: number;
  errStr?: string;
}> {
  try {
    const ok = await initWechat();
    if (!ok) {
      console.warn('[WeChatPay] SDK 未注册（Expo Go 或原生模块未链接）');
      return { success: false, resultStatus: '', errStr: 'NATIVE_UNAVAILABLE' };
    }

    const WeChatLib = require('react-native-wechat-lib');

    if (Platform.OS === 'android') {
      const installed = await WeChatLib.isWXAppInstalled();
      if (!installed) {
        return { success: false, resultStatus: '', errStr: '请先安装微信 App' };
      }
    }

    // react-native-wechat-lib v1.x 的 pay() 参数（mchid 走 partnerId）
    const result = await WeChatLib.pay({
      partnerId: payload.partnerId,
      prepayId: payload.prepayId,
      nonceStr: payload.nonceStr,
      timeStamp: payload.timestamp,
      package: payload.packageVal,
      sign: payload.paySign,
    });

    const errCode = (result as any)?.errCode;
    const errStr = (result as any)?.errStr || (result as any)?.errMsg || '';
    console.log(`[WeChatPay] result: errCode=${errCode} errStr=${errStr}`);

    if (errCode === -2) {
      return { success: false, resultStatus: '6001', errCode, errStr };
    }
    if (errCode === 0) {
      return { success: true, resultStatus: '', errCode, errStr };
    }
    return { success: false, resultStatus: '', errCode, errStr };
  } catch (err: any) {
    console.error('[WeChatPay] 支付异常:', err);
    return { success: false, resultStatus: '', errStr: err?.message || 'UNKNOWN_ERROR' };
  }
}
```

- [ ] **Step 2: 验证 App 端 TS 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && npx tsc -b --noEmit
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/utils/wechat-pay.ts
git commit -m "feat(app/wechat): add payWithWechat wrapper mapping result to alipay-like resultStatus"
```

---

## Task 13: app/checkout.tsx 加 wechat 分支（普通结算 + VIP 礼包）

**Files:**
- Modify: `app/checkout.tsx`

**重要**：`app/checkout.tsx` 有**两段**几乎相同的支付分发代码：普通商品结算（≈ 行 579-628 在 `handleCheckout` 内）和 VIP 礼包结算（≈ 行 707-770 在 `handleVipCheckout` 内）。两段都要加 wechat 分支。两段之间还有不同：VIP 路径对 alipay `6001`（用户取消）做了"二次确认 active-query 防误报"特殊处理（行 720-748），微信 `errCode=-2` 同样需要这层防误报。

- [ ] **Step 1: 加 import**

Find line:
```ts
import { payWithAlipay } from '../src/utils/alipay';
```

Add immediately after:
```ts
import { payWithWechat } from '../src/utils/wechat-pay';
```

- [ ] **Step 2: 普通结算路径加 wechat 分支（≈ 行 609 起）**

Find `app/checkout.tsx` 内 `handleCheckout` 函数里的 `if (paymentParams?.channel === 'alipay' && paymentParams?.orderStr) { ... }` 整块（≈ 行 579-609）。在该 `if` 块结束的 `}` 之后、`} else if (paymentMethod === 'alipay')` 之前插入并列分支：

```tsx
      } else if (paymentParams?.channel === 'wechat' && paymentParams?.prepayId) {
        const wechatResult = await payWithWechat({
          appId: paymentParams.appId,
          partnerId: paymentParams.partnerId,
          timestamp: paymentParams.timestamp,
          nonceStr: paymentParams.nonceStr,
          prepayId: paymentParams.prepayId,
          packageVal: paymentParams.packageVal,
          signType: paymentParams.signType,
          paySign: paymentParams.paySign,
        });
        if (wechatResult.errStr === 'NATIVE_UNAVAILABLE') {
          if (__DEV__) {
            const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
            if (!payResult.ok) {
              show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
              await OrderRepo.cancelCheckoutSession(sessionId);
              return;
            }
          } else {
            show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
            await OrderRepo.cancelCheckoutSession(sessionId);
            return;
          }
        } else if (wechatResult.resultStatus === '6001') {
          // 用户取消 — 与 alipay 6001 同处理：保留 session，跳 pending 让用户决定
          router.replace({ pathname: '/checkout-pending', params: { sessionId } });
          return;
        }
        // 其他状态（errCode=0 / 其他）：不依赖 SDK 结果，统一走 confirmPaymentAndNavigate
```

- [ ] **Step 3: 普通结算路径加微信 fallback 文案（修 bug：选了微信但后端没返 prepayId 时会落到"请使用支付宝"）**

继续在同一文件，找到刚刚步骤 2 之后的现有 `} else if (paymentMethod === 'alipay') { ... }` 块（约行 614-618，alipay 选了但后端没生成 orderStr 的兜底）。在该 alipay 兜底 `}` 后、`} else if (__DEV__)` 之前插入并列分支：

```tsx
      } else if (paymentMethod === 'wechat') {
        // 用户选了微信但后端没生成 paymentParams.prepayId → 微信凭据缺失 / SDK 未初始化
        show({ message: '微信支付服务暂不可用，请稍后重试或联系客服', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
```

末尾保留的 `else { show({ message: '当前支付方式暂未开通，请使用支付宝', type: 'error' }) ... }` 是给银行卡等真正未开通通道的兜底，**不改**。

- [ ] **Step 4: VIP 礼包路径加 wechat 分支（≈ 行 770 起）**

Find `app/checkout.tsx` 内 `handleVipCheckout` 函数里的 `if (paymentParams?.channel === 'alipay' && paymentParams?.orderStr) { ... }` 整块（≈ 行 707-756，含 VIP 特有的 6001 二次确认逻辑）。在该 `if` 块结束的 `}` 之后、`} else if (paymentMethod === 'alipay')` 之前插入：

```tsx
      } else if (paymentParams?.channel === 'wechat' && paymentParams?.prepayId) {
        const wechatResult = await payWithWechat({
          appId: paymentParams.appId,
          partnerId: paymentParams.partnerId,
          timestamp: paymentParams.timestamp,
          nonceStr: paymentParams.nonceStr,
          prepayId: paymentParams.prepayId,
          packageVal: paymentParams.packageVal,
          signType: paymentParams.signType,
          paySign: paymentParams.paySign,
        });
        if (wechatResult.errStr === 'NATIVE_UNAVAILABLE') {
          if (__DEV__) {
            const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
            if (!payResult.ok) {
              show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
              await OrderRepo.cancelCheckoutSession(sessionId);
              return;
            }
          } else {
            show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
            await OrderRepo.cancelCheckoutSession(sessionId);
            return;
          }
        } else if (wechatResult.resultStatus === '6001') {
          // VIP 路径同 alipay：微信用户取消时做二次确认 active-query 防"SDK 返取消但实际已付款"误报
          const activeR = await OrderRepo.activeQueryPayment(sessionId);
          if (activeR.ok && activeR.data.status === 'COMPLETED') {
            clearVipPackageSelection();
            resetCheckoutStore();
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['orders'] }),
              queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-ledger'] }),
            ]);
            show({ message: '支付成功', type: 'success' });
            router.replace('/orders');
            return;
          }
          show({ message: '已取消支付，如需重新购买请等 5 分钟', type: 'info', duration: 4000 });
          router.replace('/vip/gifts');
          return;
        }
        // 其他状态（errCode=0 / 其他）→ 进 confirmPaymentAndNavigate
```

- [ ] **Step 5: VIP 路径加微信 fallback 文案**

继续在 `handleVipCheckout` 内，在 `} else if (paymentMethod === 'alipay')` 兜底块（约行 758-762）之后、`} else if (__DEV__)` 之前插入：

```tsx
      } else if (paymentMethod === 'wechat') {
        show({ message: '微信支付服务暂不可用，请稍后重试或联系客服', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
```

- [ ] **Step 6: 验证 TS 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && npx tsc -b --noEmit
```

Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add app/checkout.tsx
git commit -m "feat(app/checkout): add wechat branch for both normal and VIP checkout paths"
```

---

## Task 14: app/checkout-pending.tsx 加 wechat 分支

**Files:**
- Modify: `app/checkout-pending.tsx`

- [ ] **Step 1: 加 import**

Find line:
```ts
import { payWithAlipay } from '../src/utils/alipay';
```

Add immediately after:
```ts
import { payWithWechat } from '../src/utils/wechat-pay';
```

- [ ] **Step 2: 改 handleResume 支付分发**

Find this block in `app/checkout-pending.tsx`:

```tsx
  const handleResume = async () => {
    const r = await OrderRepo.resumeCheckout(pending.sessionId);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
      return;
    }
    const orderStr = r.data.paymentParams?.orderStr;
    if (!orderStr) {
      show({ message: '支付参数获取失败，请重试', type: 'error' });
      return;
    }
    const result = await payWithAlipay(orderStr);
    await confirmPayment({
      sessionId: pending.sessionId,
      sdkResultStatus: result.resultStatus ?? '',
      onSuccess: () => router.replace('/orders'),
    });
  };
```

Replace with:

```tsx
  const handleResume = async () => {
    const r = await OrderRepo.resumeCheckout(pending.sessionId);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
      return;
    }
    const params = r.data.paymentParams;
    if (params?.channel === 'alipay' && params.orderStr) {
      const result = await payWithAlipay(params.orderStr);
      await confirmPayment({
        sessionId: pending.sessionId,
        sdkResultStatus: result.resultStatus ?? '',
        onSuccess: () => router.replace('/orders'),
      });
      return;
    }
    if (params?.channel === 'wechat' && params.prepayId) {
      const result = await payWithWechat({
        appId: params.appId,
        partnerId: params.partnerId,
        timestamp: params.timestamp,
        nonceStr: params.nonceStr,
        prepayId: params.prepayId,
        packageVal: params.packageVal,
        signType: params.signType,
        paySign: params.paySign,
      });
      await confirmPayment({
        sessionId: pending.sessionId,
        sdkResultStatus: result.resultStatus,
        onSuccess: () => router.replace('/orders'),
      });
      return;
    }
    show({ message: '支付参数获取失败，请重试', type: 'error' });
  };
```

- [ ] **Step 3: 验证 TS 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && npx tsc -b --noEmit
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add app/checkout-pending.tsx
git commit -m "feat(app/checkout-pending): dispatch resume payment by channel"
```

---

## Task 14b: PendingCheckoutBanner 横幅续付按 channel 派发

**为什么必须**：

`src/components/overlay/PendingCheckoutBanner.tsx:44-61` 当前 `handleResume` 硬编码 `orderStr` + `payWithAlipay`——这是首页 / 购物车顶部的"未完成订单"横幅，**用户最常用的续付入口之一**。微信待支付会话从这里点"继续支付"会直接断（取不到 orderStr → 提示"支付参数获取失败"）。

**Files:**
- Modify: `src/components/overlay/PendingCheckoutBanner.tsx`

- [ ] **Step 1: 加 import**

Find at top of `src/components/overlay/PendingCheckoutBanner.tsx`：
```ts
import { payWithAlipay } from '../../utils/alipay';
```

Add immediately after:
```ts
import { payWithWechat } from '../../utils/wechat-pay';
```

- [ ] **Step 2: 重写 handleResume 按 channel 派发**

Replace the existing `handleResume` function (lines 44-61):

```tsx
  const handleResume = async () => {
    const r = await OrderRepo.resumeCheckout(pending.sessionId);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '续付失败', type: 'error' });
      return;
    }
    const params = r.data.paymentParams;
    if (params?.channel === 'alipay' && params.orderStr) {
      const result = await payWithAlipay(params.orderStr);
      await confirmPayment({
        sessionId: pending.sessionId,
        sdkResultStatus: result.resultStatus ?? '',
        onSuccess: () => router.push('/orders'),
      });
      return;
    }
    if (params?.channel === 'wechat' && params.prepayId) {
      const result = await payWithWechat({
        appId: params.appId,
        partnerId: params.partnerId,
        timestamp: params.timestamp,
        nonceStr: params.nonceStr,
        prepayId: params.prepayId,
        packageVal: params.packageVal,
        signType: params.signType,
        paySign: params.paySign,
      });
      await confirmPayment({
        sessionId: pending.sessionId,
        sdkResultStatus: result.resultStatus,
        onSuccess: () => router.push('/orders'),
      });
      return;
    }
    show({ message: '支付参数获取失败', type: 'error' });
  };
```

- [ ] **Step 3: 验证 TS 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && npx tsc -b --noEmit
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/overlay/PendingCheckoutBanner.tsx
git commit -m "feat(app/banner): dispatch pending checkout banner resume by channel"
```

---

## Task 15: 管理后台订单详情中文标签修正

**Files:**
- Modify: `admin/src/pages/orders/detail.tsx`

**背景**：`admin/src/pages/orders/detail.tsx:20-25` 有一个**局部** `paymentChannelLabel` 映射表，用的是遗留 key `WECHAT`（小写"微信"），但后端 `admin-orders.service.ts:73-74` 实际返回 `paymentChannel` 枚举值 `'WECHAT_PAY'`。当前 admin 订单详情若遇到微信付款的订单会显示原始枚举字符串 `WECHAT_PAY`，不是中文。

**注**：admin 中央常量 `admin/src/constants/statusMaps.ts:117-119` 已含 `WECHAT_PAY: { text: '微信支付', color: 'green' }` ✅，无需改。本任务只修复订单详情页面的局部映射。

- [ ] **Step 1: 修改 paymentChannelLabel 映射**

Edit `admin/src/pages/orders/detail.tsx`。Find:

```ts
// 支付方式枚举 → 中文显示
const paymentChannelLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT: '微信',
  WALLET: '钱包',
};
```

Replace with:

```ts
// 支付方式枚举 → 中文显示（key 必须与后端 PaymentChannel enum 对齐：WECHAT_PAY 非 WECHAT）
const paymentChannelLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT_PAY: '微信支付',
  UNIONPAY: '银联',
  AGGREGATOR: '聚合支付',
  WALLET: '钱包',
};
```

注：保留遗留 `WALLET` 是为了兼容更老的 mock 数据，对当前 enum 无影响。

- [ ] **Step 2: 验证 TS 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/admin" && npx tsc -b --noEmit
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/orders/detail.tsx
git commit -m "fix(admin/orders): map WECHAT_PAY enum to 微信支付 label in detail page"
```

---

## Task 16: 翻 `src/constants/payment.ts` 的微信 available 开关 + 合规清单

**Files:**
- Modify: `src/constants/payment.ts`
- Modify: `src/content/legal/privacyPolicy.ts`

**前置**：本任务**仅在用户口头确认要正式开放微信支付通道**时执行（即：APP 支付权限审核已通过 + 真小金额联调验证完毕）。在此之前应**保持 `available: false`**，避免买家点了导致 NotImplemented 错误。

执行触发条件示例（用户告知任一即可）：
- "微信支付权限已批，可以打开开关了"
- "真机 0.01 元已测通，开放微信"

- [ ] **Step 1: 翻 available**

Edit `src/constants/payment.ts:21-25`。Find:

```ts
  { value: 'alipay', label: '支付宝', description: '支持快捷支付（沙箱测试中）', available: true },
  { value: 'wechat', label: '微信支付', description: '微信账户余额或银行卡支付', available: false, comingSoon: 'v1.1 上线' },
  { value: 'bankcard', label: '银行卡/信用卡', description: '支持储蓄卡与信用卡', available: false, comingSoon: 'v1.2 上线' },
```

Replace with:

```ts
  { value: 'alipay', label: '支付宝', description: '支持快捷支付', available: true },
  { value: 'wechat', label: '微信支付', description: '微信账户余额或银行卡支付', available: true },
  { value: 'bankcard', label: '银行卡/信用卡', description: '支持储蓄卡与信用卡', available: false, comingSoon: 'v1.2 上线' },
```

- [ ] **Step 2: 同步更新文件头注释**

Find:
```ts
 * 当前 v1.0 仅接通支付宝（沙箱测试中）：
 * - 微信支付：腾讯审核中，v1.1 上线
 * - 银行卡/信用卡：未接入网联通道，v1.2 评估
```

Replace with:
```ts
 * 当前接通：支付宝 + 微信支付
 * - 银行卡/信用卡：未接入网联通道，v1.2 评估
```

- [ ] **Step 3: 验证 TS 编译**

- [ ] **Step 3: 同步隐私政策第三方 SDK 清单**

Edit `src/content/legal/privacyPolicy.ts`，找到支付类里的微信支付条目：

```ts
{ type: 'bullet', text: '微信支付（微信开放平台，腾讯公司）— 用途：完成订单支付；共享字段：订单号、金额；隐私政策：https://www.tenpay.com/v3/helpcenter/low/privacy.shtml' },
```

Replace with:

```ts
{ type: 'bullet', text: '微信支付（财付通支付科技有限公司 / 微信开放平台）— 用途：完成订单支付；共享字段：订单号、金额、支付状态；SDK 名称：react-native-wechat-lib；隐私政策：https://www.tenpay.com/v3/helpcenter/low/privacy.shtml' },
```

保持支付宝条目不变。

- [ ] **Step 4: 验证 TS 编译**

Run:
```bash
cd "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台" && npx tsc -b --noEmit
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/constants/payment.ts src/content/legal/privacyPolicy.ts
git commit -m "feat(app/payment): enable wechat pay option and update sdk disclosure"
```

---

## Task 17: 密码本 + 文档同步（CLAUDE.md / AGENTS.md / plan.md）

**Files:**
- Modify: `docs/operations/密码本.md`（gitignored）
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `plan.md`

- [ ] **Step 1: 密码本 wechat 段（gitignored）**

Append to `docs/operations/密码本.md`:

```markdown

## X. 微信支付（v1.1，等 APP 支付权限审核 + iOS 配置）

> 后续动作：等 App 上架后到 https://pay.weixin.qq.com → 产品中心 → APP支付 → 申请开通
> 商户号已有，本段需要在审核通过后填实。
> v1.0 Android-only（与登录同步），iOS 等 Apple Developer 账号就绪后跟登录一起补。

- WECHAT_PAY_APP_ID: <wx 开头，微信开放平台 → 移动应用，与登录共用>
- WECHAT_PAY_MCH_ID: <商户号，已有>
- WECHAT_PAY_API_V3_KEY: <32 位自定义字符串，商户平台 → API安全 → APIv3密钥 自行设置>
- WECHAT_PAY_MERCHANT_CERT_SERIAL: <商户证书序列号，CertificateDownloader 工具或商户平台显示>
- WECHAT_PAY_MERCHANT_CERT: <apiclient_cert.pem 全文，含 BEGIN/END>
- WECHAT_PAY_MERCHANT_PRIVATE_KEY: <apiclient_key.pem 全文，含 BEGIN/END>
- WECHAT_PAY_NOTIFY_URL: https://api.ai-maimai.com/api/v1/payments/wechat/notify
- WEBHOOK_IP_WHITELIST: <上线前合并支付宝 + 微信支付回调 IP/CIDR；微信参考 https://pay.weixin.qq.com/doc/v3/merchant/4012791880>
```

⚠️ 仅本地填值，**绝不 commit**。`docs/operations/密码本.md` 应已在 `.gitignore`。

- [ ] **Step 2: CLAUDE.md 加架构决策行**

In `CLAUDE.md`，在"关键架构决策"表的末尾追加一行：

```markdown
| 微信支付集成 | **支付宝行为不变 + 微信并列分支 + Android-only（v1.0）**：新建 `WechatPayService` 并列于 `AlipayService`；`initiateRefund` 返回 `pending`，`queryRefund` + refund.notify 双兜底闭环；`closeOrder` 接入取消/过期 CheckoutSession 的资金安全分支；`PaymentService.confirmCheckout`（原 `confirmAlipayCheckout`）按 channel 派发 query；`PaymentController.handleWechatNotify` 使用 raw body 验签并强校验 amount + appid + mchid；售后退款、自动退款、未发货取消退款、退货运费退款均真实闭环；`AfterSaleShippingPaymentService` 退货运费支付/退款 provider 按原订单 paymentChannel dispatch；Android 需补 `WXPayEntryActivity`。微信路径以 `WechatPayService.isAvailable()` 守门，凭据未配齐自动不可用。iOS 等 Apple Developer 账号就绪后跟微信登录一起补 |
```

- [ ] **Step 3: CLAUDE.md 加文档索引**

In `CLAUDE.md` 的"设计方案与实施计划"段落末尾追加：

```markdown
- `docs/superpowers/plans/2026-05-23-wechat-pay-integration.md` — 微信支付接入实施计划（WechatPayService 全套含 createAppOrder/refund/queryRefund/parseNotify/queryOrder/closeOrder / 退款 pending 二态 / raw body 验签的 wechat notify / confirmCheckout channel dispatch / cancel/expire 关单 / 售后退货运费支付与退款微信全链路 / 未发货取消退款 pending 闭环 / Android WXPayEntryActivity / App checkout 普通+VIP+续付+Pending Banner+售后详情 / admin 订单详情中文标签 / available 开关和隐私政策条件触发 / AGENTS.md 同步，**微信支付接入实施排程，支付宝行为不变 + 资金链路安全（金额校验 + 防伪造 + 真实退款闭环）+ Android-only v1.0**）
```

- [ ] **Step 4: AGENTS.md 加文档索引（项目规则要求）**

In `AGENTS.md`，找到列举设计/实施计划的段落（参考已有的 `docs/superpowers/plans/...` 条目格式），追加一行：

```markdown
- `docs/superpowers/plans/2026-05-23-wechat-pay-integration.md` — 微信支付接入实施计划
```

如果 `AGENTS.md` 引用了 CLAUDE.md 的"相关文档"列表（很多仓库这样做），同步在 `AGENTS.md` 对应位置补齐。

- [ ] **Step 5: plan.md 加 v1.1 条目**

In `plan.md`，在合适的 v1.1 段落追加：

```markdown
- [ ] **微信支付接入（Android-only）** —— 后端 WechatPayService（含 queryOrder + queryRefund + closeOrder）/ 退款 pending 二态 / 独立 notify 端点（raw body 验签 + 金额 + appid + mchid 校验 + 退款真实闭环）/ confirmCheckout channel dispatch / cancel/expire 关单 / checkout 三入口 / 未发货取消退款 pending 闭环 / 售后退货运费支付与退款 provider dispatch；App 端 Android WXPayEntryActivity + payWithWechat / checkout 普通+VIP+续付 + Pending Banner 横幅 + 售后详情页；管理端中文展示；隐私政策 SDK 清单同步。等微信开放平台移动应用审核 + 商户平台 APP 支付权限审核完毕后真小金额联调 + 上线。iOS 跟随登录一起到 U06 后补。详见 `docs/superpowers/plans/2026-05-23-wechat-pay-integration.md`。
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md AGENTS.md plan.md
git commit -m "docs(wechat-pay): document wechat pay integration plan in CLAUDE.md, AGENTS.md, plan.md"
```

注：`docs/operations/密码本.md` 是 gitignored，不会被 add 进来，这是预期行为。

---

## Self-Review

### Spec coverage

按 `docs/superpowers/specs/2026-05-10-wechat-pay-integration-design.md` 各节核对：

| Spec 节 | 对应 Task |
|---|---|
| §2.2 新增 `WechatPayService` | Task 2-5d |
| §2.2 `PaymentController.handleWechatNotify` | Task 8（raw body 验签） |
| §2.2 `PaymentService.initiateRefund` 加分支 | Task 7 + 7b + 7c |
| §2.3 `AfterSaleShippingPaymentService` provider dispatch | Task 10（支付参数 + 微信退款 + notify 闭环 + App 售后详情） |
| §7.1 createAppOrder / refund / queryRefund / parseNotify / queryOrder / closeOrder | Task 3-5d（**queryOrder/queryRefund/closeOrder 已升级为 v1.0 必备**，不再是延伸项） |
| §7.2 PaymentController 端点 | Task 8（含金额校验 + 防伪造 + 真实退款闭环） |
| §7.3 initiateRefund 加分支 | Task 7（含 `pending` 二态返回）+ Task 7b/7c 消费 pending |
| §7.4 AfterSaleShippingPaymentService 修正 | Task 10 |
| §8.1 react-native-wechat-lib 依赖 | 已装，Task 11b/11c/12 验证复用、补类型和 Android 支付回调 Activity |
| §8.3 结账页支付方式选择 UI | UI 已存在，Task 13 加分发逻辑（普通 + VIP）；`available` 开关 Task 16（条件触发） |
| §8.4 微信支付调起 + 回调 | Task 11c + Task 12-14b + Task 10 售后详情 |
| §10.1 .env 新增 | Task 1（8 个变量，含 `WECHAT_PAY_MERCHANT_CERT`） |
| §10.2 EAS env | 不在本计划（AppID 已在 src/services/wechat.ts:57） |
| §11 实施 Phase | Task 1-17 完整覆盖 Phase 2-3（含 5b/5c/5d/7b/7c/9b/9c/11b/11c/14b 子任务） |
| §12 风险与缓解 | Task 11 烟雾测试 + Task 5d/9c 关单 + Task 7b/7c/8 退款闭环 + Task 9b active-query channel dispatch |
| §14 验收标准 | Task 11 全套测试 + 上线阶段真金联调（不在本计划） |

**已关闭 Gap**：
- ~~queryOrder 推到 v1.1~~ → 评审 C2 指出**必备**，Task 5b 实现 + Task 9b 把 `confirmAlipayCheckout` 重命名为 `confirmCheckout` 加 channel dispatch。
- ~~退款 200 当成成功~~ → 评审 C1 指出，Task 4 重写为按 `result.data.status` 返回 `pending` + Task 5c queryRefund 兜底 + Task 7b 在 AfterSaleRefundService 分发 + Task 8 退款 notify 真实闭环。
- ~~取消/过期会话未关微信单~~ → 二次审计发现，Task 5d 加 `closeOrder`，Task 9c 接入 `cancelSession` / `CheckoutExpireService`。
- ~~未发货取消退款 pending 被立即 REFUNDED~~ → 二次审计发现，Task 7c 补 `OrderService` 单订单/整 session 取消退款 pending 分发。
- ~~Android 只有 WXEntryActivity 没有 WXPayEntryActivity~~ → 二次审计发现，Task 11c 补 Expo config plugin 生成和注册支付回调 Activity。
- ~~wechat notify 缺金额校验 / raw body 验签~~ → 评审 C3 指出，Task 8 加 `assertWechatAmountMatchesSession` + `assertWechatAfterSaleShippingPaymentAmountMatches` + 支付通知 appid/mchid、退款通知 mchid 防伪造校验，并强制使用 `req.rawBody` 验签。
- ~~SDK 字段名 camelCase / 顶层字段误读~~ → 评审 H1 指出，Task 3/4/5b/5c 全部改为读取 `result.data.*`；APP 支付 data 内字段为 lowercase（`appid/partnerid/prepayid/package/noncestr/timestamp/sign`），SDK 构造函数 `publicKey` 也改为 `apiclient_cert.pem` 实际内容。
- ~~售后退货运费只改 provider 不闭环~~ → 评审 C4 指出，Task 10 扩展为支付参数、退款、微信退款通知、App 售后详情全链路，并修复微信 `out_trade_no` 32 字符限制。
- ~~前端 paymentParams unknown 类型~~ → 评审 F1 指出，Task 11b 新增支付参数 union type，保证 checkout/pending wechat 分支可编译。
- ~~PendingCheckoutBanner 漏改~~ → 评审 M1 指出，新增 Task 14b。
- ~~AGENTS.md 漏~~ → 评审 M3 指出，Task 17 加一步。

**保留为非目标的 Gap**：
- `initiateTransfer` 微信分支（spec 第 4 节"非目标"明确不做）—— 不补。
- iOS 原生配置（CFBundleURLTypes / LSApplicationQueriesSchemes / Universal Link / AppDelegate）—— 评审 M2 部分接受，**v1.0 Android-only**（与微信登录同步），iOS 跟随登录一起到 U06 后补，不在本计划。

### 跨系统中文展示一致性核查（基于代码审计结果）

| 系统 / 文件 | 现状 | 处理方式 | 对应 Task |
|---|---|---|---|
| **后端** `backend/prisma/schema.prisma:201-206` `PaymentChannel` enum | 已含 `WECHAT_PAY` | ✅ 无需改 | — |
| **后端** `backend/src/modules/order/checkout.dto.ts` `CHANNEL_MAP` `wechat → WECHAT_PAY` | 已存在 | ✅ 无需改 | — |
| **后端** `backend/src/modules/order/checkout.service.ts` `cancelSession` | 仅支付宝查单 + 关单 | ⚠️ 微信必须补同等 `queryOrder + closeOrder` | **Task 9c** |
| **后端** `backend/src/modules/order/checkout-expire.service.ts` `expireSession` | 仅支付宝查单 + 关单 | ⚠️ 微信必须补同等 `queryOrder + closeOrder` | **Task 9c** |
| **后端** `backend/src/modules/order/order.service.ts` 未发货取消退款 | `result.success` 立即标 REFUNDED | ⚠️ 微信 pending 必须保持 REFUNDING | **Task 7c** |
| **后端** `backend/src/modules/admin/orders/admin-orders.service.ts` 返回 `paymentMethod: paymentChannel` enum 值 | 动态透传 | ✅ 无需改 | — |
| **后端** `backend/prisma/seed.ts` 已含 `WECHAT_PAY` mock 订单数据 | 完备 | ✅ 无需改 | — |
| **管理后台** `admin/src/constants/statusMaps.ts:117-119` 中央 `paymentChannelMap` | 已含 `WECHAT_PAY: { text: '微信支付', color: 'green' }` | ✅ 无需改（与支付宝 'blue' 区分） | — |
| **管理后台** `admin/src/pages/orders/index.tsx` 订单列表筛选 + Tag | 复用中央 `paymentChannelMap` | ✅ 无需改 | — |
| **管理后台** `admin/src/pages/orders/detail.tsx:20-25` **局部** label 表 | 用遗留 `WECHAT` key 导致微信订单显示原始 `WECHAT_PAY` 字符串 | ⚠️ 修复 | **Task 15** |
| **管理后台** `admin/src/pages/bonus/withdrawals.tsx:199-203` "支付宝单号"列名硬编码 | 仅展示提现单（v1.0 提现仅支付宝） | ✅ 保持（v1.0 决策） | — |
| **卖家后台** `seller/src/**` | 全文 grep 无支付方式展示 | ✅ 无需改 | — |
| **买家 App** `src/components/orders/OrderInfoBlock.tsx:19` `PAY_LABEL` | 已含 `wechat: '微信支付'` | ✅ 无需改 | — |
| **买家 App** `src/constants/payment.ts:23` `wechat.available: false` | 故意挡 UI | ⚠️ 待 APP 支付权限批 + 真金联调后翻 true | **Task 16**（条件触发） |
| **买家 App** `app/checkout.tsx` 普通结算 alipay 分发（行 579-628） | 仅识别 alipay | ⚠️ 加 wechat 分支 + 加 `paymentMethod === 'wechat'` fallback 文案 | **Task 13 Step 2-3** |
| **买家 App** `app/checkout.tsx` VIP 礼包 alipay 分发（行 707-770） | 仅识别 alipay；6001 有二次确认防误报 | ⚠️ 加 wechat 分支 + 镜像 6001 二次确认（用 errCode -2 → '6001'）+ wechat fallback 文案 | **Task 13 Step 4-5** |
| **买家 App** `app/checkout-pending.tsx` 续付 alipay 分发 | 仅识别 alipay | ⚠️ 加 wechat 分支 | **Task 14** |
| **买家 App** `app/checkout.tsx:604/749` "支付宝未响应" 硬编码 | 仅在 alipay TIMEOUT 路径内触发 | ✅ 保持（alipay-specific 文案，wechat 在 Task 13 的 wechat 分支里走独立提示） | — |
| **买家 App** `app/orders/after-sale-detail/[id].tsx:310/312` 售后退货运费支付硬编码支付宝 | 现状仅 `orderStr + payWithAlipay` | ⚠️ 改为按 `paymentParams.channel` dispatch 到 alipay/wechat，并保留 `merchantPaymentNo` active-query 兜底 | **Task 10 Step 6** |
| **买家 App** `app/me/withdraw.tsx` / `app/me/wallet.tsx` 提现页 | UI 全 alipay-only | ✅ 保持（v1.0 提现仅支付宝） | — |
| **买家 App** `plugins/withWechat.js` Expo plugin | 已配置 WXEntryActivity（登录用），缺 WXPayEntryActivity | ⚠️ 补 Android 支付回调 Activity | **Task 11c** |
| **买家 App** `src/services/wechat.ts:57` `WECHAT_APP_ID = 'wxeb8e8dc219da02dd'` | 登录用 AppID | ⚠️ 用户**线下确认**该 AppID 在微信开放平台已开通"APP 支付"能力（同一 AppID 可同时挂登录 + 支付） | **不入计划，用户线下确认** |
| **买家 App** `app/_layout.tsx` `initWechat()` 在 `_layout` 已调用 | 登录已注册 SDK | ✅ 支付复用同一注册，Task 12 的 `payWithWechat` 内部调 `initWechat()` 兜底 | — |
| **买家 App** `src/content/legal/privacyPolicy.ts` 第三方 SDK 清单 | 已写微信支付但缺 SDK 名称和实际集成口径 | ⚠️ 同步合规披露 | **Task 16 Step 3** |

**关键审计发现**（新增 Task 5d / 7c / 9c / 11c / 15-16）：

1. **Task 5d + Task 9c（微信关单）**：审计发现现有支付宝链路在取消/过期 CheckoutSession 时会先查单、再关单；微信计划原先只覆盖下单/notify/active-query，缺 `closeOrder` 和 cancel/expire 接线。现在补齐，避免本地过期后微信侧仍可支付。

2. **Task 7c（未发货取消退款 pending）**：审计发现 `OrderService` 未发货取消退款也会消费 `PaymentService.initiateRefund`，不能只改售后退款。现在补 `pending=true` 保持 REFUNDING，等 refund.notify / queryRefund 闭环。

3. **Task 11c（Android WXPayEntryActivity）**：审计发现 `plugins/withWechat.js` 只有登录用 `WXEntryActivity`，微信支付需要 `WXPayEntryActivity` 才能稳定回传支付结果。现在补原生插件任务。

4. **Task 15（管理后台订单详情）**：审计发现 admin 订单详情页用局部映射表覆盖了中央 `paymentChannelMap`，且 key 错配（用了 legacy `WECHAT` 而非 `WECHAT_PAY`），微信订单的支付方式会渲染为原始枚举字符串。Task 15 修复。

5. **Task 16（App `available` 开关 + 合规清单）**：从原 Self-Review 的"不在本计划"提升为独立 Task（条件触发型），明确"在 APP 支付权限审核通过 + 真金联调验证完毕后才执行"，并同步 `privacyPolicy.ts` 第三方 SDK 披露。

6. **Task 13 扩展**：原计划只覆盖了 `app/checkout.tsx` 普通结算路径（行 579-609），审计发现 VIP 礼包路径（行 707-770）有**结构相同但独立的**支付分发，且 alipay 6001（用户取消）有"二次确认 active-query 防误报"特殊处理。Task 13 现拆为 7 步覆盖两条路径 + 两处 fallback 文案。

### Placeholder scan

已 review，没有待定项或占位代码块。所有 Task 都给完整代码 + 完整测试 + 完整命令。

### Type consistency

- `WechatPayService.createAppOrder` 返回 `{ appId, partnerId, timestamp, nonceStr, prepayId, packageVal, signType, paySign }` — Task 3 测试 + Task 3 实现 + Task 9 checkout 用 `paymentParams = { channel: 'wechat', ...wxParams }` + Task 12 `payWithWechat(payload)` 入参一致（含 `partnerId`）+ Task 13 普通 / VIP 两路径透传 `partnerId` + Task 14 续付页透传 `partnerId`。
- `WechatPayService.refund` 返回 `{ success, pending, providerRefundId?, message }` — Task 4 实现 + Task 7 `PaymentService.initiateRefund` 透传 `pending`；Task 7b / Task 10 按 pending 保持 REFUNDING。
- `WechatPayService.queryRefund` 返回 `{ outRefundNo, outTradeNo, providerRefundId, status, refundAmount, totalAmount, successAt? } | null` — Task 5c 实现 + Task 7b cron + Task 8 notify/query 统一闭环消费一致。
- `WechatPayService.closeOrder` 返回 `{ success, terminal, alreadyPaid, message }` — Task 5d 实现 + Task 9c `cancelSession` / `CheckoutExpireService` 消费一致。
- `WechatPayService.parseNotify` 返回 `{ type, appId?, mchId, outTradeNo, outRefundNo?, providerTxnId, tradeState, amount, paidAt? }` — Task 5 + Task 8 controller 消费一致；验签入参包含 `rawBody`；退款通知官方没有 `appid`，所以 `appId` 可选。
- `payWithWechat` 入参字段名（`appId/partnerId/timestamp/nonceStr/prepayId/packageVal/signType/paySign`）— Task 11b 类型 + Task 12 定义 + Task 13 (checkout.tsx 普通 + VIP 两段) + Task 14 (checkout-pending.tsx) + Task 14b (PendingCheckoutBanner) + Task 10 售后详情页全部一致。
- `PaymentService.initiateRefund.pending` 消费点 — Task 7b（售后退款）+ Task 7c（订单未发货取消退款）+ Task 10（退货运费退款）全部保持一致：`pending=true` 不标 REFUNDED。
- PaymentChannel **大小写约定**：后端 enum 全大写 `'ALIPAY' / 'WECHAT_PAY'`；买家 App API 响应字段 `paymentMethod` 用小写 `'alipay' / 'wechat'`（前端 PaymentMethod 类型别名）；buyer App `PAY_LABEL` 和 admin `paymentChannelLabel` 各自匹配自己的 API 大小写。Task 15 修复 admin 局部表的 key 错配。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-wechat-pay-integration.md`.

**Recommended execution**：按 Task 顺序推进；后端资金链路（Task 1-10）优先于 App（Task 11-14b），管理后台与合规开关（Task 15-16）最后做。每个 Task 完成后先跑该 Task 的定向测试，再跑对应模块回归。

**Parallelizable slices**：Task 15（admin 展示）可在后端 Task 9 之后独立执行；Task 16（available 开关 + 隐私政策）必须等微信 APP 支付权限和真金联调通过后执行；Task 17 文档同步必须最后执行。
