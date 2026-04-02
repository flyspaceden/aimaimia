# 企业 AI 搜索资料 Card 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在卖家端企业设置页新增"企业 AI 搜索资料 Card"，将搜索关键信息从自由文本收敛为结构化字段，存入 `CompanyProfile.highlights` JSON。

**Architecture:** 新增 `GET/PUT /seller/company/ai-search-profile` 端点，在 Serializable 事务中原子读取现有 highlights、合并 AI 搜索字段、计算派生字段（mainBusiness/badges）、写回。现有 `PUT /seller/company/highlights` 改为 merge 模式（保护 AI 字段不被企业亮点 Card 覆盖）。前端新增一个结构化表单 Card。

**Tech Stack:** NestJS + Prisma (backend), React 19 + Ant Design 5 + React Query (seller frontend)

**Spec:** `docs/superpowers/specs/2026-03-12-ai-search-profile-card-design.md`

---

## Chunk 1: 后端实现

### Task 1: 后端 DTO — 新增 UpdateAiSearchProfileDto

**Files:**
- Modify: `backend/src/modules/seller/company/seller-company.dto.ts`

- [ ] **Step 1: 在 seller-company.dto.ts 末尾新增 DTO 和枚举常量**

在文件末尾（`AddDocumentDto` 之后）追加：

```typescript
import { IsArray, ArrayMinSize, IsIn } from 'class-validator';

// ============ AI 搜索资料枚举常量 ============

export const COMPANY_TYPES = ['farm', 'company', 'cooperative', 'base', 'factory', 'store'] as const;
export const INDUSTRY_TAGS = ['水果', '蔬菜', '粮油', '肉禽', '水产', '茶叶', '蜂蜜', '乳制品', '其他'] as const;
export const PRODUCT_FEATURES = ['有机', '可溯源', '冷链', '认证'] as const;
export const SUPPLY_MODES = ['批发', '零售', '直供', '同城配送', '可预约考察'] as const;
export const CERTIFICATIONS = ['有机认证', '绿色食品', '地理标志'] as const;

/** AI 搜索字段键名（用于 highlights merge 保护） */
export const AI_SEARCH_KEYS = [
  'companyType', 'industryTags', 'productKeywords', 'serviceAreas',
  'productFeatures', 'supplyModes', 'certifications', 'mainBusiness', 'badges',
] as const;

/** 更新 AI 搜索资料 DTO */
export class UpdateAiSearchProfileDto {
  @IsIn(COMPANY_TYPES)
  companyType: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(INDUSTRY_TAGS, { each: true })
  industryTags: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productKeywords?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  serviceAreas: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(PRODUCT_FEATURES, { each: true })
  productFeatures: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(SUPPLY_MODES, { each: true })
  supplyModes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(CERTIFICATIONS, { each: true })
  certifications?: string[];
}
```

