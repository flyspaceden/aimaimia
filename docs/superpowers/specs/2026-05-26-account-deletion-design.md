# 账号注销设计方案

## 背景

2026-05-25 华为应用商店审核反馈中明确要求账号注销功能为必备合规项，并给出"个人中心-设置-账号注销"的标准路径。同时《个人信息保护法》第 47 条、工信部《App 个人信息保护管理规定》第 22 条均要求 App 必须提供便捷的账号注销渠道。

爱买买当前**完全没有**账号注销能力——用户一旦注册无法自助删除账号，仅可在管理后台由超级管理员手动 ban 账号（`User.status=BANNED`），不满足合规要求。

## 目标

1. **买家 App** 新增完整自助注销流程：注销须知 → 身份核验（短信/弹窗）→ 提交申请 → 30 天冷静期 → cron 数据清理
2. 资金安全：已支付订单**继续履约**（不退款），虚拟资产（钱包/积分/红包/分润）**即时清零归平台**
3. VIP 树位置保留：注销用户节点不剔除，未发放分润全部转入平台收入
4. 法律合规：依《电子商务法》§31 保留交易记录 3 年、依《税收征管法》保留发票 5 年、依《网络安全法》§21 保留登录日志 6 个月
5. 不影响商户：OWNER 必须先转让企业才能注销
6. 注销可撤销：30 天冷静期内任何登录/消费/售后操作即自动撤回

## 决策速查表（供实现时对齐）

| 决策点 | 结论 |
|---|---|
| 注销策略 | **30 天延迟生效**（冷静期内可撤销） |
| 注销期间订单 | **已支付订单继续履约**，不退款、不取消 |
| 注销期间售后 | **继续受理**（消费者法定权利不可剥夺） |
| 虚拟资产处理 | 钱包/积分/红包/抽奖名额/VIP 礼包/分润奖励**全部即时清零归平台**，不退还 |
| VIP 节点处理 | **保留**节点（不剔除），下级链路不受影响；该节点未发放分润全归平台 |
| 二次确认 | 绑定手机号：**短信验证码**；仅绑微信：**弹窗输入「确认注销」四字** |
| 注销前置条件 | 不能是任一企业的 **OWNER**；账号未处于 BANNED 状态 |
| 冷静期登录 | 允许登录，登录后顶部红色横幅 + 「撤销注销」按钮；任何写操作（下单/支付/售后）自动撤销注销 |
| 数据清除范围 | 软删个人字段（昵称→"已注销用户"、phone/email/avatar 清空、地址软删）；保留订单/发票/分润记录（法定保留期内） |
| 关联表清除 | 购物车清空、收藏清空、关注商家清空、AI 会话清空、地址软删、收藏 SKU 清空 |
| 推荐码 | 推荐码失效（他人无法再用），但 ReferralLink 历史记录保留 |
| 短信 scope 隔离 | **新增** `SmsPurpose.DELETION` 枚举值（与 LOGIN/BIND/BUYER_RESET 完全隔离） |
| 审计 | 复用 `LoginEvent`，`meta.action='DELETION_REQUESTED'` / `'DELETION_CANCELED'` / `'DELETION_EXECUTED'` |
| 并发控制 | request/cancel/execute 均用 Serializable 事务 + advisory lock (`AD-${userId}`) |
| 强制登出 | 注销提交瞬间 revoke 该用户所有 Session（防注销后仍能下单干扰冷静期） |

## 架构选型

**方案：买家 App 端独立 deletion 模块，复用现有 SmsOtp / Captcha / Audit 基础设施**

- 新建 `backend/src/modules/me/deletion/` 子模块（DeletionController + DeletionService + DeletionCronService）
- 数据库：User 表加 5 个字段（详见下方 schema），不新增独立 Deletion 表
- 短信：复用 `AliyunSmsService` + 新增 `SmsPurpose.DELETION`
- Cron：扩展现有 `BullModule` 队列或直接用 `@nestjs/schedule` `@Cron`，每天 02:00 跑

为什么不做单独 `DeletionRequest` 表：
- 每个用户最多一条进行中的注销申请（不需要一对多）
- 注销字段总数 ≤ 5 个，直接挂在 User 表足够
- 撤销时直接清空字段即可，状态机简单
- 减少跨表 join 成本

