# H5 邀请页微信辅助登录设计方案

> 状态：设计确认，待实施计划
> 创建时间：2026-07-08
> 基线代码：`origin/staging` @ `9d2bdca1`
> 适用范围：官网 H5 邀请页 / 后端 Auth / 微信登录 / H5 推荐绑定
>
> **For agentic workers:** 本文档是 `2026-07-08-h5-invite-auth-binding-design.md` 的补充。已确认 H5 邀请页采用“手机号验证码优先，微信登录辅助”的界面方向。微信登录只新增授权入口和身份解析，不新建第二套用户体系，登录成功后必须复用 `InviteH5Service.bindAfterAuth()` 完成推荐关系处理。

## 1. 背景

H5 邀请注册登录第一版已经支持：

```text
扫码进入 H5 -> 手机号验证码登录/注册 -> 自动绑定推荐关系 -> 以后用同手机号登录 App
```

现在补充需求是：H5 页面也要支持微信登录，体验上类似 App 登录页，但 H5 不能直接复用 App 原生微信 SDK。H5 必须走微信服务号网页授权，后端拿到网页授权 `code` 后换取 `openid/unionId`，再进入现有买家账号体系。

产品确认后的界面方向：

- 主推荐路径仍是手机号验证码。
- 微信登录作为辅助入口放在手机号表单下方。
- 页面不展示推荐人信息。
- 手机号和微信两种登录方式最终都应复用同一个推荐绑定逻辑。

## 2. 目标

1. H5 邀请页首屏保持“手机号登录”为主标题。
2. 手机号、验证码和“登录并绑定”按钮是页面主路径。
3. 下方增加“微信登录”辅助按钮。
4. 微信登录成功后自动登录或注册买家账号。
5. 微信登录成功后立即按扫码来源绑定推荐关系。
6. 已绑定其他推荐关系时不覆盖，提示“已绑定推荐关系，无法覆盖”。
7. 后续下载 App 后，用同一手机号或同一微信身份登录，应读取到已经存在的推荐关系。
8. H5 页面必须响应式适配手机、平板和电脑，不允许表单溢出、按钮文字挤压或首屏内容不可滚动。

## 3. 非目标

- 不把微信登录放到主按钮位置。
- 不要求微信登录后立刻强制补手机号。
- 不展示推荐人昵称、头像、手机号、买家编号或身份。
- 不新增一套 H5 用户表。
- 不把推荐绑定逻辑复制到 H5 controller 中。
- 不改变普通分享码、VIP 推荐码、收益、入树或成长奖励规则。

## 4. 用户界面

最终 H5 页面采用手机号优先布局：

```text
爱买买
手机号登录

邀请通道已识别

昵称（选填）
手机号
验证码 + 获取验证码

[登录并绑定]

也可以使用

[微信登录]
```

交互口径：

- 用户扫码进入页面时，先调用 `/invite-h5/landing` 记录打开事件。
- `landingState=ready` 时显示“邀请通道已识别”。
- `landingState=unverified` 时仍允许登录，但登录后不会绑定无效推荐码。
- 首屏不提前展示“自动记录推荐关系 / 已有关系不覆盖”等后台规则说明；绑定结果只在提交后提示。
- 微信登录按钮在微信内打开时发起网页授权。
- 非微信浏览器点击微信登录时，提示“请在微信中打开，或使用手机号登录”。
- 微信授权失败时，保留当前页面状态，提示用户改用手机号验证码。

视觉原则：

- 保持当前绿色农业电商调性。
- 不做营销落地页，不放大促文案。
- 页面像正常登录页，不让被推荐人感觉被强制加入某个推荐人。

响应式规则：

- 手机窄屏（约 320-430px）：单列布局，表单宽度为 `100%`，左右安全留白 16-20px，验证码输入和“获取验证码”按钮保持同一行；如果小屏或大字体导致挤压，验证码行允许降级为上下两行。
- 平板竖屏 / 小桌面：登录面板居中，最大宽度控制在 480px 左右，不把输入框拉满整屏。
- 桌面宽屏：页面仍以居中登录面板为主，可增加背景留白或轻量品牌区域，但不能做成营销页，也不能展示推荐人信息。
- 页面高度不足时必须允许纵向滚动，避免键盘、浏览器工具栏或小屏设备遮挡“登录并绑定”和“微信登录”按钮。
- 字号不随视口宽度缩放；按钮和输入框使用稳定高度，长文案通过换行或收紧文案处理，不用负字距。
- 验收视口至少覆盖：`320x568`、`375x667`、`390x844`、`768x1024`、`1024x768`、`1440x900`。

