# 忘记密码 / 找回密码实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为买家 App 和卖家后台添加基于"手机号 + 图形验证码 + 短信验证码 + 新密码"的自助忘记密码流程；管理后台仅加"联系超管"文字提示 + 超管应急 SQL 流程文档。

**Architecture:** 复用 `CaptchaModule`、`AliyunSmsService`、`SmsOtp`、bcrypt。
- **新增 `SmsPurpose.BUYER_RESET` + `SmsPurpose.SELLER_RESET`** 两个枚举值，实现买家/卖家 scope 完全隔离（防跨端串用）
- **改造 `verifyCode` 签名**：`purpose` 改为必填参数，所有现有调用点（买家 register / 买家短信登录 / 卖家短信登录）显式传 `LOGIN`
- 买家端：重置更新 `AuthIdentity.meta.passwordHash`
- 卖家端（方案 β 三步）：`send-code` → `list-companies`（只读验证 OTP）→ `reset`（CAS 消费 OTP + 更新**指定** `staffId` 的 `passwordHash`），`loginByPassword` 不动
- 三端密码独立（方案 Y），买家重置不影响卖家，反之亦然

**Tech Stack:** NestJS + Prisma + PostgreSQL + Redis（后端）、RN + Expo + expo-router（买家 App）、Vite + React + Ant Design（卖家后台、管理后台）

**Spec:** `docs/superpowers/specs/2026-04-23-forgot-password-design.md`

---

## File Structure

### Backend — New Files
| File | Responsibility |
|------|---------------|
| `backend/src/modules/auth/dto/forgot-password.dto.ts` | 买家端 send-code + reset 两个 DTO（含密码复杂度校验正则） |
| `backend/src/modules/seller/auth/dto/seller-forgot-password.dto.ts` | 卖家端 send-code + list-companies + reset 三个 DTO |
| `backend/prisma/migrations/<timestamp>_add_buyer_seller_reset_purposes/migration.sql` | Prisma migration：`ALTER TYPE "SmsPurpose" ADD VALUE` 两次 |

### Backend — Modified Files
| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | `enum SmsPurpose` 增加 `BUYER_RESET` 和 `SELLER_RESET` 两值 |
| `backend/src/modules/auth/auth.controller.ts` | 新增 `forgot-password/send-code` 和 `forgot-password/reset` 两个 `@Public()` 路由 |
| `backend/src/modules/auth/auth.service.ts` | 新增 `sendForgotPasswordCode` + `resetForgotPassword`；**改造 `verifyCode` 签名为 `(target, code, purpose)`（必填）**；更新现有 2 个调用点（register、code login）显式传 `SmsPurpose.LOGIN` |
| `backend/src/modules/auth/auth.module.ts` | `imports` 增加 `CaptchaModule` |
| `backend/src/modules/seller/auth/seller-auth.controller.ts` | 新增 3 个 `@Public()` 路由：`forgot-password/send-code`、`forgot-password/list-companies`、`forgot-password/reset` |
| `backend/src/modules/seller/auth/seller-auth.service.ts` | 新增 `sendForgotPasswordCode` + `listCompaniesForReset` + `resetForgotPassword`；**改造 `verifyCode` 签名**；更新现有 1 个调用点（短信登录）显式传 `SmsPurpose.LOGIN`；新增 `verifyCodeReadonly`（只读变体）供 list-companies 使用 |
| `backend/src/modules/seller/auth/seller-auth.module.ts` | `imports` 增加 `CaptchaModule` |

### Buyer App — Modified Files
| File | Change |
|------|--------|
| `src/components/overlay/AuthModal.tsx` | 引入 `flowMode: 'auth' \| 'forgotPassword'`，在 `flowMode='forgotPassword'` 下渲染 3 步向导（手机号+图形码 / 短信码 / 新密码），成功后回到 `flowMode='auth'` 并预填手机号到登录表单。**不新增路由**。 |
| `src/repos/AuthRepo.ts` | 新增 `sendForgotPasswordCode` / `resetForgotPassword` / `getCaptcha` 方法（沿用 `ApiClient` 风格，captcha 调 `/captcha`） |

### Seller Frontend — New Files
| File | Responsibility |
|------|---------------|
| `seller/src/pages/forgot-password/index.tsx` | 四步 Steps 忘记密码页（手机号+图形码 / 短信码 / 选企业 / 新密码） |
| `seller/src/api/forgot-password.ts` | 四个 API 调用封装（getCaptcha / sendCode / listCompanies / reset） |

### Seller Frontend — Modified Files
| File | Change |
|------|--------|
| `seller/src/pages/login/index.tsx` | 密码登录 Tab 添加"忘记密码？"链接（第 443-477 行区间） |
| `seller/src/App.tsx` | 路由表增加 `/forgot-password` → `ForgotPasswordPage` |

### Admin Frontend — Modified Files
| File | Change |
|------|--------|
| `admin/src/pages/login/index.tsx` | 密码登录 Tab 的登录按钮下方增加居中灰字"忘记密码请联系超级管理员重置"（第 419-429 行区间后） |

