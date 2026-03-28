# 发现页企业筛选栏动态化 + 管理后台商品标签编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the discovery page company filter bar configurable from admin backend, and add product tag editing to admin product edit page.

**Architecture:** Use existing Config system (`ruleConfig` table) to store `DISCOVERY_COMPANY_FILTERS` as a JSON array of `{tagId, icon}` objects. Add a public endpoint to serve resolved filters (with tag names). Admin gets a new drag-sortable config page. Admin product edit page gets a `tagIds` multi-select matching seller's implementation.

**Tech Stack:** NestJS (backend), React + Ant Design + @dnd-kit (admin), React Native + React Query (app)

**Spec:** `docs/superpowers/specs/2026-03-28-discovery-filter-design.md`

---

### Task 1: Backend — Register config validation + seed default filters

**Files:**
- Modify: `backend/src/modules/admin/config/config-validation.ts`
- Modify: `backend/prisma/seed.ts`

- [ ] **Step 1: Add validation rule for DISCOVERY_COMPANY_FILTERS**

In `backend/src/modules/admin/config/config-validation.ts`, add after the `NORMAL_FREE_SHIPPING_THRESHOLD` entry (before the `@deprecated` section at line 232):

```ts
  // =================== 发现页配置 ===================
  DISCOVERY_COMPANY_FILTERS: {
    type: 'json',
    description: '发现页企业筛选栏配置（有序标签数组）',
    custom: (value: any) => {
      if (!Array.isArray(value)) return 'DISCOVERY_COMPANY_FILTERS 的值必须是数组';
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (!item || typeof item !== 'object') return `[${i}] 必须是对象`;
        if (!item.tagId || typeof item.tagId !== 'string') return `[${i}].tagId 必须是非空字符串`;
        if (!item.icon || typeof item.icon !== 'string') return `[${i}].icon 必须是非空字符串`;
      }
      return null;
    },
  },
```

- [ ] **Step 2: Seed default DISCOVERY_COMPANY_FILTERS config**

In `backend/prisma/seed.ts`, after all tag seeding is complete (after the CompanyTag/ProductTag associations), add a section to seed the config. The seed needs to look up actual tag IDs from the seeded data:

```ts
  // =================== 发现页企业筛选配置 ===================
  // 从已有种子标签中构建默认筛选配置
  const discoveryTagNames = [
    { name: '有机认证', categoryCode: 'company_cert', icon: '🌿' },
    { name: '水果', categoryCode: 'industry', icon: '🍎' },
    { name: '茶叶', categoryCode: 'industry', icon: '🍵' },
  ];

  const discoveryFilters: Array<{ tagId: string; icon: string }> = [];
  for (const entry of discoveryTagNames) {
    const tag = await prisma.tag.findFirst({
      where: {
        name: entry.name,
        category: { code: entry.categoryCode },
      },
    });
    if (tag) {
      discoveryFilters.push({ tagId: tag.id, icon: entry.icon });
    }
  }

  await prisma.ruleConfig.upsert({
    where: { key: 'DISCOVERY_COMPANY_FILTERS' },
    update: {},
    create: {
      key: 'DISCOVERY_COMPANY_FILTERS',
      value: discoveryFilters as any,
      description: '发现页企业筛选栏配置',
    },
  });
  console.log(`  ✅ 发现页筛选配置已设置：${discoveryFilters.length} 项`);
```

- [ ] **Step 3: Verify Prisma validate passes**

