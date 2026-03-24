# Merchant Self-Service Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable merchants to submit onboarding applications via the website, with admin review in the management panel, and automatic seller account creation upon approval.

**Architecture:** New `MerchantApplication` Prisma model stores applications independently from `Company`. A public API endpoint accepts multipart form submissions (no auth). Admin endpoints handle review. On approval, a DB transaction auto-creates Company + User + CompanyStaff(OWNER). A standalone Captcha module (Redis-backed) protects the public endpoint.

**Tech Stack:** NestJS + Prisma + PostgreSQL + Redis (backend), Vite + React + Tailwind (website), Vite + React + Ant Design ProComponents (admin)

**Spec:** `docs/superpowers/specs/2026-03-24-merchant-onboarding-design.md`

---

## File Structure

### Backend — New Files
| File | Responsibility |
|------|---------------|
| `backend/src/modules/captcha/captcha.module.ts` | Captcha module registration |
| `backend/src/modules/captcha/captcha.controller.ts` | `GET /api/v1/captcha` public endpoint |
| `backend/src/modules/captcha/captcha.service.ts` | Generate image captcha, Redis store/verify |
| `backend/src/modules/merchant-application/merchant-application.module.ts` | Module registration |
| `backend/src/modules/merchant-application/merchant-application.controller.ts` | `POST /api/v1/merchant-applications` public endpoint |
| `backend/src/modules/merchant-application/merchant-application.service.ts` | Application CRUD + approve/reject logic |
| `backend/src/modules/merchant-application/dto/create-merchant-application.dto.ts` | Validation DTO for public submission |
| `backend/src/modules/merchant-application/dto/reject-merchant-application.dto.ts` | Validation DTO for rejection |
| `backend/src/modules/admin/merchant-applications/admin-merchant-applications.module.ts` | Admin module registration |
| `backend/src/modules/admin/merchant-applications/admin-merchant-applications.controller.ts` | Admin list/detail/approve/reject endpoints |
| `backend/src/modules/admin/merchant-applications/admin-merchant-applications.service.ts` | Admin business logic (approve automation) |

### Backend — Modified Files
| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `MerchantApplicationStatus` enum + `MerchantApplication` model |
| `backend/src/app.module.ts` | Import `CaptchaModule` + `MerchantApplicationModule` |
| `backend/src/modules/admin/admin.module.ts` | Import `AdminMerchantApplicationsModule` |

### Admin Frontend — New Files
| File | Responsibility |
|------|---------------|
| `admin/src/api/merchant-applications.ts` | API calls for merchant application endpoints |
| `admin/src/pages/companies/applications-tab.tsx` | "入驻申请" Tab content (ProTable + detail drawer + approve/reject modals) |

### Admin Frontend — Modified Files
| File | Change |
|------|--------|
| `admin/src/pages/companies/index.tsx` | Add third "入驻申请" tab |

### Website — New Files
| File | Responsibility |
|------|---------------|
| `website/src/lib/api.ts` | Lightweight fetch wrapper with `VITE_API_BASE_URL` |
| `website/src/pages/MerchantApply.tsx` | Onboarding application form page |

### Website — Modified Files
| File | Change |
|------|--------|
| `website/src/App.tsx` | Add `/merchants/apply` route |
| `website/src/pages/Merchants.tsx` | Change CTA buttons to navigate to `/merchants/apply` |
| `website/.env.example` | Add `VITE_API_BASE_URL` |

---

## Task 1: Prisma Schema — Add MerchantApplication Model

**Files:**
- Modify: `backend/prisma/schema.prisma` (add after line ~900, after CompanyDocument model)

- [ ] **Step 1: Add enum and model to schema**

在 `backend/prisma/schema.prisma` 文件中，`CompanyDocument` 模型之后（约第 900 行之后）添加：

```prisma
enum MerchantApplicationStatus {
  PENDING
  APPROVED
  REJECTED
}

model MerchantApplication {
  id             String                      @id @default(cuid())
  companyName    String
  category       String
  contactName    String
  phone          String
  email          String?
  licenseFileUrl String
  status         MerchantApplicationStatus   @default(PENDING)
  rejectReason   String?
  reviewedAt     DateTime?
  reviewedBy     String?
  companyId      String?
  createdAt      DateTime                    @default(now())
  updatedAt      DateTime                    @updatedAt

  @@index([status])
  @@index([phone])
}
```

- [ ] **Step 2: Validate schema**

Run: `cd backend && npx prisma validate`
Expected: "The schema is valid."

- [ ] **Step 3: Create migration**

Run: `cd backend && npx prisma migrate dev --name add_merchant_application`
Expected: Migration created successfully

- [ ] **Step 4: Generate Prisma client**

Run: `cd backend && npx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(schema): add MerchantApplication model for self-service onboarding"
```

---

## Task 2: Backend — Captcha Module

**Files:**
- Create: `backend/src/modules/captcha/captcha.module.ts`
- Create: `backend/src/modules/captcha/captcha.controller.ts`
- Create: `backend/src/modules/captcha/captcha.service.ts`
- Modify: `backend/src/app.module.ts` (add import at line ~37, add to imports array at line ~78)

- [ ] **Step 1: Install svg-captcha**

Run: `cd backend && npm install svg-captcha`