### Docs — Modified Files
| File | Change |
|------|--------|
| `docs/operations/密码本.md` | 追加超级管理员 admin 账号应急 SQL 重置流程 |
| `CLAUDE.md` | 在"相关文档"追加 spec + plan 两条 |
| `plan.md` | v1.0 冲刺路线图增加"忘记密码"条目 |

---

## Task 0: Prisma Schema — 新增 BUYER_RESET / SELLER_RESET 枚举值

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_buyer_seller_reset_purposes/`

- [ ] **Step 1: 修改 schema.prisma 的 SmsPurpose enum**

```prisma
enum SmsPurpose {
  LOGIN
  BIND
  RESET          // 保留占位，当前无代码使用
  BUYER_RESET    // 新增
  SELLER_RESET   // 新增
}
```

- [ ] **Step 2: 生成 migration**

```bash
cd backend && npx prisma migrate dev --name add_buyer_seller_reset_purposes
```

Prisma 会生成类似：
```sql
ALTER TYPE "SmsPurpose" ADD VALUE 'BUYER_RESET';
ALTER TYPE "SmsPurpose" ADD VALUE 'SELLER_RESET';
```

**Verification:** `npx prisma validate` 通过；检查生成的 SQL 不含 DROP / RENAME；生产环境 `migrate deploy` 零停机。

---

## Task 1: 后端 — 买家端 DTO + 校验规则

**Files:**
- Create: `backend/src/modules/auth/dto/forgot-password.dto.ts`

- [ ] **Step 1: 创建 DTO 文件**

```ts
import { IsString, Matches, Length, MinLength } from 'class-validator';

export class SendForgotPasswordCodeDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  captchaId: string;

  @IsString()
  @Length(4, 8)
  captchaCode: string;
}

export class ResetForgotPasswordDto {
  @Matches(/^1[3-9]\d{9}$/)
  phone: string;

  @Length(4, 8)
  code: string;

  @MinLength(6)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/, {
    message: '密码至少 6 位且必须包含大写字母、小写字母和数字',
  })
  newPassword: string;
}
```

**Verification:** `cd backend && npx tsc --noEmit` 通过。

---

## Task 2: 后端 — 改造 verifyCode 签名 + 买家端 Service

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.module.ts`

- [ ] **Step 1: auth.module.ts 引入 CaptchaModule**

```ts
import { CaptchaModule } from '../captcha/captcha.module';
// @Module({ imports: [..., CaptchaModule] })
```

- [ ] **Step 2: auth.service.ts 构造函数注入 CaptchaService**

- [ ] **Step 3: **改造 verifyCode 签名为 purpose 必填**

现有签名：`private async verifyCode(target: string, code?: string)`
新签名：`private async verifyCode(target: string, code: string | undefined, purpose: SmsPurpose)`

在 `findMany` 的 `where` 中加入 `purpose: purpose`（强过滤，不再兼容"不传就不过滤"）。

- [ ] **Step 4: 更新现有两个调用点**

```ts
// auth.service.ts:92 (register)
await this.verifyCode(dto.phone, dto.code, SmsPurpose.LOGIN);

// auth.service.ts:357 (code login)
await this.verifyCode(phone, code, SmsPurpose.LOGIN);
```

编译若报错说明还有漏改的调用点——grep `verifyCode(` 确认全部已更新。

- [ ] **Step 5: 新增 sendForgotPasswordCode 方法**

```ts
async sendForgotPasswordCode(dto: SendForgotPasswordCodeDto, ip?: string) {
  const captchaOk = await this.captcha.verify(dto.captchaId, dto.captchaCode);
  if (!captchaOk) throw new BadRequestException({ code: 'CAPTCHA_INVALID', message: '图形验证码错误或已过期' });

  const identity = await this.prisma.authIdentity.findFirst({
    where: { provider: 'PHONE', identifier: dto.phone },
  });
  if (!identity) throw new NotFoundException({ code: 'PHONE_NOT_REGISTERED', message: '该手机号未注册' });

  await this.createOtpWithRateLimit(dto.phone, SmsPurpose.BUYER_RESET, ip);
  return { success: true };
}
```

**注意**：现有 `createOtpWithRateLimit` 可能硬编码 `purpose: 'LOGIN'`（见 `auth.service.ts:553,593`）。需要把 purpose 提升为参数；或单独为 reset 路径写一个并列方法。倾向前者（改签名+所有调用点显式传），理由同 verifyCode。

- [ ] **Step 6: 新增 resetForgotPassword 方法（Serializable 事务）**