Run: `cd backend && npx prisma validate`
Expected: No errors (schema unchanged)

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/admin/config/config-validation.ts backend/prisma/seed.ts
git commit -m "feat(backend): add DISCOVERY_COMPANY_FILTERS config validation and seed data"
```

---

### Task 2: Backend — Public discovery-filters endpoint + tagId filtering

**Files:**
- Modify: `backend/src/modules/company/company.controller.ts`
- Modify: `backend/src/modules/company/company.service.ts`

- [ ] **Step 1: Add getDiscoveryFilters method to CompanyService**

In `backend/src/modules/company/company.service.ts`, add a new method after `listTagCategories()` (after line 72):

```ts
  /** 获取发现页企业筛选配置（公开） */
  async getDiscoveryFilters() {
    const config = await this.prisma.ruleConfig.findUnique({
      where: { key: 'DISCOVERY_COMPANY_FILTERS' },
    });
    if (!config || !Array.isArray(config.value)) return [];

    const entries = config.value as Array<{ tagId: string; icon: string }>;
    if (entries.length === 0) return [];

    const tagIds = entries.map((e) => e.tagId);
    const tags = await this.prisma.tag.findMany({
      where: { id: { in: tagIds }, isActive: true },
      select: { id: true, name: true },
    });
    const tagMap = new Map(tags.map((t) => [t.id, t.name]));

    // 保持配置的顺序，过滤已删除/停用的标签
    return entries
      .filter((e) => tagMap.has(e.tagId))
      .map((e) => ({
        tagId: e.tagId,
        label: tagMap.get(e.tagId)!,
        icon: e.icon,
      }));
  }
```

- [ ] **Step 2: Add tagId filter to list() method**

Modify the `list()` method in `CompanyService` to accept an optional `tagId` parameter. Change the method signature and add filtering:

```ts
  /** 企业列表（3 分钟内存缓存，含每家企业 top 8 商品） */
  async list(tagId?: string) {
    const cacheKey = tagId ? `companies:tag:${tagId}` : 'companies:all';
    const cached = this.listCache.get(cacheKey);
    if (cached) return cached;

    const where: any = {};
    if (tagId) {
      where.companyTags = { some: { tagId } };
    }

    const companies = await this.prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        profile: true,
        companyTags: {
          include: { tag: { include: { category: { select: { code: true } } } } },
        },
        products: {
          where: { status: 'ACTIVE', auditStatus: 'APPROVED' },
          take: 8,
          orderBy: { createdAt: 'desc' },
          include: {
            media: {
              where: { type: 'IMAGE' },
              take: 1,
              orderBy: { sortOrder: 'asc' },
            },
            skus: {
              where: { status: 'ACTIVE' },
              take: 1,
              orderBy: { price: 'asc' },
            },
          },
        },
      },
    });

    const result = companies.map((c) => ({
      ...this.mapToFrontend(c),
      topProducts: c.products.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.skus[0]?.price ?? p.basePrice ?? 0,
        image: p.media[0]?.url ?? '',
        defaultSkuId: p.skus[0]?.id ?? null,
      })),
    }));
    this.listCache.set(cacheKey, result);
    return result;
  }
```

- [ ] **Step 3: Add controller endpoints**

In `backend/src/modules/company/company.controller.ts`, add the discovery-filters endpoint and tagId query param to list:

```ts
  @Public()
  @Get()
  list(@Query('tagId') tagId?: string) {
    return this.companyService.list(tagId || undefined);
  }

  /** 公开接口：获取发现页企业筛选配置 */
  @Public()
  @Get('discovery-filters')
  getDiscoveryFilters() {
    return this.companyService.getDiscoveryFilters();
  }
```

**Important:** The `discovery-filters` route must be placed BEFORE the `:id` route to avoid being captured by the `:id` parameter.

The final route order should be:
1. `GET /companies` (list)
2. `GET /companies/tag-categories`
3. `GET /companies/discovery-filters`
4. `GET /companies/:id`
5. `GET /companies/:id/products`
6. `GET /companies/:id/events`

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/company/company.controller.ts backend/src/modules/company/company.service.ts
git commit -m "feat(backend): add public discovery-filters endpoint and tagId filtering for company list"
```

---

### Task 3: Backend — Admin product update supports tagIds

**Files:**
- Modify: `backend/src/modules/admin/products/dto/update-product.dto.ts`
- Modify: `backend/src/modules/admin/products/admin-products.service.ts`

- [ ] **Step 1: Add tagIds to AdminUpdateProductDto**

In `backend/src/modules/admin/products/dto/update-product.dto.ts`, add after the `originRegion` field (line 72):

```ts
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];
```

- [ ] **Step 2: Add tagIds handling to AdminProductsService.update()**

In `backend/src/modules/admin/products/admin-products.service.ts`, modify the `update()` method. After `const product = await this.prisma.product.findUnique(...)` check (line 91), extract `tagIds` from dto before passing to Prisma update, then handle ProductTag associations:

