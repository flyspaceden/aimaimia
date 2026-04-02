# 延迟深度链接（Deferred Deep Link）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现推荐码从扫码到注册的全链路无感知传递，支持已装/未装 App 两条链路。

**Architecture:** 后端新增 DeferredDeepLink 模块处理指纹采集与匹配；网站新增落地页（/r/:code、/download、/resolve）；App 端新增 Universal Link 拦截 + 首次启动延迟匹配 + 注册后自动绑定。Cookie 为主 + 指纹兜底双层匹配策略。

**Tech Stack:** NestJS (后端模块) / Prisma (数据模型) / Vite + React (网站落地页) / Expo Router + AsyncStorage (App 端) / crypto (SHA256 指纹)

**Spec:** `docs/superpowers/specs/2026-03-27-deferred-deep-link-design.md`

---

## 文件结构

### 新增文件
| 文件 | 职责 |
|------|------|
| `backend/src/modules/deferred-link/deferred-link.module.ts` | NestJS 模块注册 |
| `backend/src/modules/deferred-link/deferred-link.controller.ts` | 3 个公开 API 端点 |
| `backend/src/modules/deferred-link/deferred-link.service.ts` | 核心业务逻辑：创建/resolve/match/cleanup |
| `backend/src/modules/deferred-link/dto/create-deferred-link.dto.ts` | POST /deferred-link 入参校验 |
| `backend/src/modules/deferred-link/dto/match-deferred-link.dto.ts` | POST /deferred-link/match 入参校验 |
| `backend/prisma/migrations/2026XXXX_add_deferred_deep_link/migration.sql` | 数据库迁移 |
| `website/src/pages/Download.tsx` | 通用下载落地页（/r/:code 和 /download 共用） |
| `website/src/pages/Resolve.tsx` | Cookie 读取 + scheme 回传页面 |
| `src/services/deferredLink.ts` | App 端延迟匹配逻辑封装 |

### 修改文件
| 文件 | 修改内容 |
|------|---------|
| `backend/prisma/schema.prisma` | 新增 DeferredDeepLink 模型 |
| `backend/src/app.module.ts` | 注册 DeferredLinkModule |
| `backend/src/modules/bonus/bonus.service.ts` | useReferralCode 支持换绑（VIP 前） |
| `app.json` | 更新 associatedDomains + 新增 Android intentFilters |
| `app/_layout.tsx` | URL 监听 + 首次启动延迟匹配 |
| `app/me/referral.tsx` | deepLink 域名 nongmai.app → app.xn--ckqa175y.com |
| `app/me/scanner.tsx` | URL 匹配正则域名替换 |
| `app/(tabs)/me.tsx` | deepLink 域名替换 |
| `src/store/useAuthStore.ts` | 注册成功后触发推荐码自动绑定 |
| `website/src/App.tsx` | 新增 /r/:code、/download、/resolve 路由 |
| `website/src/main.tsx` | HashRouter → BrowserRouter（落地页需要真实路径） |

---

### Task 1: Prisma Schema — 新增 DeferredDeepLink 模型

**Files:**
- Modify: `backend/prisma/schema.prisma:1682` (在 ReferralLink 模型之后)

- [ ] **Step 1: 在 schema.prisma 中 ReferralLink 模型后面添加 DeferredDeepLink 模型**

在 `backend/prisma/schema.prisma` 的 ReferralLink 模型（第 1682 行 `}` 后面）添加：

```prisma
model DeferredDeepLink {
  id            String   @id @default(cuid())
  referralCode  String
  fingerprint   String
  ipAddress     String
  userAgent     String
  screenInfo    String?
  language      String?
  cookieId      String   @unique
  matched       Boolean  @default(false)
  expiresAt     DateTime
  createdAt     DateTime @default(now())

  @@index([fingerprint, matched, expiresAt])
  @@index([ipAddress, matched, expiresAt])
  @@index([expiresAt])
}
```

- [ ] **Step 2: 验证 Schema**

Run: `cd backend && npx prisma validate`
Expected: `✔ Your Prisma schema is valid.`

- [ ] **Step 3: 创建数据库迁移**

Run: `cd backend && npx prisma migrate dev --name add_deferred_deep_link`

如果提示 drift，手动创建迁移目录和 SQL 文件：

```sql
-- CreateTable
CREATE TABLE "DeferredDeepLink" (
    "id" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "screenInfo" TEXT,
    "language" TEXT,
    "cookieId" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeferredDeepLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeferredDeepLink_cookieId_key" ON "DeferredDeepLink"("cookieId");
CREATE INDEX "DeferredDeepLink_fingerprint_matched_expiresAt_idx" ON "DeferredDeepLink"("fingerprint", "matched", "expiresAt");
CREATE INDEX "DeferredDeepLink_ipAddress_matched_expiresAt_idx" ON "DeferredDeepLink"("ipAddress", "matched", "expiresAt");
CREATE INDEX "DeferredDeepLink_expiresAt_idx" ON "DeferredDeepLink"("expiresAt");
```

