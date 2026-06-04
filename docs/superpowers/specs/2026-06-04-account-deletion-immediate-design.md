# 账号注销设计方案（即时注销版）

> **本文档替代 `2026-05-26-account-deletion-design.md`（已 superseded）。**
> 核心变化：取消 30 天冷静期，改为**提交即时、不可撤销注销**；明确**全部资产（含可提现现金）作废归平台**（用户书面接受该处置）。除"已付款订单继续履约 + 进行中售后继续受理"外，其余一切立即作废。

## 背景

2026-05-25 华为应用商店审核反馈中明确要求账号注销功能为必备合规项，并给出"个人中心-设置-账号注销"的标准路径。《个人信息保护法》§47、工信部/网信办相关规定要求 App 必须提供便捷的账号注销渠道，且在 **15 个工作日内**完成注销。

爱买买当前**完全没有**账号注销能力，不满足上架合规要求。本方案为上架强制项落地实现。

## 与 2026-05-26 旧版的差异（决策变更）

| 维度 | 旧版（2026-05-26） | 本版（2026-06-04，生效） |
|---|---|---|
| 注销生效 | 30 天冷静期后由 cron 执行 | **提交即同步执行，不可撤销** |
| 可撤销 | 冷静期内可 cancel | **不可撤销**（取消 cancel 接口与冷静期横幅） |
| 可提现现金（钱包/可提现分润/可提现积分） | 提交即清零（旧版也清零） | **作废归平台**（用户书面接受，见下方法律风险段） |
| cron 清理 | 每天 02:00 扫描执行 | **取消**（同步执行，无 cron） |
| User 新增字段 | 5 个（含 requestedAt/scheduledAt） | **3 个**（无冷静期相关字段） |
| 合规时效 | 30 天 + 15 工作日清除 ≈ 50 天（超标隐患） | **立即完成 < 15 工作日**，且无"强制拖延"问题 |

> **为什么取消冷静期更合规**：工信部明确"强行设置冷静期显著拖延注销程序属于违规"，要求 15 个工作日内完成。立即注销天然满足时效，且双重身份核验已足够防误触（参照淘宝/京东"满足条件后即时注销"）。

## 法律风险书面接受（可提现现金作废）

用户决定：**可提现现金类资产（分润可提现余额、可提现消费积分、钱包余额）注销时一并作废归平台，不予退还或兑现。**

- 该处置与"红包/优惠券/抽奖名额等纯运营权益作废"在法律性质上不同：可提现现金涉嫌不当得利/侵占风险，且工信部曾明确"资产结清不得作为强制注销条件"。
- **风险缓释（书面披露）**：在「注销须知」「用户协议」「隐私政策」三处均显著写明"提交注销即视为您自愿放弃上述全部资产（含可提现余额），平台不予退还、兑现或补偿"，提交注销时必须勾选「我已阅读并同意」方可继续。
- 项目方已知悉并接受该风险。本 spec 记录此决策以备追溯。

## 决策速查表（供实现对齐）

| 决策点 | 结论 |
|---|---|
| 注销策略 | **提交即时生效，不可撤销** |
| 注销期间订单 | **已付款订单继续履约**，不退款、不取消 |
| 进行中售后 | **继续受理**（退款走原支付通道回支付宝/微信，不进钱包） |
| 可提现现金 | 分润可提现余额 / 可提现消费积分 / 钱包余额 → **清零归平台**（书面接受） |
| 运营权益 | 红包 / 优惠券 / 抽奖名额 / 未消费 VIP 礼包 / 冻结未结算分润 → **作废归平台** |
| VIP 节点 | **保留**节点（不剔除），下级链路不受影响；该节点未发放分润归平台 |
| 二次确认 | 绑手机号：**短信验证码**；仅绑微信：**弹窗输入「确认注销」四字** |
| 前置条件 | 不能是任一企业的 **OWNER**（须先转让/注销企业）；账号未处于 BANNED/DELETED |
| 个人资料 | 软删（昵称→"已注销用户"、phone/email/avatar 清空、地址软删） |
| 关联表清除 | 购物车 / 收藏 / 关注商家 / AI 会话 / 收藏 SKU 清空 |
| 推荐码 | 推荐码失效（他人无法再用），ReferralLink 历史保留 |
| 手机号释放 | AuthIdentity.identifier 改 `deleted:${userId}`，原号可被新用户重新注册 |
| 法定保留 | Order/OrderItem（3年）、Invoice（5年）、LoginEvent（6个月）、RewardLedger 历史、VipTreeNode、ReferralLink |
| 短信 scope | **新增** `SmsPurpose.DELETION`（与 LOGIN/BIND/BUYER_RESET 隔离） |
| 审计 | 复用 `LoginEvent`，`event='DELETION_EXECUTED'`，meta 带资产快照 |
| 并发控制 | 单个 Serializable 事务 + advisory lock `AD-${userId}` |
| 强制登出 | 注销瞬间 revoke 该用户所有 ACTIVE Session |

