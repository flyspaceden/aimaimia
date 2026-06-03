# 忘记密码 / 找回密码设计方案

## 背景

2026-04-23 发现三端登录页（买家 App `src/components/overlay/AuthModal.tsx`、卖家后台 `seller/src/pages/login/index.tsx`、管理后台 `admin/src/pages/login/index.tsx`）均提供"手机号+密码"登录方式，但**都没有**"忘记密码"入口。后端也没有任何自助重置密码的 API——用户一旦忘密码只能联系管理员后台代改。

## 目标

1. **买家 App** 提供完整的自助忘记密码流程：手机号 → 图形验证码 → 短信验证码 → 新密码
2. **卖家后台** 提供自助忘记密码流程（多企业员工需先选定要重置的企业）
3. **管理后台** 不做自助找回（管理员数量少、风险高、攻击面大），登录页增加灰字提示"忘记密码请联系超级管理员"，已有的 `/admin/users/:id/reset-password` 端点即可满足需求；超级管理员 `admin` 本身的应急恢复走服务器 SQL，写入 `docs/operations/密码本.md`
4. 复用现有基础设施：`AliyunSmsService`、`SmsOtp`、`CaptchaModule`、bcrypt 加密、审计日志
5. **新增两个 `SmsPurpose` 枚举值**（`BUYER_RESET`、`SELLER_RESET`），彻底隔离买家/卖家验证码 scope，防止跨端串用

## 决策速查表（供实现时对齐）

| 决策点 | 结论 |
|---|---|
| 管理后台是否自助找回 | ❌ 否，登录页仅加提示文字 + 服务器端 SQL 应急流程 |
| 买家 App 是否加忘记密码 | ✅ 是 |
| 卖家后台是否加忘记密码 | ✅ 是（带"选择企业"步骤） |
| 密码复杂度 | ≥6 位，且**同时**包含大写字母、小写字母、数字（≥1 个） |
| 未注册手机号提示 | 在"忘记密码"页明确返回 `该手机号未注册`（登录页维持"账号或密码错误"不变） |
| 重置后旧会话处理 | 不强制踢出，现有 Session 保持，下次登录用新密码 |
| 图形验证码 | 买家 App + 卖家后台均在**发送短信前**强制图形验证码（复用 `CaptchaModule`） |
| 短信验证码 scope 隔离 | **新增** `SmsPurpose.BUYER_RESET` + `SELLER_RESET`，买家发的码卖家不认、反之亦然；原有 `RESET` 保留占位不使用 |
| 短信验证码节流 | 60 秒发送间隔、1 小时 5 次上限；**3 次输错作废**；限流计数和失败计数均按 purpose 隔离（如 Redis key `reset:fail:buyer:{phone}` / `reset:fail:seller:{phone}`） |
| verifyCode 签名 | **`purpose` 改为必填参数**，所有现有调用点显式传 `LOGIN`，reset 流程传 `BUYER_RESET` / `SELLER_RESET`（编译期强制约束，杜绝误匹配） |
| 买家端重置影响范围 | 仅更新 `AuthIdentity.meta.passwordHash`，不影响该用户的 `CompanyStaff.passwordHash`（三端独立方案 Y） |
| 卖家端重置影响范围 | **方案 β**：用户先选一个企业，只重置该企业的 `CompanyStaff.passwordHash`（现有"每家独立密码"架构保持不变，`loginByPassword` 无需改动） |
| 审计日志 | 复用现有 `LoginEvent` 表（`schema.prisma:711`，`auth.service.ts:707` 已在用），`meta.action='PASSWORD_RESET_VIA_SMS'` + scope + 卖家额外记 `staffId`/`companyId`。**不新增 schema**。 |

## 架构选型

**方案：独立的 `forgot-password` 子路径，两个端各自实现，且各用独立 SMS purpose**

- 买家端：`POST /api/v1/auth/forgot-password/send-code` + `POST /api/v1/auth/forgot-password/reset`（`SmsPurpose.BUYER_RESET`）
- 卖家端：`POST /api/v1/seller/auth/forgot-password/send-code` + `POST /api/v1/seller/auth/forgot-password/list-companies` + `POST /api/v1/seller/auth/forgot-password/reset`（`SmsPurpose.SELLER_RESET`）