```ts
async resetForgotPassword(dto: ResetForgotPasswordDto, ip?: string, userAgent?: string) {
  return this.prisma.$transaction(async (tx) => {
    await this.verifyCodeTx(tx, dto.phone, dto.code, SmsPurpose.BUYER_RESET);

    const identity = await tx.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.phone },
    });
    if (!identity) throw new BadRequestException({ code: 'PHONE_NOT_REGISTERED' });

    const newHash = await bcrypt.hash(dto.newPassword, 10);
    const newMeta = { ...(identity.meta as any), passwordHash: newHash };
    await tx.authIdentity.update({ where: { id: identity.id }, data: { meta: newMeta } });

    await this.recordPasswordReset(identity.userId, 'BUYER', dto.phone, ip, userAgent, tx);
    return { success: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

- [ ] **Step 7: verifyCodeTx（事务变体）+ Redis 失败计数**

- 失败分支：Redis `INCR reset:fail:buyer:{phone}` + 首次 `EXPIRE 300`
- 失败次数 ≥3 → `tx.smsOtp.updateMany({ where: { phone, purpose: BUYER_RESET, usedAt: null }, data: { usedAt: new Date() } })` 作废

- [ ] **Step 8: 审计日志写入 `LoginEvent`**

不新增 schema，直接复用现有 `LoginEvent` 表（`schema.prisma:711`，`auth.service.ts:707` 已有同类写入）：

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

**Verification:** `npx prisma validate` + `npx tsc --noEmit` 全通过，运行单元测试不退化。

---

## Task 3: 后端 — 买家端 Controller 路由

**Files:**
- Modify: `backend/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: 在 login/sms/code 路由之后新增两个端点**

```ts
@Public()
@Throttle({ default: { ttl: 60_000, limit: 3 } })
@Post('forgot-password/send-code')
sendForgotPasswordCode(@Body() dto: SendForgotPasswordCodeDto, @Req() req: Request) {
  return this.authService.sendForgotPasswordCode(dto, req.ip);
}

@Public()
@Throttle({ default: { ttl: 60_000, limit: 5 } })
@Post('forgot-password/reset')
resetForgotPassword(@Body() dto: ResetForgotPasswordDto, @Req() req: Request) {
  return this.authService.resetForgotPassword(dto, req.ip, req.headers['user-agent'] as string);
}
```

**Verification:** 用 `curl` 或 Postman 手工打一遍完整流程 → 200 成功，bcrypt.compare 新密码通过。**关键回归**：用 RESET 码去调 `/auth/login` mode=code 应该返回"验证码错误"（证明 scope 隔离生效）。

---

## Task 4: 后端 — 卖家端 DTO

**Files:**
- Create: `backend/src/modules/seller/auth/dto/seller-forgot-password.dto.ts`

- [ ] **Step 1: 创建三个 DTO**

```ts
import { IsString, Matches, Length, MinLength } from 'class-validator';

export class SellerSendForgotPasswordCodeDto {
  @Matches(/^1[3-9]\d{9}$/) phone: string;
  @IsString() captchaId: string;
  @IsString() @Length(4, 8) captchaCode: string;
}

export class SellerListCompaniesForResetDto {
  @Matches(/^1[3-9]\d{9}$/) phone: string;
  @Length(4, 8) code: string;
}

export class SellerResetForgotPasswordDto {
  @Matches(/^1[3-9]\d{9}$/) phone: string;
  @Length(4, 8) code: string;
  @IsString() staffId: string;
  @MinLength(6)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/, {
    message: '密码至少 6 位且必须包含大写字母、小写字母和数字',
  })
  newPassword: string;
}
```

为什么不复用买家端 DTO：`class-validator` 跨模块复用会把校验规则绑死到同一个 class。两份独立维护更安全。

---

## Task 5: 后端 — 卖家端 verifyCode 签名改造 + Service 逻辑

**Files:**
- Modify: `backend/src/modules/seller/auth/seller-auth.service.ts`
- Modify: `backend/src/modules/seller/auth/seller-auth.module.ts`

- [ ] **Step 1: seller-auth.module.ts 引入 CaptchaModule**

- [ ] **Step 2: seller-auth.service.ts 注入 CaptchaService**（已有 `captchaService` 可复用，若未注入则补上）

- [ ] **Step 3: 改造 `verifyCode` 签名为 purpose 必填（同 Task 2 Step 3）**

- [ ] **Step 4: 更新现有调用点**
  - `seller-auth.service.ts:86`（短信登录）→ 传 `SmsPurpose.LOGIN`
  - 如另有 BIND 等调用点，同步传对应 purpose
  - grep `verifyCode(` 确保零漏网

- [ ] **Step 5: 新增 verifyCodeReadonly（只读变体）**

```ts
private async verifyCodeReadonly(phone: string, code: string, purpose: SmsPurpose) {
  // 与 verifyCode 唯一差异：匹配成功后不执行 CAS 消费
  // 失败仍计入 Redis reset:fail:seller:{phone}，3 次失败作废该 purpose 下所有 OTP
  const records = await this.prisma.smsOtp.findMany({
    where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }, take: 5,
  });
  if (!records.length) throw new BadRequestException({ code: 'OTP_EXPIRED' });
  let matched = false;
  for (const r of records) {
    if (await bcrypt.compare(code, r.codeHash)) { matched = true; break; }
  }
  if (!matched) {
    await this.recordResetFailure(phone, 'seller');   // Redis INCR
    throw new BadRequestException({ code: 'OTP_INVALID' });
  }
}
```

