# H5 邀请注册登录与推荐绑定设计方案

> 状态：已实现，待 Staging 联调/真机验收
> 创建时间：2026-07-08
> 基线代码：`origin/staging` @ `dedfa1f9`
> 适用范围：官网 H5 / 买家 App 推荐中心 / 后端 Auth / 普通分享 / VIP 推荐 / 推荐统计
>
> **For agentic workers:** 本文档是“H5 扫码后手机号验证码注册/登录并立即绑定推荐关系”的权威来源。必须基于 `origin/staging` 当前已有的 `normal-share`、`growth`、VIP 推荐码和 `/s/:code` 落地页实现，不要依据本地落后的 `staging` 工作区判断能力边界。

## 1. 背景

现场推广、会议推广和线下获客时，现有“扫码 -> 下载 App -> 注册/登录 -> 读取剪贴板或指纹归因 -> 绑定推荐关系”链路太慢，且受网络、应用商店、安装权限、机型和用户耐心影响。推广人一次可能要面对十个到一百个被推荐人，不能要求每个人当场下载 App。

现在 `origin/staging` 已经具备两套推荐入口：

1. 普通用户拥有 `NormalShareProfile.code`，分享链接为 `/s/{code}`，绑定走 `normal-share/bind`。
2. VIP 用户拥有 `MemberProfile.referralCode`，分享链接为 `/r/{code}`，绑定走 `bonus/referral`。

但官网 H5 当前仍以“打开 / 下载 App”为主，不能在网页上直接完成手机号验证码注册/登录并立即绑定推荐关系。

本设计补齐一条短链路：

```text
App 用户展示二维码
  -> 被推荐人扫码进入 H5 注册/登录页
  -> 手机号 + 短信验证码登录或自动注册
  -> 后端按邀请码类型绑定推荐关系
  -> 被推荐人以后下载 App，用同手机号登录即可看到已绑定关系
```

本功能的核心验收口径是：被推荐人扫码后不需要先下载 App，也不需要下载后再次扫码。只要他在 H5 页面用手机号验证码完成注册或登录，后台就应立即完成推荐关系处理；之后同手机号登录 App 时，App 只是读取已经存在的关系。

## 2. 核心结论

第一版新增 **H5 邀请注册登录承接页** 和 **H5 邀请登录接口**。

产品口径：

- 对用户只说“推荐码 / 邀请码”，不区分普通分享码和 VIP 推荐码。
- 扫码后 H5 不展示推荐人信息，只展示正常注册/登录表单。
- H5 使用手机号 + 短信验证码，不能无验证码绑定正式账号。
- 登录成功后立即尝试绑定推荐关系；如果该账号此前没有推荐关系，则绑定到当前推荐人。
- 如果该账号此前已经绑定推荐关系，则不覆盖，并明确提示“已绑定推荐关系，无法覆盖”。
- 推荐人可看到扫码打开人数、成功登录/注册人数、成功绑定人数。

代码口径：

- 不新增第二个可见码。
- 普通用户继续使用 `NormalShareProfile.code`。
- VIP 用户继续使用 `MemberProfile.referralCode`。
- 新增统一 H5 解析层，根据 code 命中普通码或 VIP 码后调用对应绑定规则。
- 不把普通分享码塞进 `useReferralCode()`，也不把 VIP 推荐码塞进 `normal-share/bind`。

## 3. 非目标

第一版不做以下内容：

- 不把整个 App 搬到网站上。
- 不做 H5 商品浏览、购物车、下单或支付。
- 不展示推荐人昵称、手机号、买家编号或头像。
- 不允许无短信验证码的正式注册/登录。
- 不允许已绑定推荐关系的账号被 H5 重新换绑。
- 不改变普通分享码和 VIP 推荐码的现有收益、入树和升级规则。
- 不改变 `/download` 的 App 下载分发机制。
- 不把 H5 访问记录当作资金奖励依据，奖励仍以正式绑定、订单和既有规则为准。

## 4. 现有代码边界

### 4.1 普通分享体系

`NormalShareService.getMe()` 会给普通用户生成或返回 `NormalShareProfile.code`，`shareUrl` 当前为：

```text
https://app.ai-maimai.com/s/{code}
```

`NormalShareService.bind(inviteeUserId, { code, source })` 负责普通分享绑定：

