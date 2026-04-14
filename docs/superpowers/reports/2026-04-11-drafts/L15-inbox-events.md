# L15 — 消息中心（事件盘点）审查报告

**审查日期**: 2026-04-11
**审查档位**: B 档（标准审查）
**审查范围**: `backend/src/modules/inbox/` (3 文件 ≈90 行) + `InboxMessage` schema + `app/inbox/index.tsx` + 全项目 Grep 调用点
**严格只读**。未运行任何代码，仅静态分析。

---

## TL;DR 🔴 **阻塞 T1 上线**

InboxService 骨架已就绪（`send/list/markRead/markAllRead/getUnreadCount` 五个方法），`InboxMessage` 表和 `/inbox` 路由均可用，买家 App 的消息中心页面也已实现三 Tab UI（互动/交易/系统）。**但是——整个后端只有 1 处业务代码调用 `InboxService.send()`**：`checkout.service.ts:1516`（VIP 激活成功通知）。

所有其它应发通知的业务事件（订单支付成功、发货、签收、分润到账、奖励解冻/过期、提现审核、售后全链路、商品审核、商户入驻审核、VIP 邀请人奖励、红包到账、员工邀请、CS 离线消息、R12 超卖）**一条都没接**。即便 VIP 那一处也是软依赖：`inboxService: any = null`，通过 `moduleRef.get(..., { strict: false })` 动态注入 + catch warn 不阻塞。

**钱相关事件（奖励到账、提现通过/拒绝、退款到账）全部未接** → 用户支付成功、奖励到账、提现通过完全无感知 → 🔴 **阻塞 T1**。

---

## 一、事件→监听者矩阵（核心产出）

所有调用 `InboxService.send()` 的位置通过 `Grep 'inboxService\.send\|InboxService\.send\|inboxMessage\.create'` 全项目扫描确认。**全项目总共 2 处**：
- `backend/src/modules/inbox/inbox.service.ts:63` — `send()` 方法内部实现（prisma.inboxMessage.create）
- `backend/src/modules/order/checkout.service.ts:1516` — VIP 激活成功通知（**唯一调用点**）