- [ ] **Step 6: 新增 sendForgotPasswordCode（判定条件必须与 list-companies 完全一致）**

```ts
async sendForgotPasswordCode(dto: SellerSendForgotPasswordCodeDto, ip?: string) {
  const captchaOk = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
  if (!captchaOk) throw new BadRequestException({ code: 'CAPTCHA_INVALID' });

  // "可重置" = 至少一条 ACTIVE 的 CompanyStaff 且其所属 Company 也是 ACTIVE
  // 注意：CompanyStaffStatus 只有 ACTIVE / DISABLED（schema.prisma:85-88）
  // 该条件必须与 listCompaniesForReset 完全一致，否则短信发出后列表为空将造成死锁
  const staffCount = await this.prisma.companyStaff.count({
    where: {
      status: 'ACTIVE',
      company: { status: 'ACTIVE' },
      user: { authIdentities: { some: { provider: 'PHONE', identifier: dto.phone } } },
    },
  });
  if (staffCount === 0) {
    throw new NotFoundException({
      code: 'NO_RESETTABLE_COMPANY',
      message: '该手机号不存在可重置密码的企业账号',
    });
  }

  await this.createOtpWithRateLimit(dto.phone, SmsPurpose.SELLER_RESET, ip);
  return { success: true };
}
```

注意：现有 `createOtpWithRateLimit`（见 `seller-auth.service.ts:694`）可能硬编码 `purpose: 'LOGIN'`。同 Task 2 处理——把 purpose 提升为参数并更新所有调用点。

- [ ] **Step 7: 新增 listCompaniesForReset（只读验证 OTP）**

```ts
async listCompaniesForReset(dto: SellerListCompaniesForResetDto) {
  await this.verifyCodeReadonly(dto.phone, dto.code, SmsPurpose.SELLER_RESET);

  const staffs = await this.prisma.companyStaff.findMany({
    where: {
      status: 'ACTIVE',
      user: { authIdentities: { some: { provider: 'PHONE', identifier: dto.phone } } },
      company: { status: 'ACTIVE' },
    },
    include: { company: { select: { id: true, name: true, shortName: true } } },
  });

  return {
    success: true,
    companies: staffs.map((s) => ({
      staffId: s.id,
      companyId: s.companyId,
      companyName: s.company.shortName || s.company.name,
      role: s.role,
    })),
  };
}
```

- [ ] **Step 8: 新增 resetForgotPassword（CAS 消费 OTP + 只改指定 staffId）**

```ts
async resetForgotPassword(dto: SellerResetForgotPasswordDto, ip?: string, userAgent?: string) {
  return this.prisma.$transaction(async (tx) => {
    // 1. CAS 消费 OTP
    await this.verifyCodeTx(tx, dto.phone, dto.code, SmsPurpose.SELLER_RESET);

    // 2. 查 staff + 越权校验
    const staff = await tx.companyStaff.findUnique({
      where: { id: dto.staffId },
      include: {
        user: { include: { authIdentities: { where: { provider: 'PHONE' } } } },
        company: { select: { id: true, name: true, shortName: true, status: true } },
      },
    });
    if (!staff || staff.status !== 'ACTIVE' || staff.company.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'STAFF_NOT_FOUND' });
    }
    const phoneMatches = staff.user.authIdentities.some((i) => i.identifier === dto.phone);
    if (!phoneMatches) {
      throw new ForbiddenException({ code: 'STAFF_PHONE_MISMATCH' });   // 关键越权防护
    }

    // 3. 更新该 staff 的 passwordHash（方案 β：只改这一条）
    const newHash = await bcrypt.hash(dto.newPassword, 10);
    await tx.companyStaff.update({ where: { id: staff.id }, data: { passwordHash: newHash } });

    // 4. 审计：写入现有 LoginEvent 表（不新建 schema）
    await tx.loginEvent.create({
      data: {
        userId: staff.userId,
        provider: 'PHONE',
        phone: dto.phone,
        success: true,
        ip,
        userAgent,
        meta: { action: 'PASSWORD_RESET_VIA_SMS', scope: 'SELLER', staffId: staff.id, companyId: staff.companyId },
      },
    });

    return { success: true, companyName: staff.company.shortName || staff.company.name };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

**Verification:** `npx tsc --noEmit` + `npx prisma validate` 通过；本地手工测试：
1. 同一手机号在 A、B 两家公司均是 staff，走完流程选 A → 只改 A 的 passwordHash，B 不变
2. 尝试拿买家 `BUYER_RESET` 码调卖家 `list-companies` → OTP_INVALID（scope 隔离生效）
3. 尝试改别人手机号的 staff（构造 staffId 指向他人）→ 403 STAFF_PHONE_MISMATCH

---

## Task 6: 后端 — 卖家端 Controller 路由

**Files:**
- Modify: `backend/src/modules/seller/auth/seller-auth.controller.ts`

- [ ] **Step 1: 新增三个 @Public 路由（位置在 login-by-password 之后）**

```ts
@Public()
@Throttle({ default: { ttl: 60_000, limit: 3 } })
@Post('forgot-password/send-code')
sendForgotPasswordCode(@Body() dto: SellerSendForgotPasswordCodeDto, @Req() req: Request) {
  return this.authService.sendForgotPasswordCode(dto, req.ip);
}