为什么放在 `me/deletion/` 而不是 `auth/`：
- 这是用户操作自己账号的功能，不涉及登录态切换
- 复用现有 `@CurrentUser()` 装饰器、`JwtAuthGuard` 守卫
- 路径语义符合 RESTful（`/me/deletion/*` 表示"我的账号注销相关"）

## 数据模型变更

### User 表新增字段

```prisma
model User {
  id                     String     @id @default(cuid())
  status                 UserStatus @default(ACTIVE)
  // ... 既有字段 ...

  // 账号注销（2026-05-26 新增）
  deletionRequestedAt    DateTime?  // 注销发起时间，null=无注销申请
  deletionScheduledAt    DateTime?  // 计划清除时间（requestedAt + 30 天）
  deletionConfirmMethod  String?    // 'SMS' | 'WECHAT_MODAL'，审计用
  deletionExecutedAt     DateTime?  // 实际清除完成时间，null=未执行
  deletionMeta           Json?      // 注销时虚拟资产快照（balance/points/redPackets/frozen 等），便于客服查证

  // ...
  @@index([deletionScheduledAt]) // cron 扫描专用
}
```

### UserStatus 枚举沿用

- `ACTIVE`：正常 / 冷静期中（不改 status，靠 `deletionRequestedAt` 是否为 null 判断）
- `BANNED`：管理员封禁
- `DELETED`：注销已执行（cron 把可删字段清完后切换到这个状态）

> **不引入 PENDING_DELETION 状态**：冷静期内用户必须能正常登录使用功能（除了下单/支付/售后这些"自动撤销注销"动作），用 status=ACTIVE + deletionRequestedAt != null 表达"冷静期"语义即可。

### SmsPurpose 枚举新增

```prisma
enum SmsPurpose {
  LOGIN
  BIND
  RESET
  BUYER_RESET
  SELLER_RESET
  DELETION       // 2026-05-26 新增：账号注销专用 scope
}
```

## API 设计（买家 App）

### 1. `GET /api/v1/me/deletion/preview`

注销前预览：返回阻塞项 + 虚拟资产快照。

**Auth**: JwtAuthGuard
**Response**:
```ts
{
  canDelete: boolean,
  blockers: Array<{ code: string; message: string }>,
  // 例：[{ code: 'IS_COMPANY_OWNER', message: '您是「华海农业」的创始人，需先转让企业' }]

  pendingItems: {
    pendingOrders: number,      // 待发货订单数（仅告知，不阻塞）
    activeAfterSales: number,    // 进行中售后数（仅告知）
    wallet: number,              // 钱包余额（元）
    points: number,              // 消费积分余额
    redPackets: number,          // 红包数量
    frozenRewards: number,       // 冻结中分润（元）
    lotteryQuota: number,        // 未消费抽奖名额
    vipPackages: number,         // 未消费 VIP 礼包数
  },

  identityVerify: 'SMS' | 'WECHAT_MODAL',
  // SMS：有手机号绑定，需短信验证码
  // WECHAT_MODAL：仅微信绑定，需弹窗输入"确认注销"

  maskedPhone?: string,          // 当 identityVerify=SMS 时返回，例 "138****1234"
}
```

### 2. `POST /api/v1/me/deletion/sms-code`

发送注销短信验证码（仅 identityVerify=SMS 时调用）。

**Auth**: JwtAuthGuard
**Body**: 空
**Response**: `{ ok: true }` 或 `{ ok: false, error: '60秒后重试' }`

- 复用 `AliyunSmsService.sendCode(phone, SmsPurpose.DELETION)`
- 60 秒发送间隔
- 同一 phone+purpose 每小时 5 次上限
- 短信模板新建：「【爱买买】您正在申请账号注销，验证码 {code}，10 分钟内有效。此操作不可恢复，请谨慎操作。」

### 3. `POST /api/v1/me/deletion/request`

提交注销申请。

**Auth**: JwtAuthGuard
**Body**:
```ts
{
  confirmationMethod: 'SMS' | 'WECHAT_MODAL',
  smsCode?: string,            // SMS 时必填
  modalConfirmText?: string,    // WECHAT_MODAL 时必填，必须等于"确认注销"
  acknowledgedNotice: true,     // 客户端必须显式传 true 表示已读须知
}
```