svg-captcha 是轻量级服务端验证码生成库，无外部依赖。

- [ ] **Step 2: Create CaptchaService**

Create `backend/src/modules/captcha/captcha.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import * as svgCaptcha from 'svg-captcha';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';

@Injectable()
export class CaptchaService {
  private static readonly TTL_SECONDS = 300; // 5 分钟过期
  private static readonly KEY_PREFIX = 'captcha:';

  constructor(private redis: RedisCoordinatorService) {}

  /** 生成图形验证码，返回 captchaId + SVG 图片 */
  async generate(): Promise<{ captchaId: string; svg: string }> {
    const captcha = svgCaptcha.create({
      size: 4,
      noise: 2,
      color: true,
      background: '#f0f0f0',
    });

    const captchaId = createId();
    const key = `${CaptchaService.KEY_PREFIX}${captchaId}`;
    await this.redis.set(key, captcha.text.toLowerCase(), CaptchaService.TTL_SECONDS * 1000);

    return { captchaId, svg: captcha.data };
  }

  /** 校验验证码（一次性消费） */
  async verify(captchaId: string, input: string): Promise<boolean> {
    const key = `${CaptchaService.KEY_PREFIX}${captchaId}`;
    const stored = await this.redis.get(key);

    if (!stored) return false;

    // 立即删除，一次性使用
    await this.redis.del(key);

    return stored === input.toLowerCase();
  }
}
```

- [ ] **Step 3: Create CaptchaController**

Create `backend/src/modules/captcha/captcha.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CaptchaService } from './captcha.service';

@Controller('captcha')
export class CaptchaController {
  constructor(private captchaService: CaptchaService) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Get()
  async getCaptcha() {
    return this.captchaService.generate();
  }
}
```

- [ ] **Step 4: Create CaptchaModule**

Create `backend/src/modules/captcha/captcha.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CaptchaController } from './captcha.controller';
import { CaptchaService } from './captcha.service';

@Module({
  controllers: [CaptchaController],
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
```

- [ ] **Step 5: Register in AppModule**

Modify `backend/src/app.module.ts`:
- Add import: `import { CaptchaModule } from './modules/captcha/captcha.module';`
- Add `CaptchaModule` to the `imports` array

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/captcha/ backend/src/app.module.ts backend/package.json backend/package-lock.json
git commit -m "feat(captcha): add Redis-backed image captcha module"
```

---

## Task 3: Backend — Public Merchant Application Endpoint

**Files:**
- Create: `backend/src/modules/merchant-application/dto/create-merchant-application.dto.ts`
- Create: `backend/src/modules/merchant-application/merchant-application.service.ts`
- Create: `backend/src/modules/merchant-application/merchant-application.controller.ts`
- Create: `backend/src/modules/merchant-application/merchant-application.module.ts`
- Modify: `backend/src/app.module.ts` (add import)

- [ ] **Step 1: Create DTO**

Create `backend/src/modules/merchant-application/dto/create-merchant-application.dto.ts`:

```typescript
import { IsString, IsNotEmpty, IsMobilePhone, IsEmail, IsOptional } from 'class-validator';

export class CreateMerchantApplicationDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsMobilePhone('zh-CN')
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  captchaId: string;

  @IsString()
  @IsNotEmpty()
  captchaCode: string;
}
```

- [ ] **Step 2: Create MerchantApplicationService**

Create `backend/src/modules/merchant-application/merchant-application.service.ts`:

```typescript
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from '../captcha/captcha.service';
import { CreateMerchantApplicationDto } from './dto/create-merchant-application.dto';

// 允许的 MIME 类型
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// 文件头魔术字节校验
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

@Injectable()
export class MerchantApplicationService {
  private readonly logger = new Logger(MerchantApplicationService.name);

  constructor(
    private prisma: PrismaService,
    private captchaService: CaptchaService,
  ) {}

  async create(
    dto: CreateMerchantApplicationDto,
    file: Express.Multer.File,
  ) {
    // 1. 验证码校验
    const captchaValid = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
    if (!captchaValid) {
      throw new BadRequestException('验证码错误或已过期');
    }

    // 2. 文件校验
    this.validateFile(file);

    // 3. 保存文件（cuid 重命名）
    const fileUrl = await this.saveFile(file);

    // 4. 检查是否已有 PENDING 申请（静默处理）
    const existing = await this.prisma.merchantApplication.findFirst({
      where: { phone: dto.phone, status: 'PENDING' },
    });
    if (existing) {
      // 静默返回，不暴露手机号状态
      return { message: '申请已提交，请等待审核' };
    }

    // 5. 创建申请
    await this.prisma.merchantApplication.create({
      data: {
        companyName: dto.companyName,
        category: dto.category,
        contactName: dto.contactName,
        phone: dto.phone,
        email: dto.email || null,
        licenseFileUrl: fileUrl,
      },
    });

    return { message: '申请已提交，请等待审核' };
  }

