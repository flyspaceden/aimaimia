# 账号注销设计方案（即时注销版）

> **本文档替代 `2026-05-26-account-deletion-design.md`（已 superseded）。**
> 核心变化：取消 30 天冷静期，改为**提交即时、不可撤销注销**；明确**全部资产（含可提现现金）作废归平台**（用户书面接受该处置）。除"已付款订单继续履约 + 进行中售后继续受理"外，其余一切立即作废。
>
> **2026-06-04 二次收口**：支付中 / 提现处理中一律阻止注销；文档按当前 Prisma schema 对齐真实模型名、状态枚举、审计字段和数据清理范围。

## 背景

2026-05-25 华为应用商店审核反馈中明确要求账号注销功能为必备合规项，并给出"个人中心-设置-账号注销"的标准路径。《个人信息保护法》§47、工信部/网信办相关规定要求 App 必须提供便捷的账号注销渠道，且在 **15 个工作日内**完成注销。

爱买买当前**完全没有**账号注销能力，不满足上架合规要求。本方案为上架强制项落地实现。

## 与 2026-05-26 旧版的差异（决策变更）

| 维度 | 旧版（2026-05-26） | 本版（2026-06-04，生效） |
|---|---|---|
| 注销生效 | 30 天冷静期后由 cron 执行 | **提交即同步执行，不可撤销** |
| 可撤销 | 冷静期内可 cancel | **不可撤销**（取消 cancel 接口与冷静期横幅） |
| 可提现现金（钱包或余额类权益/可提现分润/可提现积分） | 提交即清零（旧版也清零） | **作废归平台**（用户书面接受，见下方法律风险段） |
| cron 清理 | 每天 02:00 扫描执行 | **取消**（同步执行，无 cron） |
| User 新增字段 | 5 个（含 requestedAt/scheduledAt） | **3 个**（无冷静期相关字段） |
| 合规时效 | 30 天 + 15 工作日清除 ≈ 50 天（超标隐患） | **立即完成 < 15 工作日**，且无"强制拖延"问题 |

> **为什么取消冷静期更合规**：工信部明确"强行设置冷静期显著拖延注销程序属于违规"，要求 15 个工作日内完成。立即注销天然满足时效，且双重身份核验已足够防误触（参照淘宝/京东"满足条件后即时注销"）。

## 法律风险书面接受（可提现现金作废）

用户决定：**可提现现金类资产（分润可提现余额、可提现消费积分、钱包或余额类权益）注销时一并作废归平台，不予退还或兑现。**

- 该处置与"红包/优惠券/抽奖名额等纯运营权益作废"在法律性质上不同：可提现现金涉嫌不当得利/侵占风险，且工信部曾明确"资产结清不得作为强制注销条件"。
- **风险缓释（书面披露）**：在「注销须知」「用户协议」「隐私政策」三处均显著写明"提交注销即视为您自愿放弃上述全部资产（含可提现余额），平台不予退还、兑现或补偿"，提交注销时必须勾选「我已阅读并同意」方可继续。
- **证据留存**：`User.deletionMeta` 必须保存注销前资产快照、放弃资产明细、确认文案版本、用户协议/隐私政策版本、确认时间、确认方式、IP、User-Agent、手机号/微信脱敏标识。后续纠纷以该快照和 `LoginEvent.meta` 为证据链。
- 项目方已知悉并接受该风险。本 spec 记录此决策以备追溯。

## 决策速查表（供实现对齐）