## 5. 微信授权方式

H5 微信登录使用微信服务号网页授权，不使用 App 原生 OpenSDK。

推荐授权链路：

```text
H5 点击“微信登录”
  -> GET /api/v1/auth/h5-wechat/start?inviteCode=...&landingSessionId=...
  -> 后端生成带签名的 state，并 302 到微信 oauth2/authorize
  -> 微信授权后回跳 H5 /invite/{code}?wechatCode=...&state=...
  -> H5 调 POST /api/v1/auth/h5-wechat/invite-login
  -> 后端校验 state，换取 openid/unionId
  -> 复用微信登录内部逻辑找到或创建用户
  -> 复用 InviteH5Service.bindAfterAuth()
  -> 返回 token + inviteBinding
```

不把 App access token 或 refresh token 放进 URL。URL 中只允许出现微信一次性 `code` 和后端签名 `state`。

## 6. 后端接口

### 6.1 发起 H5 微信授权

```http
GET /api/v1/auth/h5-wechat/start?inviteCode=S8K6M2Q9&landingSessionId=ih5_xxx
```

行为：

- 校验 `inviteCode` 格式。
- 校验 `landingSessionId` 长度和格式。
- 生成短期签名 `state`，包含：
  - `inviteCode`
  - `landingSessionId`
  - `nonce`
  - `iat`
- 拼接微信服务号网页授权 URL。
- 302 跳转到微信授权地址。

微信授权 scope：

```text
snsapi_userinfo
```

原因：第一版需要尽量拿到 `unionId`，减少 H5 微信身份和 App 微信身份分裂。

### 6.2 H5 微信邀请登录

```http
POST /api/v1/auth/h5-wechat/invite-login
```

请求：

```json
{
  "wechatCode": "wx-code-from-query",
  "state": "signed-state",
  "inviteCode": "S8K6M2Q9",
  "landingSessionId": "ih5_xxx"
}
```

