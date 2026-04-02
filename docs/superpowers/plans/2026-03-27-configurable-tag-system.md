# Configurable Tag System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded tag constants with a fully configurable tag system — admin manages tag categories and tags, admin/seller assign tags to companies and products.

**Architecture:** New `TagCategory` and `CompanyTag` tables + refactored `Tag` table. Admin CRUD module for tag/category management. Public API for tag options. Company service reads from CompanyTag relations instead of highlights JSON. Seller product tagging switches from free text to tag pool selection.

**Tech Stack:** NestJS + Prisma (backend), React + Ant Design ProComponents (admin/seller), React Native (buyer app)

**Spec:** `docs/superpowers/specs/2026-03-27-configurable-tag-system-design.md`

---

## File Map

### Backend — Schema & Seed
- Modify: `backend/prisma/schema.prisma` — Add TagCategory, CompanyTag models; refactor Tag model; remove TagType enum
- Modify: `backend/prisma/seed.ts` — Seed tag categories and tags with new schema

### Backend — Admin Tag Management Module (new)
- Create: `backend/src/modules/admin/tags/admin-tags.controller.ts`
- Create: `backend/src/modules/admin/tags/admin-tags.service.ts`
- Create: `backend/src/modules/admin/tags/admin-tags.dto.ts`
- Create: `backend/src/modules/admin/tags/admin-tags.module.ts`
- Modify: `backend/src/modules/admin/admin.module.ts` — Register new module

### Backend — Public Tag API
- Modify: `backend/src/modules/company/company.controller.ts` — Add public tag-categories endpoint
- Modify: `backend/src/modules/company/company.service.ts` — Add tag query methods, refactor mapToFrontend
- Modify: `backend/src/modules/company/company.module.ts` — (if needed)

### Backend — Admin Company Tags
- Modify: `backend/src/modules/admin/companies/admin-companies.controller.ts` — Add company tag endpoints
- Modify: `backend/src/modules/admin/companies/admin-companies.service.ts` — Add company tag methods

### Backend — Seller Company Tags
- Modify: `backend/src/modules/seller/company/seller-company.controller.ts` — Add tag endpoints
- Modify: `backend/src/modules/seller/company/seller-company.service.ts` — Add tag methods

### Backend — Seller Product Tags
- Modify: `backend/src/modules/seller/products/seller-products.dto.ts` — Change tags to tagIds
- Modify: `backend/src/modules/seller/products/seller-products.service.ts` — Use tagIds instead of tag names

### Admin Frontend
- Create: `admin/src/api/tags.ts` — Tag API functions
- Create: `admin/src/pages/tags/index.tsx` — Tag management page
- Modify: `admin/src/App.tsx` — Add route
- Modify: `admin/src/layouts/AdminLayout.tsx` — Add menu item
- Modify: `admin/src/constants/permissions.ts` — Add tag permissions
- Modify: `admin/src/pages/companies/detail.tsx` — Dynamic tag options
- Modify: `admin/src/types/index.ts` — Remove hardcoded options

### Seller Frontend
- Create: `seller/src/api/tags.ts` — Tag API functions
- Modify: `seller/src/pages/company/index.tsx` — Dynamic tag options
- Modify: `seller/src/pages/products/edit.tsx` — Tag pool Select
- Modify: `seller/src/types/index.ts` — Remove hardcoded options

### Buyer App Frontend
- Delete: `src/constants/tags.ts`
- Modify: `src/mocks/companies.ts` — Update mock data

---

## Task 1: Schema Migration

**Files:**
- Modify: `backend/prisma/schema.prisma:123-128` (TagType enum), `:1027-1034` (Tag model), `:851-887` (Company model)

- [ ] **Step 1: Add TagScope enum and TagCategory model**

In `backend/prisma/schema.prisma`, replace the `TagType` enum (lines 123-128) with:

```prisma
enum TagScope {
  COMPANY
  PRODUCT
}

model TagCategory {
  id          String   @id @default(cuid())
  name        String
  code        String   @unique
  description String?
  scope       TagScope
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tags        Tag[]
}
```

- [ ] **Step 2: Refactor Tag model**

Replace the existing `Tag` model (lines 1027-1034) with:

```prisma
model Tag {
  id         String      @id @default(cuid())
  name       String
  categoryId String
  category   TagCategory @relation(fields: [categoryId], references: [id])
  synonyms   String[]    @default([])
  sortOrder  Int         @default(0)
  isActive   Boolean     @default(true)
  createdAt  DateTime    @default(now())

  productTags ProductTag[]
  companyTags CompanyTag[]

  @@unique([name, categoryId])
  @@index([categoryId])
}
```

- [ ] **Step 3: Add CompanyTag model**

Add after the Tag model:

```prisma
model CompanyTag {
  id        String  @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  tagId     String
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([companyId, tagId])
  @@index([companyId])
  @@index([tagId])
}
```

- [ ] **Step 4: Add companyTags relation to Company model**

In the Company model (line 886, before the closing `}`), add:

```prisma
  companyTags   CompanyTag[]
```

- [ ] **Step 5: Run Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: "The Prisma schema is valid."

- [ ] **Step 6: Generate migration**

Run: `cd backend && npx prisma migrate dev --name add_configurable_tag_system`
Expected: Migration created and applied successfully.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(schema): add TagCategory, CompanyTag models and refactor Tag for configurable tag system"
```

---

## Task 2: Seed Data

**Files:**
- Modify: `backend/prisma/seed.ts:363-372` (tag creation), `:410-420` (ProductTag association)

- [ ] **Step 1: Replace tag seeding logic**

In `backend/prisma/seed.ts`, replace the tag creation block (lines 363-372) with:

```typescript
  // ===== 标签类别与标签 =====
  const tagCategories = [
    {
      code: 'company_badge', name: '企业徽章', scope: 'COMPANY' as const, sortOrder: 1,
      tags: ['优选基地', '品质认证', '产地直供', '低碳种植'],
    },
    {
      code: 'company_cert', name: '企业认证', scope: 'COMPANY' as const, sortOrder: 2,
      tags: ['有机认证', '绿色食品', '地理标志', 'GAP认证', 'SC认证'],
    },
    {
      code: 'industry', name: '行业标签', scope: 'COMPANY' as const, sortOrder: 3,
      tags: ['水果', '蔬菜', '粮油', '肉禽', '水产', '茶叶', '蜂蜜', '乳制品'],
    },
    {
      code: 'product_feature', name: '产品特色', scope: 'COMPANY' as const, sortOrder: 4,
      tags: ['有机', '可溯源', '冷链', '认证'],
    },
    {
      code: 'product_tag', name: '商品标签', scope: 'PRODUCT' as const, sortOrder: 5,
      tags: ['可信溯源', '检测报告', '有机认证', '地理标志', '当季鲜采'],
    },
  ];

  for (const cat of tagCategories) {
    const category = await prisma.tagCategory.upsert({
      where: { code: cat.code },
      update: { name: cat.name, scope: cat.scope, sortOrder: cat.sortOrder },
      create: { code: cat.code, name: cat.name, scope: cat.scope, sortOrder: cat.sortOrder },
    });
    for (let i = 0; i < cat.tags.length; i++) {
      await prisma.tag.upsert({
        where: { name_categoryId: { name: cat.tags[i], categoryId: category.id } },
        update: { sortOrder: i },
        create: { name: cat.tags[i], categoryId: category.id, sortOrder: i },
      });
    }
  }
  console.log('✅ 标签类别与标签已创建');
