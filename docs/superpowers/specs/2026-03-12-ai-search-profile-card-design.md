# 企业 AI 搜索资料 Card — P0/P1 设计方案

> **范围**: P0（卖家端表单收口）+ P1（后端 DTO 与存储收口）
> **不包含**: P2（搜索消费侧升级）、P3（管理后台配套）、地址三级结构化改造

---

## 1. 目标

把原本散落在 `description` / `highlights` 里的搜索关键信息，收敛成可维护、可搜索、可排序的结构化资料，写入 `CompanyProfile.highlights` JSON 的固定 schema。

## 2. 数据模型

### 2.1 highlights JSON 结构 (Phase 1)

所有字段存入 `CompanyProfile.highlights`（`Json?`），与现有 `cover` 字段共存。

```json
{
  "cover": "https://...",
  "companyType": "farm",
  "industryTags": ["水果", "蔬菜"],
  "productKeywords": ["蓝莓", "草莓"],
  "serviceAreas": ["湖北", "武汉", "武昌区"],
  "productFeatures": ["有机", "可溯源"],
  "supplyModes": ["批发", "基地直供"],
  "certifications": ["有机认证"],
  "mainBusiness": "水果、蔬菜、蓝莓、草莓",
  "badges": ["有机", "可溯源", "有机认证", "批发", "湖北", "武汉"]
}
```

### 2.2 AI 搜索字段（权威来源）

| 字段 | 键名 | 类型 | 必填 | 说明 |
|------|------|------|:----:|------|
| 企业类型 | `companyType` | string | Yes | 枚举：`farm/company/cooperative/base/factory/store` |
| 主营品类 | `industryTags` | string[] | Yes | 平台预置：水果/蔬菜/粮油/肉禽/水产/茶叶/蜂蜜/乳制品/其他 |
| 主营产品关键词 | `productKeywords` | string[] | No | 自由补充，如"蓝莓/草莓/有机五常大米" |
| 服务地区 | `serviceAreas` | string[] | Yes | 自由输入，后端 trim + 去重 + 过滤空串 |
| 产品特征 | `productFeatures` | string[] | Yes | 平台预置：有机/可溯源/冷链/认证 |
| 供给方式 | `supplyModes` | string[] | No | 平台预置：批发/零售/直供/同城配送/可预约考察 |
| 认证资质 | `certifications` | string[] | No | 平台预置：有机认证/绿色食品/地理标志 |

### 2.3 派生字段（自动生成，卖家无感知）

每次保存 AI 搜索资料时，后端自动重新计算：

- **`mainBusiness`** = `industryTags.join('、')` + productKeywords 拼接
  - 例：`"水果、蔬菜、蓝莓、草莓"`
- **`badges`** = `[...productFeatures, ...certifications, ...supplyModes.slice(0,2), ...serviceAreas.slice(0,2)].slice(0,8)`
  - 例：`["有机", "可溯源", "有机认证", "批发", "基地直供", "湖北", "武汉"]`

这些派生字段用于消费侧（买家 App 搜索、AI 语音匹配）的向下兼容。消费侧不用改动即可继续读 `mainBusiness` / `badges`。

### 2.4 字段边界

- `industryTags`（主营品类）：大类枚举，粗筛
- `productKeywords`（主营产品关键词）：品类下细分，精确匹配
- `productFeatures`（产品特征）：有机/可溯源/冷链/认证 — 产品属性
- `supplyModes`（供给方式）：批发/零售/直供/同城配送/可预约考察 — 交易模式
- `certifications`（认证资质）：有机认证/绿色食品/地理标志 — 企业资质

## 3. API 设计

### 3.1 新增端点：AI 搜索资料 CRUD

```
GET  /seller/company/ai-search-profile
PUT  /seller/company/ai-search-profile
```

- 角色：OWNER / MANAGER
- Guard：`@SellerRoles('OWNER', 'MANAGER')`
- 审计：`@SellerAudit({ action: 'UPDATE_AI_SEARCH_PROFILE', module: 'company', targetType: 'Company' })`

**GET 响应**：
```json
{
  "companyType": "farm",
  "industryTags": ["水果"],
  "productKeywords": ["蓝莓"],
  "serviceAreas": ["湖北", "武汉"],
  "productFeatures": ["有机"],
  "supplyModes": ["批发"],
  "certifications": ["有机认证"]
}
```
从 `CompanyProfile.highlights` 中提取 7 个 AI 搜索字段返回。无 profile 时返回空对象。

**PUT 请求体**：
```json
{
  "companyType": "farm",
  "industryTags": ["水果"],
  "productKeywords": ["蓝莓"],
  "serviceAreas": ["湖北", "武汉"],
  "productFeatures": ["有机"],
  "supplyModes": ["批发"],
  "certifications": ["有机认证"]
}
```

