# L1. 三系统用户认证 Audit Draft
**Tier**: 1
**审查时间**: 2026-04-11
**审查范围**: 买家 App / 卖家后台 / 管理后台 三系统认证链路
**审查方式**: 静态代码阅读（只读）

---

## 🚨 关键疑点

### 🔴 已用户确认的 T1 必修项（2026-04-11）

1. **H1 — 卖家端需补账号密码登录**（用户 2026-04-11 决策：必做）
   - **现状**：`seller-auth.service.ts` / `SellerLoginDto` 仅实现**手机号 + 验证码**登录，无密码字段
   - **决策**：v1.0 必须补齐账号密码登录分支（**与现有手机验证码并存**，不是替换）
   - **工作项**：
     - `seller-auth.dto.ts` 新增 `SellerPasswordLoginDto { username|phone, password }`
     - `seller-auth.service.ts` 新增 `loginByPassword` 方法
     - `seller-auth.controller.ts` 新增 `POST /seller/auth/login-by-password` 端点
     - CompanyStaff schema 是否已有 `passwordHash` 字段需核对；若无需迁移
     - 前端 `seller/src/pages/login/` 新增密码登录 Tab

2. **H2 — 管理端需补图形验证码 + 手机号验证码登录**（用户 2026-04-11 决策：必做）
   - **现状**：`AdminLoginDto` 仅含 `{username, password}`，无 captcha，无手机号登录
   - **决策**：v1.0 必须补齐：
     - a) **图形验证码**（防暴力破解/撞库/短信轰炸，登录前必须过）
     - b) **手机号 + 短信验证码登录**（作为密码登录的补充，**不是替换**）
   - **工作项**：
     - 图形验证码：接入 `captcha.service.ts`（买家端已有），生成 4 位数字/字母 + 服务端保存 → `AdminLoginDto` 加 `captchaId + captchaCode` 字段 → 登录时先验 captcha 再验密码
     - 短信验证码登录：`admin-auth.service.ts` 新增 `loginByPhoneCode` 方法，复用 `SmsOtp` 表，需要 AdminUser 加 `phone` 字段（schema 核对）
     - 前端 `admin/src/pages/login/` 加 captcha 展示组件 + 短信登录 Tab

### 🟡 建议补齐项（非 T1 阻塞，但建议加入 T1 批次）

3. **令牌类型校验不对称**：买家 `jwt.strategy.ts` 和 管理端 `admin-jwt.strategy.ts` 没校验 `payload.type`，而 seller 有（`seller-jwt.strategy.ts` 第 2 行）。三端不一致。建议统一在所有 strategy 里检查 `payload.type === '相应类型'`，作为纵深防御
4. **三个 JWT secret 未做启动期互不相等断言**：如果开发环境不小心把三个 secret 设成同一个，会导致跨系统令牌伪造。建议在 AppModule 启动时断言
5. **买家 logout 接口未 throttle**：`auth.controller.ts:41` 无 Throttle，理论上能被用作会话枚举工具。风险不高，建议 T1 补

### 🟢 已确认为现状（不改）

6. **AuthIdentity 模型无 EMAIL provider**：v1.0 确认只支持 PHONE + WECHAT（微信 Mock 到 v1.1），EMAIL 推迟到 v1.1+。spec 记录已更新
7. **BANNED 拦截语义三端不一致**：买家检查 `User.status === 'BANNED'`，卖家检查 `CompanyStaff.status === 'ACTIVE'`，管理员检查 `AdminUser.status === 'ACTIVE'`。语义不同但效果等价（都会拦截），不改

---

## 📍 范围

**后端**:
- 买家：`backend/src/modules/auth/` (5 文件) + `backend/src/common/guards/jwt-auth.guard.ts`
- 卖家：`backend/src/modules/seller/auth/` (5 文件) + `backend/src/modules/seller/common/{guards,decorators}/`
- 管理：`backend/src/modules/admin/auth/` + `backend/src/modules/admin/common/{strategies,guards,decorators}/`

**前端**:
- 买家 App：`src/store/useAuthStore.ts`（SecureStore 持久化）
- 卖家后台：`seller/src/store/useAuthStore.ts`（localStorage）+ `seller/src/pages/login/index.tsx`
- 管理后台：`admin/src/store/useAuthStore.ts`（localStorage）+ `admin/src/pages/login/index.tsx`

**Schema**:
- `backend/prisma/schema.prisma` → `AuthProvider`(30), `AuthIdentity`(644), `Session`(675), `AdminSession`(861), `SellerSession`(1040)

---

## 🔗 端到端路径