## 架构选型

**买家 App 端独立 deletion 模块，复用现有 SmsOtp / Captcha / Audit / advisory lock 基础设施。**

- 新建 `backend/src/modules/me/deletion/`：`DeletionController` + `DeletionService`
- **相比旧版砍掉**：`DeletionCronService`、`POST cancel` 接口、冷静期横幅、自动撤销逻辑
- 短信：复用 `AliyunSmsService` + 新增 `SmsPurpose.DELETION`
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

### RewardEntryType 新增清零类型

- 新增枚举值（如 `DELETION_BURN`，最终枚举名以现有 `RewardEntryType` 命名风格为准，实施时确认）。
- 作废方式：`RewardAccount.balance=0, frozen=0`（VIP_REWARD / NORMAL_REWARD 两条各处理），并写一条 `RewardLedger`（entryType=DELETION_BURN，status=VOIDED，meta 记录原 balance/frozen 与去向=平台）。

> **不新增字段做推荐码失效**：在 `useReferralCode` / `deferredLink.create` 流程中检查目标 User 的 `deletionExecutedAt != null` 即视为推荐码无效（代码层判断，与 VIP 普通用户推荐码 null 策略一致）。

## 资产处置明细

| 资产 | 现有模型 | 注销处置 |
|---|---|---|
| 钱包余额 | （按现有钱包实现）| 清零归平台 + 流水记录 |
| 消费积分（双轨可提现）| RewardAccount | balance/frozen=0，VOIDED ledger |
| 分润可提现 / 冻结 | RewardAccount(VIP/NORMAL) | balance/frozen=0，VOIDED ledger，份额归平台 |
| 平台红包 / 优惠券 | CouponInstance | `status=REVOKED`（where userId 全量） |
| 抽奖名额 | （按现有抽奖实现）| 清零/置 0 |
| 未消费 VIP 礼包 | （按现有实现）| 标记失效 |

资产快照（处置前的全部金额/数量）写入 `User.deletionMeta`，供日后客服处理纠纷举证。

## API 设计（买家 App，3 个端点）

### 1. `GET /api/v1/me/deletion/preview`
**Auth**: JwtAuthGuard。返回阻塞项 + 资产快照 + 核验方式。
```ts
{
  canDelete: boolean,
  blockers: Array<{ code: string; message: string }>,
  // 例：[{ code: 'IS_COMPANY_OWNER', message: '您是「华海农业」的创始人，需先转让企业' }]
  assets: {
    wallet: number, points: number, redPackets: number,
    coupons: number, withdrawableRewards: number, frozenRewards: number,
    lotteryQuota: number, vipPackages: number,
  },
  pending: { pendingOrders: number, activeAfterSales: number }, // 仅告知不阻塞
  identityVerify: 'SMS' | 'WECHAT_MODAL',
  maskedPhone?: string,   // SMS 时返回，例 "138****1234"
}
```

### 2. `POST /api/v1/me/deletion/sms-code`
**Auth**: JwtAuthGuard。发送注销短信验证码（仅 identityVerify=SMS）。
- 复用 `AliyunSmsService.sendCode(phone, SmsPurpose.DELETION)`，60 秒间隔，每小时 5 次上限
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
2. 重新校验 blockers（OWNER 等）
3. **身份核验**：SMS → `verifyCode(phone, smsCode, DELETION)` CAS 消费；WECHAT_MODAL → 校验四字
4. **资产快照** → 写 `deletionMeta`
5. **清零/作废资产**（见处置明细表）+ 平台进账流水
6. **清关联表**：CartItem / Favorite / FollowedCompany / 收藏 SKU deleteMany；Address 软删；AiSession deleteMany
7. **个人资料软删**：UserProfile（昵称→"已注销用户"、avatar/gender/birthday 清空）
8. **AuthIdentity**：`identifier = 'deleted:${userId}'`（释放手机号/微信，符合 `@@unique([provider,identifier,appId])`）；meta 清空
9. **强制登出**：`Session.updateMany({ userId, status:ACTIVE }, { status:REVOKED })`
10. **置状态**：`status=DELETED, deletionExecutedAt=now, deletionConfirmMethod=...`
11. **审计**：`LoginEvent.create({ userId, event:'DELETION_EXECUTED', meta:{ snapshot } })`

**Response**: `{ ok: true, message: '账号已注销' }`

> 已付款订单 / 进行中售后所依赖的数据**不清**：`Order`（含 `addressSnapshot`，履约不受影响）、`OrderItem`、`AfterSaleRequest`、`Invoice` 全部保留。

## VIP 分润计算改造

