# 卖家商品草稿设计方案

## 背景

2026-04-24 发现 `seller/src/pages/products/edit.tsx` 商品创建页只有"提交审核"一个按钮，且强制 `form.validateFields()` 全量校验，卖家中途退出（关闭标签页、浏览器崩溃、切换账号、断网等）已填内容全部丢失。现有 `useUnsavedChanges` Hook 只做 `beforeunload` 拦截，不做任何持久化。

Prisma schema 里 `ProductStatus` 已经预留 `DRAFT` 值（`schema.prisma:107-111`），但 service `create()` 硬编码成 `INACTIVE`（`seller-products.service.ts:151`），也没有对应 API / 前端入口。本次改造把 DRAFT 真正用起来，同时让卖家跨设备、跨浏览器均可恢复草稿。

## 目标

1. 卖家填写商品中可随时点**"保存草稿"**持久化到数据库，后端不校验除"标题"以外的字段
2. 创建页每 30 秒自动保存一次（debounce，dirty 才触发）
3. 卖家商品列表页新增**草稿 tab**，列出所有草稿、可继续编辑或删除
4. 每个商户最多保留 **5 份**草稿，超过时拒绝再存
5. 草稿提交审核走完整校验、走现有审核流程（`status: INACTIVE, auditStatus: PENDING`）
6. 草稿**不进任何买家查询、不进管理员审核列表、不计入商品总数统计**

## 决策速查表

| 决策点 | 结论 |
|---|---|
| 持久化位置 | 数据库（`Product` 表，`status=DRAFT`），复用现有 schema |
| 草稿数量上限 | 每商户 **5 份** |
| 保存草稿最低门槛 | **必须填标题**（便于列表展示 + 防滥用） |
| 自动保存 | 30 秒 debounce，dirty 时触发；支持手动保存 |
| 图片上传 | 可以（现有 `/upload` 接口与商品记录无强关联，草稿存 URL 即可） |
| 被驳回商品再编辑 | **不回退到 DRAFT**，沿用现有 `INACTIVE + REJECTED` 流程，避免状态机分叉 |
| 自动过期清理 | v1 不做，未来按需加 Cron |
| 管理端审核列表 | 显式排除 `status = 'DRAFT'`（避免草稿混入审核队列） |
| 买家查询 | 所有买家端查询已经隐含 `status = 'ACTIVE'`，天然排除 DRAFT，零改动 |
| 商品总数卡片 | 列表页顶部"商品总数"统计**排除** DRAFT（仅统计 ACTIVE + INACTIVE） |
| 提交审核路径 | DRAFT → `submitDraft` 校验通过后 → `status: INACTIVE, auditStatus: PENDING, submissionCount: 1` |
| 草稿路由 | **复用** `/products/new` 和 `/products/:id`，不新增路由，根据 `product.status` 切换 UI |
| 前端持久化 draftId | 首次保存后通过 `history.replaceState` 改 URL 为 `/products/:draftId`（刷新/复制链接不丢） |

## 架构选型

**方案：后端 `status = 'DRAFT'` 持久化 + 前端双按钮 + 自动保存**

- 不走 localStorage 的理由：用户要求 v1 即支持跨设备、跨浏览器
- 不引入新表的理由：`Product.status = DRAFT` 已预留，用子类型而非另建 `ProductDraft` 表——避免两套字段维护的同步漂移，也方便"草稿→提交"原地切换
- **校验分层**：
  - 保存草稿时用新的 `CreateDraftDto` / `UpdateDraftDto`，除 `title` 外所有字段 `@IsOptional`
  - 提交审核时在 service 层**重跑** `CreateProductDto` 的完整校验（手动 `validate(plainToInstance(CreateProductDto, data))`），保证审核队列数据格式严格
- **状态隔离策略**：所有可能把草稿误当正常商品处理的查询（卖家列表默认视图、管理端审核列表、买家 feed）显式加 `status != 'DRAFT'` 或 `status IN ('ACTIVE', 'INACTIVE')`
- **数量上限在事务内校验**：`createDraft` 前 `count({ companyId, status: 'DRAFT' })`，达 5 抛 `409 Conflict`

## 一、数据模型

### Schema 变更

**无 migration**——`ProductStatus.DRAFT` 早已存在：

```prisma
enum ProductStatus {
  DRAFT       // 本次真正启用
  ACTIVE
  INACTIVE
}
```

### 状态机