  private validateFile(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传营业执照');
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG、PNG、PDF 格式');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('文件大小不能超过 5MB');
    }
    // Magic bytes 校验
    const expected = MAGIC_BYTES[file.mimetype];
    if (expected) {
      const header = Array.from(new Uint8Array(file.buffer.slice(0, 8)));
      const valid = expected.some((magic) =>
        magic.every((byte, i) => header[i] === byte),
      );
      if (!valid) {
        throw new BadRequestException('文件内容与类型不匹配');
      }
    }
  }

  private async saveFile(file: Express.Multer.File): Promise<string> {
    const ext = file.originalname.split('.').pop() || 'bin';
    const filename = `${createId()}.${ext}`;
    const dir = 'uploads/merchant-applications';

    // 确保目录存在
    const fs = await import('fs/promises');
    const path = await import('path');
    const fullDir = path.join(process.cwd(), dir);
    await fs.mkdir(fullDir, { recursive: true });

    // 写入文件
    const fullPath = path.join(fullDir, filename);
    await fs.writeFile(fullPath, file.buffer);

    return `/${dir}/${filename}`;
  }
}
```

- [ ] **Step 3: Create MerchantApplicationController**

Create `backend/src/modules/merchant-application/merchant-application.controller.ts`:

```typescript
import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { MerchantApplicationService } from './merchant-application.service';
import { CreateMerchantApplicationDto } from './dto/create-merchant-application.dto';