**事务**（Serializable + advisory lock `AD-${userId}`）：

1. 检查 `User.deletionRequestedAt` 是否已有值 → 已申请则 409
2. 重新检查 blockers（preview 后到 request 之间状态可能变）
3. **身份核验**：
   - SMS：调 `AliyunSmsService.verifyCode(phone, smsCode, SmsPurpose.DELETION)` CAS 消费
   - WECHAT_MODAL：校验 `modalConfirmText === '确认注销'`
4. **虚拟资产快照**：读取并写入 `deletionMeta`
   - `{ wallet, points, redPackets, frozenRewards, lotteryQuota, vipPackages, snapshotAt }`
5. **清零虚拟资产**（按"归平台"语义）：
   - `RewardAccount.balance = 0, frozen = 0`（VIP_REWARD 和 NORMAL_REWARD 各一条）
   - `RewardLedger` 写 `DELETION_BURN` 记录（type 新增）
   - 平台对应账户加同等金额（platform aggregate ledger）
   - `CouponInstance` where userId 全部置 `status=EXPIRED, reason='DELETION'`
   - `LotteryQuota`（如有）全部消费/置 0
   - VIP 礼包未消费的标记失效
6. **关联表清除**（购物车/收藏/关注，不涉及钱）：
   - `CartItem.deleteMany({ where: { cart: { userId } } })`
   - `Favorite.deleteMany({ where: { userId } })`
   - `FollowedCompany.deleteMany({ where: { userId } })`
7. **推荐码失效**（不删 ReferralLink 历史，但下游不能再 use）：
   - 给 `User` 加 `referralCodeRevoked` Boolean？或在 useReferralCode 时检查 deletionRequestedAt
   - 实现选 B（代码层判断，不加字段）
8. **强制登出**：`Session.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'REVOKED' } })`
9. **设置注销时间**：
   - `deletionRequestedAt = now`
   - `deletionScheduledAt = now + 30 days`
   - `deletionConfirmMethod = body.confirmationMethod`
10. **审计**：`LoginEvent.create({ userId, event: 'DELETION_REQUESTED', meta: { snapshot: deletionMeta } })`

**Response**:
```ts
{
  scheduledAt: '2026-06-25T...',
  message: '已提交注销申请，将于 2026-06-25 清除。30 天内重新登录可撤销。',
}
```

### 4. `POST /api/v1/me/deletion/cancel`

撤销注销申请。

**Auth**: JwtAuthGuard
**Body**: 空

**事务**（Serializable + advisory lock）：

1. 检查 `deletionRequestedAt != null && deletionExecutedAt == null` → 否则 400
2. 清空 `deletionRequestedAt = null, deletionScheduledAt = null, deletionConfirmMethod = null, deletionMeta = null`
3. **不恢复**已清零的虚拟资产（条款约定不可逆）
4. 审计 `LoginEvent.create({ event: 'DELETION_CANCELED' })`

**Response**: `{ ok: true, message: '已撤销注销申请' }`

### 5. 隐性"自动撤销"触发点

下列写操作发生时，若 `deletionRequestedAt != null && deletionExecutedAt == null`，**先自动调 cancel 再继续业务**：

- 下单（CheckoutSession 创建）
- 申请售后
- 申请发票

不需要为这些路径单独写代码，统一在 `JwtAuthStrategy.validate()` 或一个全局拦截器里检测：
- 读操作（GET /products、GET /cart）→ 不触发
- 写操作 + deletionRequestedAt != null → 触发 cancel

> 实现简化版：暂时不做自动撤销，只在登录页提示用户「您处于注销冷静期，下单前请先撤销注销」。后续真有用户投诉再加自动撤销逻辑。

## VIP 分润计算改造

`backend/src/modules/bonus/services/` 现有分润分配逻辑需改造：

- 利润分配 traversal 时，**遍历上级链路前先检查 `deletionRequestedAt`**：
  - 若 `deletionRequestedAt != null` 且 `deletionExecutedAt == null`：跳过该节点，份额并入平台账户
  - 若 `deletionExecutedAt != null`：节点已 DELETED，依然跳过（兜底）