| # | 事件 | 发射位置 | 应发通知给 | 是否已接 | 证据 |
|---|---|---|---|---|---|
| 1 | 订单支付成功 | `payment.service.ts:257` / `checkout.service.ts:handlePaymentSuccess` | 买家 + 卖家 | ❌ | 无 send 调用，支付成功只写 Order/Shipment 表 |
| 2 | 订单已发货 | `seller-orders.service.ts:ship`（L120+） | 买家 | ❌ | 发货只更新 Shipment/Order，无 inbox |
| 3 | 物流签收回调 | `shipment.service.ts`（callback） | 买家 | ❌ | 仅状态变更，无通知 |
| 4 | 订单自动确认收货 | `order-auto-confirm.service.ts`（`@Cron EVERY_HOUR`） | 买家 | ❌ | 状态流转无通知 |
| 5 | 分润奖励到账（VIP） | `bonus.service.ts:activateVipAfterPayment` / `vip-upstream.service` | 各层祖辈用户 | ❌ | 写 RewardLedger 无 inbox |
| 6 | 分润奖励到账（普通） | `bonus/engine/normal-upstream.service.ts` | 各层祖辈用户 | ❌ | 同上 |
| 7 | 奖励解冻 | `bonus/engine/freeze-expire.service.ts:handleFreezeExpire`（:34） | 用户 | ❌ | 仅写 RewardLedger，无通知 |
| 8 | 奖励过期失效 | `freeze-expire.service.ts:expireSingleLedger`（:223） | 用户 | ❌ | 同上 |
| 9 | 提现申请成功 | `bonus.service.ts:requestWithdraw`（:579） | 用户 | ❌ | 仅写 BonusWithdraw 记录 |
| 10 | 提现审核通过 | `admin-bonus.service.ts:approveWithdraw`（:69） | 用户 | ❌ | 用户无法知晓钱已到账 🔴 |
| 11 | 提现审核拒绝 | `admin-bonus.service.ts:rejectWithdraw`（:1402） | 用户 | ❌ | 用户无法知晓被拒及原因 🔴 |
| 12 | VIP 激活成功 | `checkout.service.ts:1515-1526` | 用户 | ✅ | 唯一已接。类型 `vip_activated`，content 含赠品名称 + 跳转 |
| 13 | VIP 邀请人奖励 | `bonus.service.ts:grantVipReferralBonus`（:1073） | 邀请人 | ❌ | 只写 RewardLedger |
| 14 | 售后申请已提交 | `after-sale.service.ts:apply`（:70） | 卖家 | ❌ | 仅创建 AfterSaleOrder |
| 15 | 售后卖家审核通过 | `after-sale.service.ts`（approve/通过流程） | 买家 | ❌ | 无通知 |
| 16 | 售后卖家审核驳回 | `after-sale.service.ts` | 买家 | ❌ | 无通知 |
| 17 | 售后平台仲裁结果 | `after-sale.service.ts` / `after-sale-timeout.service.ts` | 买家 + 卖家 | ❌ | 无通知 |
| 18 | 退款到账 | `after-sale.service.ts` / `after-sale-reward.service.ts` | 买家 | ❌ | 钱到账无感知 🔴 |
| 19 | 换货运单创建 | `after-sale.service.ts`（ship） | 买家 | ❌ | 无通知 |
| 20 | 买家确认收货（售后） | `after-sale.service.ts:confirmReceive`（:406） | 卖家 | ❌ | 无通知 |
| 21 | 商品审核通过 | `admin-products.service.ts:audit`（:223） | 卖家 | ❌ | 仅更新 `auditStatus='APPROVED'` |
| 22 | 商品审核驳回 | `admin-products.service.ts:audit`（:223） | 卖家 | ❌ | 卖家不知为何没上架 |
| 23 | 入驻申请审核通过 | `admin-merchant-applications.service.ts:approve`（:87） | 申请商户手机号 | ❌ | 走 SMS（见下文注），无 inbox |
| 24 | 入驻申请审核驳回 | `admin-merchant-applications.service.ts:reject`（:207） | 申请商户 | ❌ | 同上 |
| 25 | 卖家邀请员工 | `seller-company.service.ts:inviteStaff`（:224） | 被邀请员工 | ❌ | 只创建 CompanyStaffInvite 记录 |
| 26 | 新客服消息 | `cs.service.ts` / `cs.gateway.ts` | 用户/客服 | ❌ | 走 Socket.IO 实时推送，**离线用户无兜底**（无 inbox fallback） |
| 27 | 红包到账 | `coupon-engine.service.ts:issueSingle`（:355） | 用户 | ❌ | 只创建 CouponInstance |
| 28 | 红包即将过期 | `coupon-engine.service.ts` 的 `@Cron` (:131/207/253) | 用户 | ❌ | 无通知 |
| 29 | R12 超卖补货 | `checkout.service.ts:1264` 有 `// TODO: 发送卖家补货通知` | 卖家 | ❌ | 代码注释明确标注 TODO |
| 30 | 发票开具完成 | invoice 模块 | 买家 | ❌ | 未盘点到调用 |

**统计**：30 个应发事件，**已接 1 个**（VIP 激活），**漏接 29 个**，覆盖率 **3.3%**。

---

## 二、已接清单（1 项）

### ✅ #12 VIP 激活成功
- **位置**: `backend/src/modules/order/checkout.service.ts:1515-1526`
- **实现**:
  ```ts
  if (vipActivated && this.inboxService) {
    this.inboxService.send({
      userId: result.sessionUserId,
      category: 'system',
      type: 'vip_activated',
      title: 'VIP 会员开通成功',
      content: `...您选择的赠品「${bizMeta.giftTitle}」将随订单发货...`,
      target: { route: '/orders/[id]', params: { id: result.orderIds[0] } },
    }).catch((err) => this.logger.warn(`VIP 开通通知发送失败：${err.message}`));
  }
  ```
- **风险**: 
  - `this.inboxService` 是软依赖（`private inboxService: any = null` + `setInboxService` setter），若 OrderModule 未显式注入（见 `order.module.ts:79-81`），通知静默丢失
  - catch 仅 warn 不重试不补偿，与 L06 报告 M1 同一问题

---

## 三、漏接清单（29 项，按严重程度分组）

### 🔴 钱相关（T1 阻塞，必须补）