@Public()
@Throttle({ default: { ttl: 60_000, limit: 10 } })   // list-companies 读多，可放宽
@Post('forgot-password/list-companies')
listCompaniesForReset(@Body() dto: SellerListCompaniesForResetDto) {
  return this.authService.listCompaniesForReset(dto);
}

@Public()
@Throttle({ default: { ttl: 60_000, limit: 5 } })
@Post('forgot-password/reset')
resetForgotPassword(@Body() dto: SellerResetForgotPasswordDto, @Req() req: Request) {
  return this.authService.resetForgotPassword(dto, req.ip, req.headers['user-agent'] as string);
}
```

---

## Task 7: 买家 App — AuthRepo 新增方法

**Files:**
- Modify: `src/repos/AuthRepo.ts`

- [ ] **Step 1: 沿用现有 `ApiClient` 风格（`AuthRepo.ts:31` 起），新增三个方法**

```ts
export const getCaptcha = async (): Promise<Result<{ captchaId: string; svg: string }>> => {
  return ApiClient.get<{ captchaId: string; svg: string }>('/captcha');   // 通用 captcha 路由
};

export const sendForgotPasswordCode = async (
  body: { phone: string; captchaId: string; captchaCode: string },
): Promise<Result<void>> => {
  return ApiClient.post<void>('/auth/forgot-password/send-code', body);
};

export const resetForgotPassword = async (
  body: { phone: string; code: string; newPassword: string },
): Promise<Result<void>> => {
  return ApiClient.post<void>('/auth/forgot-password/reset', body);
};
```

沿用 AuthRepo 里其他方法的 Result 封装模式和错误码透传约定（把 `PHONE_NOT_REGISTERED` / `CAPTCHA_INVALID` / `OTP_INVALID` 等 code 透传给调用方）。

---

## Task 8: 买家 App — 在 AuthModal 内嵌三步忘记密码向导（方案 A）

**Files:**
- Modify: `src/components/overlay/AuthModal.tsx`

不新增路由、不新增页面文件。扩展 AuthModal 内部状态机。

- [ ] **Step 0: 调用 /ui-ux-pro-max 获取设计指导**（三步向导 UI 在 Modal 内布局）

- [ ] **Step 1: 新增 state**

```tsx
type FlowMode = 'auth' | 'forgotPassword';
const [flowMode, setFlowMode] = useState<FlowMode>('auth');
const [fpStep, setFpStep] = useState<1 | 2 | 3>(1);
const [fpCaptcha, setFpCaptcha] = useState<{ captchaId: string; svg: string } | null>(null);
const [fpCaptchaCode, setFpCaptchaCode] = useState('');
const [fpCode, setFpCode] = useState('');          // SMS 验证码
const [fpNewPwd, setFpNewPwd] = useState('');
const [fpConfirmPwd, setFpConfirmPwd] = useState('');
const [fpResendCountdown, setFpResendCountdown] = useState(0);
```

- [ ] **Step 2: 在密码登录 tab 的密码输入框下方（约第 304 行附近）追加"忘记密码？"链接**

```tsx
{isLogin && loginMode === 'password' && flowMode === 'auth' && (
  <Pressable
    onPress={async () => {
      setFlowMode('forgotPassword');
      setFpStep(1);
      const r = await AuthRepo.getCaptcha();
      if (r.ok) setFpCaptcha(r.data);
    }}
    style={{ alignSelf: 'flex-end', marginTop: 8 }}
  >
    <Text style={{ color: colors.primary, fontSize: 13 }}>忘记密码？</Text>
  </Pressable>
)}
```

- [ ] **Step 3: 根据 flowMode 条件渲染**

在 AuthModal 的主渲染区域最外层：

```tsx
{flowMode === 'auth' ? (
  // 现有登录/注册 UI 保持不变
  <ExistingAuthUI />
) : (
  <ForgotPasswordWizard />
)}
```

`<ForgotPasswordWizard>` 是内联的 3 步渲染，不抽成独立组件（保持 state 集中在 AuthModal）。

- [ ] **Step 4: Step 1 UI — 手机号 + 图形验证码**

- 顶部"← 返回登录"按钮，点击：`setFlowMode('auth')` + 清空 fp* state
- 手机号输入框（与登录 tab 的风格一致，可考虑从登录态的 `phone` state 预填）
- 图形验证码输入框 + 右侧 SVG captcha 渲染区（点击刷新调 `AuthRepo.getCaptcha`）
- SVG 渲染方案：用 `react-native-svg` 的 `SvgXml` 组件（已在项目依赖中？否则用 base64 + `<Image>`）
- "下一步"按钮 → 调 `sendForgotPasswordCode`，成功后 `setFpStep(2)` 并启动 60 秒倒计时
- 错误：`PHONE_NOT_REGISTERED` 红字 + "去注册"按钮（`setFlowMode('auth')` + `setIsLogin(false)`）；`CAPTCHA_INVALID` 红字 + 自动 `getCaptcha()` 刷新

- [ ] **Step 5: Step 2 UI — 短信验证码 + 倒计时**

- 6 位数字输入（numeric 键盘）
- "重新发送"按钮：倒计时期间禁用，恢复后点击重新走 `sendForgotPasswordCode`（须重新输图形码→回 Step 1 刷新 captcha 或者这里允许"已持有 captcha 时直接重发"——**选前者**更安全，防短信炸弹）
- "下一步"按钮 → 本地暂存 code，`setFpStep(3)`

- [ ] **Step 6: Step 3 UI — 新密码**

- 新密码 + 确认密码两个安全输入框（明暗切换眼睛）
- 密码规则实时校验：大写 ✓ / 小写 ✓ / 数字 ✓ / ≥6 位（3 条条件分别 ✓/✗ 显示）
- "确认重置"按钮 → 校验两次密码一致 → 调 `resetForgotPassword`
- 成功处理：
  ```tsx
  setFlowMode('auth');
  setIsLogin(true);
  setLoginMode('password');
  setPhone(fpPhone);        // 预填手机号
  setPassword('');          // 清空密码让用户输入新密码
  setFpStep(1); setFpCaptchaCode(''); setFpCode(''); setFpNewPwd(''); setFpConfirmPwd('');
  showToast('密码已重置，请用新密码登录');
  // 可选：focusPasswordInput()
  ```
- 失败：`OTP_INVALID/EXPIRED` 红字（留在 Step 3 不跳回，用户可选择退回 Step 2 重发）；`PASSWORD_FORMAT_INVALID` 红字

- [ ] **Step 7: Loading + 错误兜底**
  - 每一步按钮在 API 调用期间 disabled，防止重复点击
  - 网络错误统一 Toast "网络异常，请稍后重试"
  - 关闭 AuthModal（onClose）时：重置 flowMode 和所有 fp* state

**Verification:** Expo 启动 App，手动走流程：登录 → 点"忘记密码？" → 三步完成 → 自动回到登录 tab（手机号预填）→ 用新密码登录成功。另外测试中途关闭 Modal 再打开，应回到登录态初始。

---

## Task 9: 卖家后台 — API 封装

**Files:**
- Create: `seller/src/api/forgot-password.ts`

- [ ] **Step 1: 新建文件（沿用 `seller/src/api/auth.ts:1` 的 `import client from './client'` 约定）**

```ts
import client from './client';