**PUT 后端流程**（整个流程在 Serializable 事务内执行，防止并发读-合并-写竞态）：
1. 校验 DTO（枚举值、数组类型、必填项）
2. 清洗 `serviceAreas`：trim + 去重 + 过滤空串
3. 开启 Serializable 事务
4. 读取现有 `highlights`（如无则 `{}`）
5. 合并 AI 搜索字段到 highlights
6. 计算派生字段 `mainBusiness` / `badges` 并写入
7. upsert 到 `CompanyProfile.highlights`
8. 提交事务
9. 返回更新后的 AI 搜索字段

### 3.2 改造现有端点：highlights merge

`PUT /seller/company/highlights` — 现有的企业亮点 Card 端点。

**改造**：从整体替换改为 merge 模式。
- 读取现有 highlights
- 合并传入的 key-value 对
- **保留** AI 搜索字段（`companyType`/`industryTags`/`productKeywords`/`serviceAreas`/`productFeatures`/`supplyModes`/`certifications`/`mainBusiness`/`badges`）不被覆盖
- 写回

具体实现：
```typescript
const AI_SEARCH_KEYS = [
  'companyType', 'industryTags', 'productKeywords', 'serviceAreas',
  'productFeatures', 'supplyModes', 'certifications', 'mainBusiness', 'badges'
];

async updateHighlights(companyId: string, highlights: Record<string, any>) {
  // Serializable 事务：防止并发 merge 竞态
  return this.prisma.$transaction(async (tx) => {
    const profile = await tx.companyProfile.findUnique({ where: { companyId } });
    const existing = (profile?.highlights as Record<string, any>) ?? {};
    // 从传入数据中移除 AI 搜索字段（防止企业亮点 Card 覆盖）
    const safeHighlights = Object.fromEntries(
      Object.entries(highlights).filter(([k]) => !AI_SEARCH_KEYS.includes(k))
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

## 4. DTO 校验

```typescript
// 新增 DTO
export class UpdateAiSearchProfileDto {
  @IsEnum(CompanyTypeEnum)
  companyType: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  industryTags: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  productKeywords?: string[];

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  serviceAreas: string[];

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  productFeatures: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  supplyModes?: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  certifications?: string[];
}
```

枚举值校验：
- `companyType`: `farm | company | cooperative | base | factory | store`
- `industryTags` 每个元素: `水果 | 蔬菜 | 粮油 | 肉禽 | 水产 | 茶叶 | 蜂蜜 | 乳制品 | 其他`
- `productFeatures` 每个元素: `有机 | 可溯源 | 冷链 | 认证`
- `supplyModes` 每个元素: `批发 | 零售 | 直供 | 同城配送 | 可预约考察`
- `certifications` 每个元素: `有机认证 | 绿色食品 | 地理标志`

## 5. 前端设计

### 5.1 新增 Card：企业 AI 搜索资料

位于企业设置页，插入在「企业亮点 Card」之后、「资质文件 Card」之前。

**可见性**：OWNER / MANAGER（与企业亮点 Card 一致）。

**表单组件**：

| 字段 | Ant Design 组件 | 配置 |
|------|----------------|------|
| 企业类型 | `Select` | 单选，6 个选项 |
| 主营品类 | `Select` | 多选 + 可搜索，9 个预置选项 |
| 主营产品关键词 | `Select` | mode="tags"，自由输入回车创建 |
| 服务地区 | `Select` | mode="tags"，自由输入回车创建 |
| 产品特征 | `Select` | 多选，4 个预置选项 |
| 供给方式 | `Select` | 多选，5 个预置选项 |
| 认证资质 | `Select` | 多选，3 个预置选项 |

**数据流**：
1. 页面加载时 `GET /seller/company/ai-search-profile` 获取当前数据填充表单
2. 卖家编辑后点击保存 → `PUT /seller/company/ai-search-profile`
3. React Query invalidate `company` 查询缓存

### 5.2 API 层

```typescript
// seller/src/api/company.ts 新增
export const getAiSearchProfile = (): Promise<AiSearchProfile> =>
  client.get('/seller/company/ai-search-profile');

export const updateAiSearchProfile = (data: AiSearchProfile): Promise<AiSearchProfile> =>
  client.put('/seller/company/ai-search-profile', data);
```

### 5.3 类型定义

```typescript
// seller/src/types/index.ts 新增
export interface AiSearchProfile {
  companyType: string;
  industryTags: string[];
  productKeywords?: string[];
  serviceAreas: string[];
  productFeatures: string[];
  supplyModes?: string[];
  certifications?: string[];
}
```

## 6. 不做的事

- 不改 `Company.address` 结构（留给 P2）
- 不改前端搜索页/AI 语音匹配消费逻辑（留给 P2）
- 不加管理后台编辑入口（留给 P3）
- 不改 Prisma Schema（Phase 1 全部走 JSON）
- 不删除企业亮点 Card（保留，弱化为补充）