Replace the current update method (lines 88-150) with:

```ts
  /** 更新商品 */
  async update(id: string, dto: AdminUpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('商品不存在');

    // 提取 tagIds，不传给 Prisma product.update
    const { tagIds, ...productData } = dto;

    const updated = await this.prisma.product.update({
      where: { id },
      data: productData,
    });

    // 更新商品标签关联
    if (tagIds !== undefined) {
      await this.prisma.productTag.deleteMany({ where: { productId: id } });
      if (tagIds.length > 0) {
        const tags = await this.prisma.tag.findMany({
          where: { id: { in: tagIds }, isActive: true },
          include: { category: { select: { scope: true } } },
        });
        const validTagIds = tags
          .filter((t) => t.category.scope === 'PRODUCT')
          .map((t) => t.id);
        if (validTagIds.length > 0) {
          await this.prisma.productTag.createMany({
            data: validTagIds.map((tagId) => ({ productId: id, tagId })),
            skipDuplicates: true,
          });
        }
      }
    }

    // 记录运营（ops）提供的语义字段来源，写入 attributes.semanticMeta
    const now = new Date().toISOString();
    type OpsFieldMeta = { source: 'ops'; updatedAt: string };
    const existingAttrs = (updated.attributes as Record<string, any>) || {};
    const existingMeta = (existingAttrs.semanticMeta as Record<string, OpsFieldMeta>) || {};

    if (dto.flavorTags !== undefined) {
      if (dto.flavorTags.length > 0) {
        existingMeta.flavorTags = { source: 'ops', updatedAt: now };
      } else {
        delete existingMeta.flavorTags;
      }
    }
    if (dto.seasonalMonths !== undefined) {
      if (dto.seasonalMonths.length > 0) {
        existingMeta.seasonalMonths = { source: 'ops', updatedAt: now };
      } else {
        delete existingMeta.seasonalMonths;
      }
    }
    if (dto.usageScenarios !== undefined) {
      if (dto.usageScenarios.length > 0) {
        existingMeta.usageScenarios = { source: 'ops', updatedAt: now };
      } else {
        delete existingMeta.usageScenarios;
      }
    }
    if (dto.dietaryTags !== undefined) {
      if (dto.dietaryTags.length > 0) {
        existingMeta.dietaryTags = { source: 'ops', updatedAt: now };
      } else {
        delete existingMeta.dietaryTags;
      }
    }
    if (dto.originRegion !== undefined) {
      if (dto.originRegion) {
        existingMeta.originRegion = { source: 'ops', updatedAt: now };
      } else {
        delete existingMeta.originRegion;
      }
    }

    await this.prisma.product.update({
      where: { id },
      data: { attributes: { ...existingAttrs, semanticMeta: existingMeta } },
    });

    return updated;
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/admin/products/dto/update-product.dto.ts backend/src/modules/admin/products/admin-products.service.ts
git commit -m "feat(backend): add tagIds support to admin product update endpoint"
```

---

### Task 4: Admin frontend — Product edit page tagIds selector

**Files:**
- Modify: `admin/src/api/products.ts`
- Modify: `admin/src/pages/products/edit.tsx`

- [ ] **Step 1: Add tagIds to updateProduct API type**

In `admin/src/api/products.ts`, add `tagIds` to the `updateProduct` function's data parameter type (line 29-43):

```ts
export const updateProduct = (id: string, data: {
  title?: string;
  subtitle?: string;
  description?: string;
  basePrice?: number;
  categoryId?: string;
  origin?: any;
  aiKeywords?: string[];
  attributes?: Record<string, any>;
  flavorTags?: string[];
  seasonalMonths?: number[];
  usageScenarios?: string[];
  dietaryTags?: string[];
  originRegion?: string;
  tagIds?: string[];
}): Promise<Product> =>
  client.put(`/admin/products/${id}`, data);
```

- [ ] **Step 2: Add tag query and form field to ProductEditPage**

In `admin/src/pages/products/edit.tsx`:

Add import at the top (line 24), add `getPublicTagCategories` from tags API:

```ts
import { getPublicTagCategories } from '@/api/tags';
```

After the existing `categories` query (around line 53), add tag categories query:

```ts
  const { data: productTagCategories = [] } = useQuery({
    queryKey: ['tag-categories-product'],
    queryFn: () => getPublicTagCategories('PRODUCT'),
  });
  const productTagOptions = productTagCategories
    .flatMap((cat: any) => (cat.tags || []).map((t: any) => ({ value: t.id, label: t.name })));
```

- [ ] **Step 3: Initialize tagIds when product loads**

Find the section where the form is initialized with `initialValues` or `form.setFieldsValue`. The form's `initialValues` prop is used. Since the product data includes `tags` as a relational array, we need to add form initialization. After the `attrPairs` computation (around line 118), add:

```ts
  const initialTagIds = product.tags?.map((t: any) => t.tag?.id || t.tagId) || [];
```

Then in the `<Form>` component's `initialValues` prop, add `tagIds: initialTagIds`.

- [ ] **Step 4: Add tagIds Form.Item in the form**

After the `aiKeywords` Form.Item (line 314), add:

```tsx
          <Form.Item label="商品标签" name="tagIds">
            <Select
              mode="multiple"
              placeholder="请选择商品标签"
              options={productTagOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
```

- [ ] **Step 5: Include tagIds in save handler**

In `handleSave` (line 70-95), after `data.attributes` is set and before `await updateProduct(...)`, add:

```ts
      // 保持 tagIds 原值（Select mode=multiple 直接返回 string[]）
      // tagIds 已经在 rest 中通过展开传入 data
```

Verify that `tagIds` is NOT destructured out of `values` alongside `originText` and `attributes`. The current destructuring is:
```ts
const { originText: ot, attributes: attrs, ...rest } = values;
```

Since `tagIds` is in `...rest`, it will be included in `data` automatically. No additional handling needed.

- [ ] **Step 6: Verify admin frontend compiles**

Run: `cd admin && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add admin/src/api/products.ts admin/src/pages/products/edit.tsx
git commit -m "feat(admin): add product tag selector to product edit page"
```

---

### Task 5: Admin frontend — Discovery filter config page

**Files:**
- Create: `admin/src/pages/config/discovery-filters.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/layouts/AdminLayout.tsx`

- [ ] **Step 1: Install @dnd-kit dependencies**

Run: `cd admin && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

- [ ] **Step 2: Create discovery filter config page**

Create `admin/src/pages/config/discovery-filters.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Card, Button, Input, message, Tag, Typography, Space, Empty, Spin } from 'antd';
import { DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getConfig, updateConfig } from '@/api/config';
import { getTags } from '@/api/tags';

const { Title, Text } = Typography;

type FilterItem = { tagId: string; icon: string };
type TagOption = { id: string; name: string; categoryName: string };

/** 可拖拽的筛选项行 */
function SortableFilterItem({
  item,
  tagName,
  onIconChange,
  onRemove,
}: {
  item: FilterItem;
  tagName: string;
  onIconChange: (tagId: string, icon: string) => void;
  onRemove: (tagId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.tagId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        marginBottom: 4,
        background: '#fafafa',
        borderRadius: 6,
        border: '1px solid #f0f0f0',
      }}
    >
      <HolderOutlined
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', color: '#999', fontSize: 16 }}
      />
      <Input
        value={item.icon}
        onChange={(e) => onIconChange(item.tagId, e.target.value)}
        style={{ width: 50, textAlign: 'center', fontSize: 18 }}
        maxLength={2}
      />
      <Text style={{ flex: 1 }}>{tagName}</Text>
      <Button
        type="text"
        danger
        size="small"
        icon={<DeleteOutlined />}
        onClick={() => onRemove(item.tagId)}
      />
    </div>
  );
}