| 决策点 | 结论 |
|---|---|
| 注销策略 | **提交即时生效，不可撤销** |
| 注销期间订单 | **已付款订单继续履约**，不退款、不取消 |
| 进行中售后 | **继续受理**（退款走原支付通道回支付宝/微信，不进钱包） |
| 可提现现金 | 分润可提现余额 / 可提现消费积分 / 钱包或余额类权益 → **清零归平台**（书面接受）；当前无独立 Wallet model 时按 `RewardAccount` 等实际余额模型归集 |
| 运营权益 | 红包 / 优惠券 / 抽奖中奖名额 / 冻结未结算分润 → **作废归平台**；已付款 VIP 礼包订单继续履约 |
| VIP / 普通树节点 | **保留**节点（不剔除），下级链路不受影响；注销节点后续应得份额归平台 |
| 二次确认 | 绑手机号：**短信验证码**；仅绑微信：**弹窗输入「确认注销」四字** |
| 前置条件 | 用户必须 `ACTIVE`；不能是任一企业 ACTIVE OWNER；不能存在支付中结算 / 支付中支付单 / 处理中提现 |
| 个人资料 | 软删（昵称→"已注销用户"、`avatarUrl/gender/birthday/city` 清空；手机号/微信从 `AuthIdentity` 释放） |
| 关联表清除 | `Cart/CartItem`、`Follow`、`AiSession/AiUtterance` 清空；`Address` 增加 `deletedAt` 后软删 |
| 推荐码 | 推荐码失效（他人无法再用），ReferralLink 历史保留 |
| 手机号/微信释放 | AuthIdentity.identifier 改 `deleted:${provider}:${userId}:${identityId}`，`unionId/meta` 清空，原号/微信可重新注册 |
| 法定保留 | Order/OrderItem/Payment/PaymentGroup（3年）、Invoice（5年）、LoginEvent（6个月）、RewardLedger/WithdrawRequest、VipTreeNode/NormalTreeNode、ReferralLink |
| 短信 scope | **新增** `SmsPurpose.DELETION`（与 LOGIN/BIND/BUYER_RESET 隔离） |
| 审计 | 复用现有 `LoginEvent` 字段，`meta.action='DELETION_EXECUTED'`，不新增 `event` 字段 |
| 并发控制 | 单个 Serializable 事务 + advisory lock `AD-${userId}` |
| 强制登出 | 注销瞬间 revoke 该用户所有 ACTIVE Session |

## 架构选型

**买家 App 端独立 deletion 模块，复用现有 SmsOtp / Captcha / Audit / advisory lock 基础设施。**

- 新建 `backend/src/modules/me/deletion/`：`DeletionController` + `DeletionService`
- **相比旧版砍掉**：`DeletionCronService`、`POST cancel` 接口、冷静期横幅、自动撤销逻辑
- 短信：复用现有 `SmsOtp` + `AliyunSmsService` 发码链路，新增 `SmsPurpose.DELETION`
- 不新增独立 Deletion 表（每用户最多一次注销，无需一对多；字段挂 User）
- 路径放 `me/deletion/`（用户操作自己账号，复用 `@CurrentUser()` + `JwtAuthGuard`）

## 数据模型变更

### User 新增 3 字段

```prisma
model User {
  // ... 既有字段 ...
  // 账号注销（2026-06-04）
  deletionExecutedAt    DateTime?  // 注销执行完成时间，null=未注销
  deletionConfirmMethod String?    // 'SMS' | 'WECHAT_MODAL'，审计用
  deletionMeta          Json?      // 注销时资产快照（forfeited 明细），供客服查证纠纷

  @@index([deletionExecutedAt])
}
```

### UserStatus（已存在 DELETED，沿用）

```prisma
enum UserStatus { ACTIVE  BANNED  DELETED }
```
注销执行后置 `status=DELETED`。无 PENDING 中间态（无冷静期）。

### Address 新增软删字段

当前 `Address` 没有 `deletedAt`，不能直接实现"地址软删"。本期新增：

```prisma
model Address {
  // ... 既有字段 ...
  deletedAt DateTime?

  @@index([userId, deletedAt])
}
```

地址列表、下单地址选择等查询必须默认过滤 `deletedAt=null`。订单继续依赖 `Order.addressSnapshot`，不依赖注销后地址表。

### SmsPurpose 新增 DELETION

```prisma
enum SmsPurpose {
  LOGIN
  BIND
  RESET
  BUYER_RESET
  SELLER_RESET
  DELETION       // 2026-06-04 新增：账号注销专用 scope
}
```

### Reward 清零不新增枚举

- 沿用现有 `RewardEntryType.VOID` + `RewardLedgerStatus.VOIDED`，不新增 `DELETION_BURN`，减少 enum 迁移面。
- 作废方式：`RewardAccount.balance=0, frozen=0`（VIP_REWARD / NORMAL_REWARD / INDUSTRY_FUND 等实际存在账户逐条处理），并写一条或多条 `RewardLedger`（entryType=VOID，status=VOIDED，amount=原 balance+frozen，meta 记录 `reason='ACCOUNT_DELETION'`、原 balance/frozen、去向=平台）。
- 已经 `WITHDRAWN` 的历史流水不改；提现 `PROCESSING/APPROVED` 时注销被 blocker 阻止，不允许同时清零。