@Controller('merchant-applications')
export class MerchantApplicationController {
  constructor(private service: MerchantApplicationService) {}

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post()
  @UseInterceptors(
    FileInterceptor('licenseFile', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async create(
    @Body() dto: CreateMerchantApplicationDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.create(dto, file);
  }
}
```

- [ ] **Step 4: Create MerchantApplicationModule**

Create `backend/src/modules/merchant-application/merchant-application.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CaptchaModule } from '../captcha/captcha.module';
import { MerchantApplicationController } from './merchant-application.controller';
import { MerchantApplicationService } from './merchant-application.service';

@Module({
  imports: [CaptchaModule],
  controllers: [MerchantApplicationController],
  providers: [MerchantApplicationService],
})
export class MerchantApplicationModule {}
```

- [ ] **Step 5: Register in AppModule**

Modify `backend/src/app.module.ts`:
- Add import: `import { MerchantApplicationModule } from './modules/merchant-application/merchant-application.module';`
- Add `MerchantApplicationModule` to the `imports` array

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/merchant-application/ backend/src/app.module.ts
git commit -m "feat(merchant-application): add public submission endpoint with captcha and file upload"
```

---

## Task 4: Backend — Admin Merchant Application Endpoints

**Files:**
- Create: `backend/src/modules/merchant-application/dto/reject-merchant-application.dto.ts`
- Create: `backend/src/modules/admin/merchant-applications/admin-merchant-applications.controller.ts`
- Create: `backend/src/modules/admin/merchant-applications/admin-merchant-applications.service.ts`
- Create: `backend/src/modules/admin/merchant-applications/admin-merchant-applications.module.ts`
- Modify: `backend/src/modules/admin/admin.module.ts` (add import at line ~24, add to imports at line ~48)

参考现有 admin controller 模式：`backend/src/modules/admin/companies/admin-companies.controller.ts`

- [ ] **Step 1: Create reject DTO**

Create `backend/src/modules/merchant-application/dto/reject-merchant-application.dto.ts`:

```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class RejectMerchantApplicationDto {
  @IsString()
  @IsNotEmpty({ message: '拒绝原因不能为空' })
  reason: string;
}
```

- [ ] **Step 2: Create AdminMerchantApplicationsService**

Create `backend/src/modules/admin/merchant-applications/admin-merchant-applications.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RejectMerchantApplicationDto } from '../../merchant-application/dto/reject-merchant-application.dto';

@Injectable()
export class AdminMerchantApplicationsService {
  private readonly logger = new Logger(AdminMerchantApplicationsService.name);

  constructor(private prisma: PrismaService) {}

  /** 分页查询申请列表 */
  async findAll(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    keyword?: string;
  }) {
    const { page = 1, pageSize = 20, status, keyword } = params;
    const where: any = {};

    if (status) {
      where.status = status;
    }
    if (keyword) {
      where.OR = [
        { companyName: { contains: keyword } },
        { phone: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.merchantApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.merchantApplication.count({ where }),
    ]);

    return { items, total };
  }

  /** 查询单条申请详情 + 同手机号历史记录 */
  async findById(id: string) {
    const application = await this.prisma.merchantApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('申请不存在');
    }

    // 同手机号的历史申请（排除当前）
    const history = await this.prisma.merchantApplication.findMany({
      where: { phone: application.phone, id: { not: id } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { ...application, history };
  }

  /** 审核通过：自动创建 Company + User + CompanyStaff(OWNER) */
  async approve(id: string, adminUserId: string) {
    // 单个事务内完成状态检查和所有创建操作（防止 TOCTOU 竞态）
    const result = await this.prisma.$transaction(async (tx) => {
      const application = await tx.merchantApplication.findUnique({
        where: { id },
      });
      if (!application) {
        throw new NotFoundException('申请不存在');
      }
      if (application.status !== 'PENDING') {
        throw new ConflictException('该申请已被处理');
      }

      // 步骤 1：查找或创建 User
      let identity = await tx.authIdentity.findFirst({
        where: { provider: 'PHONE', identifier: application.phone },
      });

      let userId: string;
      if (identity) {
        userId = identity.userId;
      } else {
        const user = await tx.user.create({
          data: {
            profile: {
              create: { nickname: application.contactName },
            },
            authIdentities: {
              create: {
                provider: 'PHONE',
                identifier: application.phone,
                verified: true,
              },
            },
          },
        });
        userId = user.id;
      }

      // 步骤 2：创建 Company
      const company = await tx.company.create({
        data: {
          name: application.companyName,
          contact: {
            name: application.contactName,
            phone: application.phone,
          },
          status: 'ACTIVE',
          profile: { create: {} },
        },
      });

      // 步骤 3：创建 CompanyStaff(OWNER)
      const staff = await tx.companyStaff.create({
        data: {
          userId,
          companyId: company.id,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      // 步骤 4：复制营业执照到 CompanyDocument
      await tx.companyDocument.create({
        data: {
          companyId: company.id,
          type: 'LICENSE',
          title: '营业执照',
          fileUrl: application.licenseFileUrl,
          verifyStatus: 'VERIFIED',
        },
      });

      // 步骤 5：更新申请状态
      await tx.merchantApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          companyId: company.id,
          reviewedAt: new Date(),
          reviewedBy: adminUserId,
        },
      });

      return { companyId: company.id, staffId: staff.id, phone: application.phone, email: application.email };
    });

    // 步骤 6：发送通知（事务外，失败不影响审核结果）
    // TODO: 接入真实短信服务
    this.logger.log(
      `[SMS Mock] 入驻通过通知 → ${result.phone}: 您的入驻申请已通过，请访问 seller.爱买买.com 登录`,
    );
    if (result.email) {
      this.logger.log(
        `[Email Mock] 入驻通过通知 → ${result.email}`,
      );
    }

    return { companyId: result.companyId, staffId: result.staffId };
  }

  /** 审核拒绝 */
  async reject(id: string, dto: RejectMerchantApplicationDto, adminUserId: string) {
    // 事务内完成状态检查和更新（防止 TOCTOU 竞态）
    const application = await this.prisma.$transaction(async (tx) => {
      const app = await tx.merchantApplication.findUnique({ where: { id } });
      if (!app) throw new NotFoundException('申请不存在');
      if (app.status !== 'PENDING') throw new ConflictException('该申请已被处理');

      await tx.merchantApplication.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectReason: dto.reason,
          reviewedAt: new Date(),
          reviewedBy: adminUserId,
        },
      });

      return app;
    });

    // 发送通知（事务外）
    this.logger.log(
      `[SMS Mock] 入驻拒绝通知 → ${application.phone}: 原因=${dto.reason}`,
    );
    if (application.email) {
      this.logger.log(
        `[Email Mock] 入驻拒绝通知 → ${application.email}`,
      );
    }

    return { ok: true };
  }

  /** 获取 PENDING 数量（用于 Tab Badge） */
  async getPendingCount() {
    return this.prisma.merchantApplication.count({
      where: { status: 'PENDING' },
    });
  }
}
```

- [ ] **Step 3: Create AdminMerchantApplicationsController**

Create `backend/src/modules/admin/merchant-applications/admin-merchant-applications.controller.ts`:

参考 `backend/src/modules/admin/companies/admin-companies.controller.ts` 的装饰器模式。

```typescript
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { AuditLog } from '../common/decorators/audit-action';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AdminMerchantApplicationsService } from './admin-merchant-applications.service';
import { RejectMerchantApplicationDto } from '../../merchant-application/dto/reject-merchant-application.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/merchant-applications')
export class AdminMerchantApplicationsController {
  constructor(private service: AdminMerchantApplicationsService) {}

  @Get()
  @RequirePermission('companies:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.service.findAll({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
      keyword,
    });
  }

  @Get('pending-count')
  @RequirePermission('companies:read')
  getPendingCount() {
    return this.service.getPendingCount();
  }

  @Get(':id')
  @RequirePermission('companies:read')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post(':id/approve')
  @RequirePermission('companies:audit')
  @AuditLog({ action: 'APPROVE', module: 'merchant-applications' })
  approve(@Param('id') id: string, @CurrentAdmin('sub') adminUserId: string) {
    return this.service.approve(id, adminUserId);
  }

  @Post(':id/reject')
  @RequirePermission('companies:audit')
  @AuditLog({ action: 'REJECT', module: 'merchant-applications' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectMerchantApplicationDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.service.reject(id, dto, adminUserId);
  }
}
```

- [ ] **Step 4: Create AdminMerchantApplicationsModule**

Create `backend/src/modules/admin/merchant-applications/admin-merchant-applications.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AdminMerchantApplicationsController } from './admin-merchant-applications.controller';
import { AdminMerchantApplicationsService } from './admin-merchant-applications.service';

@Module({
  controllers: [AdminMerchantApplicationsController],
  providers: [AdminMerchantApplicationsService],
})
export class AdminMerchantApplicationsModule {}
```

- [ ] **Step 5: Register in AdminModule**

Modify `backend/src/modules/admin/admin.module.ts`:
- Add import: `import { AdminMerchantApplicationsModule } from './merchant-applications/admin-merchant-applications.module';`
- Add `AdminMerchantApplicationsModule` to the `imports` array (after `AdminCompaniesModule` at line 35)

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/admin/merchant-applications/ backend/src/modules/merchant-application/dto/reject-merchant-application.dto.ts backend/src/modules/admin/admin.module.ts
git commit -m "feat(admin): add merchant application review endpoints with auto company creation"
```

---

## Task 5: Admin Frontend — Merchant Applications API

**Files:**
- Create: `admin/src/api/merchant-applications.ts`

参考现有 API 模式：`admin/src/api/companies.ts`

- [ ] **Step 1: Create API file**

Create `admin/src/api/merchant-applications.ts`:

```typescript
import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

export interface MerchantApplication {
  id: string;
  companyName: string;
  category: string;
  contactName: string;
  phone: string;
  email: string | null;
  licenseFileUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantApplicationDetail extends MerchantApplication {
  history: MerchantApplication[];
}

interface ApplicationQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
}

/** 入驻申请列表 */
export const getMerchantApplications = (params?: ApplicationQueryParams): Promise<PaginatedData<MerchantApplication>> =>
  client.get('/admin/merchant-applications', { params });

/** 入驻申请详情 */
export const getMerchantApplication = (id: string): Promise<MerchantApplicationDetail> =>
  client.get(`/admin/merchant-applications/${id}`);

/** 审核通过 */
export const approveMerchantApplication = (id: string): Promise<{ companyId: string; staffId: string }> =>
  client.post(`/admin/merchant-applications/${id}/approve`);

/** 审核拒绝 */
export const rejectMerchantApplication = (id: string, reason: string): Promise<void> =>
  client.post(`/admin/merchant-applications/${id}/reject`, { reason });

/** 待审核数量 */
export const getMerchantApplicationPendingCount = (): Promise<number> =>
  client.get('/admin/merchant-applications/pending-count');
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/api/merchant-applications.ts
git commit -m "feat(admin-ui): add merchant application API client"
```

---

## Task 6: Admin Frontend — Applications Tab

**Files:**
- Create: `admin/src/pages/companies/applications-tab.tsx`
- Modify: `admin/src/pages/companies/index.tsx` (add third tab)

参考现有 Tab + ProTable 模式：`admin/src/pages/companies/index.tsx`

- [ ] **Step 1: Create ApplicationsTab component**

Create `admin/src/pages/companies/applications-tab.tsx`:

```tsx
import { useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, message, Modal, Input, Space, Drawer, Image, Descriptions } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined } from '@ant-design/icons';
import {
  getMerchantApplications,
  getMerchantApplication,
  approveMerchantApplication,
  rejectMerchantApplication,
} from '@/api/merchant-applications';
import type { MerchantApplication, MerchantApplicationDetail } from '@/api/merchant-applications';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import dayjs from 'dayjs';