```

- [ ] **Step 2: Update ProductTag association**

Replace the ProductTag association block (lines 410-420). The product tag creation now needs to look up by `name_categoryId` composite key. Replace with:

```typescript
    // 创建 ProductTag 关联
    const productTagCategory = await prisma.tagCategory.findUnique({ where: { code: 'product_tag' } });
    for (const tagName of p.tags) {
      const tag = await prisma.tag.findUnique({
        where: { name_categoryId: { name: tagName, categoryId: productTagCategory!.id } },
      });
      if (tag) {
        await prisma.productTag.upsert({
          where: { productId_tagId: { productId: p.id, tagId: tag.id } },
          update: {},
          create: { productId: p.id, tagId: tag.id },
        });
      }
    }
```

- [ ] **Step 3: Add CompanyTag seed data for existing companies**

After the company creation section in seed.ts, add CompanyTag associations. Find where companies are seeded and add after company profile creation:

```typescript
  // ===== 企业标签关联 =====
  const companyTagMapping: Record<string, Record<string, string[]>> = {
    // companyId → { categoryCode → tagNames }
    // Use the actual company IDs from seed data
  };

  // For each company with a profile, assign some default tags from highlights
  const allCompanies = await prisma.company.findMany({ include: { profile: true } });
  for (const company of allCompanies) {
    const highlights = (company.profile?.highlights as any) || {};
    const mapping: Record<string, string[]> = {
      company_badge: highlights.badges || [],
      company_cert: highlights.certifications || [],
      industry: highlights.industryTags || [],
      product_feature: highlights.productFeatures || [],
    };
    for (const [code, names] of Object.entries(mapping)) {
      const category = await prisma.tagCategory.findUnique({ where: { code } });
      if (!category) continue;
      for (const name of names) {
        const tag = await prisma.tag.findFirst({ where: { name, categoryId: category.id } });
        if (tag) {
          await prisma.companyTag.upsert({
            where: { companyId_tagId: { companyId: company.id, tagId: tag.id } },
            update: {},
            create: { companyId: company.id, tagId: tag.id },
          });
        } else {
          // Tag not in seed? Create it dynamically
          const newTag = await prisma.tag.create({
            data: { name, categoryId: category.id },
          });
          await prisma.companyTag.create({
            data: { companyId: company.id, tagId: newTag.id },
          });
        }
      }
    }
  }
  console.log('✅ 企业标签关联已创建');
```

- [ ] **Step 4: Run seed**

Run: `cd backend && npx prisma db seed`
Expected: Seed completes without errors.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.ts
git commit -m "feat(seed): add tag categories, tags, and company tag associations"
```

---

## Task 3: Admin Tag Management Backend Module

**Files:**
- Create: `backend/src/modules/admin/tags/admin-tags.dto.ts`
- Create: `backend/src/modules/admin/tags/admin-tags.service.ts`
- Create: `backend/src/modules/admin/tags/admin-tags.controller.ts`
- Create: `backend/src/modules/admin/tags/admin-tags.module.ts`
- Modify: `backend/src/modules/admin/admin.module.ts`

- [ ] **Step 1: Create DTOs**

Create `backend/src/modules/admin/tags/admin-tags.dto.ts`:

```typescript
import { IsString, IsOptional, IsInt, IsArray, IsEnum, IsBoolean, Min } from 'class-validator';
import { TagScope } from '@prisma/client';

// ===== TagCategory DTOs =====

export class CreateTagCategoryDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsEnum(TagScope)
  scope: TagScope;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateTagCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// ===== Tag DTOs =====

export class CreateTagDto {
  @IsString()
  name: string;

  @IsString()
  categoryId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  synonyms?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  synonyms?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 2: Create service**

Create `backend/src/modules/admin/tags/admin-tags.service.ts`:

```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TagScope } from '@prisma/client';
import { CreateTagCategoryDto, UpdateTagCategoryDto, CreateTagDto, UpdateTagDto } from './admin-tags.dto';

@Injectable()
export class AdminTagsService {
  constructor(private prisma: PrismaService) {}

  // ===================== TagCategory =====================

  async listCategories(scope?: TagScope) {
    return this.prisma.tagCategory.findMany({
      where: scope ? { scope } : undefined,
      orderBy: { sortOrder: 'asc' },
      include: {
        tags: {
          orderBy: { sortOrder: 'asc' },
          include: {
            _count: { select: { productTags: true, companyTags: true } },
          },
        },
      },
    });
  }

  async createCategory(dto: CreateTagCategoryDto) {
    const existing = await this.prisma.tagCategory.findUnique({ where: { code: dto.code } });
    if (existing) throw new BadRequestException(`类别编码 "${dto.code}" 已存在`);
    return this.prisma.tagCategory.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateTagCategoryDto) {
    const category = await this.prisma.tagCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('标签类别不存在');
    return this.prisma.tagCategory.update({ where: { id }, data: dto });
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.tagCategory.findUnique({
      where: { id },
      include: { tags: { include: { _count: { select: { productTags: true, companyTags: true } } } } },
    });
    if (!category) throw new NotFoundException('标签类别不存在');

    const usedTags = category.tags.filter(t => t._count.productTags > 0 || t._count.companyTags > 0);
    if (usedTags.length > 0) {
      throw new BadRequestException(
        `该类别下有 ${usedTags.length} 个标签正在使用中，无法删除。请先移除关联后再试。`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.tag.deleteMany({ where: { categoryId: id } }),
      this.prisma.tagCategory.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  // ===================== Tag =====================

  async listTags(categoryId?: string, scope?: TagScope) {
    return this.prisma.tag.findMany({
      where: {
        ...(categoryId ? { categoryId } : {}),
        ...(scope ? { category: { scope } } : {}),
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      include: {
        category: { select: { id: true, name: true, code: true, scope: true } },
        _count: { select: { productTags: true, companyTags: true } },
      },
    });
  }

  async createTag(dto: CreateTagDto) {
    const category = await this.prisma.tagCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException('标签类别不存在');

    const existing = await this.prisma.tag.findUnique({
      where: { name_categoryId: { name: dto.name, categoryId: dto.categoryId } },
    });
    if (existing) throw new BadRequestException(`标签 "${dto.name}" 在该类别下已存在`);

    return this.prisma.tag.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        synonyms: dto.synonyms || [],
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateTag(id: string, dto: UpdateTagDto) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');

    if (dto.name && dto.name !== tag.name) {
      const existing = await this.prisma.tag.findUnique({
        where: { name_categoryId: { name: dto.name, categoryId: tag.categoryId } },
      });
      if (existing) throw new BadRequestException(`标签 "${dto.name}" 在该类别下已存在`);
    }

    return this.prisma.tag.update({ where: { id }, data: dto });
  }

  async deleteTag(id: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { id },
      include: { _count: { select: { productTags: true, companyTags: true } } },
    });
    if (!tag) throw new NotFoundException('标签不存在');

    const totalUsage = tag._count.productTags + tag._count.companyTags;
    if (totalUsage > 0) {
      throw new BadRequestException(
        `该标签已被 ${tag._count.companyTags} 个企业和 ${tag._count.productTags} 个商品使用，无法删除。请先移除关联或将标签设为停用。`,
      );
    }

    await this.prisma.tag.delete({ where: { id } });
    return { ok: true };
  }
}
```

- [ ] **Step 3: Create controller**

Create `backend/src/modules/admin/tags/admin-tags.controller.ts`:

```typescript
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { TagScope } from '@prisma/client';
import { AdminTagsService } from './admin-tags.service';
import { CreateTagCategoryDto, UpdateTagCategoryDto, CreateTagDto, UpdateTagDto } from './admin-tags.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/tag-categories')
export class AdminTagCategoriesController {
  constructor(private tagsService: AdminTagsService) {}