> **不新增字段做推荐码失效**：在 `useReferralCode` / `deferredLink.create` 流程中检查目标 User 的 `deletionExecutedAt != null` 即视为推荐码无效（代码层判断，与 VIP 普通用户推荐码 null 策略一致）。

### 不新增 LoginEvent.event 字段

当前 `LoginEvent` 模型为 `provider / success / phone / wechatOpenId / ip / userAgent / meta`，无 `event` 字段。账号注销审计写法：

```ts
LoginEvent.create({
  data: {
    userId,
    provider: primaryProvider,
    success: true,
    phone: maskedOrNull,
    wechatOpenId: maskedOrNull,
    ip,
    userAgent,
    meta: {
      action: 'DELETION_EXECUTED',
      deletionExecutedAt: now,
      confirmationMethod,
      noticeVersion,
      termsVersion,
      privacyVersion,
      snapshot,
    },
  },
})
```

如后续要做统一审计表，另起 spec；本期不扩大范围。

## 资产处置明细

| 资产 | 现有模型 | 注销处置 |
|---|---|---|
| 消费积分 / 分润可提现余额 | RewardAccount | 所有账户 `balance/frozen=0`，写 `RewardLedger(VOID/VOIDED)` 记录放弃明细 |
| 提现中金额 | WithdrawRequest + RewardLedger(WITHDRAW/FROZEN) | **阻止注销**：存在 `PROCESSING/APPROVED` 时 preview/execute 返回 blocker |
| 平台红包 / 优惠券 | CouponInstance | `AVAILABLE/RESERVED` → `REVOKED`；`USED/EXPIRED/REVOKED` 历史不改 |
| 消费积分抵扣预留 | CheckoutSession + RewardLedger(DEDUCT/RESERVED) | **阻止注销**：存在支付中 CheckoutSession 时不进入清零 |
| 抽奖中奖名额 | LotteryRecord | `WON/IN_CART` → `EXPIRED`；`CONSUMED/EXPIRED/NO_PRIZE` 历史不改 |
| VIP 礼包 | CheckoutSession / Order / VipPurchase | 未支付 VIP CheckoutSession 属于支付中 blocker；已付款 VIP_PACKAGE 订单继续履约，不作废 |
| 购物车奖品 | CartItem + LotteryRecord | 随购物车清空；对应未消费中奖记录置 `EXPIRED` |

资产快照（处置前的全部金额/数量）写入 `User.deletionMeta`，供日后客服处理纠纷举证。

## 注销前置 blocker

`preview` 展示 blocker，`execute` 必须在同一个 Serializable 事务内再次校验。任一 blocker 存在时返回 409，不执行任何清零/释放身份动作。

| blocker code | 查询口径 | 用户提示 |
|---|---|---|
| `IS_COMPANY_OWNER` | `CompanyStaff.userId=userId AND role=OWNER AND status=ACTIVE` | 您是企业创始人，请先转让或注销企业 |
| `USER_NOT_ACTIVE` | `User.status != ACTIVE OR deletionExecutedAt != null` | 账号状态不支持注销 |
| `ACTIVE_CHECKOUT_EXISTS` | `CheckoutSession.status IN (ACTIVE, PAID)` | 您有正在支付或确认中的订单，请先完成或取消 |
| `PENDING_PAYMENT_EXISTS` | `Payment.status IN (INIT, PENDING)` 或 `PaymentGroup.status IN (INIT, PENDING)` | 您有支付处理中记录，请稍后再试 |
| `WITHDRAW_PROCESSING_EXISTS` | `WithdrawRequest.status IN (PROCESSING, APPROVED)` | 您有提现处理中记录，请到账或失败后再注销 |

已付款订单、已创建订单、已进入售后的事项不作为 blocker：它们继续按订单/售后链路履约，注销只终止账号登录和新增操作。

## API 设计（买家 App，3 个端点）

### 1. `GET /api/v1/me/deletion/preview`
**Auth**: JwtAuthGuard。返回阻塞项 + 资产快照 + 核验方式。
```ts
{
  canDelete: boolean,
  blockers: Array<{ code: string; message: string }>,
  // 例：[{ code: 'ACTIVE_CHECKOUT_EXISTS', message: '您有正在支付或确认中的订单，请先完成或取消' }]
  assets: {
    points: number,
    coupons: number,
    withdrawableRewards: number,
    frozenRewards: number,
    lotteryQuota: number,
    pendingWithdrawAmount: number,
    activeCheckoutCount: number,
  },
  pending: { paidOrders: number, activeAfterSales: number }, // 仅告知不阻塞
  identityVerify: 'SMS' | 'WECHAT_MODAL',
  maskedPhone?: string,   // SMS 时返回，例 "138****1234"
}
```