### 买家登录
```
POST /auth/sms/code (Public, Throttle 1/m/IP, target-window Redis 1/m/d)
  → AuthService.sendSmsCode → SmsOtp.create (bcrypt codeHash)
POST /auth/login (Public, Throttle 5/m/IP, target-window 5/m)
  → loginByPhone → verifyCode(CAS usedAt=null→now) → issueTokens
  → Session.create (refreshTokenHash + absoluteExpiresAt=90d)
  → JWT { sub, sessionId }（JWT_SECRET, 15m）
全局 APP_GUARD = JwtAuthGuard → JwtStrategy.validate
  → user.status !== BANNED + Session(ACTIVE, exp>now, id=payload.sessionId)
```

### 卖家登录
```
POST /seller/auth/sms/code (Public, Throttle 3/m)
POST /seller/auth/login (Public, Throttle 5/m) — 手机号+验证码
  → 查 AuthIdentity(PHONE) → 查 CompanyStaff(ACTIVE) → 过滤停用企业
  → 单企业: issueTokens(SELLER_JWT_SECRET, 8h)；多企业: tempToken(type=seller-temp,5m) + companies[]
POST /seller/auth/select-company (Public) → verify tempToken → issueTokens
全部 seller 控制器：@Public() + @UseGuards(SellerAuthGuard, SellerRoleGuard) + 类级
SellerJwtStrategy.validate:
  → payload.type === 'seller'（令牌类型校验 C07）
  → SellerSession(id=sessionId, staffId=sub, exp>now)
  → CompanyStaff.status === ACTIVE && companyId === payload.companyId（C08）
SellerAuthGuard: 继承 AuthGuard('seller-jwt')，并再查 Company.status === ACTIVE（支持 SUSPENDED 自动恢复）
```

### 管理员登录
```
POST /admin/auth/login (Public, Throttle 5/m/IP) — 用户名+密码
  → AdminUser.findUnique(username) → lockedUntil 检查 → status != DISABLED
  → bcrypt.compare(password, passwordHash, cost=10)
  → 失败：loginFailCount.increment → 若 >= 5 则 lockedUntil = +30m CAS 清零
  → 成功：lastLoginAt/Ip 更新 + AdminAuditLog(LOGIN) + issueTokens
  → AdminSession.create (refreshTokenHash, absoluteExpiresAt=90d)
  → JWT { sub, type:'admin', roles, permissions, sessionId }（ADMIN_JWT_SECRET, 8h）
全部 admin 控制器：@Public() + @UseGuards(AdminAuthGuard, PermissionGuard)
AdminJwtStrategy.validate:
  → AdminSession(id=payload.sessionId, adminUserId=sub, exp>now)
  → AdminUser.status === ACTIVE
PermissionGuard:
  → 实时查库 roles + permissions（覆盖 JWT 缓存，M6 修复）
  → 超级管理员 role === SUPER_ADMIN_ROLE 直接放行
  → 否则 permissionCodes.includes(requiredPermission)
```

---

## ✅ 验证点清单