  @Get()
  @RequirePermission('tags:read')
  listCategories(@Query('scope') scope?: TagScope) {
    return this.tagsService.listCategories(scope);
  }

  @Post()
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'CREATE', module: 'tags', targetType: 'TagCategory', isReversible: true })
  createCategory(@Body() dto: CreateTagCategoryDto) {
    return this.tagsService.createCategory(dto);
  }

  @Patch(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'UPDATE', module: 'tags', targetType: 'TagCategory', targetIdParam: 'params.id', isReversible: true })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateTagCategoryDto) {
    return this.tagsService.updateCategory(id, dto);
  }

  @Delete(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'DELETE', module: 'tags', targetType: 'TagCategory', targetIdParam: 'params.id', isReversible: false })
  deleteCategory(@Param('id') id: string) {
    return this.tagsService.deleteCategory(id);
  }
}

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/tags')
export class AdminTagsController {
  constructor(private tagsService: AdminTagsService) {}

  @Get()
  @RequirePermission('tags:read')
  listTags(@Query('categoryId') categoryId?: string, @Query('scope') scope?: TagScope) {
    return this.tagsService.listTags(categoryId, scope);
  }

  @Post()
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'CREATE', module: 'tags', targetType: 'Tag', isReversible: true })
  createTag(@Body() dto: CreateTagDto) {
    return this.tagsService.createTag(dto);
  }

  @Patch(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'UPDATE', module: 'tags', targetType: 'Tag', targetIdParam: 'params.id', isReversible: true })
  updateTag(@Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tagsService.updateTag(id, dto);
  }

  @Delete(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'DELETE', module: 'tags', targetType: 'Tag', targetIdParam: 'params.id', isReversible: false })
  deleteTag(@Param('id') id: string) {
    return this.tagsService.deleteTag(id);
  }
}
```

- [ ] **Step 4: Create module**

Create `backend/src/modules/admin/tags/admin-tags.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AdminTagCategoriesController, AdminTagsController } from './admin-tags.controller';
import { AdminTagsService } from './admin-tags.service';

@Module({
  controllers: [AdminTagCategoriesController, AdminTagsController],
  providers: [AdminTagsService],
})
export class AdminTagsModule {}
```

- [ ] **Step 5: Register in admin module**

In `backend/src/modules/admin/admin.module.ts`, add import and register:

```typescript
import { AdminTagsModule } from './tags/admin-tags.module';
```

Add `AdminTagsModule` to the imports array.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/admin/tags/ backend/src/modules/admin/admin.module.ts
git commit -m "feat(admin): add tag categories and tags CRUD management module"
```

---

## Task 4: Public Tag Categories API + Company Tag Endpoints

**Files:**
- Modify: `backend/src/modules/company/company.controller.ts`
- Modify: `backend/src/modules/company/company.service.ts`
- Modify: `backend/src/modules/admin/companies/admin-companies.controller.ts`
- Modify: `backend/src/modules/admin/companies/admin-companies.service.ts`

- [ ] **Step 1: Add public tag-categories endpoint**

In `backend/src/modules/company/company.controller.ts`, add import and endpoint:

```typescript
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
```

Add this method to the controller:

```typescript
  @Public()
  @Get('tag-categories')
  listTagCategories(@Query('scope') scope?: string) {
    return this.companyService.listTagCategories(scope as any);
  }
```

Note: This endpoint must be defined BEFORE the `:id` route to avoid conflicts. Move it before `@Get(':id')`.

Also update the controller path: The tag-categories endpoint path is `/companies/tag-categories`. However since this is a shared resource, add a separate controller. Instead, add the method to `company.service.ts` and expose via the existing controller. The path `/companies/tag-categories` is acceptable.

Actually, better approach — create a standalone route. Add to `company.controller.ts` before the `@Get(':id')` method:

```typescript
  /** 公开接口：获取标签类别与标签选项 */
  @Public()
  @Get('tag-categories')
  listTagCategories(@Query('scope') scope?: string) {
    return this.companyService.listTagCategories(scope);
  }
```

- [ ] **Step 2: Add tag categories query to company service**

In `backend/src/modules/company/company.service.ts`, add:

```typescript
  /** 获取标签类别（含 active 标签），供前端选择器使用 */
  async listTagCategories(scope?: string) {
    return this.prisma.tagCategory.findMany({
      where: scope ? { scope: scope as any } : undefined,
      orderBy: { sortOrder: 'asc' },
      include: {
        tags: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, synonyms: true },
        },
      },
    });
  }
```

- [ ] **Step 3: Add company tag endpoints to admin controller**

In `backend/src/modules/admin/companies/admin-companies.controller.ts`, add these endpoints:

```typescript
  @Get(':id/tags')
  @RequirePermission('companies:read')
  getCompanyTags(@Param('id') id: string) {
    return this.companiesService.getCompanyTags(id);
  }

  @Put(':id/tags')
  @RequirePermission('companies:update')
  @AuditLog({ action: 'UpdateCompanyTags', resource: 'Company', resourceId: '#id', isReversible: true })
  updateCompanyTags(@Param('id') id: string, @Body() body: { tagIds: string[] }) {
    return this.companiesService.updateCompanyTags(id, body.tagIds);
  }
```

Add `Put` to the NestJS imports at the top of the file if not already imported.

- [ ] **Step 4: Add company tag methods to admin service**