- 已冻结但未发放的分润（`RewardAccount.frozen`）：
  - 冷静期内：deletion request 时直接清零归平台（步骤 5）
  - 已结算的 RewardLedger 历史不动（这是过去的事实，依法保留）

## Cron 数据清理

`backend/src/modules/me/deletion/deletion.cron.ts`：

```ts
@Cron('0 0 2 * * *') // 每天凌晨 2 点
async executeDeletion() {
  const expired = await prisma.user.findMany({
    where: {
      deletionRequestedAt: { not: null },
      deletionScheduledAt: { lte: new Date() },
      deletionExecutedAt: null,
      status: { not: 'DELETED' },
    },
    take: 100, // 每次最多 100 个，防 OOM
  });

  for (const user of expired) {
    await this.executeOne(user.id);
  }
}

async executeOne(userId: string) {
  // Serializable + advisory lock
  await prisma.$transaction(async (tx) => {
    // 1. 软删个人字段
    await tx.userProfile.update({
      where: { userId },
      data: {
        nickname: '已注销用户',
        avatar: null,
        gender: null,
        birthday: null,
        // ... 其他个人字段清空
      },
    });

    // 2. 清空 AuthIdentity（手机号 / 微信 OpenID）
    await tx.authIdentity.updateMany({
      where: { userId },
      data: {
        identifier: `deleted:${userId}`, // unique 占位，防止他人无法用该手机号注册
        meta: Prisma.JsonNull,
      },
    });
    // 实际策略：identifier 改为 `deleted:${userId}` 让该手机号"释放"，新用户可以重新用此号注册

    // 3. 地址软删
    await tx.address.updateMany({
      where: { userId },
      data: { deletedAt: new Date() },
    });

    // 4. AI 会话清空
    await tx.aiSession.deleteMany({ where: { userId } });

    // 5. 标记 DELETED
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        deletionExecutedAt: new Date(),
      },
    });

    // 6. 审计
    await tx.loginEvent.create({
      data: { userId, event: 'DELETION_EXECUTED', meta: {} },
    });
  }, { isolationLevel: 'Serializable' });
}
```

**保留不动**：Order / OrderItem / Invoice / RewardLedger / VipTreeNode / ReferralLink / CompanyStaff(role!=OWNER)

## 买家 App 前端

### 入口

- **设置页**（`app/settings.tsx`）→ 「账号安全」分组底部加红色文字「账号注销」
- 注销页路由 `app/me/deletion.tsx`

### 注销页设计（`app/me/deletion.tsx`）

```
┌─────────────────────────────────┐
│ ← 账号注销                       │
├─────────────────────────────────┤
│                                 │
│ 📋 账号注销须知                  │
│ ┌─────────────────────────────┐ │
│ │ （完整须知文案，可滚动）       │ │
│ │ [一、注销冷静期]              │ │
│ │ [二、订单与售后不受影响]      │ │
│ │ [三、虚拟资产即时清零]        │ │
│ │ ...                          │ │
│ └─────────────────────────────┘ │
│                                 │
│ 💰 您当前的虚拟资产              │
│ ┌─────────────────────────────┐ │
│ │ 钱包余额        ¥45.20      │ │
│ │ 消费积分           1,238    │ │
│ │ 平台红包             3 个   │ │
│ │ 冻结中分润       ¥120.00    │ │
│ │ 未消费抽奖名额        2     │ │
│ │ ⚠️ 上述资产将全部清零归平台   │ │
│ └─────────────────────────────┘ │
│                                 │
│ 📦 进行中事项（不受影响）        │
│ ┌─────────────────────────────┐ │
│ │ • 2 单待发货订单将正常发货    │ │
│ │ • 1 个进行中售后将继续受理    │ │
│ └─────────────────────────────┘ │
│                                 │
│ ☐ 我已阅读并同意上述全部内容      │
│                                 │
│ ┌─────────────────────────────┐ │
│ │      下一步：身份核验         │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### 身份核验页（同页 step 2）

**手机号绑定者（identityVerify=SMS）**：

```
┌─────────────────────────────────┐
│ ← 身份核验                       │
├─────────────────────────────────┤
│                                 │
│ 为确认是您本人操作，请输入        │
│ 138****1234 收到的短信验证码     │
│                                 │
│ [_ _ _ _ _ _]                  │
│                                 │
│ [发送验证码 (60s)]              │
│                                 │
│ ⚠️ 提交后账号将立即进入注销冷静期 │
│                                 │
│ ┌─────────────────────────────┐ │
│ │         确认提交注销          │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**仅微信绑定者（identityVerify=WECHAT_MODAL）**：