为什么不做成共用一套接口按 scope 区分：
- 两端用不同密码字段（`AuthIdentity.meta.passwordHash` vs 多条 `CompanyStaff.passwordHash`），写入逻辑差异较大
- 两端注册关系判定不同：买家端 "存在 AuthIdentity" 即视为注册；卖家端需至少有一条 `CompanyStaff` 记录
- 两端复用各自已有的 `AuthService` / `SellerAuthService`，对齐原有风格成本更低
- **scope 隔离通过 SMS purpose 枚举值实现**（BUYER_RESET / SELLER_RESET），代码路径 + 数据层双重隔离

为什么卖家端多一个 `list-companies` 步骤：
- 方案 β：用户先用手机号+短信码证明身份，拿到该手机名下的企业列表，选定一家后再重置该企业员工密码
- 这样保留了"每家企业独立密码"的现有架构，`loginByPassword` 一行不改（避免改动导致回归风险）
- `list-companies` 对 OTP 执行**只读验证**（不消费 usedAt），真正的 CAS 消费放在 `reset` 步骤，防止 step 2 消费完 step 3 无法验证

不做成"重置同时影响两端"：架构上密码本就分离，越权改另一域容易埋安全隐患（买家 App 的 SMS 验证码能改掉商户后台密码并不直观）。每端走自己的忘记密码即可。

## 一、数据模型

### Schema 变更

```prisma
enum SmsPurpose {
  LOGIN
  BIND
  RESET          // 保留占位，当前无代码使用（保留防止旧数据/外部引用破裂）
  BUYER_RESET    // 新增：买家 App 忘记密码专用 scope
  SELLER_RESET   // 新增：卖家后台忘记密码专用 scope
}
```

Migration 风险：PostgreSQL `ALTER TYPE ... ADD VALUE`，零停机、零数据影响（当前 `RESET` 从未被使用，新增两个值不冲突）。

### 其他现有资产（无需改造）
- `AuthIdentity.meta.passwordHash`（买家密码）
- `CompanyStaff.passwordHash`（卖家密码，每个 staff 一条）
- `CompanyStaffStatus` 枚举：仅 `ACTIVE` / `DISABLED`（`schema.prisma:85-88`）——本次不新增值
- `SmsOtp`（新增 purpose 值后直接使用）
- `LoginEvent`（`schema.prisma:711-725`，带 `meta: Json?`，`auth.service.ts:707` 已在用）——忘记密码审计直接写入，`meta.action='PASSWORD_RESET_VIA_SMS'`

## 二、后端 API（买家端）

路由位置：`backend/src/modules/auth/auth.controller.ts`（在现有 login/sms/code 之后新增）

### 2.1 `POST /api/v1/auth/forgot-password/send-code`

**请求体**
```ts
{
  phone: string;         // 11 位手机号
  captchaId: string;     // /captcha 接口返回
  captchaCode: string;   // 用户在图片上识别的字符
}
```

**业务流程**（按序）
1. 校验 `captchaId` + `captchaCode`，失败返回 `400 图形验证码错误或已过期`
   - 验证**一次性**：验证后立刻作废（防重放）
2. 查询 `AuthIdentity { provider: 'PHONE', identifier: phone }`
3. 若不存在 → 返回 `404 { code: 'PHONE_NOT_REGISTERED', message: '该手机号未注册' }`
4. 检查限流（复用 `createOtpWithRateLimit` 模式，**限流 key 带 purpose 区分**）：
   - 同一手机号 × 同一 purpose 60 秒内不得重复发送
   - 同一手机号 × 同一 purpose 1 小时内不得超过 5 次
   - 同一 IP 1 小时内不得超过 10 次（已在全局 `@Throttle` 装饰器中）
5. 调用 `AliyunSmsService.send({ phone, template: 阿里云通用模板, params: { code } })` 发送 6 位数字验证码（5 分钟有效）
6. 插入 `SmsOtp { phone, purpose: 'BUYER_RESET', codeHash: bcrypt(code), expiresAt: now+5min, ip }`
7. 返回 `200 { success: true }`

**响应**
```ts
// 200
{ success: true }
// 400
{ code: 'CAPTCHA_INVALID', message: '图形验证码错误或已过期' }
// 404
{ code: 'PHONE_NOT_REGISTERED', message: '该手机号未注册' }
// 429
{ code: 'SMS_RATE_LIMIT', message: '发送过于频繁，请稍后再试' }
```