In `backend/src/modules/admin/companies/admin-companies.service.ts`, add:

```typescript
  async getCompanyTags(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    const companyTags = await this.prisma.companyTag.findMany({
      where: { companyId },
      include: {
        tag: {
          include: { category: { select: { id: true, name: true, code: true, scope: true } } },
        },
      },
    });

    // 按类别分组返回
    const grouped: Record<string, { categoryId: string; categoryName: string; categoryCode: string; tags: { id: string; name: string }[] }> = {};
    for (const ct of companyTags) {
      const code = ct.tag.category.code;
      if (!grouped[code]) {
        grouped[code] = {
          categoryId: ct.tag.category.id,
          categoryName: ct.tag.category.name,
          categoryCode: code,
          tags: [],
        };
      }
      grouped[code].tags.push({ id: ct.tag.id, name: ct.tag.name });
    }
    return Object.values(grouped);
  }

  async updateCompanyTags(companyId: string, tagIds: string[]) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('企业不存在');

    // 验证所有 tagIds 存在且 scope 为 COMPANY
    if (tagIds.length > 0) {
      const tags = await this.prisma.tag.findMany({
        where: { id: { in: tagIds } },
        include: { category: { select: { scope: true } } },
      });
      const invalidTags = tags.filter(t => t.category.scope !== 'COMPANY');
      if (invalidTags.length > 0) {
        throw new BadRequestException(`以下标签不适用于企业：${invalidTags.map(t => t.name).join(', ')}`);
      }
      if (tags.length !== tagIds.length) {
        throw new BadRequestException('部分标签 ID 不存在');
      }
    }

    await this.prisma.$transaction([
      this.prisma.companyTag.deleteMany({ where: { companyId } }),
      ...(tagIds.length > 0
        ? [this.prisma.companyTag.createMany({
            data: tagIds.map(tagId => ({ companyId, tagId })),
            skipDuplicates: true,
          })]
        : []),
    ]);

    return this.getCompanyTags(companyId);
  }
```

Add `BadRequestException` to the imports if not already present.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/company/company.controller.ts backend/src/modules/company/company.service.ts backend/src/modules/admin/companies/
git commit -m "feat(api): add public tag-categories endpoint and admin company tag management"
```

---

## Task 5: Seller Company Tag Endpoints

**Files:**
- Modify: `backend/src/modules/seller/company/seller-company.controller.ts`
- Modify: `backend/src/modules/seller/company/seller-company.service.ts`

- [ ] **Step 1: Add tag endpoints to seller company controller**

In `backend/src/modules/seller/company/seller-company.controller.ts`, add before the documents section (around line 78):

```typescript
  // ===================== 企业标签 =====================

  /** 获取企业标签 */
  @SellerRoles('OWNER', 'MANAGER')
  @Get('tags')
  getCompanyTags(@CurrentSeller('companyId') companyId: string) {
    return this.companyService.getCompanyTags(companyId);
  }

  /** 更新企业标签 */
  @SellerAudit({ action: 'UPDATE_COMPANY_TAGS', module: 'company', targetType: 'Company' })
  @SellerRoles('OWNER', 'MANAGER')
  @Put('tags')
  updateCompanyTags(
    @CurrentSeller('companyId') companyId: string,
    @Body() body: { tagIds: string[] },
  ) {
    return this.companyService.updateCompanyTags(companyId, body.tagIds);
  }
```

- [ ] **Step 2: Add tag methods to seller company service**

In `backend/src/modules/seller/company/seller-company.service.ts`, add:

```typescript
  // ===================== 企业标签 =====================

  async getCompanyTags(companyId: string) {
    const companyTags = await this.prisma.companyTag.findMany({
      where: { companyId },
      include: {
        tag: {
          include: { category: { select: { id: true, name: true, code: true, scope: true } } },
        },
      },
    });

    const grouped: Record<string, { categoryId: string; categoryName: string; categoryCode: string; tags: { id: string; name: string }[] }> = {};
    for (const ct of companyTags) {
      const code = ct.tag.category.code;
      if (!grouped[code]) {
        grouped[code] = {
          categoryId: ct.tag.category.id,
          categoryName: ct.tag.category.name,
          categoryCode: code,
          tags: [],
        };
      }
      grouped[code].tags.push({ id: ct.tag.id, name: ct.tag.name });
    }
    return Object.values(grouped);
  }

  async updateCompanyTags(companyId: string, tagIds: string[]) {
    if (tagIds.length > 0) {
      const tags = await this.prisma.tag.findMany({
        where: { id: { in: tagIds } },
        include: { category: { select: { scope: true } } },
      });
      const invalidTags = tags.filter(t => t.category.scope !== 'COMPANY');
      if (invalidTags.length > 0) {
        throw new BadRequestException(`以下标签不适用于企业：${invalidTags.map(t => t.name).join(', ')}`);
      }
      if (tags.length !== tagIds.length) {
        throw new BadRequestException('部分标签 ID 不存在');
      }
    }

    await this.prisma.$transaction([
      this.prisma.companyTag.deleteMany({ where: { companyId } }),
      ...(tagIds.length > 0
        ? [this.prisma.companyTag.createMany({
            data: tagIds.map(tagId => ({ companyId, tagId })),
            skipDuplicates: true,
          })]
        : []),
    ]);

    return this.getCompanyTags(companyId);
  }
```

Add `BadRequestException` to the imports from `@nestjs/common` if not already present.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seller/company/
git commit -m "feat(seller): add company tag get/update endpoints"
```

---

## Task 6: Refactor Company Service mapToFrontend

**Files:**
- Modify: `backend/src/modules/company/company.service.ts:203-241`

- [ ] **Step 1: Update company queries to include companyTags**

In `company.service.ts`, find the `list()` and `getById()` methods. Add `companyTags` to the include clause wherever `company` is fetched. For example, in the query options add:

```typescript
companyTags: {
  include: { tag: { include: { category: { select: { code: true } } } } },
},
```

- [ ] **Step 2: Refactor mapToFrontend to use CompanyTag**

Replace the highlights-based tag extraction in `mapToFrontend` (lines 223, 235-239):

Replace:
```typescript
    badges: highlights.badges || [],
```
and:
```typescript
    companyType: highlights.companyType || null,
    industryTags: highlights.industryTags || [],
    productKeywords: highlights.productKeywords || [],
    productFeatures: highlights.productFeatures || [],
    certifications: highlights.certifications || [],
```

With:
```typescript
    badges: this.getTagNamesByCode(company.companyTags, 'company_badge'),
    companyType: highlights.companyType || null,
    industryTags: this.getTagNamesByCode(company.companyTags, 'industry'),
    productKeywords: highlights.productKeywords || [],
    productFeatures: this.getTagNamesByCode(company.companyTags, 'product_feature'),
    certifications: this.getTagNamesByCode(company.companyTags, 'company_cert'),
```