- 被邀请人不能是 VIP。
- 分享码必须存在且启用。
- 邀请人必须是 ACTIVE 且未注销。
- 邀请人不能是 VIP。
- 不能绑定自己。
- 已有不同推荐关系时拒绝换绑。
- 绑定成功后创建 `NormalShareBinding`，并触发 `NORMAL_INVITE_REGISTER` 成长奖励。

### 4.2 VIP 推荐体系

`BonusService.useReferralCode(userId, code)` 仍是 VIP 推荐绑定入口：

- code 必须命中 `MemberProfile.referralCode`。
- 推荐人必须是 VIP。
- 推荐人必须是 ACTIVE 且未注销。
- 被推荐人如果已是 VIP，不能再更换推荐人。
- 已有冲突推荐关系时拒绝换绑。
- 成功后写入 `ReferralLink` 和 `MemberProfile.inviterUserId`。

### 4.3 H5 落地页

`website/src/pages/NormalShareLanding.tsx` 当前用于 `/s/:code`，主要行为是：

- 记录普通分享 deferred link。
- 复制普通分享口令。
- 打开或下载 App。

它不是注册/登录页面。

## 5. 用户流程

### 5.1 推荐人侧

买家 App 推荐中心继续作为二维码入口。

第一版推荐把二维码目标统一改为：

```text
https://app.ai-maimai.com/invite/{code}
```

其中 `{code}` 来自当前用户已有推荐身份：

- 普通用户：`NormalShareProfile.code`。
- VIP 用户：`MemberProfile.referralCode`。

App 页面可以继续显示同一个“推荐码 / 邀请码”文案。普通和 VIP 的收益说明仍按现有推荐中心区分。

### 5.2 被推荐人侧

被推荐人扫码进入 H5：

1. 页面不展示推荐人信息。
2. 页面显示爱买买 Logo、手机号、验证码、昵称或姓名可选输入框。
3. 用户点击“获取验证码”，调用现有短信验证码接口。
4. 用户提交后，调用 H5 邀请登录接口。
5. 如果账号此前没有推荐关系，成功后显示：

```text
登录成功，推荐关系已记录
```

6. 如果账号此前已经绑定其他推荐关系，成功后显示：

```text
登录成功，你已绑定推荐关系，本次不覆盖
```

7. 页面提供“下载 App”按钮；用户可以立即下载，也可以以后再下载。
8. 用户以后用同手机号登录 App，推荐关系已经在后台存在。

## 6. 推荐码解析

新增统一解析能力，命名建议：

```text
InviteCodeResolver
```

解析顺序不依赖前缀，而依赖数据库：

1. 查 `NormalShareProfile.code`。
2. 查 `MemberProfile.referralCode`，但只有 `MemberProfile.tier = VIP` 时才视为 VIP 推荐码。
3. 两边都没有命中则返回 `INVALID`。
4. 理论上两边不应同时命中，因为现有生成工具会跨表查重；如果历史数据出现冲突，返回 `CONFLICT` 并拒绝绑定，写告警日志。

注意：当前 `origin/staging` 的注册路径会给普通用户也创建 `MemberProfile.referralCode`，但普通用户对外传播和 H5 绑定必须使用 `NormalShareProfile.code`。普通用户隐藏的 `MemberProfile.referralCode` 不能被 `/invite/{code}` 识别为可绑定邀请码。

解析结果：

```ts
type InviteCodeResolveResult =
  | { type: 'NORMAL_SHARE'; code: string; inviterUserId: string }
  | { type: 'VIP_REFERRAL'; code: string; inviterUserId: string }
  | { type: 'INVALID'; code: string }
  | { type: 'CONFLICT'; code: string };
```

状态校验必须复用对应体系的业务规则：

- 普通分享码：使用 `NormalShareService.bind()` 的校验。
- VIP 推荐码：使用 `BonusService.useReferralCode()` 的校验。

统一解析层只负责识别类型和统计，不绕过业务校验。

## 7. 后端接口

### 7.1 发送验证码

复用现有接口：

```http
POST /api/v1/auth/sms/code
```

参数：

```json
{
  "phone": "13800000000"
}
```

短信仍使用 `SmsPurpose.LOGIN`，沿用现有限流。

### 7.2 H5 邀请登录

新增公开接口：

```http
POST /api/v1/auth/invite-login
```

请求：

```json
{
  "phone": "13800000000",
  "code": "123456",
  "name": "张三",
  "inviteCode": "S8K6M2Q9",
  "landingSessionId": "optional-session-id"
}
```