- [ ] **Step 4: 生成 Prisma Client**

Run: `cd backend && npx prisma generate`

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(schema): add DeferredDeepLink model for referral fingerprint tracking"
```

---

### Task 2: 后端 — DeferredLink 模块骨架

**Files:**
- Create: `backend/src/modules/deferred-link/deferred-link.module.ts`
- Create: `backend/src/modules/deferred-link/dto/create-deferred-link.dto.ts`
- Create: `backend/src/modules/deferred-link/dto/match-deferred-link.dto.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: 创建 DTO — CreateDeferredLinkDto**

Create `backend/src/modules/deferred-link/dto/create-deferred-link.dto.ts`:

```typescript
import { IsString, IsInt, IsOptional, MaxLength, Min, Max, Matches } from 'class-validator';

export class CreateDeferredLinkDto {
  @IsString()
  @Matches(/^[A-Z0-9]{8}$/, { message: '推荐码格式无效' })
  referralCode: string;

  @IsString()
  @MaxLength(500)
  userAgent: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  screenWidth: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  screenHeight: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;
}
```

- [ ] **Step 2: 创建 DTO — MatchDeferredLinkDto**

Create `backend/src/modules/deferred-link/dto/match-deferred-link.dto.ts`:

```typescript
import { IsString, IsInt, IsOptional, MaxLength, Min, Max } from 'class-validator';

export class MatchDeferredLinkDto {
  @IsString()
  @MaxLength(500)
  userAgent: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  screenWidth: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  screenHeight: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;
}
```

- [ ] **Step 3: 创建 Module**

Create `backend/src/modules/deferred-link/deferred-link.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DeferredLinkController } from './deferred-link.controller';
import { DeferredLinkService } from './deferred-link.service';

@Module({
  controllers: [DeferredLinkController],
  providers: [DeferredLinkService],
})
export class DeferredLinkModule {}
```

- [ ] **Step 4: 注册模块到 AppModule**

在 `backend/src/app.module.ts` 中：

文件顶部添加 import：
```typescript
import { DeferredLinkModule } from './modules/deferred-link/deferred-link.module';
```

在 `imports` 数组中 `MerchantApplicationModule` 后面添加：
```typescript
    DeferredLinkModule,
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/deferred-link/ backend/src/app.module.ts
git commit -m "feat(deferred-link): add module skeleton with DTOs"
```

---

### Task 3: 后端 — DeferredLinkService 核心逻辑

**Files:**
- Create: `backend/src/modules/deferred-link/deferred-link.service.ts`

- [ ] **Step 1: 创建 DeferredLinkService**

Create `backend/src/modules/deferred-link/deferred-link.service.ts`:

```typescript
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeferredLinkService {
  private readonly logger = new Logger(DeferredLinkService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 归一化 User-Agent：去除微信特征后缀，使微信内 UA 与系统浏览器 UA 一致
   */
  private normalizeUA(ua: string): string {
    return ua
      .replace(/\s*MicroMessenger\/[\d.]+/i, '')
      .replace(/\s*NetType\/\w+/i, '')
      .replace(/\s*Language\/[\w-]+/i, '')
      .replace(/\s*miniProgram\/[\d.]+/i, '')
      .trim()
      .slice(0, 500);
  }

  /**
   * 计算设备指纹哈希
   */
  private computeFingerprint(ip: string, ua: string, screenInfo: string, language: string): string {
    const normalized = this.normalizeUA(ua);
    const raw = `${ip}|${normalized}|${screenInfo}|${language}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * 创建延迟深度链接记录
   */
  async create(
    dto: { referralCode: string; userAgent: string; screenWidth: number; screenHeight: number; language?: string },
    ipAddress: string,
  ): Promise<{ cookieId: string }> {
    // 校验推荐码有效性
    const member = await this.prisma.memberProfile.findUnique({
      where: { referralCode: dto.referralCode },
    });
    if (!member) {
      throw new BadRequestException('推荐码无效');
    }

    const screenInfo = `${dto.screenWidth}x${dto.screenHeight}`;
    const language = dto.language || '';
    const fingerprint = this.computeFingerprint(ipAddress, dto.userAgent, screenInfo, language);

    const record = await this.prisma.deferredDeepLink.create({
      data: {
        referralCode: dto.referralCode,
        fingerprint,
        ipAddress,
        userAgent: dto.userAgent.slice(0, 500),
        screenInfo,
        language: language || null,
        cookieId: this.generateCookieId(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 小时
      },
    });

    return { cookieId: record.cookieId };
  }

  /**
   * 通过 cookieId 解析推荐码（Cookie 方式）
   */
  async resolve(cookieId: string): Promise<{ referralCode: string | null }> {
    if (!cookieId || cookieId.length > 50) {
      return { referralCode: null };
    }

    const record = await this.prisma.deferredDeepLink.findUnique({
      where: { cookieId },
    });

    if (!record || record.matched || record.expiresAt < new Date()) {
      return { referralCode: null };
    }

    await this.prisma.deferredDeepLink.update({
      where: { id: record.id },
      data: { matched: true },
    });

    return { referralCode: record.referralCode };
  }

  /**
   * 通过设备指纹匹配推荐码（兜底方式）
   */
  async match(
    dto: { userAgent: string; screenWidth: number; screenHeight: number; language?: string },
    ipAddress: string,
  ): Promise<{ referralCode: string | null }> {
    const screenInfo = `${dto.screenWidth}x${dto.screenHeight}`;
    const language = dto.language || '';
    const fingerprint = this.computeFingerprint(ipAddress, dto.userAgent, screenInfo, language);
    const now = new Date();

    // 第一优先级：精确指纹匹配
    const exactMatch = await this.prisma.deferredDeepLink.findFirst({
      where: {
        fingerprint,
        matched: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (exactMatch) {
      await this.prisma.deferredDeepLink.update({
        where: { id: exactMatch.id },
        data: { matched: true },
      });
      return { referralCode: exactMatch.referralCode };
    }

    // 第二优先级：模糊匹配（同 IP + 相似屏幕信息）
    const fuzzyMatch = await this.prisma.deferredDeepLink.findFirst({
      where: {
        ipAddress,
        screenInfo,
        matched: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (fuzzyMatch) {
      await this.prisma.deferredDeepLink.update({
        where: { id: fuzzyMatch.id },
        data: { matched: true },
      });
      return { referralCode: fuzzyMatch.referralCode };
    }

    return { referralCode: null };
  }

  /**
   * 定时清理过期记录（每日凌晨 3:00）
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpired() {
    const result = await this.prisma.deferredDeepLink.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`清理过期 DeferredDeepLink 记录：${result.count} 条`);
    }
  }

  private generateCookieId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'ddl_';
    for (let i = 0; i < 24; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/deferred-link/deferred-link.service.ts
git commit -m "feat(deferred-link): implement service with create/resolve/match/cleanup"
```

---

### Task 4: 后端 — DeferredLinkController（3 个公开 API）

**Files:**
- Create: `backend/src/modules/deferred-link/deferred-link.controller.ts`

- [ ] **Step 1: 创建 Controller**

Create `backend/src/modules/deferred-link/deferred-link.controller.ts`:

```typescript
import { Controller, Post, Get, Body, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DeferredLinkService } from './deferred-link.service';
import { CreateDeferredLinkDto } from './dto/create-deferred-link.dto';
import { MatchDeferredLinkDto } from './dto/match-deferred-link.dto';

@Controller('deferred-link')
export class DeferredLinkController {
  constructor(private service: DeferredLinkService) {}

  /**
   * 创建延迟深度链接记录（网页落地页调用）
   * 限流：同一 IP 10 次/小时
   */
  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post()
  create(@Body() dto: CreateDeferredLinkDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    return this.service.create(dto, ip);
  }

  /**
   * 通过 cookieId 解析推荐码（App 隐藏浏览器调用）
   * 限流：同一 IP 20 次/小时
   */
  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @Get('resolve')
  resolve(@Query('cookieId') cookieId: string) {
    return this.service.resolve(cookieId);
  }

  /**
   * 通过设备指纹匹配推荐码（App 兜底调用）
   * 限流：同一 IP 5 次/小时
   */
  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post('match')
  match(@Body() dto: MatchDeferredLinkDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    return this.service.match(dto, ip);
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/deferred-link/deferred-link.controller.ts
git commit -m "feat(deferred-link): add controller with rate-limited public endpoints"
```

---

### Task 5: 后端 — 修改 useReferralCode 支持换绑

**Files:**
- Modify: `backend/src/modules/bonus/bonus.service.ts:50-96`

- [ ] **Step 1: 修改 useReferralCode 方法**

在 `backend/src/modules/bonus/bonus.service.ts` 中，将 `useReferralCode` 方法（第 50-96 行）替换为：

```typescript
  /** 使用推荐码（支持换绑：VIP 前允许更换推荐人） */
  async useReferralCode(userId: string, code: string) {
    const inviter = await this.prisma.memberProfile.findUnique({
      where: { referralCode: code },
    });
    if (!inviter) throw new BadRequestException('推荐码无效');
    if (inviter.userId === userId) throw new BadRequestException('不能使用自己的推荐码');

    // 检查当前用户是否已购买 VIP（已购买则锁定推荐关系）
    const currentMember = await this.prisma.memberProfile.findUnique({
      where: { userId },
    });
    if (currentMember?.tier === 'VIP') {
      throw new BadRequestException('已加入 VIP 团队，无法更换推荐人');
    }

    // 检查是否已有邀请关系
    const existing = await this.prisma.referralLink.findUnique({
      where: { inviteeUserId: userId },
    });

    if (existing && existing.inviterUserId === inviter.userId) {
      // 已绑定同一推荐人，幂等返回
      return { success: true, inviterUserId: inviter.userId };
    }

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        // 换绑：更新已有的 ReferralLink
        await tx.referralLink.update({
          where: { inviteeUserId: userId },
          data: {
            inviterUserId: inviter.userId,
            codeUsed: code,
          },
        });
      } else {
        // 首次绑定：创建 ReferralLink
        await tx.referralLink.create({
          data: {
            inviterUserId: inviter.userId,
            inviteeUserId: userId,
            codeUsed: code,
          },
        });
      }

      await tx.memberProfile.upsert({
        where: { userId },
        create: {
          userId,
          inviterUserId: inviter.userId,
          referralCode: this.generateReferralCode(),
        },
        update: { inviterUserId: inviter.userId },
      });
    });

    // Phase F: 邀请成功后触发 INVITE 红包（发给邀请人，失败不阻塞主流程）
    this.couponEngine
      .handleTrigger(inviter.userId, 'INVITE', {
        inviteeUserId: userId,
      })
      .catch((err: any) => {
        this.logger.warn(
          `INVITE 红包触发失败: inviterUserId=${inviter.userId}, inviteeUserId=${userId}, error=${err?.message}`,
        );
      });

    return { success: true, inviterUserId: inviter.userId };
  }
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/bonus/bonus.service.ts
git commit -m "feat(bonus): allow referral re-binding before VIP purchase"
```

---

### Task 6: 域名统一 — 全局替换 nongmai 域名引用

**Files:**
- Modify: `app.json`
- Modify: `app/me/referral.tsx:35`
- Modify: `app/me/scanner.tsx:73-74`
- Modify: `app/(tabs)/me.tsx:106`

- [ ] **Step 1: 更新 app.json — associatedDomains + Android intentFilters**

将 `app.json` 全部替换为：

```json
{
  "expo": {
    "name": "AI爱买买",
    "slug": "ai-aimaimai",
    "scheme": "aimaimai",
    "plugins": [
      "expo-router"
    ],
    "android": {
      "package": "com.aimaimai.shop",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "app.xn--ckqa175y.com",
              "pathPrefix": "/r/"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    "ios": {
      "bundleIdentifier": "com.aimaimai.shop",
      "associatedDomains": ["applinks:app.xn--ckqa175y.com"]
    }
  }
}
```

- [ ] **Step 2: 更新 app/me/referral.tsx — deepLink 域名**

将第 35 行：
```typescript
  const deepLink = `https://nongmai.app/r/${referralCode}`;
```
替换为：
```typescript
  const deepLink = `https://app.xn--ckqa175y.com/r/${referralCode}`;
```

- [ ] **Step 3: 更新 app/me/scanner.tsx — URL 匹配正则**

将第 73-74 行：
```typescript
    // 支持 URL 格式: https://nongmai.app/r/CODE
    const urlMatch = data.match(/nongmai\.app\/r\/([A-Za-z0-9]{8})/);
```
替换为：
```typescript
    // 支持 URL 格式: https://app.xn--ckqa175y.com/r/CODE
    const urlMatch = data.match(/app\.xn--ckqa175y\.com\/r\/([A-Za-z0-9]{8})/);
```

- [ ] **Step 4: 更新 app/(tabs)/me.tsx — deepLink 域名**

将第 106 行：
```typescript
  const deepLink = `https://nongmai.app/r/${referralCode}`;
```
替换为：
```typescript
  const deepLink = `https://app.xn--ckqa175y.com/r/${referralCode}`;
```

- [ ] **Step 5: Commit**

```bash
git add app.json app/me/referral.tsx app/me/scanner.tsx "app/(tabs)/me.tsx"
git commit -m "fix: unify domain references from nongmai.app to app.xn--ckqa175y.com"
```

---

### Task 7: 网站 — 路由改造 + 下载落地页

**Files:**
- Modify: `website/src/main.tsx` (HashRouter → BrowserRouter)
- Modify: `website/src/App.tsx` (新增路由)
- Create: `website/src/pages/Download.tsx`

- [ ] **Step 1: 修改 main.tsx — 使用 BrowserRouter**

将 `website/src/main.tsx` 替换为：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 2: 修改 App.tsx — 添加路由**

在 `website/src/App.tsx` 中：

添加 lazy import（在现有 import 后面）：
```tsx
const Download = lazy(() => import('@/pages/Download'))
const Resolve = lazy(() => import('@/pages/Resolve'))
```

在 `<Routes>` 内，`<Route path="*"` 之前添加：
```tsx
            <Route path="/r/:code" element={<Download />} />
            <Route path="/download" element={<Download />} />
            <Route path="/resolve" element={<Resolve />} />
```

注意：`/r/:code`、`/download`、`/resolve` 这三个路由的页面不应该显示 Navbar 和 Footer。修改 `App.tsx` 的结构，在 `/r/:code`、`/download`、`/resolve` 路由时隐藏 Navbar/Footer：

将 `App.tsx` 的完整 return 改为：

```tsx
export default function App() {
  const location = useLocation()
  const isLandingPage = location.pathname.startsWith('/r/') || location.pathname === '/download' || location.pathname === '/resolve'

  return (
    <>
      <MetaUpdater />
      {!isLandingPage && <Navbar />}
      <main id="main-content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/ai" element={<AiTech />} />
            <Route path="/about" element={<About />} />
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/merchants/apply" element={<MerchantApply />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/r/:code" element={<Download />} />
            <Route path="/download" element={<Download />} />
            <Route path="/resolve" element={<Resolve />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      {!isLandingPage && <Footer />}
    </>
  )
}
```

- [ ] **Step 3: 创建 Download.tsx 落地页**

Create `website/src/pages/Download.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'
const APP_DOMAIN = 'app.xn--ckqa175y.com'

type Platform = 'ios' | 'android' | 'desktop'
type Environment = 'wechat' | 'browser'

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}

function detectEnvironment(): Environment {
  const ua = navigator.userAgent.toLowerCase()
  if (/micromessenger/.test(ua)) return 'wechat'
  return 'browser'
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`
}

export default function Download() {
  const { code } = useParams<{ code?: string }>()
  const [showWechatGuide, setShowWechatGuide] = useState(false)
  const platform = detectPlatform()
  const env = detectEnvironment()

  useEffect(() => {
    if (!code) return

    // 静默上报指纹 + 获取 cookieId
    const reportFingerprint = async () => {
      try {
        const res = await fetch(`${API_BASE}/deferred-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referralCode: code.toUpperCase(),
            userAgent: navigator.userAgent,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            language: navigator.language,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.cookieId) {
            setCookie('_ddl_id', data.data.cookieId, 7)
          }
        }
      } catch {
        // 静默失败，不影响用户体验
      }
    }

    reportFingerprint()

    // 非微信环境尝试 Universal Link 唤起
    if (env !== 'wechat' && platform !== 'desktop') {
      window.location.href = `https://${APP_DOMAIN}/r/${code}`
      // 2 秒后如果没跳走，说明没装 App，保持当前页面
    }
  }, [code, env, platform])

  useEffect(() => {
    if (env === 'wechat') {
      setShowWechatGuide(true)
    }
  }, [env])

  const handleDownload = () => {
    if (env === 'wechat') {
      setShowWechatGuide(true)
      return
    }
    if (platform === 'ios') {
      // TODO: 替换为真实 App Store 链接
      window.location.href = 'https://apps.apple.com/app/id000000000'
    } else if (platform === 'android') {
      // TODO: 替换为真实应用商店链接
      window.location.href = 'https://play.google.com/store/apps/details?id=com.aimaimai.shop'
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a1628 0%, #1a2744 50%, #0d1f3c 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{
        width: 80, height: 80, borderRadius: 20,
        background: 'linear-gradient(135deg, #2E7D32, #66BB6A)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 24, boxShadow: '0 8px 32px rgba(46, 125, 50, 0.3)',
      }}>
        <span style={{ fontSize: 36, color: '#fff', fontWeight: 700 }}>买</span>
      </div>

      {/* 品牌名 */}
      <h1 style={{
        fontSize: 28, fontWeight: 700, color: '#fff',
        margin: '0 0 8px 0', letterSpacing: 2,
      }}>
        爱买买
      </h1>

      <p style={{
        fontSize: 16, color: 'rgba(255,255,255,0.7)',
        margin: '0 0 40px 0', textAlign: 'center',
      }}>
        加入爱买买，发现优质农产品
      </p>

      {/* 下载按钮 */}
      {platform !== 'desktop' ? (
        <button
          onClick={handleDownload}
          style={{
            background: 'linear-gradient(135deg, #2E7D32, #43A047)',
            color: '#fff', border: 'none', borderRadius: 50,
            padding: '16px 48px', fontSize: 18, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(46, 125, 50, 0.4)',
            transition: 'transform 0.2s',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {platform === 'ios' ? '前往 App Store 下载' : '前往应用商店下载'}
        </button>
      ) : (
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
          请在手机上打开此页面下载 App
        </p>
      )}

      {/* 微信引导遮罩 */}
      {showWechatGuide && (
        <div
          onClick={() => setShowWechatGuide(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'flex-end', paddingTop: 20, paddingRight: 24,
          }}
        >
          {/* 箭头指向右上角 */}
          <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
            <path d="M30 50 L30 15 L15 30" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M30 15 L45 30" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <p style={{
            color: '#fff', fontSize: 18, fontWeight: 600,
            textAlign: 'right', marginTop: 16, lineHeight: 1.6,
          }}>
            点击右上角 ··· <br />
            选择「在浏览器中打开」
          </p>
          <p style={{
            color: 'rgba(255,255,255,0.5)', fontSize: 14,
            textAlign: 'center', position: 'absolute', bottom: 40,
            left: 0, right: 0,
          }}>
            点击任意位置关闭
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add website/src/main.tsx website/src/App.tsx website/src/pages/Download.tsx
git commit -m "feat(website): add download landing page with fingerprint collection"
```

---

### Task 8: 网站 — Resolve 页面（Cookie 读取 + scheme 回传）

**Files:**
- Create: `website/src/pages/Resolve.tsx`

- [ ] **Step 1: 创建 Resolve.tsx**

Create `website/src/pages/Resolve.tsx`:

```tsx
import { useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * /resolve 页面
 *
 * 由 App 的隐藏浏览器（SFSafariViewController / Chrome Custom Tab）访问。
 * 读取之前落地页写入的 Cookie，调用后端 resolve 接口获取推荐码，
 * 然后通过 URL scheme 将结果回传给 App。
 */
export default function Resolve() {
  useEffect(() => {
    const resolve = async () => {
      const cookieId = getCookie('_ddl_id')

      if (cookieId) {
        try {
          const res = await fetch(`${API_BASE}/deferred-link/resolve?cookieId=${encodeURIComponent(cookieId)}`)
          if (res.ok) {
            const data = await res.json()
            const code = data.data?.referralCode
            if (code) {
              window.location.href = `aimaimai://referral?code=${code}`
              return
            }
          }
        } catch {
          // 静默失败
        }
      }

      // 无 Cookie 或匹配失败
      window.location.href = 'aimaimai://referral?code=none'
    }

    resolve()
  }, [])

  // 此页面用户不会看到（由隐藏浏览器加载），但保留最小 UI 以防异常
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a1628',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>正在处理...</p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add website/src/pages/Resolve.tsx
git commit -m "feat(website): add resolve page for cookie-based referral code retrieval"
```

---

### Task 9: App 端 — 延迟匹配服务封装

**Files:**
- Create: `src/services/deferredLink.ts`

- [ ] **Step 1: 创建 deferredLink.ts**

Create `src/services/deferredLink.ts`:

```typescript
/**
 * 延迟深度链接服务
 *
 * 用途：App 首次启动时，通过指纹匹配获取未装 App 时扫码的推荐码。
 * Cookie 方式由 WebBrowser 打开 /resolve 页面处理（见 _layout.tsx）。
 * 本模块封装指纹兜底匹配逻辑。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Dimensions } from 'react-native';
import Constants from 'expo-constants';
import { ApiClient } from '../repos/http/ApiClient';

const PENDING_REFERRAL_KEY = 'pending_referral_code';
const DDL_CHECKED_KEY = 'ddl_checked';

/** 获取待绑定的推荐码 */
export async function getPendingReferralCode(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_REFERRAL_KEY);
}

/** 保存待绑定的推荐码 */
export async function setPendingReferralCode(code: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_REFERRAL_KEY, code);
}

/** 清除待绑定的推荐码 */
export async function clearPendingReferralCode(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
}

/** 是否已完成延迟匹配检查 */
export async function isDDLChecked(): Promise<boolean> {
  const val = await AsyncStorage.getItem(DDL_CHECKED_KEY);
  return val === 'true';
}

/** 标记延迟匹配检查已完成 */
export async function markDDLChecked(): Promise<void> {
  await AsyncStorage.setItem(DDL_CHECKED_KEY, 'true');
}

/**
 * 指纹兜底匹配（当 Cookie 方式未获取到推荐码时调用）
 */
export async function matchByFingerprint(): Promise<string | null> {
  try {
    const { width, height } = Dimensions.get('screen');
    const ua = await Constants.getWebViewUserAgentAsync() || `ReactNative/${Platform.OS}`;

    const result = await ApiClient.post<{ referralCode: string | null }>('/deferred-link/match', {
      userAgent: ua,
      screenWidth: Math.round(width),
      screenHeight: Math.round(height),
      language: 'zh-CN',
    });

    if (result.ok && result.data.referralCode) {
      return result.data.referralCode;
    }
  } catch {
    // 静默失败
  }
  return null;
}

/**
 * 从 URL 中提取推荐码
 * 支持格式：https://app.xn--ckqa175y.com/r/{CODE}
 */
export function extractReferralCodeFromURL(url: string): string | null {
  const match = url.match(/app\.xn--ckqa175y\.com\/r\/([A-Za-z0-9]{8})/);
  if (match) return match[1].toUpperCase();

  // 兼容 aimaimai:// scheme 回调
  const schemeMatch = url.match(/aimaimai:\/\/referral\?code=([A-Za-z0-9]{8})/);
  if (schemeMatch) return schemeMatch[1].toUpperCase();

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/deferredLink.ts
git commit -m "feat(app): add deferred deep link service for fingerprint matching"
```

---

### Task 10: App 端 — Universal Link 拦截 + 首次启动延迟匹配

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: 修改 _layout.tsx — 添加 URL 监听和延迟匹配**

将 `app/_layout.tsx` 的完整内容替换为：

```tsx
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';
import { AiFloatingCompanion } from '../src/components/effects';
import { appQueryClient } from '../src/queryClient';
import { useAuthStore } from '../src/store';
import { BonusRepo } from '../src/repos';
import {
  extractReferralCodeFromURL,
  getPendingReferralCode,
  setPendingReferralCode,
  clearPendingReferralCode,
  isDDLChecked,
  markDDLChecked,
  matchByFingerprint,
} from '../src/services/deferredLink';

const APP_DOMAIN = 'app.xn--ckqa175y.com';

/**
 * 处理传入的推荐码：已登录则直接绑定，未登录则暂存
 */
async function handleReferralCode(code: string) {
  const { isLoggedIn } = useAuthStore.getState();
  if (isLoggedIn) {
    try {
      await BonusRepo.useReferralCode(code);
    } catch {
      // 静默失败（推荐码无效、已绑定等）
    }
    await clearPendingReferralCode();
  } else {
    await setPendingReferralCode(code);
  }
}

/**
 * 处理传入 URL（Universal Link / Deep Link）
 */
function handleIncomingURL(url: string | null) {
  if (!url) return;
  const code = extractReferralCodeFromURL(url);
  if (code && code !== 'none') {
    handleReferralCode(code);
  }
}

/**
 * 首次启动延迟匹配（Cookie + 指纹兜底）
 */
async function performDeferredLinkCheck() {
  const checked = await isDDLChecked();
  if (checked) return;

  try {
    // 步骤 1：Cookie 方式 — 用隐藏浏览器打开 resolve 页面
    // resolve 页面会重定向到 aimaimai://referral?code=xxx
    // 通过 Linking.addEventListener 接收回调
    let cookieResolved = false;

    const resolveUrl = `https://${APP_DOMAIN}/resolve`;
    const result = await Promise.race([
      WebBrowser.openAuthSessionAsync(resolveUrl, 'aimaimai://referral'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    if (result && typeof result === 'object' && 'type' in result && result.type === 'success' && 'url' in result) {
      const code = extractReferralCodeFromURL(result.url as string);
      if (code && code !== 'none') {
        await handleReferralCode(code);
        cookieResolved = true;
      }
    }

    // 步骤 2：指纹兜底（Cookie 方式未拿到时）
    if (!cookieResolved) {
      const code = await matchByFingerprint();
      if (code) {
        await handleReferralCode(code);
      }
    }
  } catch {
    // 静默失败
  } finally {
    await markDDLChecked();
  }
}

// 根布局：挂载全局 Provider（数据层/主题/Toast/安全区）
export default function RootLayout() {
  // 监听 Universal Link / Deep Link
  useEffect(() => {
    // 冷启动时检查初始 URL
    Linking.getInitialURL().then(handleIncomingURL);

    // 热启动时监听 URL
    const subscription = Linking.addEventListener('url', (event) => {
      handleIncomingURL(event.url);
    });

    return () => subscription.remove();
  }, []);

  // 首次启动延迟匹配
  useEffect(() => {
    performDeferredLinkCheck();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={appQueryClient}>
          <ThemeProvider>
            <ToastProvider>
              <View style={{ flex: 1 }}>
                <Stack screenOptions={{
                  headerShown: false,
                  animation: 'slide_from_right',
                  animationDuration: 250,
                }} />
                <AiFloatingCompanion />
              </View>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: 安装 expo-web-browser（如果尚未安装）**

Run: `npx expo install expo-web-browser`

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误（或仅有已知的非相关警告）

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx package.json
git commit -m "feat(app): add Universal Link interception and deferred deep link matching"
```

---

### Task 11: App 端 — 注册成功后自动绑定推荐码

**Files:**
- Modify: `src/store/useAuthStore.ts`

- [ ] **Step 1: 修改 useAuthStore — 登录成功后自动绑定推荐码**

在 `src/store/useAuthStore.ts` 中，修改 `setLoggedIn` 方法，在设置完登录状态后触发推荐码自动绑定。

将第 68-69 行的 `setLoggedIn` 实现：
```typescript
      setLoggedIn: ({ accessToken, refreshToken, userId, loginMethod }) =>
        set({ isLoggedIn: true, accessToken, refreshToken, userId, loginMethod }),
```

替换为：
```typescript
      setLoggedIn: ({ accessToken, refreshToken, userId, loginMethod }) => {
        set({ isLoggedIn: true, accessToken, refreshToken, userId, loginMethod });
        // 注册/登录成功后，自动绑定暂存的推荐码
        import('../services/deferredLink').then(({ getPendingReferralCode, clearPendingReferralCode }) => {
          getPendingReferralCode().then((code) => {
            if (!code) return;
            import('../repos').then(({ BonusRepo }) => {
              BonusRepo.useReferralCode(code)
                .catch(() => {}) // 静默失败
                .finally(() => clearPendingReferralCode());
            });
          });
        }).catch(() => {}); // 静默失败
      },
```

- [ ] **Step 2: Commit**

```bash
git add src/store/useAuthStore.ts
git commit -m "feat(app): auto-bind pending referral code after login/registration"
```

---

### Task 12: 部署配置 — .well-known 文件 + website vite.config

**Files:**
- Create: `website/public/.well-known/apple-app-site-association`
- Create: `website/public/.well-known/assetlinks.json`
- Modify: `website/vite.config.ts`

- [ ] **Step 1: 创建 apple-app-site-association**

Create `website/public/.well-known/apple-app-site-association`:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.com.aimaimai.shop",
        "paths": ["/r/*"]
      }
    ]
  }
}
```

注意：`TEAM_ID` 需要在部署前替换为真实的 Apple Developer Team ID。

- [ ] **Step 2: 创建 assetlinks.json**

Create `website/public/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.aimaimai.shop",
      "sha256_cert_fingerprints": ["APP_SIGNING_CERT_SHA256"]
    }
  }
]
```

注意：`APP_SIGNING_CERT_SHA256` 需要在部署前替换为真实的签名证书指纹。

- [ ] **Step 3: 更新 website/vite.config.ts — 修正 base 路径**

落地页部署在 `app.爱买买.com` 的根路径下，需要将 base 从 `/aimaimia/` 改为 `/`。

但注意：如果官网和落地页是部署在同一服务器不同子域的话，落地页的 base 应该是 `/`。如果 vite.config 用于官网构建，则落地页需要独立部署配置。

根据当前架构（`app.爱买买.com` 是独立子域），在 `website/vite.config.ts` 中添加条件 base：

将 `base: '/aimaimia/'` 这行的逻辑注释说明，落地页在 `app.爱买买.com` 部署时需要将 base 改为 `'/'`。当前保持不变（官网构建）。

添加注释：

```typescript
  // 官网部署在 爱买买.com/aimaimia/ 下
  // 落地页部署在 app.爱买买.com/ 下时需要将 base 改为 '/'
  base: '/aimaimia/',
```

- [ ] **Step 4: 配置 SPA fallback — website/public/404.html**

BrowserRouter 需要服务器将所有路径指向 index.html。检查 `website/public/404.html` 是否已存在 SPA fallback。如果使用 Nginx 部署，需要在 Nginx 配置中添加 `try_files $uri $uri/ /index.html;`。

- [ ] **Step 5: Commit**

```bash
git add website/public/.well-known/ website/vite.config.ts
git commit -m "feat(website): add .well-known files for Universal Link and App Link verification"
```

---

### Task 13: 验证与集成测试

**Files:** 无新增/修改文件，纯验证步骤

- [ ] **Step 1: 验证后端编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: 验证 Prisma Schema**

Run: `cd backend && npx prisma validate`
Expected: `✔ Your Prisma schema is valid.`

- [ ] **Step 3: 启动后端验证 API**

Run: `cd backend && npm run start:dev`

验证 3 个端点是否可用（使用 curl 或 Postman）：

```bash
# 创建延迟链接（应返回 400，因为推荐码不存在）
curl -X POST http://localhost:3000/api/v1/deferred-link \
  -H 'Content-Type: application/json' \
  -d '{"referralCode":"TESTCODE","userAgent":"test","screenWidth":390,"screenHeight":844}'

# resolve（应返回 referralCode: null）
curl 'http://localhost:3000/api/v1/deferred-link/resolve?cookieId=nonexistent'

# match（应返回 referralCode: null）
curl -X POST http://localhost:3000/api/v1/deferred-link/match \
  -H 'Content-Type: application/json' \
  -d '{"userAgent":"test","screenWidth":390,"screenHeight":844}'
```

- [ ] **Step 4: 验证网站构建**

Run: `cd website && npm run build`
Expected: 构建成功，无错误

- [ ] **Step 5: 验证 App TypeScript**

Run: `npx tsc --noEmit`
Expected: 无错误（或仅有已知的非相关警告）

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "chore: verify deferred deep link system integration"
```