Add helper method to the service:
```typescript
  private getTagNamesByCode(companyTags: any[], categoryCode: string): string[] {
    if (!companyTags) return [];
    return companyTags
      .filter((ct: any) => ct.tag?.category?.code === categoryCode)
      .map((ct: any) => ct.tag.name);
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/company/company.service.ts
git commit -m "refactor(company): read tags from CompanyTag relations instead of highlights JSON"
```

---

## Task 7: Refactor Seller Product Tag System

**Files:**
- Modify: `backend/src/modules/seller/products/seller-products.dto.ts:58-61,129-132`
- Modify: `backend/src/modules/seller/products/seller-products.service.ts:150-166,280-306`

- [ ] **Step 1: Update DTO — add tagIds field**

In `backend/src/modules/seller/products/seller-products.dto.ts`, replace the `tags` fields in both `CreateProductDto` and `UpdateProductDto`:

In `CreateProductDto` (lines 58-61), replace:
```typescript
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
```
With:
```typescript
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
```

In `UpdateProductDto` (lines 129-132), same replacement:
```typescript
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
```

- [ ] **Step 2: Update service — create product tags by ID**

In `backend/src/modules/seller/products/seller-products.service.ts`, in the create method (around lines 143-166), replace the tag creation logic:

Replace the entire tag block (from `if (dto.tags` or similar) with:

```typescript
      // 创建商品标签关联（通过 tagId）
      if (dto.tagIds && dto.tagIds.length > 0) {
        // 验证标签存在且 scope 为 PRODUCT
        const tags = await tx.tag.findMany({
          where: { id: { in: dto.tagIds }, isActive: true },
          include: { category: { select: { scope: true } } },
        });
        const validTagIds = tags
          .filter(t => t.category.scope === 'PRODUCT')
          .map(t => t.id);
        if (validTagIds.length > 0) {
          await tx.productTag.createMany({
            data: validTagIds.map(tagId => ({ productId: product.id, tagId })),
            skipDuplicates: true,
          });
        }
      }
```

- [ ] **Step 3: Update service — update product tags by ID**

In the update method (around lines 280-306), replace the tag update logic:

Replace:
```typescript
    if (dto.tags) {
      await tx.productTag.deleteMany({ where: { productId } });
      // ... old tag name-based logic
```

With:
```typescript
    if (dto.tagIds) {
      await tx.productTag.deleteMany({ where: { productId } });
      if (dto.tagIds.length > 0) {
        const tags = await tx.tag.findMany({
          where: { id: { in: dto.tagIds }, isActive: true },
          include: { category: { select: { scope: true } } },
        });
        const validTagIds = tags
          .filter(t => t.category.scope === 'PRODUCT')
          .map(t => t.id);
        if (validTagIds.length > 0) {
          await tx.productTag.createMany({
            data: validTagIds.map(tagId => ({ productId, tagId })),
            skipDuplicates: true,
          });
        }
      }
    }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/seller/products/
git commit -m "refactor(seller): switch product tags from free text to tagId-based selection"
```

---

## Task 8: Admin Frontend — API Layer & Permissions

**Files:**
- Create: `admin/src/api/tags.ts`
- Modify: `admin/src/constants/permissions.ts`

- [ ] **Step 1: Create admin tags API**

Create `admin/src/api/tags.ts`:

```typescript
import client from './client';

// ===== Types =====

export interface TagCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
  scope: 'COMPANY' | 'PRODUCT';
  sortOrder: number;
  tags: TagItem[];
}

export interface TagItem {
  id: string;
  name: string;
  synonyms: string[];
  sortOrder: number;
  isActive: boolean;
  _count?: { productTags: number; companyTags: number };
  category?: { id: string; name: string; code: string; scope: string };
}

// ===== TagCategory =====

export const getTagCategories = (scope?: string): Promise<TagCategory[]> =>
  client.get('/admin/tag-categories', { params: scope ? { scope } : undefined });

export const createTagCategory = (data: {
  name: string;
  code: string;
  scope: 'COMPANY' | 'PRODUCT';
  description?: string;
  sortOrder?: number;
}): Promise<TagCategory> => client.post('/admin/tag-categories', data);

export const updateTagCategory = (
  id: string,
  data: { name?: string; description?: string; sortOrder?: number },
): Promise<TagCategory> => client.patch(`/admin/tag-categories/${id}`, data);

export const deleteTagCategory = (id: string): Promise<void> =>
  client.delete(`/admin/tag-categories/${id}`);

// ===== Tag =====

export const getTags = (params?: { categoryId?: string; scope?: string }): Promise<TagItem[]> =>
  client.get('/admin/tags', { params });

export const createTag = (data: {
  name: string;
  categoryId: string;
  synonyms?: string[];
  sortOrder?: number;
}): Promise<TagItem> => client.post('/admin/tags', data);

export const updateTag = (
  id: string,
  data: { name?: string; synonyms?: string[]; sortOrder?: number; isActive?: boolean },
): Promise<TagItem> => client.patch(`/admin/tags/${id}`, data);

export const deleteTag = (id: string): Promise<void> =>
  client.delete(`/admin/tags/${id}`);

// ===== Company Tags =====

export interface CompanyTagGroup {
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  tags: { id: string; name: string }[];
}

export const getCompanyTags = (companyId: string): Promise<CompanyTagGroup[]> =>
  client.get(`/admin/companies/${companyId}/tags`);

export const updateCompanyTags = (companyId: string, tagIds: string[]): Promise<CompanyTagGroup[]> =>
  client.put(`/admin/companies/${companyId}/tags`, { tagIds });

// ===== Public API (for tag options) =====

export const getPublicTagCategories = (scope?: string): Promise<TagCategory[]> =>
  client.get('/companies/tag-categories', { params: scope ? { scope } : undefined });
```

- [ ] **Step 2: Add tag permissions**

In `admin/src/constants/permissions.ts`, add before the closing `} as const`:

```typescript
  // 标签管理
  TAGS_READ: 'tags:read',
  TAGS_MANAGE: 'tags:manage',
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/api/tags.ts admin/src/constants/permissions.ts
git commit -m "feat(admin-ui): add tags API layer and permission constants"
```

---

## Task 9: Admin Frontend — Tag Management Page

**Files:**
- Create: `admin/src/pages/tags/index.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`

- [ ] **Step 1: Create tag management page**