export default function DiscoveryFiltersPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FilterItem[]>([]);
  const [dirty, setDirty] = useState(false);

  // 加载当前配置
  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['admin', 'config', 'DISCOVERY_COMPANY_FILTERS'],
    queryFn: () => getConfig('DISCOVERY_COMPANY_FILTERS').catch(() => null),
  });

  // 加载所有 COMPANY scope 标签
  const { data: allTags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['admin', 'tags', 'company-scope'],
    queryFn: async () => {
      const tags = await getTags({ scope: 'COMPANY' });
      return (tags as any[]).map((t: any) => ({
        id: t.id,
        name: t.name,
        categoryName: t.category?.name || '',
      })) as TagOption[];
    },
  });

  // 标签 ID → 名称映射
  const tagNameMap = new Map(allTags.map((t) => [t.id, t.name]));

  // 按类别分组（左侧标签池）
  const tagsByCategory = allTags.reduce<Record<string, TagOption[]>>((acc, t) => {
    const cat = t.categoryName || '未分类';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  // 已选 tagId 集合
  const selectedIds = new Set(filters.map((f) => f.tagId));

  // 初始化
  useEffect(() => {
    if (configData?.value && Array.isArray(configData.value)) {
      setFilters(configData.value as FilterItem[]);
    }
  }, [configData]);

  // 保存
  const saveMutation = useMutation({
    mutationFn: () =>
      updateConfig('DISCOVERY_COMPANY_FILTERS', {
        value: filters,
        changeNote: '更新发现页企业筛选配置',
      }),
    onSuccess: () => {
      message.success('保存成功');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
    onError: (err: any) => {
      message.error(err?.message || '保存失败');
    },
  });

  // 拖拽
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFilters((prev) => {
        const oldIndex = prev.findIndex((f) => f.tagId === active.id);
        const newIndex = prev.findIndex((f) => f.tagId === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
      setDirty(true);
    }
  };

  const handleAdd = (tag: TagOption) => {
    if (selectedIds.has(tag.id)) return;
    setFilters((prev) => [...prev, { tagId: tag.id, icon: '🏷️' }]);
    setDirty(true);
  };

  const handleRemove = (tagId: string) => {
    setFilters((prev) => prev.filter((f) => f.tagId !== tagId));
    setDirty(true);
  };

  const handleIconChange = (tagId: string, icon: string) => {
    setFilters((prev) => prev.map((f) => (f.tagId === tagId ? { ...f, icon } : f)));
    setDirty(true);
  };

  if (configLoading || tagsLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>发现页企业筛选配置</Title>
        <Button type="primary" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!dirty}>
          保存配置
        </Button>
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        配置买家 App 发现页「企业」标签页顶部的筛选标签。「全部」固定在最前，「附近」固定在最后，不可编辑。
      </Text>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* 左栏：标签池 */}
        <Card title="标签池" style={{ flex: 1 }} size="small">
          {Object.entries(tagsByCategory).map(([category, tags]) => (
            <div key={category} style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{category}</Text>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {tags.map((tag) => (
                  <Tag
                    key={tag.id}
                    style={{
                      cursor: selectedIds.has(tag.id) ? 'not-allowed' : 'pointer',
                      opacity: selectedIds.has(tag.id) ? 0.4 : 1,
                    }}
                    color={selectedIds.has(tag.id) ? 'default' : 'blue'}
                    onClick={() => handleAdd(tag)}
                  >
                    {tag.name}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
        </Card>

        {/* 右栏：已选筛选项 */}
        <Card title="已选筛选项（拖拽排序）" style={{ flex: 1 }} size="small">
          {/* 固定首项提示 */}
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 4,
              background: '#f6ffed',
              borderRadius: 6,
              border: '1px dashed #b7eb8f',
              color: '#999',
            }}
          >
            🏠 全部（固定首位）
          </div>

          {filters.length === 0 ? (
            <Empty description="点击左侧标签添加筛选项" style={{ margin: '24px 0' }} />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filters.map((f) => f.tagId)} strategy={verticalListSortingStrategy}>
                {filters.map((item) => (
                  <SortableFilterItem
                    key={item.tagId}
                    item={item}
                    tagName={tagNameMap.get(item.tagId) || item.tagId}
                    onIconChange={handleIconChange}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* 固定末项提示 */}
          <div
            style={{
              padding: '8px 12px',
              marginTop: 4,
              background: '#f6ffed',
              borderRadius: 6,
              border: '1px dashed #b7eb8f',
              color: '#999',
            }}
          >
            📍 附近（固定末位）
          </div>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add route to App.tsx**

In `admin/src/App.tsx`, add lazy import (after line 46):

```ts
const DiscoveryFiltersPage = lazy(() => import('@/pages/config/discovery-filters'));
```

Add route (after the `config` route at line 129):

```tsx
            <Route path="config/discovery-filters" element={<DiscoveryFiltersPage />} />
```

- [ ] **Step 4: Add menu item to AdminLayout.tsx**

In `admin/src/layouts/AdminLayout.tsx`, add menu entry under "系统管理" group (after the `config` entry at line 91):

```ts
        { path: '/config/discovery-filters', name: '发现页筛选', icon: <TagsOutlined />, permission: PERMISSIONS.CONFIG_READ },
```

- [ ] **Step 5: Verify admin frontend compiles**

Run: `cd admin && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/config/discovery-filters.tsx admin/src/App.tsx admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin): add discovery filter config page with drag-and-drop sorting"
```

---

### Task 6: App frontend — Dynamic company filter bar

**Files:**
- Modify: `src/repos/CompanyRepo.ts`
- Modify: `app/(tabs)/museum.tsx`

- [ ] **Step 1: Add getDiscoveryFilters to CompanyRepo**

In `src/repos/CompanyRepo.ts`, add a new method to the `CompanyRepo` object (after the existing methods):

```ts
  /**
   * 获取发现页企业筛选配置
   * - 后端接口：`GET /api/v1/companies/discovery-filters`
   */
  getDiscoveryFilters: async (): Promise<Result<Array<{ tagId: string; label: string; icon: string }>>> => {
    if (USE_MOCK) {
      return simulateRequest([
        { tagId: 'mock-cert-organic', label: '有机认证', icon: '🌿' },
        { tagId: 'mock-industry-fruit', label: '水果', icon: '🍎' },
        { tagId: 'mock-industry-tea', label: '茶叶', icon: '🍵' },
      ]);
    }

    return ApiClient.get('/companies/discovery-filters');
  },
```

- [ ] **Step 2: Add tagId param to CompanyRepo.list()**

In `src/repos/CompanyRepo.ts`, add `tagId` to the options type (line 62-69):

```ts
  list: async (
    options?: {
      page?: number;
      pageSize?: number;
      certified?: boolean;
      productCategory?: string;
      sortBy?: 'distance' | 'rating';
      includeTopProducts?: boolean;
      tagId?: string;
    },
  ): Promise<Result<PaginationResult<Company>>> => {
```

In the mock mode section, add tagId filtering after the `productCategory` filter (after line 111):

```ts
      // 过滤：tagId — 匹配 certifications 或 industryTags 中的名称
      if (options?.tagId) {
        // mock 模式下用标签名模糊匹配（真实 API 用 tagId）
        const mockTagNames: Record<string, string> = {
          'mock-cert-organic': '有机认证',
          'mock-industry-fruit': '水果',
          'mock-industry-tea': '茶叶',
        };
        const tagName = mockTagNames[options.tagId];
        if (tagName) {
          filtered = filtered.filter((company) =>
            [...(company.certifications || []), ...(company.industryTags || [])].some(
              (t) => t.includes(tagName),
            ),
          );
        }
      }
```

In the real API section (line 135), add `tagId` to the query params:

```ts
    const params = new URLSearchParams();
    if (options?.tagId) params.set('tagId', options.tagId);
    const queryString = params.toString();
    const res = await ApiClient.get<any>(`/companies${queryString ? `?${queryString}` : ''}`);
```

- [ ] **Step 3: Update museum.tsx to use dynamic filters**

In `app/(tabs)/museum.tsx`:

Remove the hardcoded `COMPANY_FILTERS` constant (lines 58-64).

Add the discovery filters query after the existing `categoriesQuery` (around line 121):

```ts
  // 企业筛选配置（10 分钟缓存）
  const discoveryFiltersQuery = useQuery({
    queryKey: ['discovery-company-filters'],
    queryFn: () => CompanyRepo.getDiscoveryFilters(),
    staleTime: 10 * 60_000,
  });
```

Add a computed filter list:

```ts
  // 企业筛选项：全部 + 后台配置 + 附近
  const companyFilters = useMemo(() => {
    const apiFilters = discoveryFiltersQuery.data?.ok
      ? discoveryFiltersQuery.data.data
      : [];
    return [
      { label: '全部', value: null as string | null },
      ...apiFilters.map((f) => ({
        label: `${f.icon} ${f.label}`,
        value: f.tagId,
      })),
      { label: '📍 附近', value: 'nearby' },
    ];
  }, [discoveryFiltersQuery.data]);
```

- [ ] **Step 4: Update companiesQuery to use tagId**

In the `companiesQuery` section (around line 146-166), update the queryFn to pass `tagId`:

```ts
  const companiesQuery = useInfiniteQuery({
    queryKey: ['companies', 'discovery', companyFilter],
    queryFn: ({ pageParam = 1 }) =>
      CompanyRepo.list({
        page: pageParam,
        includeTopProducts: true,
        ...(companyFilter === 'nearby' ? { sortBy: 'distance' as const } : {}),
        ...(companyFilter && companyFilter !== 'nearby'
          ? { tagId: companyFilter }
          : {}),
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.ok && lastPage.data.nextPage) return lastPage.data.nextPage;
      return undefined;
    },
    initialPageParam: 1,
    enabled: true,
    staleTime: 3 * 60_000,
  });
```

- [ ] **Step 5: Update filter bar rendering**

Find the section in the JSX that renders `COMPANY_FILTERS` (search for `COMPANY_FILTERS.map` or `companyFilter` in the JSX). Replace references to `COMPANY_FILTERS` with the new `companyFilters` variable. The rendering pattern should be:

```tsx
{companyFilters.map((filter) => (
  <Pressable
    key={filter.value ?? 'all'}
    onPress={() => setCompanyFilter(filter.value)}
    style={[/* existing styles */]}
  >
    <Text style={[/* existing styles */]}>
      {filter.label}
    </Text>
  </Pressable>
))}
```

- [ ] **Step 6: Commit**

```bash
git add src/repos/CompanyRepo.ts app/(tabs)/museum.tsx
git commit -m "feat(app): replace hardcoded company filters with dynamic API-driven config"
```

---

### Task 7: Mock data sync

**Files:**
- Modify: `src/mocks/companies.ts`
- Modify: `src/mocks/products.ts`

- [ ] **Step 1: Update company mock badges and certifications**

In `src/mocks/companies.ts`, ensure values match seed data tag names. Current values already match seed data:
- `badges`: `优选基地`, `品质认证`, `产地直供`, `低碳种植` → all in `company_badge` category ✓
- `certifications`: `有机认证`, `GAP认证`, `绿色食品`, `SC认证` → all in `company_cert` category ✓
- `industryTags`: `蔬菜`, `有机`, `粮油`, `水果`, `深加工`, `茶叶` → mostly in `industry` category ✓

No changes needed for companies mock — values already match.

- [ ] **Step 2: Update product mock tags**

In `src/mocks/products.ts`, ensure values match seed data tag names in the `product_tag` category.

Seed data tags: `可信溯源`, `检测报告`, `有机认证`, `地理标志`, `当季鲜采`

Current mock values:
- `p-001`: `['有机认证', '当季鲜采']` ✓
- `p-002`: `['可信溯源']` ✓
- `p-003`: `['检测报告', '地理标志']` ✓
- `p-004`: `['地理标志']` ✓
- `p-005`: `['有机认证']` ✓
- `p-006`: `['可信溯源']` ✓

No changes needed for products mock — values already match.

- [ ] **Step 3: Commit (skip if no changes)**

If any changes were made:
```bash
git add src/mocks/companies.ts src/mocks/products.ts
git commit -m "fix(mocks): sync mock data tags with seed data"
```

---

### Task 8: CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add design spec to related docs section**

In `CLAUDE.md`, add to the `相关文档` section:

```
- `docs/superpowers/specs/2026-03-28-discovery-filter-design.md` — 发现页企业筛选栏动态化设计方案（配置数据模型、管理后台页面、App端动态加载、管理端商品标签编辑，**发现页筛选配置权威来源**）
- `docs/superpowers/plans/2026-03-28-discovery-filter.md` — 发现页企业筛选栏动态化实施计划（8个任务、后端配置/公开API/管理前端/拖拽排序/App端动态化/Mock同步，**发现页筛选实施排程**）
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register discovery filter spec and plan in CLAUDE.md"
```