### 2.2 `POST /api/v1/auth/forgot-password/reset`

**请求体**
```ts
{
  phone: string;
  code: string;          // 6 位短信验证码
  newPassword: string;   // ≥6 位，含大小写字母和数字
}
```

**业务流程**（Serializable 事务）
1. 校验 `newPassword` 格式（服务端**必须**二次校验，前端校验不可信）
   - 正则：`/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/`
2. 验证 `SmsOtp`（**必须**调用 `verifyCode(phone, code, SmsPurpose.BUYER_RESET)`）
   - 查询该手机号最近 5 条 `purpose=BUYER_RESET`、`usedAt=null`、`expiresAt>now` 记录
   - 逐条 `bcrypt.compare` 匹配
   - 匹配失败：记录失败次数到 Redis `reset:fail:buyer:{phone}`（TTL 5 分钟），超过 3 次作废该手机号所有未使用的 `BUYER_RESET` OTP
   - 匹配成功：CAS 将 `usedAt = now()`（原子消费）
3. 查询 `AuthIdentity { provider: 'PHONE', identifier: phone }`，不存在返回 `400`
4. 生成 `newHash = bcrypt.hash(newPassword, 10)`
5. 更新 `AuthIdentity.meta = { ...meta, passwordHash: newHash }`
6. 写入审计日志到**现有 `LoginEvent` 表**（`schema.prisma:711`，已被 `auth.service.ts:707` 使用，无需新建表）：
   ```ts
   await tx.loginEvent.create({
     data: {
       userId: identity.userId,
       provider: 'PHONE',
       phone: dto.phone,
       success: true,
       ip, userAgent,
       meta: { action: 'PASSWORD_RESET_VIA_SMS', scope: 'BUYER' },
     },
   });
   ```
7. 返回 `200 { success: true }`

**响应**
```ts
// 200
{ success: true }
// 400
{ code: 'PASSWORD_FORMAT_INVALID' | 'OTP_INVALID' | 'OTP_EXPIRED' | 'PHONE_NOT_REGISTERED', message: '...' }
```

**注意**
- 不触发任何 Session 吊销（决策：不强踢旧会话）
- 不触发"首次注册红包"（此场景是已注册用户，不是新注册）
- 若目标账号此前没有 `passwordHash`（仅短信登录过），此流程相当于"首次设置密码"，不做阻拦

## 三、后端 API（卖家端 — 方案 β 三步流程）

路由位置：`backend/src/modules/seller/auth/seller-auth.controller.ts`（在现有 login-by-password 之后新增）

### 3.1 `POST /api/v1/seller/auth/forgot-password/send-code`

**请求体**（同买家端 2.1）
```ts
{ phone: string; captchaId: string; captchaCode: string; }
```

**业务流程**
1. 校验图形验证码（同 2.1）
2. **"可重置"判定标准**（与 3.2 `list-companies` 必须完全一致，避免短信发出后列表为空的死锁）：
   - 该手机号名下至少存在一条 `CompanyStaff.status=ACTIVE` 且所属 `Company.status=ACTIVE` 的记录
   - `CompanyStaffStatus` 枚举只有 `ACTIVE` / `DISABLED`（`schema.prisma:85-88`）；DISABLED 员工或 DISABLED 公司均不允许触发重置
3. 若为空 → 返回 `404 { code: 'NO_RESETTABLE_COMPANY', message: '该手机号不存在可重置密码的企业账号' }`
   - 不浪费一条短信，避免用户收到验证码后在 list-companies 无法继续
4. 限流（**key 带 purpose**，独立于买家）：60 秒 / 1 小时 5 次 / IP 1 小时 10 次
5. 插入 `SmsOtp { phone, purpose: 'SELLER_RESET', ... }` 并发送短信
6. 返回 `200 { success: true }`

### 3.2 `POST /api/v1/seller/auth/forgot-password/list-companies`

**用途**：用户输入短信验证码后，返回该手机号名下可重置的企业列表供选择。此接口**不消费 OTP**（只读验证），允许用户在选择阶段来回切换。

**请求体**
```ts
{
  phone: string;
  code: string;       // 6 位短信验证码
}
```