字段规则：

| 字段 | 规则 |
|---|---|
| `phone` | 必填，中国大陆手机号 |
| `code` | 必填，短信验证码 |
| `name` | 可选，最多 50 字；只在自动注册新账号时作为昵称 |
| `inviteCode` | 必填，8 位普通分享码或 VIP 推荐码 |
| `landingSessionId` | 可选，用于关联页面打开统计 |

响应：

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": {
    "id": "user-id",
    "buyerNo": "AIMM00000000000001"
  },
  "inviteBinding": {
    "status": "BOUND",
    "type": "NORMAL_SHARE",
    "message": "推荐关系已记录"
  }
}
```

`inviteBinding.status` 枚举：

| 状态 | 含义 |
|---|---|
| `BOUND` | 本次成功绑定 |
| `ALREADY_BOUND_SAME` | 此账号此前已绑定同一推荐人，幂等成功 |
| `ALREADY_BOUND_OTHER` | 此账号此前已绑定其他推荐人，本次不覆盖 |
| `SELF_INVITE` | 不能绑定自己的码 |
| `INVALID_CODE` | 邀请码无效、停用、推荐人注销或不可用 |
| `NOT_ELIGIBLE` | 当前账号身份不允许该码类型，例如 VIP 用户使用普通分享码 |
| `ERROR` | 非预期失败；账号登录仍成功，绑定待用户重试或客服处理 |

登录注册结果和绑定结果必须分开表达：验证码正确时，登录/注册成功不应因为邀请码无效而整体失败。

### 7.3 页面打开统计

新增公开接口：

```http
POST /api/v1/invite-h5/landing
```

请求：

```json
{
  "inviteCode": "S8K6M2Q9",
  "path": "/invite/S8K6M2Q9",
  "userAgent": "...",
  "screenWidth": 390,
  "screenHeight": 844,
  "language": "zh-CN"
}
```

响应：

```json
{
  "landingSessionId": "ih5_xxx",
  "codeStatus": "VALID"
}
```

该接口只用于统计扫码打开，不返回推荐人信息。

## 8. 后端服务设计

### 8.1 AuthService 改造

新增 `inviteLogin(dto)`，不要让 H5 页面自己组合多个接口。

建议内部拆出可复用方法：

```ts
private async loginOrAutoRegisterByPhoneCode(input: {
  phone: string;
  code: string;
  name?: string;
  source: 'APP' | 'H5_INVITE';
}): Promise<AuthSession>
```

用途：

- 复用现有短信验证码校验。
- 已注册手机号走登录。
- 未注册手机号自动创建 User、UserProfile、MemberProfile、GrowthAccount、NormalShareProfile、AuthIdentity。
- 新用户昵称使用 `name || '新用户'`。
- 继续触发 `REGISTER` 红包和 `REGISTER` 成长事件。

`inviteLogin()` 在账号登录成功后调用 `InviteBindingService.bindAfterAuth(userId, inviteCode, landingSessionId)`。

### 8.2 InviteBindingService

新增服务：

```text
backend/src/modules/auth/invite-binding.service.ts
```

或放入独立模块：

```text
backend/src/modules/invite-h5/
```

推荐独立模块，因为它同时接入 Auth、NormalShare、Bonus 和统计。

职责：

1. 解析邀请码类型。
2. 记录页面打开、登录成功、绑定成功或失败。
3. 普通码调用 `NormalShareService.bind(userId, { code, source: 'LANDING' })`。
4. VIP 码调用 `BonusService.useReferralCode(userId, code)`。
5. 把异常归一化为 `inviteBinding.status`，不泄漏内部错误。

### 8.3 模块依赖

推荐：

```text
InviteH5Module
  imports:
    NormalShareModule
    BonusModule
    AuthModule? 不直接 import，避免循环