Create `admin/src/pages/tags/index.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Card, Row, Col, Button, Space, Tag, Modal, Form, Input, Select, Switch, message, Popconfirm, InputNumber } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  getTagCategories, createTagCategory, updateTagCategory, deleteTagCategory,
  getTags, createTag, updateTag, deleteTag,
  type TagCategory, type TagItem,
} from '@/api/tags';

export default function TagManagementPage() {
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<TagCategory | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<TagCategory | null>(null);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagItem | null>(null);
  const [categoryForm] = Form.useForm();
  const [tagForm] = Form.useForm();

  // ===== 数据查询 =====

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['admin-tag-categories'],
    queryFn: () => getTagCategories(),
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['admin-tags', selectedCategory?.id],
    queryFn: () => getTags({ categoryId: selectedCategory?.id }),
    enabled: !!selectedCategory,
  });

  // ===== Category mutations =====

  const createCategoryMut = useMutation({
    mutationFn: createTagCategory,
    onSuccess: () => {
      message.success('类别已创建');
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setCategoryModalOpen(false);
      categoryForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '创建失败'),
  });

  const updateCategoryMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateTagCategory(id, data),
    onSuccess: () => {
      message.success('类别已更新');
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setCategoryModalOpen(false);
      setEditingCategory(null);
      categoryForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '更新失败'),
  });

  const deleteCategoryMut = useMutation({
    mutationFn: deleteTagCategory,
    onSuccess: () => {
      message.success('类别已删除');
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      if (selectedCategory?.id === editingCategory?.id) setSelectedCategory(null);
    },
    onError: (e: any) => message.error(e?.message || '删除失败'),
  });

  // ===== Tag mutations =====

  const createTagMut = useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      message.success('标签已创建');
      queryClient.invalidateQueries({ queryKey: ['admin-tags', selectedCategory?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setTagModalOpen(false);
      tagForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '创建失败'),
  });

  const updateTagMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateTag(id, data),
    onSuccess: () => {
      message.success('标签已更新');
      queryClient.invalidateQueries({ queryKey: ['admin-tags', selectedCategory?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
      setTagModalOpen(false);
      setEditingTag(null);
      tagForm.resetFields();
    },
    onError: (e: any) => message.error(e?.message || '更新失败'),
  });

  const deleteTagMut = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      message.success('标签已删除');
      queryClient.invalidateQueries({ queryKey: ['admin-tags', selectedCategory?.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-tag-categories'] });
    },
    onError: (e: any) => message.error(e?.message || '删除失败'),
  });

  // ===== Handlers =====

  const openCategoryModal = useCallback((category?: TagCategory) => {
    setEditingCategory(category || null);
    if (category) {
      categoryForm.setFieldsValue(category);
    } else {
      categoryForm.resetFields();
    }
    setCategoryModalOpen(true);
  }, [categoryForm]);

  const handleCategorySubmit = useCallback(async () => {
    const values = await categoryForm.validateFields();
    if (editingCategory) {
      updateCategoryMut.mutate({ id: editingCategory.id, data: { name: values.name, description: values.description, sortOrder: values.sortOrder } });
    } else {
      createCategoryMut.mutate(values);
    }
  }, [categoryForm, editingCategory, createCategoryMut, updateCategoryMut]);

  const openTagModal = useCallback((tag?: TagItem) => {
    setEditingTag(tag || null);
    if (tag) {
      tagForm.setFieldsValue({ ...tag, synonyms: tag.synonyms?.join(', ') || '' });
    } else {
      tagForm.resetFields();
    }
    setTagModalOpen(true);
  }, [tagForm]);

  const handleTagSubmit = useCallback(async () => {
    const values = await tagForm.validateFields();
    const synonyms = values.synonyms
      ? values.synonyms.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean)
      : [];
    if (editingTag) {
      updateTagMut.mutate({ id: editingTag.id, data: { name: values.name, synonyms, sortOrder: values.sortOrder, isActive: values.isActive } });
    } else {
      createTagMut.mutate({ name: values.name, categoryId: selectedCategory!.id, synonyms, sortOrder: values.sortOrder || 0 });
    }
  }, [tagForm, editingTag, selectedCategory, createTagMut, updateTagMut]);

  // ===== Category Columns =====

  const categoryColumns: ProColumns<TagCategory>[] = [
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '编码', dataIndex: 'code', width: 120, copyable: true },
    {
      title: '范围', dataIndex: 'scope', width: 80,
      render: (_, r) => <Tag color={r.scope === 'COMPANY' ? 'blue' : 'green'}>{r.scope === 'COMPANY' ? '企业' : '商品'}</Tag>,
    },
    { title: '标签数', width: 60, render: (_, r) => r.tags?.length || 0 },
    { title: '排序', dataIndex: 'sortOrder', width: 60 },
    {
      title: '操作', width: 100,
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openCategoryModal(record)}><EditOutlined /></a>
          <Popconfirm title="确定删除此类别？" onConfirm={() => deleteCategoryMut.mutate(record.id)}>
            <a style={{ color: '#ff4d4f' }}><DeleteOutlined /></a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ===== Tag Columns =====

  const tagColumns: ProColumns<TagItem>[] = [
    { title: '标签名', dataIndex: 'name', width: 120 },
    { title: '同义词', dataIndex: 'synonyms', width: 160, render: (_, r) => r.synonyms?.join(', ') || '-' },
    { title: '排序', dataIndex: 'sortOrder', width: 60 },
    {
      title: '状态', dataIndex: 'isActive', width: 80,
      render: (_, r) => (
        <Switch
          checked={r.isActive}
          size="small"
          onChange={(checked) => updateTagMut.mutate({ id: r.id, data: { isActive: checked } })}
        />
      ),
    },
    {
      title: '使用量', width: 80,
      render: (_, r) => (r._count?.productTags || 0) + (r._count?.companyTags || 0),
    },
    {
      title: '操作', width: 100,
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openTagModal(record)}><EditOutlined /></a>
          <Popconfirm title="确定删除此标签？" onConfirm={() => deleteTagMut.mutate(record.id)}>
            <a style={{ color: '#ff4d4f' }}><DeleteOutlined /></a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Row gutter={16}>
        {/* 左侧：标签类别 */}
        <Col span={10}>
          <Card
            title="标签类别"
            extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openCategoryModal()}>新增类别</Button>}
          >
            <ProTable<TagCategory>
              columns={categoryColumns}
              dataSource={categories}
              loading={categoriesLoading}
              rowKey="id"
              search={false}
              options={false}
              pagination={false}
              onRow={(record) => ({
                onClick: () => setSelectedCategory(record),
                style: { cursor: 'pointer', background: selectedCategory?.id === record.id ? '#e6f4ff' : undefined },
              })}
            />
          </Card>
        </Col>

        {/* 右侧：标签列表 */}
        <Col span={14}>
          <Card
            title={selectedCategory ? `${selectedCategory.name} — 标签列表` : '请选择一个类别'}
            extra={
              selectedCategory && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openTagModal()}>
                  新增标签
                </Button>
              )
            }
          >
            {selectedCategory ? (
              <ProTable<TagItem>
                columns={tagColumns}
                dataSource={tags}
                loading={tagsLoading}
                rowKey="id"
                search={false}
                options={false}
                pagination={false}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>点击左侧类别查看标签</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 类别弹窗 */}
      <Modal
        title={editingCategory ? '编辑类别' : '新增类别'}
        open={categoryModalOpen}
        onOk={handleCategorySubmit}
        onCancel={() => { setCategoryModalOpen(false); setEditingCategory(null); }}
        confirmLoading={createCategoryMut.isPending || updateCategoryMut.isPending}
      >
        <Form form={categoryForm} layout="vertical">
          <Form.Item name="name" label="类别名称" rules={[{ required: true, message: '请输入类别名称' }]}>
            <Input placeholder="如：企业徽章" />
          </Form.Item>
          {!editingCategory && (
            <>
              <Form.Item name="code" label="类别编码" rules={[{ required: true, message: '请输入编码' }, { pattern: /^[a-z_]+$/, message: '只允许小写字母和下划线' }]}>
                <Input placeholder="如：company_badge" />
              </Form.Item>
              <Form.Item name="scope" label="适用范围" rules={[{ required: true, message: '请选择范围' }]}>
                <Select options={[{ value: 'COMPANY', label: '企业' }, { value: 'PRODUCT', label: '商品' }]} />
              </Form.Item>
            </>
          )}
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" initialValue={0}>
            <InputNumber min={0} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 标签弹窗 */}
      <Modal
        title={editingTag ? '编辑标签' : '新增标签'}
        open={tagModalOpen}
        onOk={handleTagSubmit}
        onCancel={() => { setTagModalOpen(false); setEditingTag(null); }}
        confirmLoading={createTagMut.isPending || updateTagMut.isPending}
      >
        <Form form={tagForm} layout="vertical">
          <Form.Item name="name" label="标签名称" rules={[{ required: true, message: '请输入标签名称' }]}>
            <Input placeholder="如：有机认证" />
          </Form.Item>
          <Form.Item name="synonyms" label="同义词（逗号分隔）">
            <Input placeholder="如：有机, 绿色有机" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" initialValue={0}>
            <InputNumber min={0} />
          </Form.Item>
          {editingTag && (
            <Form.Item name="isActive" label="启用" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

In `admin/src/App.tsx`, add lazy import (after line 45):

```typescript
const TagManagementPage = lazy(() => import('@/pages/tags/index'));
```

Add route (after line 130, before the closing `</Route>`):

```typescript
            <Route path="tags" element={<TagManagementPage />} />