| 动作 | `status` 变化 | `auditStatus` 变化 | 可见性 |
|---|---|---|---|
| 保存草稿（创建） | `(none)` → `DRAFT` | `PENDING`（默认，忽略） | 仅卖家本人草稿 tab |
| 保存草稿（更新） | `DRAFT` → `DRAFT` | 不变 | 同上 |
| 提交审核 | `DRAFT` → `INACTIVE` | `PENDING`（触发审核） | 卖家 + 管理员审核队列 |
| 管理员通过 | `INACTIVE` → `INACTIVE` | `PENDING` → `APPROVED` | 卖家可上架 |
| 管理员驳回 | `INACTIVE` → `INACTIVE` | `PENDING` → `REJECTED` | 卖家修改后重新提交（不回退 DRAFT） |
| 上架 | `INACTIVE` → `ACTIVE` | `APPROVED` | 买家可见 |

## 二、后端 API（`backend/src/modules/seller/products/`）

### 2.1 `POST /api/v1/seller/products/draft` — 新建草稿

**DTO（`CreateDraftDto`）**：所有字段 `@IsOptional`，仅 `title` 必填且 `@MaxLength(100)`。其他字段类型/格式校验保留（如 `cost` 必须 >= 0.01，若填了）。

**Service (`createDraft`)：**
1. 事务内 `count({ companyId, status: 'DRAFT' })`，达 5 抛 `ConflictException('草稿数量已达上限（5 份），请先清理')`
2. 创建 `Product`：`status: 'DRAFT'`, `auditStatus: 'PENDING'`（默认值，语义上忽略），`submissionCount: 0`（本次未提交过）
3. 按可选字段组装：`skus` 可为空数组（草稿允许没 SKU）；`media` 可为空
4. 不发审核通知、不进审核 Socket 推送
5. 返回 `productId`

**响应：** `{ id: string, status: 'DRAFT' }`

### 2.2 `PATCH /api/v1/seller/products/:id/draft` — 更新草稿

**DTO（`UpdateDraftDto`）**：所有字段 `@IsOptional`。

**Service (`updateDraft`)：**
1. 校验 `product.companyId === ctx.companyId`（多商户隔离）
2. 校验 `product.status === 'DRAFT'`，否则抛 `BadRequestException('该商品非草稿状态，不能用此接口更新')`
3. 事务内覆盖写（`update` 而非 `upsert`）：skus 复用 `updateProductSkus` 逻辑的**草稿版**（草稿 SKU 可能还没 ID、可能为空数组）；媒体 URL 全量覆盖
4. 不触发审计日志（草稿频繁保存，审计价值低）
5. 返回 `{ id, updatedAt }`

### 2.3 `POST /api/v1/seller/products/:id/submit` — 草稿提交审核

**Service (`submitDraft`)：**
1. 校验 `product.status === 'DRAFT'`，否则抛错
2. 把当前 product（包括 skus、媒体）装回 `CreateProductDto` 形状，**手动调用 `class-validator` 的 `validate()` 全量校验**，失败返回 `400` + 字段级错误
3. 事务内更新：`status: 'DRAFT' → 'INACTIVE'`, `submissionCount: 0 → 1`, `auditStatus` 维持 `PENDING`
4. 触发审核通知（沿用现有 create 流程里的通知代码 —— 需要识别出那段逻辑并复用）
5. 返回 `{ id, status: 'INACTIVE', auditStatus: 'PENDING' }`

### 2.4 `DELETE /api/v1/seller/products/:id` — 已有，放宽

当前 `deleteProduct` 只允许 `status === 'INACTIVE'` 删除。改为：**`INACTIVE` 或 `DRAFT` 均允许删**。

### 2.5 `GET /api/v1/seller/products` — 已有，默认排除 DRAFT

现有 `list(companyId, status?)` 若不传 `status` 参数，`where` 会漏 DRAFT 吗？需要显式改：**不传 status 时默认排除 DRAFT**（`where.status = { not: 'DRAFT' }`）；传了 `status=DRAFT` 时返回草稿。

### 2.6 `POST /api/v1/seller/products/:id/status`（toggleStatus） — 已有，加防御

当前 `toggleStatus` 只接受 `ACTIVE | INACTIVE`，但加一层前置校验：**`product.status === 'DRAFT'` 时拒绝**（必须先提交审核 + 通过，才能上架）。

### 2.7 统计接口：商品总数卡片

列表页顶部四个统计卡片分别为"商品总数 / 在售 / 审核中 / 低库存"。"商品总数"查询需要加 `status != 'DRAFT'`。审核中 = `auditStatus: 'PENDING' AND status != 'DRAFT'`（防止万一 DRAFT 的 auditStatus 值污染统计）。

### 2.8 管理端审核列表（`backend/src/modules/admin/products/`）