注意：`IsArray`, `ArrayMinSize`, `IsIn` 需要添加到文件顶部的 `class-validator` import 中。`@IsString` 和 `@IsOptional` 已在现有 import 中。

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无与 seller-company.dto.ts 相关的错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/seller/company/seller-company.dto.ts
git commit -m "feat(seller): add UpdateAiSearchProfileDto with enum constants"
```

---

### Task 2: 后端 Service — AI 搜索资料读写 + highlights merge 改造

**Files:**
- Modify: `backend/src/modules/seller/company/seller-company.service.ts`

- [ ] **Step 1: 在 service 中导入新 DTO 常量**

在文件顶部 import 区域添加：

```typescript
import { UpdateCompanyDto, InviteStaffDto, UpdateStaffDto, AI_SEARCH_KEYS } from './seller-company.dto';
```

- [ ] **Step 2: 添加 `getAiSearchProfile` 方法**

在 `updateHighlights` 方法之后添加：

```typescript
/** 获取 AI 搜索资料（从 highlights 提取结构化字段） */
async getAiSearchProfile(companyId: string) {
  const profile = await this.prisma.companyProfile.findUnique({
    where: { companyId },
    select: { highlights: true },
  });
  const h = (profile?.highlights as Record<string, any>) ?? {};
  return {
    companyType: h.companyType ?? null,
    industryTags: h.industryTags ?? [],
    productKeywords: h.productKeywords ?? [],
    serviceAreas: h.serviceAreas ?? [],
    productFeatures: h.productFeatures ?? [],
    supplyModes: h.supplyModes ?? [],
    certifications: h.certifications ?? [],
  };
}
```

- [ ] **Step 3: 添加 `updateAiSearchProfile` 方法（Serializable 事务 + 派生字段）**

在 `getAiSearchProfile` 之后添加：

```typescript
/** 更新 AI 搜索资料（原子合并到 highlights + 计算派生字段） */
async updateAiSearchProfile(companyId: string, dto: {
  companyType: string;
  industryTags: string[];
  productKeywords?: string[];
  serviceAreas: string[];
  productFeatures: string[];
  supplyModes?: string[];
  certifications?: string[];
}) {
  // 清洗 serviceAreas：trim + 去重 + 过滤空串
  const cleanedAreas = [...new Set(
    dto.serviceAreas.map((s) => s.trim()).filter(Boolean),
  )];

  const aiFields = {
    companyType: dto.companyType,
    industryTags: dto.industryTags,
    productKeywords: dto.productKeywords ?? [],
    serviceAreas: cleanedAreas,
    productFeatures: dto.productFeatures,
    supplyModes: dto.supplyModes ?? [],
    certifications: dto.certifications ?? [],
  };

  // 计算派生字段
  const mainBusiness = [
    ...aiFields.industryTags,
    ...aiFields.productKeywords,
  ].join('、');

  const badges = [
    ...aiFields.productFeatures,
    ...aiFields.certifications,
    ...aiFields.supplyModes.slice(0, 2),
    ...aiFields.serviceAreas.slice(0, 2),
  ].slice(0, 8);

  return this.prisma.$transaction(async (tx) => {
    const profile = await tx.companyProfile.findUnique({
      where: { companyId },
      select: { highlights: true },
    });
    const existing = (profile?.highlights as Record<string, any>) ?? {};
    const merged = { ...existing, ...aiFields, mainBusiness, badges };

    await tx.companyProfile.upsert({
      where: { companyId },
      create: { companyId, highlights: merged },
      update: { highlights: merged },
    });

    return aiFields;
  }, { isolationLevel: 'Serializable' });
}
```

- [ ] **Step 4: 改造现有 `updateHighlights` 为 merge 模式（保护 AI 字段）**

替换当前 `updateHighlights` 方法（第 59-67 行）：

```typescript
/** 更新企业亮点（merge 模式，保护 AI 搜索字段不被覆盖） */
async updateHighlights(companyId: string, highlights: any) {
  return this.prisma.$transaction(async (tx) => {
    const profile = await tx.companyProfile.findUnique({
      where: { companyId },
      select: { highlights: true },
    });
    const existing = (profile?.highlights as Record<string, any>) ?? {};
    // 从传入数据中移除 AI 搜索字段，防止企业亮点 Card 覆盖
    const safeHighlights = Object.fromEntries(
      Object.entries(highlights as Record<string, any>).filter(
        ([k]) => !(AI_SEARCH_KEYS as readonly string[]).includes(k),
      ),
    );
    const merged = { ...existing, ...safeHighlights };
    return tx.companyProfile.upsert({
      where: { companyId },
      create: { companyId, highlights: merged },
      update: { highlights: merged },
    });
  }, { isolationLevel: 'Serializable' });
}
```

- [ ] **Step 5: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无与 seller-company.service.ts 相关的错误

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/seller/company/seller-company.service.ts
git commit -m "feat(seller): add AI search profile CRUD + highlights merge mode"
```

---

### Task 3: 后端 Controller — 新增 GET/PUT 端点

**Files:**
- Modify: `backend/src/modules/seller/company/seller-company.controller.ts`

- [ ] **Step 1: 更新 import 添加新 DTO**

替换 import 行（第 13 行）：

```typescript
import { UpdateCompanyDto, InviteStaffDto, UpdateStaffDto, UpdateHighlightsDto, AddDocumentDto, UpdateAiSearchProfileDto } from './seller-company.dto';
```

- [ ] **Step 2: 在 highlights 端点和资质文件端点之间新增 AI 搜索资料端点**

在 `updateHighlights` 方法（第 56 行）之后、`// ===================== 资质文件 =====================` 注释之前插入：

```typescript
  // ===================== AI 搜索资料 =====================

  /** 获取 AI 搜索资料 */
  @SellerRoles('OWNER', 'MANAGER')
  @Get('ai-search-profile')
  getAiSearchProfile(@CurrentSeller('companyId') companyId: string) {
    return this.companyService.getAiSearchProfile(companyId);
  }

  /** 更新 AI 搜索资料 */
  @SellerAudit({ action: 'UPDATE_AI_SEARCH_PROFILE', module: 'company', targetType: 'Company' })
  @SellerRoles('OWNER', 'MANAGER')
  @Put('ai-search-profile')
  updateAiSearchProfile(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: UpdateAiSearchProfileDto,
  ) {
    return this.companyService.updateAiSearchProfile(companyId, dto);
  }
```