```
┌─────────────────────────────────┐
│ ← 身份核验                       │
├─────────────────────────────────┤
│                                 │
│ 您的账号仅绑定微信，请手动输入    │
│ 「确认注销」四字以证明是您本人    │
│                                 │
│ [______________]                │
│                                 │
│ ⚠️ 提交后账号将立即进入注销冷静期 │
│                                 │
│ ┌─────────────────────────────┐ │
│ │         确认提交注销          │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### 注销成功页（同页 step 3）

```
┌─────────────────────────────────┐
│ ✅ 注销申请已提交                 │
├─────────────────────────────────┤
│                                 │
│ 您的账号将于                    │
│      2026-06-25 02:00          │
│        正式注销                  │
│                                 │
│ 在此之前您可登录爱买买           │
│ 通过【设置 → 撤销注销】恢复账号    │
│                                 │
│ ┌─────────────────────────────┐ │
│ │      退出 App 并关闭          │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### 冷静期登录拦截

`app/(tabs)/_layout.tsx` 或 `app/(tabs)/me.tsx` 顶部：检测 `userProfile.deletionRequestedAt != null` → 红色横幅

```
┌─────────────────────────────────┐
│ ⚠️ 您的账号将于 2026-06-25 注销   │
│              [撤销注销]          │
└─────────────────────────────────┘
```

点「撤销注销」→ 二次确认弹窗 →  POST `/me/deletion/cancel` → 横幅消失。

## 法律对照表

| 法条 | 要求 | 本方案对应 |
|------|------|----------|
| 《个人信息保护法》§47 | 提供注销渠道 | ✅ 设置页入口 |
| 《个人信息保护法》§15 | 用户可撤回同意 | ✅ 已有 / 与本功能正交 |
| 《电子商务法》§31 | 交易记录保留 3 年 | ✅ Order / OrderItem / Payment 不删 |
| 《税收征管法》 + 发票管理 | 发票数据保留 5 年 | ✅ Invoice 不删 |
| 《网络安全法》§21 | 网络日志保留 6 个月 | ✅ LoginEvent 不删 |
| 工信部 App 规定 §22 | 15 个工作日内处理 | ✅ 30 天延迟 + cron 自动执行 |
| 《消费者权益保护法》§24 | 退款权利 | ✅ 已支付订单继续履约不剥夺退货退款权 |

## 注销须知文案（最终版，写入前端硬编码 + 隐私政策附录）