export const getCaptcha = (): Promise<{ captchaId: string; svg: string }> =>
  client.get('/seller/auth/captcha');    // 卖家专属 captcha 路由，不用通用 /captcha

export const sendForgotPasswordCode = (data: { phone: string; captchaId: string; captchaCode: string }) =>
  client.post('/seller/auth/forgot-password/send-code', data);

export const listCompaniesForReset = (
  data: { phone: string; code: string },
): Promise<{ companies: Array<{ staffId: string; companyId: string; companyName: string; role: string }> }> =>
  client.post('/seller/auth/forgot-password/list-companies', data);

export const resetForgotPassword = (
  data: { phone: string; code: string; staffId: string; newPassword: string },
): Promise<{ companyName: string }> =>
  client.post('/seller/auth/forgot-password/reset', data);
```

---

## Task 10: 卖家后台 — 忘记密码页面（四步方案 β）

**Files:**
- Create: `seller/src/pages/forgot-password/index.tsx`

- [ ] **Step 0: 调用 /ui-ux-pro-max 获取设计指导**
- [ ] **Step 1: 页面骨架**
  - 复用登录页的整体布局（居中卡片 + 品牌 Logo）
  - `<Steps current={step} items={['手机验证', '短信验证', '选择企业', '设置新密码']}>`
  - 底部"返回登录"链接
  - 本地 state 持有：`{ phone, code, companies, selectedStaffId }`
- [ ] **Step 2: Step 1 Form — 手机号 + 图形验证码**
  - `<Form>` + `<Form.Item>` 内置 rules
  - 图形验证码 SVG 渲染：`<img src={`data:image/svg+xml;base64,${btoa(svg)}`} />`
  - 点击图片刷新
  - 提交 → `sendForgotPasswordCode`
  - 失败：`STAFF_NOT_FOUND` / `CAPTCHA_INVALID` 红字提示 + 自动刷新验证码
- [ ] **Step 3: Step 2 Form — 短信验证码 + 60 秒倒计时**
  - 提交 → `listCompaniesForReset`，拿到企业列表后存入 state、进入 Step 3
  - 失败：`OTP_INVALID` / `OTP_EXPIRED` 提示（**不**回退 step，让用户重输或等倒计时重发）
- [ ] **Step 4: Step 3 — 选择企业**
  - `<Radio.Group>` 或 `<List>` 渲染 `companies` 数组
  - 每项显示：企业名 + 角色标签（OWNER / MANAGER / OPERATOR）
  - 若只有一家企业，默认选中并自动跳转 Step 4（但仍展示一步让用户确认）
  - 选定后 "下一步" 进入 Step 4
- [ ] **Step 5: Step 4 Form — 新密码**
  - `<Input.Password>` + `<Form.Item>` 规则（≥6 位 + 大小写 + 数字）
  - 密码强度组件（实时校验 3 个条件并分别用 ✓/✗ 显示）
  - 提交 → `resetForgotPassword(phone, code, selectedStaffId, newPassword)`
- [ ] **Step 6: 成功处理**
  - `const { message } = App.useApp();` 弹 `密码已重置，企业【${companyName}】可用新密码登录`
  - `navigate('/login')`
- [ ] **Step 7: 错误处理**
  - `NO_RESETTABLE_COMPANY`（404，Step 1 send-code 返回）→ 手机号输入框下红字"该手机号不存在可重置密码的企业账号"
  - `STAFF_NOT_FOUND`（400，Step 4 reset 返回，比如选中后企业或 staff 被改为 DISABLED）→ 提示"所选企业已不可用，请返回重新选择"并回到 Step 3
  - `STAFF_PHONE_MISMATCH`（403）→ 理论不应出现，若出现提示"数据异常，请重新操作"并回到 Step 1
  - `OTP_INVALID`/`OTP_EXPIRED`（Step 2/4 均可能返回）→ 红字提示，不清空前置状态
  - `CAPTCHA_INVALID` → 自动刷新验证码
  - **禁止**使用静态 `message` / `Modal.confirm`，统一走 `App.useApp()` hook（CLAUDE.md）

**Verification:** `npm run build` 通过；浏览器 E2E 走完四步流程，验证"多企业员工选定 A 只改 A、B 不变"；另外测试单企业员工路径（应自动选中 A、仍走一次确认）。

---

## Task 11: 卖家后台 — 登录页入口 + 路由

**Files:**
- Modify: `seller/src/pages/login/index.tsx`
- Modify: `seller/src/App.tsx`（或路由配置文件，具体名以实际为准）

- [ ] **Step 1: 登录页密码 Tab 加入口**

在第 443-477 行区间的密码登录表单底部（登录按钮之后、图形验证码之前或之后）追加：

```tsx
<div style={{ textAlign: 'right', marginBottom: 12 }}>
  <Button type="link" size="small" onClick={() => navigate('/forgot-password')}>
    忘记密码？
  </Button>