```

- [ ] **Step 3: Add menu item in AdminLayout.tsx**

In `admin/src/layouts/AdminLayout.tsx`, add `TagsOutlined` to the icon imports (line 7-19):

```typescript
import { TagsOutlined } from '@ant-design/icons';
```

In the `menuRoutes` (inside the `商家与商品` group, after `{ path: '/trace', ...}` around line 59), add:

```typescript
        { path: '/tags', name: '标签管理', icon: <TagsOutlined />, permission: PERMISSIONS.TAGS_READ },
```

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/tags/ admin/src/App.tsx admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin-ui): add tag management page with category and tag CRUD"
```

---

## Task 10: Admin Frontend — Company Detail Dynamic Tags

**Files:**
- Modify: `admin/src/pages/companies/detail.tsx:50-55,560-573`
- Modify: `admin/src/types/index.ts:397-407`

- [ ] **Step 1: Replace hardcoded options with dynamic query in company detail**

In `admin/src/pages/companies/detail.tsx`, replace the import of hardcoded options (lines 50-55):

Replace:
```typescript
import {
  COMPANY_TYPE_OPTIONS,
  INDUSTRY_TAG_OPTIONS,
  PRODUCT_FEATURE_OPTIONS,
  CERTIFICATION_OPTIONS,
} from '@/types';
```

With:
```typescript
import { COMPANY_TYPE_OPTIONS } from '@/types';
import { getPublicTagCategories, getCompanyTags, updateCompanyTags, type TagCategory } from '@/api/tags';
```

- [ ] **Step 2: Add tag categories query and company tags state**

Inside the component, add queries:

```typescript
const { data: tagCategories = [] } = useQuery({
  queryKey: ['tag-categories-company'],
  queryFn: () => getPublicTagCategories('COMPANY'),
});

const { data: companyTagGroups = [] } = useQuery({
  queryKey: ['company-tags', id],
  queryFn: () => getCompanyTags(id!),
  enabled: !!id,
});
```

- [ ] **Step 3: Replace AI Search Profile form fields**

Replace the hardcoded Select fields (lines 562-573) with dynamically generated ones. Replace:

```tsx
<ProForm.Item name="industryTags" label="主营品类" ...>
  <Select mode="multiple" ... options={INDUSTRY_TAG_OPTIONS} />
</ProForm.Item>
...
<ProForm.Item name="productFeatures" label="产品特征" ...>
  <Select mode="multiple" ... options={PRODUCT_FEATURE_OPTIONS} />
</ProForm.Item>
<ProForm.Item name="certifications" label="认证资质">
  <Select mode="multiple" ... options={CERTIFICATION_OPTIONS} />
</ProForm.Item>
```

With a dynamic rendering block:

```tsx
{tagCategories
  .filter(cat => cat.code !== 'product_tag') // 只显示企业相关类别
  .map(cat => (
    <ProForm.Item
      key={cat.code}
      name={`tag_${cat.code}`}
      label={cat.name}
    >
      <Select
        mode="multiple"
        placeholder={`请选择${cat.name}`}
        options={cat.tags.map(t => ({ value: t.id, label: t.name }))}
        showSearch
        optionFilterProp="label"
      />
    </ProForm.Item>
  ))}
```

- [ ] **Step 4: Set initial form values from company tags**

When setting form initial values, populate the tag fields from `companyTagGroups`:

```typescript
// 初始化标签选中状态
for (const group of companyTagGroups) {
  form.setFieldValue(`tag_${group.categoryCode}`, group.tags.map(t => t.id));
}
```

- [ ] **Step 5: Update save handler to submit company tags**

In the AI Search Profile save handler, collect all tag IDs and call updateCompanyTags:

```typescript
const allTagIds: string[] = [];
for (const cat of tagCategories) {
  const fieldValue = form.getFieldValue(`tag_${cat.code}`) || [];
  allTagIds.push(...fieldValue);
}
await updateCompanyTags(id!, allTagIds);
```

- [ ] **Step 6: Remove hardcoded options from types**

In `admin/src/types/index.ts`, remove lines 397-407 (the `INDUSTRY_TAG_OPTIONS`, `PRODUCT_FEATURE_OPTIONS`, `CERTIFICATION_OPTIONS` constants). Keep `COMPANY_TYPE_OPTIONS` as it's a different concern (company type, not tags).

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/companies/detail.tsx admin/src/types/index.ts
git commit -m "refactor(admin-ui): replace hardcoded tag options with dynamic API-driven selectors"
```

---

## Task 11: Seller Frontend — Dynamic Tag Options

**Files:**
- Create: `seller/src/api/tags.ts`
- Modify: `seller/src/pages/company/index.tsx:9-12,264-331`
- Modify: `seller/src/pages/products/edit.tsx:267-269`
- Modify: `seller/src/types/index.ts:258-272`

- [ ] **Step 1: Create seller tags API**

Create `seller/src/api/tags.ts`:

```typescript
import client from './client';

