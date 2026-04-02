# 可配置标签系统设计方案

## 背景

当前企业和商品的标签（徽章、认证、行业标签、产品特色等）全部在前端硬编码（`src/constants/tags.ts`、`admin/src/types/index.ts`），管理员无法新增/删除/修改可选标签。企业标签存储在 `CompanyProfile.highlights` JSON 字段中，缺乏规范化结构，无法做跨企业统计和筛选。

## 目标

- 标签类别和标签全部在管理后台可配置（CRUD）
- 管理员和卖家可以给企业打标签
- 商品标签从自由输入改为从标签池选择
- 消除所有前端硬编码的标签常量
- 与现有 AI 语义搜索系统兼容

## 数据模型

### 新增 TagCategory 表

```prisma
model TagCategory {
  id          String   @id @default(cuid())
  name        String   // 显示名称："企业徽章"
  code        String   @unique // 程序标识：company_badge
  description String?
  scope       TagScope // COMPANY / PRODUCT
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tags        Tag[]
}

enum TagScope {
  COMPANY
  PRODUCT
}
```

`code` 字段用于前端按业务场景定位标签类别（如企业卡片展示 `company_badge` 类别的标签），不依赖 id。

### 改造 Tag 表

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

变更点：
- 删除 `type: TagType` 字段和 `TagType` 枚举
- 新增 `categoryId` 外键关联 TagCategory
- `name` 唯一约束改为 `@@unique([name, categoryId])`（同名标签可存在于不同类别）
- 新增 `sortOrder`、`isActive`、`createdAt`
- 新增 `companyTags` 反向关系

### 新增 CompanyTag 关联表

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

### Company 模型新增关系

```prisma
model Company {
  // ... 现有字段
  companyTags CompanyTag[]
}
```

### 预置种子数据

| code | name | scope | 初始标签 |
|------|------|-------|---------|
| `company_badge` | 企业徽章 | COMPANY | 优选基地、品质认证、产地直供、低碳种植 |
| `company_cert` | 企业认证 | COMPANY | 有机认证、绿色食品、地理标志、GAP认证、SC认证 |
| `industry` | 行业标签 | COMPANY | 水果、蔬菜、粮油、肉禽、水产、茶叶、蜂蜜、乳制品 |
| `product_feature` | 产品特色 | COMPANY | 有机、可溯源、冷链、认证 |
| `product_tag` | 商品标签 | PRODUCT | 可信溯源、检测报告、有机认证、地理标志、当季鲜采 |

## 后端 API

### 管理后台 — 标签类别 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/admin/tag-categories` | 列表，支持 `?scope=COMPANY` 筛选 |
| `POST` | `/admin/tag-categories` | 新增类别（name, code, scope, description, sortOrder） |
| `PATCH` | `/admin/tag-categories/:id` | 编辑类别 |
| `DELETE` | `/admin/tag-categories/:id` | 删除类别，需检查下属标签是否有关联数据 |

### 管理后台 — 标签 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/admin/tags` | 列表，支持 `?categoryId=xxx` 和 `?scope=COMPANY` 筛选 |
| `POST` | `/admin/tags` | 新增标签（name, categoryId, synonyms, sortOrder） |
| `PATCH` | `/admin/tags/:id` | 编辑标签 |
| `DELETE` | `/admin/tags/:id` | 删除标签，有关联时返回关联数量让管理员确认 |

### 管理后台 — 企业标签

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/admin/companies/:id/tags` | 获取企业标签，按类别分组返回 |
| `PUT` | `/admin/companies/:id/tags` | 批量设置企业标签，body: `{ tagIds: string[] }`，整体替换 |

### 公开 API — 标签选项查询

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/tag-categories` | 获取类别列表（含下属 active 标签），支持 `?scope=COMPANY/PRODUCT` 筛选 |

此接口供买家 App 搜索筛选、卖家后台选择标签、管理后台企业详情页使用。返回格式：

```json
[
  {
    "id": "...",
    "name": "企业徽章",
    "code": "company_badge",
    "scope": "COMPANY",
    "tags": [
      { "id": "...", "name": "优选基地" },
      { "id": "...", "name": "品质认证" }
    ]
  }
]
```