**业务流程**
1. **只读验证 OTP**：`verifyCodeReadonly(phone, code, SmsPurpose.SELLER_RESET)`
   - 与 `verifyCode` 差异：匹配成功后**不**执行 `usedAt = now()` 的 CAS，保留该 OTP 供 step 3 消费
   - 失败计数仍走 `reset:fail:seller:{phone}`，3 次失败作废所有 `SELLER_RESET` OTP
2. 查询该手机号名下所有 `CompanyStaff.status='ACTIVE'` + `Company.status='ACTIVE'` 的 staff（与 3.1 send-code 过滤条件完全一致）
3. 返回
```ts
{
  success: true,
  companies: [
    { staffId: string, companyId: string, companyName: string, role: 'OWNER' | 'MANAGER' | 'OPERATOR' },
    ...
  ]
}
```

**安全说明**：对已证明持有 SMS 验证码的调用者公开企业列表属于轻度信息泄露（攻击者已攻陷该手机号）。只读验证允许同一 OTP 被多次用于读列表——可接受，因为真实密码变更仍受 step 3 的 CAS 消费保护。

### 3.3 `POST /api/v1/seller/auth/forgot-password/reset`

**请求体**
```ts
{
  phone: string;
  code: string;         // 6 位短信验证码（仍携带，用于最终 CAS 消费）
  staffId: string;      // 从 3.2 返回列表中选定的 staffId
  newPassword: string;
}
```

**业务流程**（Serializable 事务）
1. 校验 `newPassword` 格式（同 2.2）
2. **CAS 消费 OTP**：`verifyCode(phone, code, SmsPurpose.SELLER_RESET)`，使用 `usedAt` CAS 原子更新
3. 查询 `CompanyStaff { where: { id: staffId }, include: { user: { authIdentities: true }, company: true } }`
4. **越权校验**（至关重要，同时覆盖状态校验）：
   - 若 `staff.status !== 'ACTIVE'` 或 `staff.company.status !== 'ACTIVE'` → `400 STAFF_NOT_FOUND`
   - 若 `staff.user.authIdentities` 不包含入参 `phone` 对应的 PHONE 身份 → `403 STAFF_PHONE_MISMATCH`
   - 这道校验防止攻击者用自己的手机号收到的 OTP + 别人的 staffId 来重置别人的密码
5. 生成 `newHash = bcrypt.hash(newPassword, 10)`
6. 更新**仅该 staff** 的 `passwordHash`
7. 写入审计日志到 `LoginEvent`：
   ```ts
   await tx.loginEvent.create({
     data: {
       userId: staff.userId,
       provider: 'PHONE',
       phone: dto.phone,
       success: true,
       ip, userAgent,
       meta: { action: 'PASSWORD_RESET_VIA_SMS', scope: 'SELLER', staffId: staff.id, companyId: staff.companyId },
     },
   });
   ```
8. 返回 `200 { success: true, companyName: string }`

**注意**
- 不影响 `AuthIdentity.meta.passwordHash`（买家密码不动，符合方案 Y）
- 不影响该用户在其他企业的 staff 密码（符合方案 β、`loginByPassword` 现有语义不破坏）
- 不吊销任何 SellerSession（决策：不强踢）
- 若 staff 先前没有 `passwordHash`（仅短信登录的员工），该流程相当于"首次设置密码"——允许

## 四、后端 API（管理端）

**不新增任何 API**。维持现有 `/admin/users/:id/reset-password`（超管代改）。超管账号自身应急见第七节。

## 五、前端实现

### 5.1 买家 App（方案 A：忘记密码内嵌在 AuthModal 中，不新增路由）

AuthModal 现有内部 mode 为 `isLogin` + `loginMode:'code'|'password'`。本次在此模型上追加第三种**流程模式** `flowMode: 'auth' | 'forgotPassword'`：
- 默认 `flowMode='auth'`，保持现有登录/注册 UI 不变
- 点击密码登录 tab 内的"忘记密码？"链接 → `flowMode='forgotPassword'`，AuthModal 切换为 3 步找回密码向导
- 找回密码成功 → `flowMode='auth'`，切回登录态，手机号字段预填之前输入的手机号、焦点跳到密码输入框、顶部 Toast "密码已重置，请用新密码登录"
- 用户中途点返回 / 关闭按钮 → `flowMode='auth'` 且清空 forgotPassword 的本地 state