### 2. `POST /api/v1/me/deletion/sms-code`
**Auth**: JwtAuthGuard。发送注销短信验证码（仅 identityVerify=SMS）。
- 复用现有短信 OTP 发码机制：写入 `SmsOtp(purpose=DELETION)`，再由 `AliyunSmsService.sendVerificationCode` 发送；60 秒间隔，每小时 5 次上限
- 短信模板：「【爱买买】您正在申请账号注销，验证码 {code}，10 分钟内有效。此操作不可恢复，请谨慎操作。」

### 3. `POST /api/v1/me/deletion/execute`
**Auth**: JwtAuthGuard。**同步执行全部注销，返回成功后客户端强制登出。**
```ts
// Body
{
  confirmationMethod: 'SMS' | 'WECHAT_MODAL',
  smsCode?: string,            // SMS 必填
  modalConfirmText?: string,   // WECHAT_MODAL 必填，须 === '确认注销'
  acknowledgedNotice: true,    // 须显式 true
}
```
**事务**（Serializable + advisory lock `AD-${userId}`）：
1. 校验 `deletionExecutedAt == null`（已注销则 409）
2. 重新校验 blockers（OWNER / 支付中 / 提现中 / 非 ACTIVE 等）
3. **身份核验**：SMS → `verifyCode(phone, smsCode, DELETION)` CAS 消费；WECHAT_MODAL → 校验四字
4. **资产快照 + 证据快照** → 写 `deletionMeta`（资产、协议版本、IP、UA、确认方式、脱敏身份）
5. **清零/作废资产**（见处置明细表）+ `RewardLedger(VOID/VOIDED)` 平台归属流水
6. **清关联表**：`CartItem` deleteMany 后保留空 `Cart` 或删除 `Cart`；`Follow` deleteMany；`AiSession` deleteMany（级联 `AiUtterance`）；`Address.deletedAt=now`
7. **个人资料软删**：`UserProfile.nickname='已注销用户'`，`avatarUrl/gender/birthday/city/interests/avatarFrame*` 清空或重置
8. **AuthIdentity**：逐条 `identifier='deleted:${provider}:${userId}:${identityId}'`（释放手机号/微信，符合 `@@unique([provider,identifier,appId])`）；`unionId=null, meta=null, verified=false`
9. **强制登出**：`Session.updateMany({ userId, status:ACTIVE }, { status:REVOKED })`
10. **置状态**：`status=DELETED, deletionExecutedAt=now, deletionConfirmMethod=...`
11. **审计**：`LoginEvent.create({ provider, success:true, ip, userAgent, meta:{ action:'DELETION_EXECUTED', snapshot } })`

**Response**: `{ ok: true, message: '账号已注销' }`

> 已付款订单 / 进行中售后所依赖的数据**不清**：`Order`（含 `addressSnapshot`，履约不受影响）、`OrderItem`、`AfterSaleRequest`、`Invoice` 全部保留。

## VIP 分润计算改造

`backend/src/modules/bonus/engine/` 分润分配 traversal：
- VIP 上级、普通树上级、推荐奖励、冻结释放、退款扣回等路径遇到节点 User `deletionExecutedAt != null` 或 `status=DELETED` → **跳过该节点，份额并入平台账户**
- 节点保留，不重排树，不修改下级归属，不删除 `VipTreeNode` / `NormalTreeNode`
- 已结算的 RewardLedger 历史不动（过去事实，依法保留）

## 鉴权与绑定接口防护

- 买家 `JwtStrategy.validate` 从“只拦 BANNED”改为 `user.status !== ACTIVE` 一律拒绝，防止 DELETED 用户通过遗留 Session 或新签 token 访问接口。
- `sendBindPhoneCode / bindPhone / bindWechat` 在入口检查当前 User 必须 `ACTIVE` 且 `deletionExecutedAt=null`；注销用户返回 409。
- 登录 / 注册路径不需要额外识别旧用户：注销事务已经释放 AuthIdentity，原手机号/微信再次登录时会按新用户注册或绑定流程处理。
- `useReferralCode`、`DeferredLinkService.create/resolve`、App 端展示推荐码时均视 `deletionExecutedAt != null` 或 `status=DELETED` 的推荐人为无效。

