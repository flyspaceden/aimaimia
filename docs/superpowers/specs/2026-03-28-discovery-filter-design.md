# 发现页企业筛选栏动态化 + 管理后台商品标签编辑

## 背景

买家 App 发现页（`app/(tabs)/museum.tsx`）的企业筛选栏目前硬编码在前端：

```ts
const COMPANY_FILTERS = [
  { label: '全部', value: null },
  { label: '🌿 有机认证', value: 'certified' },
  { label: '🍎 水果', value: '水果' },
  { label: '🍵 茶叶', value: '茶叶' },
  { label: '📍 附近', value: 'nearby' },
];
```

同时管理后台商品编辑页缺少商品标签（`tagIds`）选择器，而卖家后台已有该功能。

## 改动范围

1. **后端**：新增 `DISCOVERY_COMPANY_FILTERS` 配置项 + 公开读取端点
2. **管理后台**：新增"发现页筛选配置"页面（拖拽排序 + emoji 图标）
3. **管理后台**：商品编辑页增加商品标签选择器
4. **App 前端**：企业筛选栏从 API 动态获取，替换硬编码
5. **Mock 数据**：同步企业/商品标签与种子数据一致

---

## 一、后端：配置项与公开端点

### 1.1 新增配置项

在 `config-validation.ts` 中注册 `DISCOVERY_COMPANY_FILTERS`：

```ts
DISCOVERY_COMPANY_FILTERS: {
  type: 'json',
  description: '发现页企业筛选栏配置',
  custom: (value: any) => {
    if (!Array.isArray(value)) return '值必须是数组';
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (!item.tagId || typeof item.tagId !== 'string')
        return `[${i}].tagId 必须是字符串`;
      if (!item.icon || typeof item.icon !== 'string')
        return `[${i}].icon 必须是字符串`;
    }
    return null;
  },
},
```

### 1.2 配置数据结构

```json
[
  { "tagId": "clxxx1", "icon": "🌿" },
  { "tagId": "clxxx2", "icon": "🍎" },
  { "tagId": "clxxx3", "icon": "🍵" }
]
```

- `tagId`：关联 Tag 表的 ID
- `icon`：emoji 图标
- 数组顺序即显示顺序（拖拽排序结果）
- `label` 不冗余存储，读取时从 Tag 表取 `name`

### 1.3 公开读取端点

在 `CompanyController` 中新增公开端点（与 `tag-categories` 同级）：

```
GET /companies/discovery-filters
```

响应格式：

```json
{
  "filters": [
    { "tagId": "clxxx1", "label": "有机认证", "icon": "🌿" },
    { "tagId": "clxxx2", "label": "水果", "icon": "🍎" }
  ]
}
```

实现逻辑：
1. 从 `ruleConfig` 表读取 `DISCOVERY_COMPANY_FILTERS` 配置
2. 批量查询对应的 Tag 记录获取 `name`
3. 过滤掉已删除或已停用的 Tag（`isActive: false`）
4. 返回有序数组，每项包含 `tagId`、`label`（Tag.name）、`icon`

### 1.4 企业列表按标签筛选

现有 `CompanyController.list()` 端点新增 `tagId` 查询参数：

```
GET /companies?tagId=clxxx1&page=1
```

后端在查询时通过 `CompanyTag` 关联表过滤：

```ts
where: {
  ...(tagId ? { companyTags: { some: { tagId } } } : {}),
}
```

### 1.5 种子数据

在 `seed.ts` 中为 `DISCOVERY_COMPANY_FILTERS` 配置一组默认筛选项，引用已有的种子标签 ID。

---

## 二、管理后台：发现页筛选配置页面

### 2.1 页面位置

新增菜单项：**系统配置** → **发现页筛选配置**（或在现有配置页面新增 Tab/区域）

### 2.2 UI 设计

**布局**：左右两栏

| 左栏：标签池 | 右栏：已选筛选项 |
|---|---|
| 按 TagCategory 分组展示所有 COMPANY scope 标签 | 已选标签列表，支持拖拽排序 |
| 点击标签 → 添加到右栏 | 每项显示：拖拽手柄 + emoji 输入 + 标签名 + 删除按钮 |
| 已选标签置灰不可重复添加 | |

**固定项提示**：页面顶部说明"「全部」固定在最前，「附近」固定在最后，不可编辑"。

**拖拽排序**：使用 `@dnd-kit/core` + `@dnd-kit/sortable`（管理后台已有 Ant Design 生态，也可用 `react-beautiful-dnd`）。

**emoji 输入**：每个已选标签旁的 Input 框，管理员手动输入 emoji（如 🌿、🍎）。