**修改文件**：`src/components/overlay/AuthModal.tsx`
- 在密码登录 tab 内（第 304 行附近），密码输入框下方右对齐添加 `<TouchableOpacity onPress={() => setFlowMode('forgotPassword')}><Text>忘记密码？</Text></TouchableOpacity>`
- 新增三步向导 UI（flowMode=forgotPassword 时渲染），顶部带"← 返回登录"按钮：
  - **Step 1**：手机号 + 图形验证码（调 `GET /captcha` 拿 SVG 渲染）→ 调 `POST /auth/forgot-password/send-code`
  - **Step 2**：短信验证码（6 位数字，60 秒倒计时重发按钮）→ 本地缓存，进入 Step 3
  - **Step 3**：新密码 + 确认密码 → 调 `POST /auth/forgot-password/reset`，成功回到 `flowMode='auth'` 并预填手机号
- 不新增文件、不新增路由
- 错误处理：
  - `PHONE_NOT_REGISTERED` → 在手机号输入框下红字"该手机号未注册，请先注册"+ 按钮"去注册"（切 `isLogin=false`）
  - `CAPTCHA_INVALID` → 红字提示 + 自动刷新图形验证码
  - `OTP_INVALID/EXPIRED` → 红字提示，不清空前置状态
  - `PASSWORD_FORMAT_INVALID` → 红字提示密码规则

**新增 Repo 方法**：`src/repos/AuthRepo.ts`（沿用现有 `ApiClient` 调用风格）
```ts
sendForgotPasswordCode({ phone, captchaId, captchaCode }): Promise<Result<void>>;   // ApiClient.post('/auth/forgot-password/send-code', ...)
resetForgotPassword({ phone, code, newPassword }): Promise<Result<void>>;           // ApiClient.post('/auth/forgot-password/reset', ...)
getCaptcha(): Promise<Result<{ captchaId: string; svg: string }>>;                  // ApiClient.get('/captcha')
```

### 5.2 卖家后台（方案 β：四步 UI）

**修改文件**：`seller/src/pages/login/index.tsx`
- 密码登录 tab 内（第 443-477 行区间），密码输入框下方右对齐加 `<Button type="link" onClick={() => navigate('/forgot-password')}>忘记密码？</Button>`

**新建文件**：`seller/src/pages/forgot-password/index.tsx`
- Ant Design `<Steps>` + 四步 `<Form>`（风格对齐现有登录页）：
  - **Step 1**：`<Input>` 手机号 + `<Input>` 图形验证码 + SVG captcha（点击刷新） → 调 `send-code`
  - **Step 2**：`<Input>` 短信验证码 + 60 秒倒计时按钮 → 调 `list-companies`（只读验证）→ 拿到企业列表进入 Step 3
  - **Step 3**：`<Radio.Group>` 或 `<List>` 展示所有 ACTIVE 企业供选择（显示企业名 + 角色），选定后进入 Step 4
    - 前端本地持有 `{ phone, code, staffId }` 三元组
  - **Step 4**：`<Input.Password>` 新密码 + `<Input.Password>` 确认密码 + 实时密码强度指示 → 调 `reset`
- 成功时顶部 `message.success('密码已重置，企业【${companyName}】可用新密码登录')`，跳转回 `/login`
- **必须**使用 `const { message } = App.useApp();` hook 实例（CLAUDE.md 静态 message 禁令）

**新增 API 文件**：`seller/src/api/forgot-password.ts`（沿用 `import client from './client'` 约定，参考 `seller/src/api/auth.ts`）
```ts
import client from './client';

export const getCaptcha = () => client.get('/seller/auth/captcha');   // 使用卖家专属 captcha 路由，非通用 /captcha
export const sendForgotPasswordCode = (data: { phone; captchaId; captchaCode }) =>
  client.post('/seller/auth/forgot-password/send-code', data);
export const listCompaniesForReset = (data: { phone; code }) =>
  client.post('/seller/auth/forgot-password/list-companies', data);
export const resetForgotPassword = (data: { phone; code; staffId; newPassword }) =>
  client.post('/seller/auth/forgot-password/reset', data);
```

### 5.3 管理后台

**修改文件**：`admin/src/pages/login/index.tsx`
- 在密码登录 Tab 底部（第 419-429 行登录按钮之后）追加一行居中灰字：
  ```tsx
  <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 12 }}>
    忘记密码请联系超级管理员重置
  </Typography.Text>
  ```