| # | 验证点 | 状态 | 证据 (file:line) | 阻塞 T1? | 补工作 |
|---|--------|------|------------------|----------|--------|
| 1 | 买家手机号+验证码登录 | ✅ | `auth.service.ts:78,285`（code/password 双模式） | - | - |
| 2 | 买家 JWT 签发 + refresh token | ✅ | `auth.service.ts:378-425`（Session+sessionId）；refresh `127-172` CAS | - | - |
| 3 | 买家 session 撤销 | ✅ | `auth.service.ts:174-190` logout；`jwt.strategy.ts:41` sessionId 精确校验 | - | - |
| 4 | 封禁用户 token 拦截 | ✅ | `jwt.strategy.ts:34` `user.status === 'BANNED'` → Forbidden | - | - |
| 5 | AuthIdentity 模型 (PHONE/WECHAT) | ⚠️ 部分 | `schema.prisma:30` 仅 PHONE/WECHAT/GUEST，无 EMAIL | 建议否 | spec 对齐：要么补 EMAIL，要么改 spec |
| 6 | 卖家账号密码登录 | ❌ | `seller-auth.dto.ts:10` 仅 `{phone, code}`；无 password 字段 | **待确认** | 若确认 spec 为准：补密码登录分支（服务端 + UI） |
| 7 | 多企业切换 | ✅ | `seller-auth.service.ts:116-133`（tempToken）+ `136-171` selectCompany；前端 `seller/src/pages/login/index.tsx:95-140` 带 5 分钟倒计时 | - | - |
| 8 | SELLER_JWT_SECRET 独立 | ✅ | `.env.example:49`；`seller-jwt.strategy.ts:26`；`seller-auth.module.ts:15` getOrThrow | - | - |
| 9 | OWNER/MANAGER/OPERATOR 角色 | ✅ | `SellerRoleGuard` + `@SellerRoles()`（`seller-role.guard.ts:18`）；schema `CompanyStaffRole` | - | - |
| 10 | SellerAuthGuard + companyId 强制过滤 | ✅ | 所有 seller 控制器类级 `@UseGuards(SellerAuthGuard, SellerRoleGuard)`；`seller-orders.service.ts:63` 参数强制 `companyId` | - | - |
| 11 | @CurrentSeller() 装饰器 | ✅ | `current-seller.decorator.ts:8`（payload 字段提取） | - | - |
| 12 | 管理员账号密码+验证码登录 | ⚠️ 部分 | `admin-login.dto.ts:3-12` 仅 `{username, password}`，无 captcha；`admin-auth.service.ts:33` 未校验 captcha | **待确认** | 若确认 captcha 必需：加 captcha 中间件 + DTO 字段 |
| 13 | bcrypt 成本因子 ≥ 10 | ✅ | `admin-users.service.ts:105,203` cost=10；`auth.service.ts:109` cost=10；`seed.ts:1466` cost=10 | - | - |
| 14 | AdminSession 软过期 | ✅ | `schema.prisma:861-874`：`expiresAt`（可滑动）+ `absoluteExpiresAt`（L1 绝对上限 90d，refresh 时继承） | - | - |
| 15 | ADMIN_JWT_SECRET 独立 | ✅ | `.env.example:41`；`admin-jwt.strategy.ts:24`；`admin-auth.module.ts:15` getOrThrow | - | - |
| 16 | RBAC (AdminRole+AdminPermission) | ✅ | `permission.guard.ts:37-73` 实时查 `adminRole.rolePermissions` → 权限码集合 | - | - |
| 17 | @Public() + AdminAuthGuard + PermissionGuard 组合 | ✅ | 审计全部 25 个 admin 控制器均有 `@Public()` 类级装饰，均 `@UseGuards(AdminAuthGuard, PermissionGuard)` | - | - |
| 18 | @RequirePermission 装饰器 | ✅ | `require-permission.ts:5`；例 `admin-orders.controller.ts:28` | - | - |
| 19 | 超级管理员绕过权限 | ✅ | `permission.guard.ts:75-78`：`roles.includes(SUPER_ADMIN_ROLE)` 直接 return true | - | - |
| 20 | 三套 JWT 密钥在 .env.example 中必须不同 | ✅ | `.env.example:33/41/49` 三个独立变量名；代码均 `getOrThrow` | - | ⚠️ 建议：补「三者值必须不同」的启动期断言（`main.ts` bootstrap） |
| 21 | 交叉伪造隔离 | ✅ 结构上安全 | 三套 JWT 不同 secretOrKey → passport-jwt 签名校验失败；此外 `seller-jwt.strategy.ts:32` 二次检查 `payload.type === 'seller'` | - | 注：买家 `jwt.strategy.ts` **未校验 payload.type**，依赖签名防护（足够但弱一层纵深） |
| 22 | 买家 A 无法访问买家 B 订单 | ✅ | `order.service.ts:429,811,960` 三处 `order.userId !== userId` → NotFoundException；`checkout.service.ts:501,774,962,1031` 多处 userId 校验 | - | - |
| 23 | 卖家 A 无法访问公司 B 商品/订单 | ✅ | 所有 seller service 方法首参 `companyId` 来自 `@CurrentSeller('companyId')`，并写入 Prisma where；`seller-jwt.strategy.ts:72` 校验 `staff.companyId === payload.companyId` | - | - |

**交叉伪造测试清单（主会话执行）**:
- 买家 JWT → `GET /admin/orders` → 应 401（ADMIN_JWT_SECRET 签名校验失败）
- 买家 JWT → `GET /seller/orders` → 应 401
- 卖家 JWT → `GET /admin/users` → 应 401
- 卖家 JWT → `GET /me` → 应 401（买家 JWT_SECRET 签名失败）
- 管理员 JWT → `GET /seller/orders` → 应 401
- 伪造 payload.type='admin' 但用 JWT_SECRET 签名 → 应 401（AdminJwtStrategy secretOrKey 不同）

---

## 🚧 已知问题 / 新发现