const statusMap: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待审核', color: 'orange' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已拒绝', color: 'red' },
};

// 手机号脱敏：138****5005
function maskPhone(phone: string) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

interface Props {
  onPendingCountChange?: (count: number) => void;
}

export default function ApplicationsTab({ onPendingCountChange }: Props) {
  const actionRef = useRef<ActionType>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<MerchantApplicationDetail | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<MerchantApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const handleViewDetail = async (id: string) => {
    const data = await getMerchantApplication(id);
    setDetail(data);
    setDrawerOpen(true);
  };

  const handleApprove = async (record: MerchantApplication) => {
    Modal.confirm({
      title: '确认通过',
      content: `确认通过「${record.companyName}」的入驻申请？通过后将自动创建企业和卖家账号。`,
      okText: '确认通过',
      onOk: async () => {
        await approveMerchantApplication(record.id);
        message.success('审核通过，已自动创建企业账号');
        actionRef.current?.reload();
      },
    });
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) {
      message.warning('请填写拒绝原因');
      return;
    }
    await rejectMerchantApplication(rejectTarget.id, rejectReason);
    message.success('已拒绝');
    setRejectModalOpen(false);
    setRejectReason('');
    setRejectTarget(null);
    actionRef.current?.reload();
  };

  const columns: ProColumns<MerchantApplication>[] = [
    { title: '公司名称', dataIndex: 'companyName', width: 200, ellipsis: true },
    { title: '联系人', dataIndex: 'contactName', width: 100, search: false },
    {
      title: '手机号',
      dataIndex: 'phone',
      width: 130,
      search: false,
      render: (_: unknown, r: MerchantApplication) => maskPhone(r.phone),
    },
    { title: '经营品类', dataIndex: 'category', width: 120, search: false },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      width: 160,
      search: false,
      render: (_: unknown, r: MerchantApplication) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        PENDING: { text: '待审核' },
        APPROVED: { text: '已通过' },
        REJECTED: { text: '已拒绝' },
      },
      render: (_: unknown, r: MerchantApplication) => {
        const s = statusMap[r.status];
        return <Tag color={s?.color}>{s?.text}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      search: false,
      render: (_: unknown, record: MerchantApplication) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record.id)}>
            详情
          </Button>
          {record.status === 'PENDING' && (
            <PermissionGate permission={PERMISSIONS.COMPANIES_AUDIT}>
              <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleApprove(record)}>
                通过
              </Button>
              <Button
                type="link"
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => { setRejectTarget(record); setRejectModalOpen(true); }}
              >
                拒绝
              </Button>
            </PermissionGate>
          )}
        </Space>
      ),
    },
  ];

  // 判断 URL 是否为图片
  const isImage = (url: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(url);

  return (
    <>
      <ProTable<MerchantApplication>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, status, companyName: keyword } = params;
          const res = await getMerchantApplications({
            page: current,
            pageSize,
            status,
            keyword,
          });
          onPendingCountChange?.(
            await getMerchantApplications({ page: 1, pageSize: 1, status: 'PENDING' }).then((r) => r.total),
          );
          return { data: res.items, total: res.total, success: true };
        }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
        scroll={{ x: 1000 }}
      />

      {/* 详情抽屉 */}
      <Drawer
        title="入驻申请详情"
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDetail(null); }}
        width={560}
      >
        {detail && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="公司名称">{detail.companyName}</Descriptions.Item>
              <Descriptions.Item label="经营品类">{detail.category}</Descriptions.Item>
              <Descriptions.Item label="联系人">{detail.contactName}</Descriptions.Item>
              <Descriptions.Item label="手机号">{detail.phone}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{detail.email || '未填写'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="申请时间">{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              {detail.rejectReason && (
                <Descriptions.Item label="拒绝原因">{detail.rejectReason}</Descriptions.Item>
              )}
              <Descriptions.Item label="营业执照">
                {isImage(detail.licenseFileUrl) ? (
                  <Image src={detail.licenseFileUrl} width={200} />
                ) : (
                  <a href={detail.licenseFileUrl} target="_blank" rel="noopener noreferrer">下载查看</a>
                )}
              </Descriptions.Item>
            </Descriptions>

            {detail.history.length > 0 && (
              <>
                <h4 style={{ marginTop: 24, marginBottom: 12 }}>该手机号历史申请</h4>
                {detail.history.map((h) => (
                  <div key={h.id} style={{ marginBottom: 8, padding: 8, background: '#fafafa', borderRadius: 4 }}>
                    <Tag color={statusMap[h.status]?.color}>{statusMap[h.status]?.text}</Tag>
                    {h.companyName} — {dayjs(h.createdAt).format('YYYY-MM-DD')}
                    {h.rejectReason && <div style={{ color: '#999', fontSize: 12 }}>拒绝原因：{h.rejectReason}</div>}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </Drawer>

      {/* 拒绝弹窗 */}
      <Modal
        title={`拒绝入驻申请: ${rejectTarget?.companyName}`}
        open={rejectModalOpen}
        onCancel={() => { setRejectModalOpen(false); setRejectReason(''); setRejectTarget(null); }}
        onOk={handleReject}
        okText="确认拒绝"
        okButtonProps={{ danger: true }}
      >
        <Input.TextArea
          rows={3}
          placeholder="请填写拒绝原因（必填）"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Modify companies/index.tsx — add third tab**

修改 `admin/src/pages/companies/index.tsx`:

1. 新增 import：
```typescript
import ApplicationsTab from './applications-tab';
```

2. 修改 `TabKey` 类型（约第 14 行）：
```typescript
type TabKey = 'all' | 'pending' | 'applications';
```

3. 新增 state（约第 23 行后）：
```typescript
const [applicationCount, setApplicationCount] = useState(0);
```

4. 在 Tab items 数组中（约第 112-121 行）新增第三个 Tab：
```typescript
{
  key: 'applications',
  label: (
    <Badge count={applicationCount} offset={[12, 0]} size="small">
      入驻申请
    </Badge>
  ),
},
```

5. 在 `</ProTable>` 之后、`<Modal>` 之前插入条件渲染：
```tsx
{activeTab === 'applications' && (
  <ApplicationsTab onPendingCountChange={setApplicationCount} />
)}
```

6. 用 `activeTab !== 'applications'` 条件隐藏 ProTable（当切换到入驻申请 Tab 时不显示企业列表）。将 `<ProTable>` 组件包裹在条件中：
```tsx
{activeTab !== 'applications' && (
  <ProTable<Company> ... />
)}
```

- [ ] **Step 3: Verify admin frontend compiles**

Run: `cd admin && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/companies/applications-tab.tsx admin/src/pages/companies/index.tsx
git commit -m "feat(admin-ui): add merchant applications tab with review workflow"
```

---

## Task 7: Website — API Client + Apply Page

**Files:**
- Create: `website/.env.example`
- Create: `website/src/lib/api.ts`
- Create: `website/src/pages/MerchantApply.tsx`
- Modify: `website/src/App.tsx` (add route at line ~60)
- Modify: `website/src/pages/Merchants.tsx` (change CTA buttons)

- [ ] **Step 1: Create .env.example**

Create `website/.env.example`:

```
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

- [ ] **Step 2: Create API client**

Create `website/src/lib/api.ts`:

```typescript
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

interface ApiResponse<T = any> {
  ok: boolean;
  data: T;
  error?: string;
}

/** 通用 GET 请求 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  const body: ApiResponse<T> = await res.json();
  if (!body.ok) throw new Error(body.error || '请求失败');
  return body.data;
}

/** 通用 POST (JSON) */
export async function apiPost<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body: ApiResponse<T> = await res.json();
  if (!body.ok) throw new Error(body.error || '请求失败');
  return body.data;
}

/** Multipart POST（表单 + 文件） */
export async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: formData,
    // 不设 Content-Type，让浏览器自动设 multipart boundary
  });
  const body: ApiResponse<T> = await res.json();
  if (!body.ok) throw new Error(body.error || '请求失败');
  return body.data;
}

/** 获取验证码 */
export async function getCaptcha(): Promise<{ captchaId: string; svg: string }> {
  return apiGet('/captcha');
}

/** 提交入驻申请 */
export async function submitMerchantApplication(formData: FormData): Promise<{ message: string }> {
  return apiPostForm('/merchant-applications', formData);
}
```

- [ ] **Step 3: Create MerchantApply page**

Create `website/src/pages/MerchantApply.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ScrollReveal from '@/components/effects/ScrollReveal'
import Button from '@/components/ui/Button'
import { getCaptcha, submitMerchantApplication } from '@/lib/api'

export default function MerchantApply() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  // 表单字段
  const [companyName, setCompanyName] = useState('')
  const [category, setCategory] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [file, setFile] = useState<File | null>(null)

  // 验证码
  const [captchaId, setCaptchaId] = useState('')
  const [captchaSvg, setCaptchaSvg] = useState('')
  const [captchaCode, setCaptchaCode] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadCaptcha = useCallback(async () => {
    try {
      const data = await getCaptcha()
      setCaptchaId(data.captchaId)
      setCaptchaSvg(data.svg)
      setCaptchaCode('')
    } catch {
      setError('验证码加载失败，请刷新重试')
    }
  }, [])

  // 首次加载验证码
  useEffect(() => { loadCaptcha() }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    if (selected.size > 5 * 1024 * 1024) {
      setError('文件大小不能超过 5MB')
      return
    }
    const allowed = ['image/jpeg', 'image/png', 'application/pdf']
    if (!allowed.includes(selected.type)) {
      setError('仅支持 JPG、PNG、PDF 格式')
      return
    }
    setFile(selected)
    setError('')
  }

  const validate = (): string | null => {
    if (!companyName.trim()) return '请填写公司名称'
    if (!category.trim()) return '请填写经营品类'
    if (!contactName.trim()) return '请填写联系人姓名'
    if (!/^1[3-9]\d{9}$/.test(phone)) return '请填写正确的手机号'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请填写正确的邮箱'
    if (!file) return '请上传营业执照'
    if (!captchaCode.trim()) return '请填写验证码'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }

    setSubmitting(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('companyName', companyName.trim())
      formData.append('category', category.trim())
      formData.append('contactName', contactName.trim())
      formData.append('phone', phone.trim())
      if (email.trim()) formData.append('email', email.trim())
      formData.append('licenseFile', file!)
      formData.append('captchaId', captchaId)
      formData.append('captchaCode', captchaCode.trim())

      await submitMerchantApplication(formData)
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || '提交失败，请稍后重试')
      loadCaptcha() // 刷新验证码
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <section className="min-h-screen pt-32 pb-20 bg-light-bg">
        <div className="max-w-lg mx-auto px-6 text-center">
          <ScrollReveal>
            <div className="bg-white rounded-card-lg p-10 shadow-card">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-h2 text-text-primary mb-3">申请已提交</h2>
              <p className="text-text-secondary mb-6">
                我们将在 1-3 个工作日内完成审核，届时会通过短信通知您审核结果。
              </p>
              <Button onClick={() => navigate('/merchants')}>返回商户入驻页</Button>
            </div>
          </ScrollReveal>
        </div>
      </section>
    )
  }

  const inputClass = 'w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none transition-colors'
  const labelClass = 'block text-sm font-medium text-text-primary mb-1.5'

  return (
    <section className="min-h-screen pt-32 pb-20 bg-light-bg">
      <div className="max-w-lg mx-auto px-6">
        <ScrollReveal>
          <h1 className="text-h1-mobile md:text-h1 text-text-primary text-center mb-2">商户入驻申请</h1>
          <p className="text-text-secondary text-center mb-8">请填写以下信息，提交入驻申请</p>
        </ScrollReveal>

        <ScrollReveal>
          <form onSubmit={handleSubmit} className="bg-white rounded-card-lg p-8 shadow-card space-y-5">
            <div>
              <label className={labelClass}>公司名称 <span className="text-red-500">*</span></label>
              <input type="text" className={inputClass} placeholder="请输入公司全称" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>经营品类 <span className="text-red-500">*</span></label>
              <input type="text" className={inputClass} placeholder="如：水果、茶叶、粮油、蔬菜" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>联系人姓名 <span className="text-red-500">*</span></label>
              <input type="text" className={inputClass} placeholder="请输入联系人姓名" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>手机号 <span className="text-red-500">*</span></label>
              <input type="tel" className={inputClass} placeholder="请输入手机号" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>邮箱 <span className="text-text-secondary font-normal">(选填)</span></label>
              <input type="email" className={inputClass} placeholder="请输入邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>营业执照 <span className="text-red-500">*</span></label>
              <div
                className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-brand transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {file ? (
                  <div className="text-brand font-medium">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</div>
                ) : (
                  <div className="text-text-secondary">
                    <div className="text-3xl mb-2">📄</div>
                    <div>点击上传营业执照</div>
                    <div className="text-xs mt-1">支持 JPG、PNG、PDF，不超过 5MB</div>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={handleFileChange} />
            </div>

            <div>
              <label className={labelClass}>验证码 <span className="text-red-500">*</span></label>
              <div className="flex gap-3 items-center">
                <input type="text" className={`${inputClass} flex-1`} placeholder="请输入验证码" value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)} />
                <div
                  className="cursor-pointer shrink-0 bg-gray-50 rounded-lg overflow-hidden border border-gray-200"
                  onClick={loadCaptcha}
                  title="点击刷新验证码"
                  dangerouslySetInnerHTML={{ __html: captchaSvg }}
                />
              </div>
            </div>

            {error && (
              <div className="text-red-500 text-sm bg-red-50 px-4 py-2 rounded-lg">{error}</div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? '提交中...' : '提交申请'}
            </Button>
          </form>
        </ScrollReveal>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add route in App.tsx**

修改 `website/src/App.tsx`:

1. 新增 lazy import（约第 13 行后）：
```typescript
const MerchantApply = lazy(() => import('@/pages/MerchantApply'))
```

2. 在 Routes 中新增路由（约第 60-61 行之间）：
```tsx
<Route path="/merchants/apply" element={<MerchantApply />} />
```

放在 `/merchants` 路由之后、`*` 路由之前。

- [ ] **Step 5: Modify Merchants.tsx CTA buttons**

修改 `website/src/pages/Merchants.tsx`:

1. Hero 区域的"立即入驻"按钮（约第 40-41 行），改为导航：
```tsx
<Button size="lg" onClick={() => navigate('/merchants/apply')}>
  立即入驻
</Button>
```

2. CTA 区域底部的"立即入驻"按钮（约第 156 行），同样改为导航：
```tsx
<Button variant="gold" size="lg" onClick={() => navigate('/merchants/apply')}>
  立即入驻
</Button>
```

3. 删除 `DownloadModal` 相关代码：
   - 删除 `useState(false)` 的 `downloadOpen` 状态（约第 26 行）
   - 删除底部 `<DownloadModal ... />` 组件（约第 167 行）
   - 删除 import `DownloadModal`（约第 7 行）

- [ ] **Step 6: Create .env.example**

已在 Step 1 完成。

- [ ] **Step 7: Verify website compiles**

Run: `cd website && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add website/src/lib/api.ts website/src/pages/MerchantApply.tsx website/src/App.tsx website/src/pages/Merchants.tsx website/.env.example
git commit -m "feat(website): add merchant onboarding application form with captcha"
```

---

## Task 8: Integration Verification

- [ ] **Step 1: Start backend**

Run: `cd backend && npm run start:dev`
Expected: "爱买买后端已启动: http://localhost:3000/api/v1"

- [ ] **Step 2: Test captcha endpoint**

Run: `curl http://localhost:3000/api/v1/captcha`
Expected: JSON with `captchaId` and `svg` fields

- [ ] **Step 3: Test public submission endpoint (should fail validation)**

Run: `curl -X POST http://localhost:3000/api/v1/merchant-applications -H "Content-Type: application/json" -d '{}' `
Expected: 400 with validation error messages

- [ ] **Step 4: Start admin frontend**

Run: `cd admin && npm run dev`
Expected: Dev server starts, open browser and navigate to 企业管理 page, verify "入驻申请" tab appears

- [ ] **Step 5: Start website**

创建 `website/.env` 文件（不提交到 Git）：
```
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

Run: `cd website && npm run dev`
Expected: Dev server starts, navigate to /merchants page, click "立即入驻" navigates to form page

- [ ] **Step 6: End-to-end test**

1. 网站填写表单 + 上传图片 + 填验证码 → 提交
2. 管理后台企业管理 → 入驻申请 Tab → 看到申请
3. 点通过 → 检查"全部企业"Tab 出现新企业
4. 用该手机号登录 seller 系统 → 成功

- [ ] **Step 7: Commit any fixes from integration testing**

```bash
git add -A
git commit -m "fix: integration test fixes for merchant onboarding flow"
```

---

## Task 9 (Phase 4 — 后续): Admin "添加企业" Button

> 不在本次实施范围内，此处记录需求以备后续。

- 在"全部企业"Tab 右上角增加"添加企业"按钮
- 点击弹出表单：公司名称、联系人、手机号、地址等
- 提交后直接创建 Company(status=PENDING)
- 管理员走现有审核流程

---

## 依赖关系

```
Task 1 (Schema) ──┐
                   ├──→ Task 3 (Public API) ──→ Task 4 (Admin API) ──→ Task 8 (Integration)
Task 2 (Captcha) ─┘                                    ↓
                                                Task 5 (Admin FE API) → Task 6 (Admin FE Tab) ──→ Task 8

Task 2 (Captcha) ──→ Task 7 (Website) ──→ Task 8 (Integration)
```

- Task 1 (Schema) 和 Task 2 (Captcha) **可以并行**（Captcha 只用 Redis，不依赖 Schema）
- Task 3 依赖 Task 1 + Task 2
- Task 4 依赖 Task 3（复用 DTO）
- Tasks 5-6 (admin frontend) 和 Task 7 (website) 可以并行开发，只要后端 Tasks 3-4 完成后即可