**保存**：调用 `PUT /admin/config/DISCOVERY_COMPANY_FILTERS` 保存有序数组。

### 2.3 数据流

```
加载页面
  → GET /admin/tags?scope=COMPANY（左栏标签池）
  → GET /admin/config/DISCOVERY_COMPANY_FILTERS（右栏已选项）
  → 合并渲染

保存
  → 收集右栏有序列表 [{ tagId, icon }, ...]
  → PUT /admin/config/DISCOVERY_COMPANY_FILTERS { value: [...] }
```

---

## 三、管理后台：商品编辑页增加标签选择器

### 3.1 改动文件

`admin/src/pages/products/edit.tsx`

### 3.2 改动内容

参照卖家后台 `seller/src/pages/products/edit.tsx` 的实现：

1. **加载标签选项**：
   ```ts
   const { data: productCategories = [] } = useQuery({
     queryKey: ['tag-categories-product'],
     queryFn: () => getPublicTagCategories('PRODUCT'),
   });
   const productTagOptions = productCategories
     .flatMap(cat => cat.tags.map(t => ({ value: t.id, label: t.name })));
   ```

2. **表单字段**：在"基本信息"卡片中（`aiKeywords` 字段下方）添加：
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

3. **初始化**：加载商品数据时映射 `tagIds`：
   ```ts
   tagIds: product.tags?.map((t: any) => t.tag?.id || t.tagId) || [],
   ```

4. **保存**：将 `tagIds` 包含在更新请求中。

### 3.3 后端支持

检查管理后台商品更新端点是否已支持 `tagIds` 参数。如不支持，在管理端商品更新 service 中增加与卖家端一致的 ProductTag 更新逻辑。

---

## 四、App 前端：企业筛选栏动态化

### 4.1 改动文件

`app/(tabs)/museum.tsx`

### 4.2 数据获取

新增 API 调用：

```ts
// src/repos/CompanyRepo.ts
static async getDiscoveryFilters(): Promise<Result<DiscoveryFilter[]>> { ... }
```

页面中：

```ts
const filtersQuery = useQuery({
  queryKey: ['discovery-company-filters'],
  queryFn: () => CompanyRepo.getDiscoveryFilters(),
  staleTime: 10 * 60_000, // 10 分钟缓存
});
```

### 4.3 渲染逻辑

替换硬编码的 `COMPANY_FILTERS`：

```ts
const companyFilters = useMemo(() => {
  const apiFilters = filtersQuery.data?.ok ? filtersQuery.data.data : [];
  return [
    { label: '全部', value: null, icon: null },        // 固定首项
    ...apiFilters.map(f => ({
      label: `${f.icon} ${f.label}`,
      value: f.tagId,
    })),
    { label: '📍 附近', value: 'nearby', icon: '📍' }, // 固定末项
  ];
}, [filtersQuery.data]);
```

### 4.4 筛选逻辑调整

选中标签时，将 `tagId` 传给企业列表查询：

```ts
const companiesQuery = useInfiniteQuery({
  queryKey: ['companies', 'discovery', companyFilter],
  queryFn: ({ pageParam = 1 }) =>
    CompanyRepo.list({
      page: pageParam,
      includeTopProducts: true,
      ...(companyFilter === 'nearby' ? { sortBy: 'distance' } : {}),
      ...(companyFilter && companyFilter !== 'nearby'
        ? { tagId: companyFilter }
        : {}),
    }),
  // ...
});
```

### 4.5 Mock 模式兼容

`CompanyRepo.getDiscoveryFilters()` 在 `USE_MOCK=true` 时返回与种子数据一致的默认筛选项。

`CompanyRepo.list()` 在 mock 模式下支持 `tagId` 过滤（按企业的 `certifications`/`industryTags` 匹配）。

---

## 五、Mock 数据同步

### 5.1 企业 Mock（`src/mocks/companies.ts`）

更新 `badges` 和 `certifications` 字段值，与种子数据中 `company_badge` 和 `company_cert` 分类下的标签名一致。

### 5.2 商品 Mock（`src/mocks/products.ts`）

更新 `tags` 字段值，与种子数据中 `product_tag` 分类下的标签名一致（可信溯源、检测报告、有机认证、地理标志、当季鲜采）。

---

## 六、类型定义

### App 前端新增类型

```ts
// src/types/domain/DiscoveryFilter.ts
export type DiscoveryFilter = {
  tagId: string;
  label: string;
  icon: string;
};
```

---

## 不在范围内

- 商品 tab 顶部分类筛选（已经从 CategoryRepo 动态获取，不需要改）
- 卡片标签连接真实 API（依赖 `USE_MOCK=false`，不在本次范围）
- 标签管理页面本身（已在前一次迭代完成）