```

更稳的落地方式：

- `AuthModule` import `NormalShareModule` 和 `BonusModule`。
- `AuthService.inviteLogin()` 直接注入 `NormalShareService` 和 `BonusService`。
- 页面打开统计接口放在 `AuthController` 或轻量 `InviteH5Controller`。

实施时如出现模块循环，再把 `InviteCodeResolver` 和统计服务拆到独立 `InviteH5Module`，由 AuthModule 单向依赖它。

## 9. 数据设计

推荐新增页面访问统计表：

```prisma
model InviteH5LandingEvent {
  id               String   @id @default(cuid())
  inviteCode       String
  inviteType       String?  // NORMAL_SHARE / VIP_REFERRAL / INVALID / CONFLICT
  inviterUserId    String?
  landingSessionId String   @unique
  ipAddress        String
  userAgent        String
  screenInfo       String?
  language         String?
  openedAt         DateTime @default(now())
  authedUserId     String?
  authedAt         DateTime?
  bindingStatus    String?
  bindingType      String?
  boundAt          DateTime?
  errorCode        String?

  @@index([inviteCode, openedAt])
  @@index([inviterUserId, openedAt])
  @@index([authedUserId])
}
```

说明：

- 该表不参与资金结算。
- `ipAddress` 和 `userAgent` 只用于统计、风控和排查，后台默认不展示原文。
- 成功绑定仍以 `NormalShareBinding` 或 `ReferralLink` 为权威关系表。
- 若不想第一版加表，也可以只做绑定，不做扫码数；但这会缺少“扫码打开人数”统计，和现场推广诉求不完全匹配。

## 10. 推荐人统计

推荐中心展示三类数：

| 指标 | 来源 |
|---|---|
| 扫码打开人数 | `InviteH5LandingEvent` 按 `inviterUserId` 去重或计数 |
| H5 登录/注册人数 | `InviteH5LandingEvent.authedUserId is not null`，按 H5 登录用户去重 |
| H5 已绑定人数 | `InviteH5LandingEvent.bindingStatus in (BOUND, ALREADY_BOUND_SAME)`，按 H5 登录用户去重；正式关系仍以 `NormalShareBinding` / `ReferralLink` 为准，但此漏斗不混入 App 内绑定、后台绑定或历史绑定 |

第一版可先做总数，不做复杂漏斗图。

隐私规则：

- 推荐人可以看到总数。
- 明细中手机号必须脱敏。
- H5 页面不展示推荐人信息。
- 被推荐人的姓名或昵称只在其账号资料或现有推荐明细允许范围内展示。

## 11. H5 页面设计

新增页面：

```text
website/src/pages/InviteAuthLanding.tsx
```

路由：

```tsx
<Route path="/invite/:code" element={<InviteAuthLanding />} />
```

页面结构：

1. 顶部：爱买买 Logo 和“手机号快捷登录”。
2. 表单：
   - 手机号。
   - 短信验证码。
   - 姓名/昵称，可选。
3. 主按钮：“登录 / 注册并继续”。
4. 成功态：
   - “登录成功，推荐关系已记录”。
   - “下载 App”按钮。
5. 失败态：
   - 验证码错误：明确提示并允许重试。
   - 推荐码无效：登录成功时提示“已登录，推荐码无效，未绑定推荐关系”。
   - 已绑定他人：提示“已登录，你已有推荐关系，本次不覆盖”。

视觉要求：

- 这是工具型注册页，不做营销落地页。
- 不展示推荐人昵称。
- 手机端首屏必须完整显示手机号、验证码和主按钮。
- 微信内置浏览器可直接使用，不要求“右上角浏览器打开”。
- 下载 App 是成功后的后续动作，不是首屏主动作。

兼容策略：

- 新二维码统一指向 `/invite/{code}`。
- 旧 `/s/{code}` 可以保留“打开 / 下载 App”能力，也可以改为重定向到 `/invite/{code}`，但要评估是否影响已发布物料。
- 旧 `/r/{code}` 建议第一版保留现状，避免破坏旧 VIP 下载归因链接；App 推荐中心新生成的 VIP 二维码改用 `/invite/{code}`。

## 12. 绑定规则

### 12.1 普通码

普通码绑定继续遵守 `NormalShareService.bind()`：

- 绑定后写 `NormalShareBinding`。
- 同步写 `MemberProfile.inviterUserId`。
- 触发普通成长注册奖励。
- 已绑定其他推荐关系时拒绝覆盖。
- VIP 用户不使用普通分享码。

H5 传入 `source='LANDING'`。

### 12.2 VIP 码

VIP 码绑定继续遵守 `BonusService.useReferralCode()`：

- 绑定后写 `ReferralLink`。
- 同步写 `MemberProfile.inviterUserId`。
- 已是 VIP 的被推荐人不允许补绑或换绑。
- 已绑定其他推荐关系时拒绝覆盖。
- 推荐人必须是可用 VIP。

### 12.3 登录和绑定的失败边界

验证码正确时，账号登录/注册成功优先。

绑定失败不回滚账号，原因：

- 邀请码可能失效。
- 用户可能已经绑定其他推荐人。
- 用户可能扫了自己的码。
- 推荐人可能注销或被封禁。

接口必须把绑定失败原因返回给 H5，但不让用户误以为登录失败。

## 13. 安全与风控

本改动涉及认证、推荐关系和奖励触发，实施时必须对照 `docs/issues/tofix-safe.md` 安全检查清单。

强制要求：

- 手机号正式登录/注册必须短信验证码。
- H5 邀请登录接口必须有 IP 限流和手机号维度登录尝试限流。
- 绑定关系写入必须使用 Serializable 事务，沿用 `NormalShareService.bind()` 和 `BonusService.useReferralCode()` 的事务规则。
- 已绑定关系不允许 H5 自动覆盖。
- 自己扫自己的码必须拒绝绑定。
- 注销、封禁、非 ACTIVE 推荐人不能被绑定。
- 页面打开统计不能作为发奖依据。
- 日志中手机号必须脱敏。

短信成本控制：

- 继续复用 `auth/sms/code` 的 1 分钟 IP 限流和手机号日限。
- H5 页面禁用连续点击发送验证码。
- 生产环境必须 `SMS_MOCK=false`，否则 H5 注册登录不可上线。

## 14. 测试计划

后端单测：

- `invite-login` 使用普通码，未注册手机号自动注册并创建 `NormalShareBinding`。
- `invite-login` 使用普通码，已注册手机号登录并绑定。
- `invite-login` 使用 VIP 码，未注册手机号自动注册并创建 `ReferralLink`。
- `invite-login` 使用普通用户隐藏的 `MemberProfile.referralCode` 时不绑定，返回 `INVALID_CODE` 或 `NOT_ELIGIBLE`。
- 已绑定其他推荐人时登录成功但返回 `ALREADY_BOUND_OTHER`。
- 自己扫自己的码时登录成功但返回 `SELF_INVITE`。
- 无效码登录成功但返回 `INVALID_CODE`。
- 推荐人注销或被封禁时返回 `INVALID_CODE`。
- 验证码错误时不创建账号、不绑定。
- 页面打开统计不返回推荐人信息。

前端测试：

- `/invite/:code` 首屏展示手机号、验证码、昵称和主按钮。
- 页面不渲染推荐人昵称、手机号或买家编号。
- 点击获取验证码调用 `/auth/sms/code`。
- 提交调用 `/auth/invite-login`。
- `BOUND` 成功态显示下载 App 按钮。
- `ALREADY_BOUND_OTHER` 显示不覆盖提示。
- 移动端 360px 宽度不溢出。

手工验收：

1. 普通用户 App 推荐中心展示二维码，被推荐人扫码后 H5 完成手机号验证码登录/注册，推荐人普通统计增加。
2. VIP 用户 App 推荐中心展示二维码，被推荐人扫码后 H5 完成手机号验证码登录/注册，VIP 推荐关系存在。
3. 被推荐人随后下载 App，用同手机号登录，推荐中心显示已绑定推荐关系。
4. 微信内扫码不要求下载 App 即可完成 H5 登录/注册。
5. 无效码、重复绑定、自己扫码都有明确提示。

## 15. 发布与回滚

发布顺序：

1. 后端先发布 `invite-login` 和统计接口。
2. 官网发布 `/invite/:code` 页面。
3. App OTA 或发版把推荐中心二维码目标切到 `/invite/{code}`。

回滚策略：

- 如果 H5 页面异常，App 可临时回退到旧 `/s/{code}` 和 `/r/{code}` 分享链接。
- 后端接口保留不影响旧 App。
- `InviteH5LandingEvent` 仅统计，不影响正式推荐关系，可安全保留。

## 16. 第一版默认决策

按本设计进入实施计划时，默认采用以下决策：

1. App 推荐中心立即把普通和 VIP 二维码都切到 `/invite/{code}`。
2. 旧 `/s/{code}` 和 `/r/{code}` 第一版继续保留现有下载/打开 App 能力，避免破坏已发布物料。
3. 推荐人端第一版展示扫码打开人数、H5 登录/注册人数和成功绑定人数。
4. H5 注册/登录成功后不把 token 持久化到浏览器 localStorage；第一版只显示成功态和下载引导，未来若做 H5 个人中心再另起设计。