### H1 (High) — 卖家端不支持密码登录与 spec 冲突
- **文件**: `backend/src/modules/seller/auth/seller-auth.dto.ts:10`、`seller-auth.service.ts:74-133`
- **问题**: spec L1 第 6 点「账号密码登录」未落地。当前仅 OTP，存在两类风险：
  - 员工手机号泄露即可直接登录后台
  - 测试种子 `seed.ts:2468` 为 `CompanyStaff` 写了 `passwordHash: manager123` 字段，但卖家 schema 下 `passwordHash` 不是 CompanyStaff 字段（可能写进了 `meta`），实际卖家登录从未验证密码 → seed 密码是假动作
- **建议**: 确认后补 `{mode:'password'|'code'}` 双模式，或更正 spec 为「手机号+验证码」。

### H2 (High) — 管理员登录无 captcha
- **文件**: `admin-login.dto.ts:3-12`、`admin-auth.service.ts:33-107`
- **问题**: spec L1 第 12 点「账号密码+验证码登录」未落地。当前防暴力仅依赖 Throttle(5/min/IP) + 5 失败 30min 账号锁定，无 captcha。撞库扫描可切换 IP 绕过 Throttle、分散账号绕过锁定。
- **建议**: 接入图形/滑块验证码，DTO 加 `captchaToken` 字段；或确认 spec 豁免。

### M1 (Medium) — 买家 JWT Strategy 未做 `payload.type` 类型校验
- **文件**: `backend/src/modules/auth/jwt.strategy.ts:29-69`
- **问题**: 不像 `seller-jwt.strategy.ts:32` 那样拒绝 `type !== 'seller'`。买家 JWT 签发时 payload 仅 `{sub, sessionId}`，无 `type` 字段；若未来买家/管理员共用相同 JWT_SECRET 的场景出现，将失去纵深防护。
- **建议**: 在 `issueTokens` 写入 `type: 'buyer'`，`validate` 校验之；作为纵深防御。

### M2 (Medium) — `JwtAuthGuard` 对 Public 路由 JWT 解析失败静默放行
- **文件**: `backend/src/common/guards/jwt-auth.guard.ts:13-32`
- **问题**: Public 路由若携带无效/过期 JWT，异常被吞掉（`.catch(() => true)`）。好处是公开接口对坏 token 宽容；坏处是如果有 `@Public()` 标注但又依赖 `request.user` 做 fallback 逻辑（如推荐码绑定、统计），可能出现旧代码误以为已登录。
- **建议**: 审计所有 `@Public()` 且读 `request.user` 的端点，确认无副作用（非 L1 必须，标记 X-cross-cutting）。

### M3 (Medium) — 买家端 logout 未限流，允许会话枚举
- **文件**: `auth.controller.ts:41-48`
- **问题**: 无 Throttle 装饰器，也不是 @Public（受全局 JwtAuthGuard 保护，已登录要求），但允许当前用户无限触发撤销 + DB 写。
- **建议**: 补 `@Throttle({ default: { ttl: 60000, limit: 10 } })`。

### M4 (Medium) — admin/seller 令牌类型校验结构不对称
- **问题**: `seller-jwt.strategy.ts:32` 校验 `payload.type === 'seller'`；`admin-jwt.strategy.ts:28-53` 未校验 `payload.type === 'admin'`（只校验 session + user 状态）。
- **建议**: admin strategy 补 `if (payload.type !== 'admin')` 断言，与 seller 对齐。

### L1 (Low) — 启动期未断言三 JWT secret 互不相等
- **文件**: `backend/src/main.ts`（未查看，但一般 bootstrap 位置）
- **建议**: 启动期做 `assert(JWT_SECRET !== ADMIN_JWT_SECRET !== SELLER_JWT_SECRET)`，并在生产环境禁止默认值 `"请替换为安全的随机字符串"`。

### L2 (Low) — 买家 EMAIL provider 缺失（与 spec）
- 见验证点 #5。`AuthProvider` 枚举只含 PHONE/WECHAT/GUEST。

### L3 (Low) — 买家 JWT 过期 15m 相对较短，但 `SecureStore` 持久化 refreshToken 30d
- **文件**: `auth.service.ts:388` (refreshExpiresAt=30d)、`jwtExpiresIn='15m'`
- **观察**: 合理值。对比卖家 8h+7d、管理员 8h+7d。建议文档化。

### L4 (Low) — Admin DTO 字段命名与 spec `AdminPermission` 术语一致性
- Admin 权限由 `AdminRolePermission` 多对多 + `AdminPermission.code` 构成，验证点 16 ✅。命名与 spec 对齐。

### L5 (Low) — 种子中 CompanyStaff `passwordHash` 字段位置可疑
- **文件**: `seed.ts:2468,2485,2502`
  ```ts
  passwordHash: await bcrypt.hash('manager123', 10),
  ```