**重要**：NestJS 路由匹配是按注册顺序的。`ai-search-profile` 是静态路径，不会与其他端点冲突。但必须放在可能存在的参数路由（如 `:id`）之前。当前 controller 没有 `:id` 参数路由在 company 下，所以位置安全。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seller/company/seller-company.controller.ts
git commit -m "feat(seller): add GET/PUT ai-search-profile endpoints"
```

---

## Chunk 2: 前端实现

### Task 4: 前端类型 + API 层

**Files:**
- Modify: `seller/src/types/index.ts`
- Modify: `seller/src/api/company.ts`

- [ ] **Step 1: 在 types/index.ts 的 Company 接口之后新增 AI 搜索资料类型和枚举常量**

在 `CompanyDocument` 接口之前（第 233 行之前）插入：

```typescript
// ============================================================
// AI 搜索资料
// ============================================================

export interface AiSearchProfile {
  companyType: string | null;
  industryTags: string[];
  productKeywords: string[];
  serviceAreas: string[];
  productFeatures: string[];
  supplyModes: string[];
  certifications: string[];
}

/** AI 搜索资料 — 枚举常量（与后端 seller-company.dto.ts 保持一致） */
export const COMPANY_TYPE_OPTIONS = [
  { value: 'farm', label: '农场' },
  { value: 'company', label: '公司' },
  { value: 'cooperative', label: '合作社' },
  { value: 'base', label: '基地' },
  { value: 'factory', label: '工厂' },
  { value: 'store', label: '店铺' },
];

export const INDUSTRY_TAG_OPTIONS = [
  '水果', '蔬菜', '粮油', '肉禽', '水产', '茶叶', '蜂蜜', '乳制品', '其他',
].map((v) => ({ value: v, label: v }));

export const PRODUCT_FEATURE_OPTIONS = [
  '有机', '可溯源', '冷链', '认证',
].map((v) => ({ value: v, label: v }));

export const SUPPLY_MODE_OPTIONS = [
  '批发', '零售', '直供', '同城配送', '可预约考察',
].map((v) => ({ value: v, label: v }));

export const CERTIFICATION_OPTIONS = [
  '有机认证', '绿色食品', '地理标志',
].map((v) => ({ value: v, label: v }));
```

- [ ] **Step 2: 在 api/company.ts 新增两个 API 方法**

在 `updateHighlights` 之后添加：

```typescript
import type { Company, CompanyDocument, CompanyStaff, AiSearchProfile } from '@/types';

// AI 搜索资料
export const getAiSearchProfile = (): Promise<AiSearchProfile> =>
  client.get('/seller/company/ai-search-profile');

export const updateAiSearchProfile = (data: Omit<AiSearchProfile, 'companyType'> & { companyType: string }): Promise<AiSearchProfile> =>
  client.put('/seller/company/ai-search-profile', data);
```

同时更新第 2 行 import 添加 `AiSearchProfile`。

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd seller && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add seller/src/types/index.ts seller/src/api/company.ts
git commit -m "feat(seller): add AiSearchProfile type, enums, and API methods"
```

---

### Task 5: 前端 UI — 新增 AI 搜索资料 Card

**Files:**
- Modify: `seller/src/pages/company/index.tsx`

- [ ] **Step 1: 添加 import**

更新文件顶部 import：

```typescript
// 在第 6 行的 api import 中添加
import { getCompany, updateCompany, updateHighlights, getDocuments, addDocument, getAiSearchProfile, updateAiSearchProfile } from '@/api/company';
// 新增 types import
import {
  COMPANY_TYPE_OPTIONS, INDUSTRY_TAG_OPTIONS, PRODUCT_FEATURE_OPTIONS,
  SUPPLY_MODE_OPTIONS, CERTIFICATION_OPTIONS,
} from '@/types';
import type { AiSearchProfile } from '@/types';
```

- [ ] **Step 2: 添加 AI 搜索资料的 query 和 handler**

在 `CompanySettingsPage` 函数内部，`const { data: documents }` query 之后添加：

```typescript
const { data: aiProfile } = useQuery({
  queryKey: ['seller-ai-search-profile'],
  queryFn: getAiSearchProfile,
  enabled: canEdit,
});

const [aiSaving, setAiSaving] = useState(false);

const handleUpdateAiSearchProfile = async (values: Record<string, any>) => {
  setAiSaving(true);
  try {
    await updateAiSearchProfile({
      companyType: values.companyType,
      industryTags: values.industryTags || [],
      productKeywords: values.productKeywords || [],
      serviceAreas: values.serviceAreas || [],
      productFeatures: values.productFeatures || [],
      supplyModes: values.supplyModes || [],
      certifications: values.certifications || [],
    });
    message.success('AI 搜索资料已更新');
    queryClient.invalidateQueries({ queryKey: ['seller-ai-search-profile'] });
    queryClient.invalidateQueries({ queryKey: ['seller-company'] });
  } catch (err) {
    message.error(err instanceof Error ? err.message : '更新失败');
  } finally {
    setAiSaving(false);
  }
};
```