- **不跳转任何页面，不加 onClick**

## 六、安全策略

| 风险 | 对策 |
|---|---|
| 短信炸弹（盗刷运营商短信费用） | 前置图形验证码 + 手机号 × purpose 60 秒间隔 + 手机号 × purpose 1 小时 5 次 + IP 1 小时 10 次（`@Throttle`） |
| 账号枚举（通过"未注册"响应探测用户库） | **已接受**：产品决定 UX 优先，透露"是否注册"。仅限忘记密码页，登录页保持模糊提示 |
| 登录短信验证码被复用于密码重置 | `verifyCode` 签名的 `purpose` 改为必填参数；所有调用点显式传 `LOGIN` / `BUYER_RESET` / `SELLER_RESET`，编译期失败兜底 |
| **跨 scope 串用（买家 RESET 码被卖家接口接受）** | `SmsPurpose` 枚举拆分为 `BUYER_RESET` / `SELLER_RESET`；两端流程 create + verify 均用自己的 purpose；限流 + 失败计数 Redis key 按 purpose 隔离 |
| OTP 暴力破解（试错 6 位数字） | 3 次输错作废该手机号所有该 purpose 下未使用 OTP（Redis 计数 `reset:fail:buyer:{phone}` / `reset:fail:seller:{phone}`，TTL 5 分钟） |
| 图形验证码重放 | 验证成功后 Redis 立即 DEL，一个 captchaId 只能用一次 |
| 越权重置他人密码（买家端） | 唯一身份证明是该手机号可接收短信，与现有短信登录安全假设一致 |
| **越权重置他人密码（卖家端：攻击者构造 staffId）** | 3.3 reset 接口强制校验 staffId 归属：`staff.user.authIdentities` 必须包含入参 `phone`，否则 403 |
| 卖家 list-companies 只读验证允许 OTP 多次读取企业列表 | **可接受**：已知持有 SMS 即可枚举企业列表（等同持码权限）；真正的密码变更仍由 step 3 的 CAS 消费保护 |
| 密码强度不足 | 服务端正则 `/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/` 二次校验，前端校验仅用于 UX |
| 事务原子性 | 整个 reset 流程用 Serializable 事务：OTP 消费 + 密码写入 + 审计日志在同一事务，失败整体回滚 |

## 七、超级管理员 admin 应急流程（密码本补充）

写入 `docs/operations/密码本.md`：

```bash
# 紧急情况下重置管理后台超级管理员 admin 账号密码

# 1. 本地生成新密码的 bcrypt 哈希
node -e "console.log(require('bcrypt').hashSync('你的新密码', 10))"

# 2. SSH 登录生产服务器
ssh <生产服务器>

# 3. 连接数据库（用 密码本 里的凭据）
psql -U <user> -h <host> -d <database>

# 4. 更新 admin 账号密码哈希
UPDATE "AdminUser" SET "passwordHash" = '<上一步生成的哈希>', "lockedUntil" = NULL, "loginFailCount" = 0 WHERE "username" = 'admin';

# 5. 通知所有使用 admin 账号的人新密码
```

## 八、文档同步

- 更新 `CLAUDE.md` 的"相关文档"列表，追加本 spec 和对应 plan
- 更新 `plan.md`，在 v1.0 冲刺路线图中追加"忘记密码"条目
- 修复完成后更新 `docs/operations/密码本.md` 记录 admin 应急流程

## 九、开放问题

1. **阿里云短信模板**：买家和卖家共用同一个现有模板（用户已确认"用之前那个"），文案通用（如 `{code}为你的爱买买登录密码找回验证码，5分钟内有效，请勿泄露`）
2. **密码复杂度错误提示的精细度**：前端统一展示"≥6 位且需包含大小写字母和数字"，后端返回统一 code 即可
3. **是否需要在管理后台增加"重置密码"操作在企业员工列表里**（目前 `/admin/companies/:id/staff/:staffId/reset-password` 已有，但前端是否有入口？）
   - 本次不处理，作为独立补丁
4. **`SmsPurpose.RESET` 枚举值退役**：本次保留占位。若后续审计确认无任何遗留使用，可在独立迁移中 `ALTER TYPE ... RENAME VALUE` 或彻底删除