- **问题**: `CompanyStaff` schema 中不存在 `passwordHash` 字段（schema:1010+），此字段在运行时会被 Prisma 拒绝。需要主会话确认这些 seed 是否实际执行成功，或是否在 Json 子对象里。如果真的写到了 schema 外字段，seed 会抛错——也可能是 TS ts-error 被忽略。
- **建议**: 检查 `seed.ts` 完整上下文与 Prisma 校验结果。

---

## 🧪 E2E 场景（T1 必须覆盖）

1. **买家登录全链路**: 发送验证码 → 登录 → 带 JWT 访问 `/me` → logout → JWT 立即失效（同 session）
2. **买家异设备登出不互相影响**: 设备 A 登录拿到 JWT-A，设备 B 登录拿到 JWT-B；A logout 后 JWT-A 401 但 JWT-B 仍有效
3. **买家封禁立即生效**: 管理员将 user.status 置为 BANNED → 买家持有有效 JWT 请求接口返回 403
4. **refresh token 单次使用（CAS）**: 并发两次用同一 refreshToken 刷新 → 仅一次成功，另一次 401
5. **refresh 绝对上限**: 90 天后无法再刷新（absoluteExpiresAt）
6. **卖家多企业选择**: 双公司员工登录 → needSelectCompany → 5 分钟内选择 → 成功
7. **卖家 tempToken 过期**: 进入多企业选择后等待 > 5min → selectCompany 返回 401
8. **卖家企业停用立即拦截**: 改 company.status=SUSPENDED → seller-auth.guard 返回 403
9. **卖家 SUSPENDED 自动恢复**: suspendedUntil 到期 + creditScore >= 40 → 下一次请求自动转 ACTIVE
10. **卖家角色限制**: OPERATOR 访问 `@SellerRoles('OWNER')` 端点 → 403
11. **管理员锁定**: 连续 5 次错密码 → 30 分钟锁定；锁定期间正确密码也 403
12. **管理员登录成功重置锁定**: 失败 3 次后成功登录 → loginFailCount 重置
13. **管理员权限即时变更**: 删除角色后，旧 JWT 下次请求被 PermissionGuard 实时拒绝（M6 修复）
14. **管理员 logout**: 撤销所有活跃 session → 旧 JWT 返回 401
15. **三系统交叉伪造 5 组**: 见交叉测试清单
16. **买家 A → 买家 B 订单**: 返回 NotFound 而非 Forbidden（避免枚举）
17. **卖家 A → 公司 B 订单**: 返回空列表（companyId where 过滤）或 NotFound

---

## ❓ 需要用户确认的疑点

1. **卖家是否需要账号密码登录？** (影响 H1)
2. **管理员是否需要图形验证码？** (影响 H2)
3. **AuthIdentity 是否需要补 EMAIL provider？** (影响 #5)
4. **是否接受买家 JWT 无 `type` 字段纵深防御？** (影响 M1)
5. **种子 `seed.ts:2468` 的 CompanyStaff.passwordHash 是否真实可执行？** (影响 L5)
6. **验证 `CORS_ORIGINS` / `TRUST_PROXY` 配置是否生产就绪？** (超出 L1 但与登录端点限流相关)

---

## 🎯 Tier 1 验收标准

### 必须通过（P0）
- [ ] 23 验证点全部通过或明确豁免（当前 #5/#6/#12 待决策）
- [ ] 交叉伪造 5 组全部返回 401
- [ ] 买家 A 访问买家 B 订单返回 404/403
- [ ] 卖家 A 访问公司 B 数据返回空/403
- [ ] 三个 JWT secret 在 `.env.example` 三个独立变量名，代码 `getOrThrow`
- [ ] bcrypt cost ≥ 10（已满足）
- [ ] 所有 seller/admin 控制器类级 `@Public()` + `@UseGuards(...)` （已审计全部 13 seller + 25 admin 文件，通过）

### 建议通过（P1）
- [ ] H1 / H2 决策落地或补 E2E 测试证明风险可接受
- [ ] M1 / M4 补齐 payload.type 纵深校验
- [ ] M3 买家 logout 限流
- [ ] L1 启动期断言三 secret 不同

### 延后（P2）
- [ ] L2 EMAIL provider
- [ ] L5 seed 代码清理

---

**审查结论**：核心认证三端隔离结构正确（独立 secret / 独立 strategy / 独立 guard / 独立 session 表），会话撤销/refresh CAS/账号锁定/RBAC 实时校验均已到位。阻塞 T1 的**关键疑点**仅有 2 项（H1 卖家密码登录 + H2 管理员 captcha），均需用户产品决策而非代码问题。其余为纵深/对称性改进，可延后。