| # | 事件 | 影响 | 建议类型 | 建议 category |
|---|---|---|---|---|
| 5 | VIP 分润奖励到账 | 用户不知道有钱了 | `reward_credited` | `transaction` |
| 6 | 普通分润奖励到账 | 同上 | `reward_credited` | `transaction` |
| 7 | 奖励解冻 | 用户不知道钱可提了 | `reward_unfrozen` | `transaction` |
| 8 | 奖励过期失效 | 用户不知道钱没了（退款/维权触发） | `reward_expired` | `transaction` |
| 10 | 提现审核通过 | 钱到账无感知（严重投诉源） | `withdraw_approved` | `transaction` |
| 11 | 提现审核拒绝 | 用户不知被拒+原因 | `withdraw_rejected` | `transaction` |
| 13 | VIP 邀请人奖励 | 邀请人不知道奖励到账 | `vip_referral_bonus` | `transaction` |
| 18 | 退款到账 | 用户不知钱退回 | `refund_credited` | `transaction` |
| 27 | 红包到账 | 用户不知收到红包 | `coupon_granted` | `transaction` |

### 🟠 交易体验（强烈建议 T1 补）

| # | 事件 | 影响 | 建议类型 |
|---|---|---|---|
| 1 | 订单支付成功 | 买家无确认反馈 | `order_paid` |
| 2 | 订单已发货 | 买家不知何时发出 | `order_shipped` |
| 3 | 物流签收 | 买家不知已到 | `order_delivered` |
| 4 | 订单自动确认 | 买家不知售后期开始 | `order_auto_confirmed` |
| 14 | 售后申请已提交 | 卖家不知有售后工单 | `after_sale_applied` |
| 15 | 售后审核通过 | 买家不知进展 | `after_sale_approved` |
| 16 | 售后审核驳回 | 买家不知结果 | `after_sale_rejected` |
| 17 | 售后平台仲裁 | 双方不知结果 | `after_sale_arbitrated` |
| 19 | 换货运单创建 | 买家不知新货寄出 | `after_sale_exchange_shipped` |
| 20 | 买家确认换货收货 | 卖家不知闭环 | `after_sale_confirm_received` |
| 26 | 新客服消息（离线兜底） | 离线用户错过客服消息 | `cs_new_message` |
| 29 | R12 超卖补货 | **代码已 TODO**，卖家完全不知 | `stock_shortage` |

### 🟡 运营/商户侧（T1 可暂缓，T1.x 补）

| # | 事件 | 建议类型 |
|---|---|---|
| 9 | 提现申请成功（申请状态确认） | `withdraw_submitted` |
| 21 | 商品审核通过 | `product_audit_approved` |
| 22 | 商品审核驳回 | `product_audit_rejected` |
| 23 | 入驻申请通过 | `merchant_application_approved` |
| 24 | 入驻申请驳回 | `merchant_application_rejected` |
| 25 | 卖家邀请员工 | `staff_invited` |
| 28 | 红包即将过期（cron） | `coupon_expiring_soon` |
| 30 | 发票开具完成 | `invoice_issued` |

---

## 四、InboxMessage 字段支持 / 分类能力

**Schema**（`schema.prisma:1975-1989`）：
```prisma
model InboxMessage {
  id        String   @id @default(cuid())
  userId    String
  category  String   // 消息分类
  type      String   // 消息类型
  title     String
  content   String
  unread    Boolean  @default(true)
  target    Json?    // { route, params }
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([userId])
}
```

**支持情况**：
| 字段 | 状态 | 备注 |
|---|---|---|
| `category` 分类 | ✅ | String 自由枚举，前端定义 `'interaction' \| 'transaction' \| 'system'`（`src/types/domain/Inbox.ts:10`） |
| `type` 业务类型 | ✅ | 自由 String |
| `target` 跳转 | ✅ | `{ route, params }` JSON |
| `priority` 优先级 | ❌ | **未定义**。钱/售后消息与系统通知无法区分紧急度 |
| `tag` 标签 | ❌ | 无 |
| `expireAt` 自动过期 | ❌ | 无 |
| `readAt` 已读时间戳 | ❌ | 仅 boolean，审计不足 |
| `ackRequired` 需确认 | ❌ | 无 |

**App 端分 Tab 实现**（`app/inbox/index.tsx:47-55`）：
```ts
tabs = [
  { id: 'all', label: '全部' },
  { id: 'interaction', label: '互动' },
  { id: 'transaction', label: '交易' },
  { id: 'system', label: '系统' },
]
```
✅ App 已按 category 分 Tab + `unreadOnly` 过滤 + 全部已读。