## Cron / 后台

**无 cron**（同步执行）。不需要扫描任务。

## 买家 App 前端

### 入口
- `app/account-security.tsx` 底部新增红色文字「账号注销」
- 注销页路由 `app/me/deletion.tsx`

### 注销页（三步同页）
1. **须知 + blocker + 资产展示 + 勾选同意**：完整须知（可滚动）；如果存在 blocker，展示红色阻断项并禁用提交；无 blocker 时展示当前各项资产 + ⚠️「上述资产将全部清零作废，包括可提现余额，注销后不予退还」；已付款订单 / 进行中售后仅告知不阻断；`☐ 我已阅读并同意上述全部内容`
2. **身份核验**：
   - SMS：「请输入 138\*\*\*\*1234 收到的验证码」+ 发送验证码(60s) + 「⚠️ 提交后账号将立即注销且不可恢复」
   - WECHAT_MODAL：「您的账号仅绑定微信，请手动输入『确认注销』四字」+ 同样的不可恢复提示
3. **成功页**：「✅ 账号已注销」→ 「退出 App」→ 清本地 token / 回登录页

### 无横幅、无冷静期、无撤销入口

## 法定保留与软删范围

| 法条 | 要求 | 对应 |
|------|------|------|
| 个保法 §47 | 提供注销渠道 | ✅ 设置页入口 |
| 电子商务法 §31 | 交易记录保留 3 年 | ✅ Order/OrderItem/Payment/PaymentGroup 不删 |
| 税收征管法 + 发票管理 | 发票保留 5 年 | ✅ Invoice/InvoiceStatusHistory 不删 |
| 网络安全法 §21 | 网络日志保留 6 个月 | ✅ LoginEvent 不删 |
| 工信部 App 规定 | 15 个工作日内完成 | ✅ 立即完成 |
| 消保法 §24 | 退款权利 | ✅ 已付款订单继续履约不剥夺退货退款权 |

**保留不动**：Order / OrderItem / Payment / PaymentGroup / Invoice / InvoiceStatusHistory / RewardLedger / WithdrawRequest / RewardAllocation / VipTreeNode / NormalTreeNode / ReferralLink / CompanyStaff(role≠OWNER) / AfterSaleRequest / CsTicket / CsSession（订单或售后相关客服记录）。

**清理或匿名化**：UserProfile / AuthIdentity / Session / Device / Address / Cart / CartItem / Follow / AiSession / AiUtterance / 可删除的偏好与画像数据。

## 边缘场景

| 场景 | 处理 |
|------|------|
| OWNER 未转让强行注销 | preview 返回 blocker，execute 二次校验阻断 |
| 有 ACTIVE/PAID CheckoutSession | 阻止注销；用户需完成支付、取消会话或等待过期 |
| 有 INIT/PENDING Payment/PaymentGroup | 阻止注销；避免注销与渠道回调并发 |
| 有 PROCESSING/APPROVED WithdrawRequest | 阻止注销；提现到账或失败后再允许注销 |
| 已付款订单在途 | 继续履约（`Order.addressSnapshot` 已存收货信息，软删 Address 不影响发货） |
| 已付款 VIP 礼包订单 | 继续履约，不按“未消费权益”作废 |
| 进行中售后 | 继续受理；退款走**原支付通道**回支付宝/微信（不进钱包） |
| 注销后该订单产生退款 | 原路退回原支付账户（用户支付宝/微信仍可收款），不依赖已注销账号 |
| 同一手机号注销后重新注册 | identifier 改 `deleted:${provider}:${userId}:${identityId}` 释放，新用户全新注册建新 User |
| 重复点击 execute | advisory lock + `deletionExecutedAt != null` 幂等拦截，返回 409 |
| 仅微信用户误触 | 必须手动输入「确认注销」四字方可执行 |

## 须知文案（写入前端硬编码 + 隐私政策附录）