`backend/src/modules/bonus/services/` 分润分配 traversal：
- 遍历上级链路时，若节点 User `deletionExecutedAt != null`（DELETED）→ **跳过该节点，份额并入平台账户**
- 已结算的 RewardLedger 历史不动（过去事实，依法保留）

## Cron / 后台

**无 cron**（同步执行）。不需要扫描任务。

## 买家 App 前端

### 入口
- `app/account-security.tsx` 底部新增红色文字「账号注销」
- 注销页路由 `app/me/deletion.tsx`

### 注销页（三步同页）
1. **须知 + 资产展示 + 勾选同意**：完整须知（可滚动）；展示当前各项资产 + ⚠️「上述资产将全部清零作废，包括可提现余额，注销后不予退还」；进行中事项（不受影响，仅告知）；`☐ 我已阅读并同意上述全部内容`
2. **身份核验**：
   - SMS：「请输入 138\*\*\*\*1234 收到的验证码」+ 发送验证码(60s) + 「⚠️ 提交后账号将立即注销且不可恢复」
   - WECHAT_MODAL：「您的账号仅绑定微信，请手动输入『确认注销』四字」+ 同样的不可恢复提示
3. **成功页**：「✅ 账号已注销」→ 「退出 App」→ 清本地 token / 回登录页

### 无横幅、无冷静期、无撤销入口

## 法定保留与软删范围

| 法条 | 要求 | 对应 |
|------|------|------|
| 个保法 §47 | 提供注销渠道 | ✅ 设置页入口 |
| 电子商务法 §31 | 交易记录保留 3 年 | ✅ Order/OrderItem/Payment 不删 |
| 税收征管法 + 发票管理 | 发票保留 5 年 | ✅ Invoice 不删 |
| 网络安全法 §21 | 网络日志保留 6 个月 | ✅ LoginEvent 不删 |
| 工信部 App 规定 | 15 个工作日内完成 | ✅ 立即完成 |
| 消保法 §24 | 退款权利 | ✅ 已付款订单继续履约不剥夺退货退款权 |

**保留不动**：Order / OrderItem / Invoice / RewardLedger / VipTreeNode / ReferralLink / CompanyStaff(role≠OWNER) / AfterSaleRequest

## 边缘场景

| 场景 | 处理 |
|------|------|
| OWNER 未转让强行注销 | preview 返回 blocker，execute 二次校验阻断 |
| 已付款订单在途 | 继续履约（`Order.addressSnapshot` 已存收货信息，软删 Address 不影响发货） |
| 进行中售后 | 继续受理；退款走**原支付通道**回支付宝/微信（不进钱包） |
| 注销后该订单产生退款 | 原路退回原支付账户（用户支付宝/微信仍可收款），不依赖已注销账号 |
| 同一手机号注销后重新注册 | identifier 改 `deleted:${userId}` 释放，新用户全新注册建新 User |
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
> 1. 钱包余额、消费积分（含可提现部分）；
> 2. 平台红包与已绑定未使用的优惠券；
> 3. 抽奖中奖名额与未消费的 VIP 礼包；
> 4. 待发放、冻结中或可提现的分润奖励。
>
> **提交注销即视为您自愿放弃上述全部资产（包括本可提现的余额），平台不予退还或补偿。**
>
> **四、VIP 推荐关系处理**
> 如您是 VIP 用户，您在推荐树中的节点位置予以保留，您推荐用户的分润链路不受影响；但您账号上未发放/待发放/冻结中的分润不再发放给您，全部由平台处理。
>
> **五、关联功能终止**
> 注销后：无法用本账号登录任何端口；关注商家、收藏商品、收货地址、发票抬头被清除；AI 对话与客服会话记录被清除；推荐码永久失效。
>
> **六、数据保留与清除**
> 我们将在注销后清除您的个人资料、设备信息、行为日志等可删除数据。但依法保留：订单交易记录 3 年（电子商务法 §31）、发票数据 5 年、网络日志 6 个月（网络安全法 §21）。
>
> **七、注销前置条件**
> 您不是任何商户的创始人（OWNER）；通过身份核验（绑定手机号者短信验证，仅微信者弹窗确认）。
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

## 实现需核实点

1. **钱包实现**：确认"钱包余额"对应的实际模型/字段（schema 未见独立 Wallet model；可能并入 RewardAccount 或其他），清零路径以实际实现为准。
2. **抽奖名额 / VIP 礼包**：确认未消费名额/礼包的实际模型与"作废"字段。
3. **RewardEntryType 枚举名**：新增 `DELETION_BURN` 时对齐现有命名风格。
4. **同步事务体量**：execute 单事务涉及多表写 + 资金清零，须 Serializable + advisory lock，注意事务时长与死锁；必要时拆分非资金类清理到事务外（资金清零与状态置 DELETED 必须同事务原子）。
5. **绑定接口防护**：换绑手机号/微信接口对 `deletionExecutedAt != null` 用户返回 409（账号已注销）。