**类型映射**（`app/inbox/index.tsx:17-26`）—— **前后端类型枚举不对齐的证据**：

App 端 `iconMap` 只定义了 8 种 `InboxType`：
```ts
expert_reply | tip_paid | cooperation_update | like | comment | follow | order_update | booking_update
```

**但是**：
- 后端唯一调用点使用的 `type` 是 `vip_activated` ← **不在 App 的 iconMap 里**，会 fallback 到 `bell-outline`
- App 的 8 种 type 来自早期 mock，全都是社交类/互动类，**完全没有覆盖**订单/支付/奖励/售后/提现
- `src/types/domain/Inbox.ts:12-20` 定义的 `InboxType` 是封闭联合类型，会导致 TS 编译层面的类型不匹配

→ **后端一旦补齐 29 个事件的 type，App 端 Icon 全部显示默认铃铛，且 TS 类型报错** → 前后端同步改造。

---

## 五、推送通道现状

| 通道 | 状态 | 证据 |
|---|---|---|
| 站内消息（InboxMessage） | ⚠️ 骨架可用但仅 1 处接入 | 见 §二 |
| Expo Push / 推送 SDK | ❌ **未接入** | 全项目 Grep `ExpoPush\|expo-server-sdk\|pushToken\|PushNotification` 只命中 `schema.prisma:701` 的 `pushToken String?`（UserDevice 表字段存在但从未写入/读出，nothing 使用） |
| 极光/华为/小米/苹果推送 | ❌ 未接入 | 同上，schema 字段注释提及但无服务 |
| SMS 短信 | ⚠️ 部分接入 | `auth.service`（验证码）、`merchant-applications.service`（审核结果通知用户手机号）、`virtual-call.service`、`seller-audit-alert.service`。**仅限验证码和入驻审核，未覆盖任何交易/奖励/售后事件** |
| 微信服务号/公众号模板 | ❌ | 无 |
| 邮件通知 | ❌ | 无 |
| Socket.IO 实时（客服） | ✅ | `cs.gateway.ts` 仅客服消息，离线用户无 inbox fallback（#26） |

**结论**：除了 VIP 激活那一条站内消息和验证码短信，平台**完全没有任何对用户的主动通知能力**。用户必须每次自己进 App 查询订单/奖励/提现状态。

---

## 六、跨系统一致性问题

### C1 前后端 InboxType 枚举脱节（🟠 HIGH）
- 前端 `InboxType`（`src/types/domain/Inbox.ts:12`）：封闭 8 种社交类型
- 后端实际使用：`vip_activated`（不在前端枚举中）
- 图标映射 `iconMap` 缺失会 fallback 到默认铃铛，但 TS 类型 `InboxType` 若严格匹配会报错
- **需同步**：后端补事件时必须同步更新前端 `InboxType` 联合类型 + `iconMap`

### C2 前端 Tab 定义与后端 category 未约定权威字典（🟡 MEDIUM）
- 前端只识别 `interaction/transaction/system` 三种 category
- 后端 `send()` 方法的 `category` 参数是 `string`，无 enum/校验
- 若后端写入 `"order"`/`"payment"` 等第四种 category，App 的 "全部" Tab 能看到但过滤 Tab 失效
- 建议后端 DTO 加 `@IsIn(['interaction','transaction','system'])` 或独立 enum

### C3 InboxRepo 未读数接口未核对 (🟡 MEDIUM)
- 后端有 `GET /inbox/unread-count`（`inbox.controller.ts:21`）
- `app/(tabs)/home.tsx` / `app/(tabs)/me.tsx` 引用 inbox（见 Grep 结果）—— 需核对是否调用此接口展示 tab bar 徽标，未展开细查
- 若未接入 → 即便补齐事件，用户进 App 仍看不到红点提醒

### C4 分类字符串在前后端无共享常量（🟡 MEDIUM）
- 前端 `InboxCategory` 在 `src/types/domain/Inbox.ts`
- 后端无对应 enum 定义，所有 `category: 'system'` 都是 magic string
- 易拼写错（如 `'System'` vs `'system'` 大小写）

---

## 七、安全/时序/审计观察