> ### 账号注销须知
>
> 提交账号注销即视为您已阅读并同意以下全部内容。**账号注销一经提交立即生效、不可恢复，请务必谨慎操作。**
>
> **一、立即生效不可撤销**
> 您的账号在通过身份核验、提交注销申请后将**立即注销**，无法登录、无法恢复。请在提交前确认。
>
> **二、订单与售后不受影响**
> 您账号下已支付的订单将正常履约发货，不会因注销而取消；进行中的售后/退换货将依据《消费者权益保护法》继续处理，相关退款将按原支付路径退回您的支付账户。
>
> **三、虚拟资产即时清零作废（含可提现余额）**
> 提交注销的瞬间，下列资产将**立即清零作废，不予退还、兑现或补偿**：
> 1. 消费积分、分润奖励、钱包或余额类权益（含可提现部分）；
> 2. 平台红包与已绑定未使用的优惠券；
> 3. 抽奖中奖名额、购物车中的奖品权益；
> 4. 待发放、冻结中或可提现的分润奖励。
>
> **提交注销即视为您自愿放弃上述全部资产（包括本可提现的余额），平台不予退还或补偿。**
>
> 如您有正在支付或确认中的订单、支付处理中记录、提现处理中记录，平台将暂不受理注销，请先完成、取消或等待处理结束后再提交。
>
> **四、VIP 推荐关系处理**
> 如您是 VIP 用户，您在推荐树中的节点位置予以保留，您推荐用户的分润链路不受影响；但您账号上未发放/待发放/冻结中的分润不再发放给您，全部由平台处理。
>
> **五、关联功能终止**
> 注销后：无法用本账号登录任何端口；关注商家、收货地址、发票抬头、AI 对话等可删除数据将被清除或匿名化；订单、售后、支付、发票、分润流水及相关客服工单将依法或为履约争议处理需要保留；推荐码永久失效。
>
> **六、数据保留与清除**
> 我们将在注销后清除您的个人资料、设备信息、行为日志等可删除数据。但依法保留：订单交易记录 3 年（电子商务法 §31）、发票数据 5 年、网络日志 6 个月（网络安全法 §21）。
>
> **七、注销前置条件**
> 您不是任何商户的创始人（OWNER）；不存在正在支付或确认中的订单、支付处理中记录、提现处理中记录；通过身份核验（绑定手机号者短信验证，仅微信者弹窗确认）。
>
> ⚠️ **请确认您已阅读并理解上述全部内容。注销立即生效且不可恢复。**

## 用户协议 / 隐私政策修订点

- `src/content/legal/termsOfService.ts`、`src/content/legal/privacyPolicy.ts` 新增/修订"账号注销"章节，与上方须知一致；显著写明可提现现金作废条款。
- 法律文本 App / 网站两份需同步（以 App 为基准对齐，见项目既有约定）。
- 修订后重新导出 `docs/legal/爱买买法律文本审核稿.docx`。

## 不做（本期范围外）

- ❌ 数据导出（GDPR 风格）
- ❌ 注销后再注册"老用户优惠"
- ❌ 商家通知（未发货订单商家不知用户注销）
- ❌ 邮件/短信回执
- ❌ 注销原因调研问卷
- ❌ 卖家后台员工注销（仅买家 App 端）
- ❌ 冷静期 / 撤销注销（本版明确取消）

## 实施检查清单

1. **blocker 必须双重校验**：`preview` 返回展示用结果，`execute` 在 Serializable 事务内重新查 `CompanyStaff`、`CheckoutSession`、`Payment`、`PaymentGroup`、`WithdrawRequest`。
2. **资金清零必须原子**：`RewardAccount` 清零、`RewardLedger(VOID/VOIDED)`、`User.status=DELETED`、`deletionMeta` 写入必须在同一事务内完成；P2034 序列化冲突按现有资金链路模式重试。
3. **提现处理中禁止清零**：`WithdrawRequest PROCESSING/APPROVED` 是 blocker，禁止同时将对应 `WITHDRAW/FROZEN` ledger 作废。
4. **支付中禁止注销**：`CheckoutSession ACTIVE/PAID`、`Payment/PaymentGroup INIT/PENDING` 是 blocker，避免注销后支付回调建单。
5. **地址软删先补 schema**：新增 `Address.deletedAt` 并改所有地址查询默认过滤，否则不能上线注销。
6. **审计按现有字段写**：`LoginEvent` 不新增 `event` 字段，使用 `meta.action='DELETION_EXECUTED'`；`deletionMeta` 必须包含资产快照和确认版本。
7. **鉴权必须拦 DELETED**：买家 JWT、绑定手机号、绑定微信、推荐码使用和延迟深链入口均拒绝 `status!=ACTIVE` 或 `deletionExecutedAt!=null` 用户。
8. **数据矩阵逐项测试**：购物车、关注、AI 会话、地址、红包、抽奖记录、RewardAccount、AuthIdentity、Session、UserProfile 均需有单测或集成测试覆盖。