### 卖家后台 — 企业标签

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/seller/company/tags` | 获取自己企业的标签（按类别分组） |
| `PUT` | `/seller/company/tags` | 设置自己企业的标签，body: `{ tagIds: string[] }` |

### 商品标签改造

现有卖家创建/编辑商品 DTO 中 `tags: string[]`（自由文本）改为 `tagIds: string[]`（从标签池选择）。后端不再自动 upsert Tag，直接用 tagId 创建 ProductTag 关联。

## 管理后台前端

### 新页面：标签管理（`admin/src/pages/tags/index.tsx`）

左右布局：
- **左侧**：TagCategory 列表（ProTable），支持新增/编辑/删除类别，显示 scope 徽标
- **右侧**：选中类别下的 Tag 列表（ProTable），支持新增/编辑/停用/删除标签

菜单入口：侧边栏「系统设置」分组下新增「标签管理」。

### 修改：企业详情页（`admin/src/pages/companies/detail.tsx`）

- 移除硬编码的 `CERTIFICATION_OPTIONS`、`PRODUCT_FEATURE_OPTIONS`、`INDUSTRY_TAG_OPTIONS`
- 从 `GET /tag-categories?scope=COMPANY` 动态获取类别和选项
- 每个类别渲染一个 Select 多选框，选项为该类别下的 active 标签
- 保存时调用 `PUT /admin/companies/:id/tags`

### 修改：商品编辑页（`admin/src/pages/products/edit.tsx`）

- 商品标签 Select 选项从 `GET /tag-categories?scope=PRODUCT` 动态获取

## 卖家后台前端

### 修改：企业信息页（`seller/src/pages/company/index.tsx`）

- 移除 AI Search Profile 中硬编码选项
- 从公开 API 动态获取标签类别和选项
- 保存调用 `PUT /seller/company/tags`

### 修改：商品编辑页（`seller/src/pages/products/edit.tsx`）

- 标签输入从自由文本 Input 改为 Select 多选，选项从 API 获取

## 买家 App 前端

### 类型变更

`Company` 类型保持 `badges`、`certifications`、`industryTags`、`productFeatures` 字段不变（均为 `string[]`），数据来源从 highlights JSON 变为 CompanyTag 关联查询。

### 后端 mapToFrontend 改造

`company.service.ts` 的 `mapToFrontend()` 改为从 CompanyTag join Tag join TagCategory 查询，按 `category.code` 分组输出：

```typescript
// 查询企业标签（按类别分组）
const companyTags = await prisma.companyTag.findMany({
  where: { companyId: company.id },
  include: { tag: { include: { category: true } } },
});

const tagsByCode = groupBy(companyTags, ct => ct.tag.category.code);

return {
  // ... 现有字段
  badges: (tagsByCode['company_badge'] ?? []).map(ct => ct.tag.name),
  certifications: (tagsByCode['company_cert'] ?? []).map(ct => ct.tag.name),
  industryTags: (tagsByCode['industry'] ?? []).map(ct => ct.tag.name),
  productFeatures: (tagsByCode['product_feature'] ?? []).map(ct => ct.tag.name),
};
```

### 删除硬编码

- 删除 `src/constants/tags.ts`
- 更新 `src/mocks/companies.ts` mock 数据
- 删除 `admin/src/types/index.ts` 中的 `INDUSTRY_TAG_OPTIONS`、`PRODUCT_FEATURE_OPTIONS`、`CERTIFICATION_OPTIONS`

### 搜索兼容

企业搜索页（`app/company/search.tsx`）和 AI 语义搜索不需要改动，因为 API 返回的字段名和类型不变。

## 数据迁移策略

1. **Schema migration**：新建 TagCategory 表、改造 Tag 表、新建 CompanyTag 表
2. **种子数据**：写入预置类别和标签
3. **数据迁移脚本**（在 seed.ts 或独立脚本中）：
   - 遍历所有 `CompanyProfile.highlights`
   - 将 `badges` 数组中每个值匹配到 `company_badge` 类别的 Tag，创建 CompanyTag
   - 同理处理 `certifications` → `company_cert`、`industryTags` → `industry`、`productFeatures` → `product_feature`
   - 遇到 highlights 中存在但 Tag 表中不存在的值，自动创建新 Tag
4. **迁移现有 ProductTag**：将 `Tag.type = PRODUCT` 的记录关联到 `product_tag` 类别
5. **验证**：确认所有企业的标签数据完整迁移
6. **清理**：从 highlights JSON 中移除已迁移字段（`badges`、`certifications`、`industryTags`、`productFeatures`）

## 不变的部分

- AI 语义字段（`flavorTags`/`dietaryTags`/`seasonalMonths`/`usageScenarios`/`originRegion`）保持不变，仍存储在 Product 模型上，由 AI 自动填充
- `CompanyProfile.highlights` 保留非标签字段（`cover`、`mainBusiness`、`latestTestedAt`、`groupTargetSize`、`companyType`、`productKeywords`）
- 买家 App 的企业卡片、企业详情页、搜索页的 UI 逻辑不变（字段名和类型不变）