检查所有审核列表查询，显式加 `where.status = { in: ['ACTIVE', 'INACTIVE'] }` 或 `where.status = { not: 'DRAFT' }`。确保 DRAFT 完全不进管理后台审核视图。

## 三、前端改造（卖家端）

### 3.1 API client（`seller/src/api/products.ts`）

新增 3 个方法：

```ts
export async function createDraft(dto: Partial<CreateProductPayload> & { title: string }): Promise<{ id: string; status: 'DRAFT' }>;
export async function updateDraft(id: string, dto: Partial<CreateProductPayload>): Promise<{ id: string; updatedAt: string }>;
export async function submitDraft(id: string): Promise<{ id: string; status: 'INACTIVE'; auditStatus: 'PENDING' }>;
```

`deleteProduct` 复用即可。

### 3.2 创建页 `ProductCreateForm`（`pages/products/edit.tsx`）

**UI 改动：**
- 页头右上角改为 **`[保存草稿]` `[提交审核]`** 两颗按钮
- 页头增加"最后保存于 HH:mm:ss"文字（仅在 `draftId` 存在时显示）
- 保存草稿按钮状态：`idle / saving / saved`

**状态：**
```ts
const [draftId, setDraftId] = useState<string | null>(null);
const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
const [draftSaving, setDraftSaving] = useState(false);
```

**保存草稿逻辑（共用 `handleSaveDraft`，手动按钮和自动保存都调它）：**
1. `form.getFieldsValue()` 拿当前值（不 validate）
2. 如果 `!values.title`：
   - 手动调用 → `message.warning('标题是必填项，才能保存草稿')`
   - 自动调用 → 静默跳过
3. 调 `buildDraftPayload(values, fileList, markupRate)`（新函数，逻辑同 `buildPayload` 但不做 `basePrice` 兜底、不做 `Math.min(...[])=Infinity` 崩溃）
4. `draftId` null → `createDraft()` → 成功后 `setDraftId(id)` + `window.history.replaceState({}, '', \`/products/\${id}\`)`
5. `draftId` 有值 → `updateDraft(draftId, payload)`
6. 成功 → `setLastSavedAt(new Date())`; 失败 → `message.error(err.message)`（自动保存失败静默记 console）
7. `409 ConflictException`（达上限） → `message.error(err.message)`，禁用保存草稿按钮

**自动保存：**
```ts
const debouncedSave = useMemo(
  () => debounce(() => handleSaveDraft(/* silent = */ true), 30_000),
  [draftId],  // draftId 变化时重建（把 draftId 带进闭包）
);
Form.useWatch([], form);  // 已有
useEffect(() => {
  if (form.isFieldsTouched()) debouncedSave();
  return () => debouncedSave.cancel();
}, [/* 表单值变化 */]);
```

注意：`lodash/debounce` 已经是 antd 依赖，直接 `import debounce from 'lodash/debounce'`。

**提交审核逻辑（`handleSubmit`）改造：**
- 如果 `draftId` 存在：先 `updateDraft(draftId, payload)` 同步最新 → 再 `submitDraft(draftId)`
- 如果 `draftId` 不存在（用户没点过保存草稿直接点提交）：走现有 `createProduct()` 路径

**跳转到编辑页场景：** 如果 URL 是 `/products/:id` 且 `product.status === 'DRAFT'`，应该**走创建页的 UI**（双按钮 + 自动保存），而不是编辑页的 UI。通过在 `ProductEditForm` 里检测 status=DRAFT 时转 `<ProductCreateForm draftInitialId={id} />`（见 3.3）。

### 3.3 编辑页 `ProductEditForm`

在 `useEffect(() => { if (!product) return; ... }, [product, form])` 之前加：

```ts
if (product.status === 'DRAFT') {
  return <ProductCreateForm draftInitialId={product.id} />;
}
```

然后 `ProductCreateForm` 接收 optional `draftInitialId` prop：
- 若有值 → `useQuery(['seller-product', draftInitialId], ...)` 预加载草稿 → useEffect 里塞进 form
- 若无值 → 当前行为（空白创建页）

### 3.4 列表页 `pages/products/index.tsx`

**统计卡片：** 4 个卡片最前面加第 5 个"草稿"卡，或把"商品总数"拆出"草稿"计数单独显示。选前者——尺寸统一好看：

```tsx
<StatCard title="草稿" value={statusCounts?.draft ?? 0} icon={<EditOutlined />} />
```

`statusCounts` 接口 `GET /seller/products/status-counts` 需要返回 `draft` 字段（若已有统计接口则加字段，若无则前端单独调 `getProducts({ status: 'DRAFT', page: 1, pageSize: 1 })`）。