> ### 账号注销须知
>
> 为保障您的合法权益，请在提交账号注销申请前仔细阅读以下条款，提交即视为您已知悉并同意以下全部内容。
>
> **一、注销冷静期**
> 您的注销申请提交后，账号将进入 **30 天注销冷静期**。冷静期内，您仍可正常登录爱买买并随时撤回注销申请。冷静期内若有登录、消费、申请售后等操作，视为您仍在正常使用账号。冷静期结束后，注销将正式生效，账号将无法恢复。
>
> **二、订单与售后不受影响**
> 您账号下已支付的订单将正常履约发货，不会因注销申请而被取消，商家与物流仍可使用您的收货信息完成配送。进行中的售后/退换货申请将依据《消费者权益保护法》正常处理，不会因注销而中止。
>
> **三、虚拟资产即时清零**
> 提交注销申请的瞬间，下列虚拟资产将立即清零，**不予退还或兑现**：
>
> 1. 钱包余额与消费积分；
> 2. 平台红包与已绑定但未使用的优惠券；
> 3. 抽奖中奖名额与未消费的 VIP 礼包；
> 4. 待发放或冻结中的分润奖励。
>
> 上述虚拟资产基于平台运营规则发放，根据《用户协议》约定，注销账号视为自愿放弃。
>
> **四、VIP 推荐关系处理**
> 如您是 VIP 用户，您在推荐树中的节点位置将予以保留，您所推荐用户的分润链路不受影响。但您账号上未发放、待发放或冻结中的分润将不再发放给您，全部由平台统一处理。
>
> **五、关联功能将终止**
> 注销正式生效后：
>
> 1. 您将无法使用本账号登录爱买买的任何端口（App、小程序、网页）；
> 2. 您关注的商家、收藏的商品、收货地址、发票抬头将被清除；
> 3. AI 对话记录、客服会话历史将被清除；
> 4. 推荐码将永久失效，他人无法再通过您的推荐码加入。
>
> **六、数据保留与清除**
> 我们将在注销正式生效后 **15 个工作日内**清除您的个人资料、设备信息、行为日志等可删除数据。但根据法律法规要求，下列数据将依法保留：
>
> 1. 依据《中华人民共和国电子商务法》第三十一条，您的订单及交易记录保留 **3 年**；
> 2. 依据《中华人民共和国税收征收管理法》及发票管理相关规定，发票数据保留 **5 年**；
> 3. 依据《中华人民共和国网络安全法》第二十一条，网络日志（登录 IP、设备指纹等）保留 **6 个月**。
>
> **七、注销前置条件**
> 您当前账号需满足以下条件才能成功提交注销：
>
> 1. 您不是某商户的创始人（OWNER）：商户创始人需先在卖家后台完成企业所有权转让或注销企业；
> 2. 您通过身份核验：手机号绑定的用户需通过短信验证码确认，仅微信绑定的用户需通过弹窗二次确认。
>
> **八、其他**
>
> 1. 注销账号不能免除您此前因使用本平台所应承担的法律责任；
> 2. 如您在注销期间收到本平台或商家的退款、赔偿或其他款项，将无法到账；
> 3. 注销操作一经正式生效不可恢复，请您在提交前再三确认。
>
> ⚠️ **请确认您已阅读并理解上述全部内容。**

## 边缘场景

| 场景 | 处理 |
|------|------|
| 用户冷静期内死亡 / 失联 | 30 天到期后照常 cron 清除 |
| 冷静期内被风控封禁（status→BANNED） | cron 跳过（只处理 status=ACTIVE 的用户） |
| 冷静期内手机号变更 | 不允许（绑定接口检测到 deletionRequestedAt != null 时返回 409） |
| 同一手机号注销后重新注册 | cron 把 identifier 改为 `deleted:${userId}` 释放该号；新用户走全新注册流程，新建 User |
| 注销期间收到分润（来自下级新购买） | VIP 分润计算改造已跳过该节点，份额归平台，不会到注销账号 |
| 冷静期内试图下单 / 售后 | 后端写操作检测 deletionRequestedAt → 返回 409 提示「您处于注销冷静期，请先撤销注销」 |
| Cron 单次失败 | 事务回滚，下次扫描重试；连续 3 次失败发告警邮件 |
| OWNER 未转让强行注销 | preview API 返回 blocker，request API 二次校验阻断 |

## 不做（v1.0 范围外）

- ❌ 数据导出（GDPR 风格，可选合规）
- ❌ 注销后再注册的"老用户优惠"
- ❌ 商家通知（未发货订单的商家不知道用户在注销）
- ❌ 邮件回执 / 短信回执
- ❌ 注销原因调研问卷
- ❌ 卖家后台员工注销（只做买家 App 端）

## 与现有功能的关系

- **账号身份绑定**（`feat(app/me + backend/auth) fc760bf`）：注销期间禁止绑定/换绑，bind 接口加 deletionRequestedAt 检查
- **推荐码系统**：注销用户的推荐码失效，但已绑定的下级关系保留
- **VIP 系统**：节点保留，分润归平台（详见上方"VIP 分润计算改造"）
- **隐私同意撤回**（`feat(app/settings) c739476`）：与本功能正交，撤回隐私同意 ≠ 注销账号，互不影响

## 上线后监控

- Grafana 看板加：每日新增注销申请数、撤销率、cron 执行成功率
- 异常告警：cron 单次 batch 失败率 > 5% → 告警邮件
- 数据备份：cron 执行前 dump 用户表（可恢复 1 周）