### S1 send() 无幂等键（🟡 MEDIUM）
- `InboxService.send()` 直接 `prisma.inboxMessage.create`，无唯一键去重
- 若业务代码在事务重试/补偿 cron 重复调用，会产生重复消息
- 建议方向：加可选 `dedupeKey` 参数 + `@@unique([userId, dedupeKey])` 索引，由调用方决定要不要幂等

### S2 跨事务边界软依赖丢失（🔴 HIGH — L06 已提）
- `checkout.service.ts:1515` 的 `this.inboxService` 是可选注入
- 若 `OrderModule` 某次重构移除 `setInboxService` 调用，VIP 通知会**编译通过但运行时静默丢失**
- 建议：改为硬依赖（constructor DI）或启动时断言存在

### S3 inbox 历史消息无清理策略（🟡 MEDIUM）
- `InboxMessage` 表无 TTL / 无清理 cron
- 用户 1 年后的订单消息仍在表内，长期增长无上限
- 建议补 `@Cron` 定期清理 180 天前的已读消息，或 schema 加 `expireAt` 字段 + 清理任务

### S4 send 在事务外执行（🟢 LOW）
- 唯一调用点在 `handlePaymentSuccess` 的事务**完成后**调用，catch warn 不阻塞 —— 这个设计合理（通知失败不应回滚支付）
- 补事件时需保持相同模式：事务成功 → 异步发消息 → catch warn

---

## 八、关键结论 & T1 行动建议

### 🔴 阻塞项（T1 上线前必须补）

1. **钱相关 9 项全部补接**（#5/6/7/8/10/11/13/18/27）—— 否则资金到账全无感知 → 客服/投诉灾难
2. **C1 前后端 InboxType 枚举同步**：后端每补 1 种 type，前端同步扩枚举 + iconMap
3. **S2 `inboxService` 改硬依赖**：消除软注入风险
4. **C3 未读数徽标核对**：确保 tab bar/me 页红点生效，否则补了也没用

### 🟠 强烈建议 T1 补接

5. **交易全链路 5 项**（#1/2/3/4/29）：支付成功 / 发货 / 签收 / 自动确认 / 超卖补货
6. **售后全链路 7 项**（#14-20）：按现有 after-sale.service 状态转换点补
7. **S1 幂等键**：cron/补偿场景必须幂等，否则重复消息体验极差

### 🟡 T1.x 补接

8. 运营/商户侧 8 项（#9/21-25/28/30）
9. S3 清理 cron
10. priority/expireAt/readAt 字段增强

### 📋 不建议 T1 做

- **不要**搭建事件总线/CQRS 中枢 —— L15 的 v1 范围就是"补齐 30 个调用点 + 前端 type 同步"，别过度工程化
- Expo Push / SMS 通用化 → v1.1 再做
- 推送去重/优先级 / 消息模板系统 → v1.2

---

## 九、相关文件清单

**后端**：
- `backend/src/modules/inbox/inbox.service.ts` — `send/list/markRead/markAllRead/getUnreadCount` 实现（90 行）
- `backend/src/modules/inbox/inbox.controller.ts` — `/inbox` 路由 4 个端点
- `backend/src/modules/inbox/inbox.module.ts` — 导出 InboxService
- `backend/prisma/schema.prisma:1975-1989` — InboxMessage 模型
- `backend/src/modules/order/checkout.service.ts:1515-1526` — **唯一调用点**
- `backend/src/modules/order/order.module.ts:79-81` — 软注入逻辑

**前端**：
- `app/inbox/index.tsx` — 消息中心页面（308 行）
- `src/types/domain/Inbox.ts` — `InboxCategory` + `InboxType`（封闭 8 种，与后端脱节）
- `src/repos/InboxRepo.ts` — repo 层（未深入审查）
- `src/mocks/inbox.ts` — mock 数据（早期 8 种 type 的来源）

**报告交叉**：
- `docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md` M1 —— inboxService 软依赖问题同源
- `docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md` —— 超卖通知 TODO 同源

---

**审查结论**: 🔴 **阻塞 T1**。InboxService 基础设施完整，但业务接入率仅 3.3%（1/30），钱相关事件 0 接入。必须在 T1 前至少补齐 §八 的"阻塞项 + 强烈建议"共 14 项事件 + 前后端 type 同步。