- [ ] **Step 3: 添加 AI 搜索资料 Card JSX**

在企业亮点 Card（`</Card>` 后，第 198 行之后）和资质文件 Card（第 201 行 `<Card title="资质文件"` 之前）之间插入：

```tsx
{/* AI 搜索资料 - 结构化搜索字段 */}
{canEdit && (
  <Card title="企业 AI 搜索资料" style={{ marginBottom: 16 }}>
    <div style={{ marginBottom: 12, color: '#666' }}>
      这些信息帮助买家通过搜索和 AI 更精准地找到您的企业，请认真填写
    </div>
    <ProForm
      onFinish={handleUpdateAiSearchProfile}
      initialValues={aiProfile || {}}
      loading={aiSaving}
      layout="vertical"
      style={{ maxWidth: 600 }}
      key={JSON.stringify(aiProfile)}
      submitter={{ searchConfig: { submitText: '保存搜索资料' } }}
    >
      <ProForm.Item
        name="companyType"
        label="企业类型"
        rules={[{ required: true, message: '请选择企业类型' }]}
      >
        <Select
          options={COMPANY_TYPE_OPTIONS}
          placeholder="请选择企业类型"
        />
      </ProForm.Item>

      <ProForm.Item
        name="industryTags"
        label="主营品类"
        rules={[{ required: true, message: '请选择至少一个主营品类' }]}
      >
        <Select
          mode="multiple"
          options={INDUSTRY_TAG_OPTIONS}
          placeholder="请选择主营品类"
          showSearch
        />
      </ProForm.Item>

      <ProForm.Item
        name="productKeywords"
        label="主营产品关键词"
        tooltip="输入后回车添加，如"蓝莓""有机五常大米""
      >
        <Select
          mode="tags"
          placeholder="输入关键词后回车添加"
          tokenSeparators={[',', '，']}
        />
      </ProForm.Item>

      <ProForm.Item
        name="serviceAreas"
        label="服务地区"
        rules={[{ required: true, message: '请输入至少一个服务地区' }]}
        tooltip="输入后回车添加，如"湖北""武汉""武昌区""
      >
        <Select
          mode="tags"
          placeholder="输入地区后回车添加"
          tokenSeparators={[',', '，']}
        />
      </ProForm.Item>

      <ProForm.Item
        name="productFeatures"
        label="产品特征"
        rules={[{ required: true, message: '请选择至少一个产品特征' }]}
      >
        <Select
          mode="multiple"
          options={PRODUCT_FEATURE_OPTIONS}
          placeholder="请选择产品特征"
        />
      </ProForm.Item>

      <ProForm.Item
        name="supplyModes"
        label="供给方式"
      >
        <Select
          mode="multiple"
          options={SUPPLY_MODE_OPTIONS}
          placeholder="请选择供给方式"
        />
      </ProForm.Item>

      <ProForm.Item
        name="certifications"
        label="认证资质"
      >
        <Select
          mode="multiple"
          options={CERTIFICATION_OPTIONS}
          placeholder="请选择认证资质"
        />
      </ProForm.Item>
    </ProForm>
  </Card>
)}
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `cd seller && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add seller/src/pages/company/index.tsx
git commit -m "feat(seller): add AI search profile Card to company settings"
```

---

## Chunk 3: 验证与收尾

### Task 6: 全栈编译验证

**Files:** 无新改动，验证已有改动

- [ ] **Step 1: 后端 Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: 成功（本次无 Schema 变更，只是确认无回归）

- [ ] **Step 2: 后端 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit --pretty`
Expected: 0 errors

- [ ] **Step 3: 前端 TypeScript 编译**

Run: `cd seller && npx tsc --noEmit --pretty`
Expected: 0 errors

- [ ] **Step 4: 前端构建测试**

Run: `cd seller && npx vite build 2>&1 | tail -5`
Expected: 构建成功

---

### Task 7: 文档同步

**Files:**
- Modify: `seller.md` — 更新 Phase 状态标记
- Modify: `plan.md` — 如有对应条目则更新

- [ ] **Step 1: 更新 seller.md 中 AI 搜索资料相关的进度标记**

在 seller.md 的修改计划 Section（约第 963 行），将 P0 和 P1 标记为完成：

```
**P0：卖家端表单收口** — ✅ 已完成
**P1：后端 DTO 与存储收口** — ✅ 已完成
```

- [ ] **Step 2: Commit**

```bash
git add seller.md
git commit -m "docs: mark AI search profile P0/P1 as completed"
```