export interface TagCategory {
  id: string;
  name: string;
  code: string;
  scope: 'COMPANY' | 'PRODUCT';
  tags: { id: string; name: string }[];
}

export interface CompanyTagGroup {
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  tags: { id: string; name: string }[];
}

export const getTagCategories = (scope?: string): Promise<TagCategory[]> =>
  client.get('/companies/tag-categories', { params: scope ? { scope } : undefined });

export const getCompanyTags = (): Promise<CompanyTagGroup[]> =>
  client.get('/seller/company/tags');

export const updateCompanyTags = (tagIds: string[]): Promise<CompanyTagGroup[]> =>
  client.put('/seller/company/tags', { tagIds });
```

- [ ] **Step 2: Update seller company page**

In `seller/src/pages/company/index.tsx`, replace the import of hardcoded options (lines 9-12):

Replace:
```typescript
import {
  COMPANY_TYPE_OPTIONS, INDUSTRY_TAG_OPTIONS, PRODUCT_FEATURE_OPTIONS,
  SUPPLY_MODE_OPTIONS, CERTIFICATION_OPTIONS,
} from '@/types';
```

With:
```typescript
import { COMPANY_TYPE_OPTIONS, SUPPLY_MODE_OPTIONS } from '@/types';
import { getTagCategories, getCompanyTags, updateCompanyTags, type TagCategory } from '@/api/tags';
```

Add queries inside the component:

```typescript
const { data: tagCategories = [] } = useQuery({
  queryKey: ['tag-categories-company'],
  queryFn: () => getTagCategories('COMPANY'),
});

const { data: companyTagGroups = [] } = useQuery({
  queryKey: ['seller-company-tags'],
  queryFn: getCompanyTags,
});
```

Replace the hardcoded Select fields (industryTags, productFeatures, certifications around lines 264-331) with dynamic rendering:

```tsx
{tagCategories
  .filter(cat => cat.code !== 'product_tag')
  .map(cat => (
    <ProForm.Item
      key={cat.code}
      name={`tag_${cat.code}`}
      label={cat.name}
    >
      <Select
        mode="multiple"
        placeholder={`请选择${cat.name}`}
        options={cat.tags.map(t => ({ value: t.id, label: t.name }))}
        showSearch
        optionFilterProp="label"
      />
    </ProForm.Item>
  ))}
```

Update form initial values and save handler similarly to admin (Task 10 Steps 4-5).

- [ ] **Step 3: Update seller product edit page**

In `seller/src/pages/products/edit.tsx`, replace the tags input (lines 267-269):

Replace:
```tsx
<Form.Item label="标签" name="tags">
  <Input placeholder="多个标签用逗号分隔，如：有机,新米,东北" />
</Form.Item>
```

With:
```tsx
<Form.Item label="标签" name="tagIds">
  <Select
    mode="multiple"
    placeholder="请选择商品标签"
    options={productTagOptions}
    showSearch
    optionFilterProp="label"
  />
</Form.Item>
```

Add query for product tag options:

```typescript
import { getTagCategories } from '@/api/tags';

const { data: productCategories = [] } = useQuery({
  queryKey: ['tag-categories-product'],
  queryFn: () => getTagCategories('PRODUCT'),
});

const productTagOptions = productCategories
  .flatMap(cat => cat.tags.map(t => ({ value: t.id, label: t.name })));
```

Update the form submission (lines 321-322): remove the comma-split logic, `tagIds` is already a `string[]`.

Replace:
```typescript
const tags = typeof values.tags === 'string'
  ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean)
```
With:
```typescript
const tagIds = values.tagIds || [];
```

And pass `tagIds` instead of `tags` in the API call.

Update the form initial value mapping (line 449): change from tag name string to tag IDs:

Replace:
```typescript
tags: product.tags?.map((t) => t.tag.name).join(',') || '',
```
With:
```typescript
tagIds: product.tags?.map((t: any) => t.tag.id || t.tagId) || [],
```

- [ ] **Step 4: Remove hardcoded options from seller types**

In `seller/src/types/index.ts`, remove lines 258-272 (the `INDUSTRY_TAG_OPTIONS`, `PRODUCT_FEATURE_OPTIONS`, `CERTIFICATION_OPTIONS` constants). Keep `COMPANY_TYPE_OPTIONS` and `SUPPLY_MODE_OPTIONS`.

- [ ] **Step 5: Commit**

```bash
git add seller/src/api/tags.ts seller/src/pages/company/index.tsx seller/src/pages/products/edit.tsx seller/src/types/index.ts
git commit -m "refactor(seller-ui): replace hardcoded tag options with dynamic API-driven selectors"
```

---

## Task 12: Buyer App Frontend Cleanup

**Files:**
- Delete: `src/constants/tags.ts`
- Modify: `src/mocks/companies.ts`

- [ ] **Step 1: Delete hardcoded tags constant**

Delete `src/constants/tags.ts`. This file's exports (`productTags`, `companyBadges`) are no longer used anywhere.

- [ ] **Step 2: Verify no imports remain**

Run: `cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台 && grep -r "constants/tags" src/ app/ --include="*.ts" --include="*.tsx"`
Expected: No matches (or only the file being deleted).

- [ ] **Step 3: Update mock data format**

In `src/mocks/companies.ts`, the mock data already has `badges`, `certifications`, `industryTags` as string arrays, which matches the API response format. No structural changes needed — the mock data format is compatible with the new backend.

- [ ] **Step 4: Commit**

```bash
git rm src/constants/tags.ts
git add src/mocks/companies.ts
git commit -m "chore(app): remove hardcoded tag constants, mock data unchanged"
```

---

## Task 13: End-to-End Verification

- [ ] **Step 1: Run Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: "The Prisma schema is valid."

- [ ] **Step 2: Run backend TypeScript compile**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run admin frontend TypeScript compile**

Run: `cd admin && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 4: Run seller frontend TypeScript compile**

Run: `cd seller && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 5: Start backend and test API**

Run: `cd backend && npm run start:dev`

Test endpoints:
```bash
# 公开接口 - 获取标签类别
curl http://localhost:3000/api/v1/companies/tag-categories
curl http://localhost:3000/api/v1/companies/tag-categories?scope=COMPANY

# 管理端 - 标签类别 CRUD (需要 admin token)
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/v1/admin/tag-categories
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/v1/admin/tags?scope=COMPANY

# 管理端 - 企业标签
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/v1/admin/companies/$COMPANY_ID/tags
```

Expected: All endpoints return valid JSON with tag data.

- [ ] **Step 6: Commit final verification note**

No code changes needed — this is verification only.