</div>
```

- [ ] **Step 2: App.tsx 路由表增加**

```tsx
{ path: '/forgot-password', element: <ForgotPasswordPage /> }
```

注意：`/forgot-password` 路由**不需要 SellerAuthGuard**，要放在登录页同级（未登录可访问）。

---

## Task 12: 管理后台 — 登录页灰字提示

**Files:**
- Modify: `admin/src/pages/login/index.tsx`

- [ ] **Step 1: 密码登录 Tab 的登录按钮下方（第 419-429 行区间后）追加**

```tsx
<Typography.Text
  type="secondary"
  style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 12 }}
>
  忘记密码请联系超级管理员重置
</Typography.Text>
```

不加 onClick，不加跳转，纯文字提示。

---

## Task 13: 文档同步

**Files:**
- Modify: `docs/operations/密码本.md`
- Modify: `CLAUDE.md`
- Modify: `plan.md`

- [ ] **Step 1: 密码本追加 admin 应急 SQL**

在"应急流程"章节（若无则新建）追加 spec 第七节给出的五步 SQL 重置流程。**注意**：密码本已 gitignore，此步在本地 checkout 完成即可。

- [ ] **Step 2: CLAUDE.md 追加文档索引**

在"设计方案与实施计划"章节追加两条：
```
- `docs/superpowers/specs/2026-04-23-forgot-password-design.md` — 忘记密码功能设计方案（买家 App + 卖家后台自助重置、管理后台仅提示、三端独立、卖家方案 β 按企业选择性重置、SmsPurpose 新增 BUYER_RESET/SELLER_RESET、verifyCode purpose 必填，**忘记密码功能权威来源**）
- `docs/superpowers/plans/2026-04-23-forgot-password.md` — 忘记密码实施计划（15 个任务：Schema × 1 + 后端 × 6 + 买家 App（含 AuthModal 内嵌向导）× 2 + 卖家后台 × 3 + 管理后台 × 1 + 文档 × 1 + 验收 × 1）
```

- [ ] **Step 3: plan.md 追加条目**

在合适的 Batch 末尾追加：
```
- [ ] F-FP01 忘记密码功能（买家 App + 卖家后台自助重置，管理后台提示文字）—— 详见 `docs/superpowers/plans/2026-04-23-forgot-password.md`
```

---

## Task 14: 集成测试与验收

**Files:** N/A（手动验证）

- [ ] **Step 1: 后端联调（买家）**
  - `GET /captcha` → `POST /auth/forgot-password/send-code` → 查看 `SmsOtp` 写入 `purpose=BUYER_RESET` + 阿里云 Mock 日志 → `POST /auth/forgot-password/reset` → 用新密码 `POST /auth/login` mode=password 成功
  - **scope 隔离回归**：拿上一步的 BUYER_RESET 码去打 `/auth/login` mode=code → 验证码错误（证明 verifyCode purpose=LOGIN 过滤生效，不会把 RESET 码当作登录码）
- [ ] **Step 2: 后端联调（卖家）**
  - 三步流程走一遍：`send-code` → `list-companies`（OTP 不被消费，多次调用均可返回企业列表）→ `reset`（OTP 此时才被消费）→ 用新密码调 `POST /seller/auth/login-by-password` 成功
  - **scope 隔离回归**：拿 `BUYER_RESET` 码去调 `/seller/auth/forgot-password/list-companies` → OTP_INVALID；反之亦然
  - **多企业重置**：同一手机号在 A、B 两家均为 ACTIVE staff，选 A 重置 → 确认 A.passwordHash 变了、B.passwordHash 不变
  - **越权防护**：构造一个 `staffId` 指向另一个手机号的 staff，用当前 phone 的 OTP 去 reset → 403 STAFF_PHONE_MISMATCH
  - **DISABLED staff / DISABLED company 过滤**：
    - 将 A 的 staff 改为 DISABLED，再走 send-code → 若用户只在 A 一家 → `404 NO_RESETTABLE_COMPANY`（不浪费短信）
    - 若用户在 A、B 两家，把 A 设 DISABLED，send-code 通过 → list-companies 只返回 B
    - 把 A 的 Company.status 设 DISABLED（staff 仍 ACTIVE）→ 效果同上
- [ ] **Step 3: 买家 App 手机端验证**
  - Expo 启动，真机或模拟器走完整三步流程
  - 故意输错场景：未注册手机号、图形验证码错、短信验证码错三次（触发作废）、密码格式不符
- [ ] **Step 4: 卖家后台浏览器 E2E**
  - Chrome 无痕模式走完整四步流程（含"选择企业"）
  - 验证 `App.useApp()` 的 `message` 正常弹出（禁止静态 message 失效回归）
- [ ] **Step 5: 管理后台登录页回归**
  - 确认新增的灰字文案居中、字体层级合适
  - 原有密码登录、短信登录功能未被影响
- [ ] **Step 6: 代码审查 Agent**
  - 完成所有前后端改动后，启动独立 `Explore` agent 按 CLAUDE.md 的审查维度扫描本次改动：
    - Schema migration 是否 ADD VALUE 而非 DROP/RENAME
    - verifyCode 所有调用点是否全部传 purpose（grep 无漏网）
    - 卖家端 list-companies 是否严格只读（无 `update`）
    - reset 接口是否带 staffId 归属校验
    - 三端 TS 类型与后端返回字段一致
  - 修复所有 High/Critical 问题

---

## Risks & Tradeoffs

| 风险 | 处理 |
|---|---|
| 阿里云短信模板复用 | 用户决定复用现有登录模板，文案通用（"您的验证码：{code}，5分钟内有效"）；实现时先用 Mock 验证逻辑，真实发送由运维确认模板 ID 配置 |
| Captcha SVG 在 RN 里渲染需要额外库 | 首选 `react-native-svg-uri` 或 base64 转图片方案；实现时评估两种哪种 bundle 增量更小 |
| `verifyCode` 改签名为 purpose 必填 → 编译期改动面广 | **刻意这么设计**：编译期强制暴露所有调用点，避免"默认不传就不过滤"的宽松方案埋跨 scope 串用隐患；Task 2/5 的 Step 4 专门用于 grep 全库更新调用点 |
| 卖家 list-companies 只读验证 OTP 允许多次读取企业列表 | 产品可接受：持码者已证明手机号控制权，企业列表不属于高敏信息；真正密码变更仍受 reset 的 CAS 消费保护 |
| Schema migration `ALTER TYPE ADD VALUE` 在事务内不可执行（PostgreSQL 限制） | Prisma 自动拆成独立语句执行；`migrate deploy` 在生产可安全运行（零停机） |
| 卖家端多企业员工每家忘记密码要走多次 | 产品接受：少数场景，且比"一次重置全部"（γ 方案与 loginByPassword "命中即跳"冲突）更安全 |
| Redis 不可用时失败计数失效 | 主流程仍能工作（OTP 仍可验证），只是 3 次作废保护失效；沿用现有降级策略 |
| 管理后台灰字提示后用户自行无出口 | 超管用已有 `/admin/users/:id/reset-password` 代改（已限流 5 次/小时） |
| 现有 `SmsPurpose.RESET` 枚举值遗留不用 | 保留占位防止未知引用破裂，后续独立迁移退役 |