**Tab：** ProTable 顶部 filter 区加"草稿" option：
```ts
const STATUS_OPTIONS = [
  { label: '全部', value: '' },  // 后端默认排除 DRAFT
  { label: '在售', value: 'ACTIVE' },
  { label: '已下架', value: 'INACTIVE' },
  { label: '草稿', value: 'DRAFT' },  // 新增
];
```

**行渲染差异：**
- `status` 列：DRAFT 显示 `<Tag>草稿</Tag>`（用 statusMaps 里新增映射，color 默认灰色）
- `auditStatus` 列：DRAFT 显示 `-`
- 操作栏：DRAFT 行显示 `[继续编辑] [删除]`，**隐藏**上下架 `Switch`、审核详情等

**路由导航：** 点"继续编辑"跳 `/products/:id` —— 由编辑页根据 status 转发到 `ProductCreateForm` 的 draft 模式。

### 3.5 `constants/statusMaps.ts`

`productStatusMap` 增加 `DRAFT: { text: '草稿', color: 'default' }`。

## 四、边界与安全

| 场景 | 处理 |
|---|---|
| 草稿数量达 5 份，用户仍点保存 | 后端返回 `409 Conflict`；前端 `message.error` 并禁用按钮 + 提示 |
| 用户同时在两个标签页编辑同一份草稿 | 后端 `updateDraft` 是 last-write-win，前端不做乐观锁（草稿场景可以容忍覆盖） |
| 未提交的草稿 URL 被复制分享给同商户别的员工 | 对方访问 `/products/:id` → 后端按 `ctx.companyId` 过滤，若同商户则 OK（多员工协作草稿是 feature 不是 bug）；跨商户则 403 |
| 草稿 SKU 字段缺失（如无 cost） | 后端允许（DTO 可选）；前端 `basePrice = Math.min(...skus.map(...))` 需防御：skus 为空时置 `undefined`，否则 `Math.min(...[]) = Infinity` 会写脏数据 |
| 草稿图片 URL 引用已被删掉的 OSS 对象 | 提交审核时校验 mediaUrls 至少 1 张即可，不强制 HEAD 检查存在性（审核员会看到图片 404，驳回） |
| 草稿被管理员通过"直接上架"入口误操作 | `toggleStatus` 前置校验 DRAFT → 拒绝；管理员审核页已排除 DRAFT，触达不到 |
| 图片上传 API 仍需 auth 与体积限制 | 现有 `/upload` 接口已有，未改造 |

## 五、实施风险 & 回滚

- **后端全部新增方法 + 少量现有查询加 where 条件**，不改 schema，风险低
- 如果"现有查询加 where"遗漏了某处（例如某个列表没加 `status != DRAFT`），会导致草稿意外显示。缓解：T9 代码审查 Agent 专门检查所有 `Product` 查询
- 前端的 `ProductCreateForm` 从"单一职责"变成"双用途"（新建 + 草稿继续编辑），代码复杂度上升。缓解：`draftInitialId` prop 让分支清晰
- 回滚：`git revert` 单 PR 即可；数据库里 `DRAFT` 行不影响任何线上查询（已全部排除），不需要数据清理

## 六、测试点

**后端：**
- `createDraft` 无 title 返回 400
- `createDraft` 达 5 份返回 409
- `createDraft` 只填 title 能成功写入 DRAFT
- `updateDraft` 对非 DRAFT 商品返回 400
- `updateDraft` 跨商户返回 403
- `submitDraft` 对不完整草稿返回 400（字段级错误）
- `submitDraft` 对完整草稿返回 200，status 变为 INACTIVE
- `list({ status: undefined })` 不包含 DRAFT
- `list({ status: 'DRAFT' })` 包含且仅包含 DRAFT
- `toggleStatus` 对 DRAFT 返回 400
- 管理端审核列表不包含 DRAFT

**前端：**
- 创建页未点保存直接提交 → 走 createProduct（现有行为）
- 创建页点保存草稿 → URL 变 `/products/:id`，刷新后表单自动填回
- 创建页 30 秒自动保存
- 列表页草稿 tab 只显示草稿，操作栏没有上下架
- 草稿继续编辑 → 跳转到创建页 UI 而非编辑页 UI
- 达 5 份时按钮禁用、toast 提示

## 七、文档 & 通信

- `docs/architecture/seller.md` 里商品状态机章节补充 DRAFT 分支（如有）
- `CLAUDE.md` 架构决策表可加一行"商品草稿：status=DRAFT, 5 份上限, 标题必填"
- `plan.md` 追加条目