响应沿用 `/auth/invite-login` 的形状：

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "userId": "user-id",
  "loginMethod": "wechat",
  "inviteBinding": {
    "status": "BOUND",
    "type": "NORMAL_SHARE",
    "message": "推荐关系已记录"
  }
}
```

状态处理：

| 场景 | 页面提示 |
|---|---|
| 本次成功绑定 | 推荐关系已记录 |
| 已绑定同一推荐人 | 推荐关系已记录 |
| 已绑定其他推荐人 | 已绑定推荐关系，无法覆盖 |
| 自己扫自己的码 | 不能绑定自己的推荐码 |
| 邀请码无效 | 推荐码无效，未绑定推荐关系 |
| 微信授权失败 | 微信授权失败，请使用手机号登录 |

## 7. 身份复用

现有 `AuthIdentity` 已有字段：

```text
provider
identifier
unionId
appId
```

微信登录内部逻辑应调整为统一入口：

```ts
loginOrCreateWechatUser(profile)
```

`profile` 包含：

```ts
{
  openId: string;
  unionId?: string;
  appId: string;
  appType: 'MOBILE_APP' | 'H5_SERVICE_ACCOUNT';
  nickname?: string;
  avatarUrl?: string;
}
```

匹配顺序：

1. 如果有 `unionId`，优先查 `AuthIdentity.provider=WECHAT AND unionId=...`。
2. 如果没命中，再查 `provider=WECHAT AND identifier=openId AND appId=...`。
3. 如果命中用户，确认用户仍是 `ACTIVE`，然后签发 token。
4. 如果没命中，创建新用户、`UserProfile`、`MemberProfile`、`NormalShareProfile`、`GrowthAccount` 和 `AuthIdentity`。
5. 创建 `AuthIdentity` 时，`identifier=openId`，`unionId` 和 `appId` 必须写入专门字段，不只放在 `meta`。

这样 H5 服务号和 App 移动应用只要绑定在同一个微信开放平台账号下，就能尽量通过 `unionId` 识别为同一用户。

## 8. 推荐绑定复用

H5 微信登录成功后不得自己实现推荐绑定。

必须调用：

```ts
InviteH5Service.bindAfterAuth({
  userId,
  inviteCode,
  landingSessionId,
})
```

原因：

- 普通分享码和 VIP 推荐码解析逻辑已经集中在 `InviteH5Service`。
- 已绑定不覆盖、自邀请、无效码、冲突码等状态已经统一处理。
- H5 漏斗统计依赖 `landingSessionId` 更新 `authedUserId`、`bindingStatus` 和 `boundAt`。

## 9. 配置

新增配置建议：

```env
WECHAT_H5_APP_ID=
WECHAT_H5_APP_SECRET=
WECHAT_H5_AUTH_REDIRECT_BASE=https://app.ai-maimai.com/invite
WECHAT_H5_AUTH_STATE_SECRET=
```

后端发起授权时按当前邀请码拼出完整回跳地址：

```text
https://app.ai-maimai.com/invite/{inviteCode}
```

部署前要求：

- 服务号必须已认证并支持网页授权。
- H5 域名必须配置到微信公众平台网页授权域名。
- 服务号和 App 移动应用应绑定到同一个微信开放平台账号，以保证 `unionId` 统一。

## 10. 测试验收

后端测试：

- `h5-wechat/start` 生成微信授权 URL，state 包含 invite 信息且不可篡改。
- `h5-wechat/invite-login` 校验 state 后调用微信 code exchange。
- 微信登录按 `unionId` 优先命中已有用户。
- 没有已有身份时创建完整买家账号资料。
- 微信登录后调用 `InviteH5Service.bindAfterAuth()`。
- 已绑定其他推荐人时不覆盖。
- 微信授权失败时返回可读错误。

网站测试：

- H5 页面主标题仍是“手机号登录”。
- 手机号验证码表单在微信按钮上方。
- 微信登录按钮存在，但不是主按钮。
- 非微信浏览器点击微信登录给出提示。
- 微信 callback query 存在时会调用 H5 微信邀请登录接口。
- 登录成功后展示绑定状态，并出现“下载 App”按钮。
- 响应式检查覆盖手机、平板、桌面视口；任何视口下输入框、验证码按钮、主按钮、微信登录按钮都不能横向溢出或互相遮挡。

集成验收：

1. 普通用户展示 H5 邀请码，被推荐人用手机号登录，绑定成功。
2. 普通用户展示 H5 邀请码，被推荐人用微信登录，绑定成功。
3. VIP 用户展示 H5 邀请码，被推荐人用手机号登录，绑定成功。
4. VIP 用户展示 H5 邀请码，被推荐人用微信登录，绑定成功。
5. 已绑定 A 的用户扫 B 的码，用微信登录后不覆盖。
6. 同一微信在 H5 和 App 登录时，如果有 `unionId`，命中同一用户。

## 11. 风险与边界

- 如果服务号和移动应用没有绑定到同一个微信开放平台账号，`unionId` 可能无法统一，H5 微信账号和 App 微信账号会分裂。
- 如果 H5 微信登录创建了微信-only 用户，用户以后只用手机号登录，仍可能是另一个账号；后续可在 App 内通过“绑定手机号/绑定微信”做账号合并引导。
- 如果微信网页授权配置不完整，微信登录入口必须优雅失败，不能阻塞手机号主流程。
- 推荐绑定仍以后台真实绑定结果为准，H5 打开记录不作为奖励依据。

## 12. 确认结论

采用“手机号优先，微信辅助”的 H5 邀请页：

- 页面主标题和主按钮围绕手机号验证码。
- 微信登录在手机号表单下方，作为便利入口。
- 微信授权使用 H5 服务号网页授权。
- 账号查找和创建复用买家 Auth 内部逻辑。
- 推荐关系绑定复用 `InviteH5Service.bindAfterAuth()`。
