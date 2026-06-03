# 卖家商品草稿实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 卖家创建/编辑商品时支持"保存草稿"，草稿持久化到 `Product.status = 'DRAFT'`，30 秒 debounce 自动保存，列表页新增草稿 tab，每商户最多 5 份草稿，标题为必填最低门槛。

**Architecture:** 复用现有 `Product` 表与 `ProductStatus.DRAFT` 枚举（零 migration），所有可能把草稿当正常商品处理的查询（卖家默认列表、管理员审核列表、商品总数统计）显式排除 DRAFT。创建页双按钮（保存草稿 / 提交审核）+ 创建与编辑页通过 `product.status === 'DRAFT'` 分支复用 `ProductCreateForm` UI。

**Tech Stack:** NestJS + Prisma + PostgreSQL（后端）、Vite + React + Ant Design + @tanstack/react-query（卖家后台）

**Spec:** `docs/superpowers/specs/2026-04-24-product-draft-design.md`

---

## File Structure

### Backend — Modified Files

| File | Change |
|------|--------|
| `backend/src/modules/seller/products/seller-products.dto.ts` | 新增 `CreateDraftDto` / `UpdateDraftDto`（所有字段 `@IsOptional`，仅 title 必填） |
| `backend/src/modules/seller/products/seller-products.service.ts` | 新增 `createDraft` / `updateDraft` / `submitDraft` 三方法；`list` 默认排除 DRAFT；`toggleStatus` 拒绝 DRAFT；`update` 拒绝 DRAFT（走 updateDraft）；`deleteProduct` 放宽允许 DRAFT；统计接口排除 DRAFT + 新增 `draftCount` |
| `backend/src/modules/seller/products/seller-products.controller.ts` | 新增 3 个路由：`POST /draft`、`PATCH /:id/draft`、`POST /:id/submit` |
| `backend/src/modules/admin/products/*` | 审核列表查询显式 `status != 'DRAFT'`（如需要） |

### Backend — Modified Tests

| File | Change |
|------|--------|
| `backend/src/modules/seller/products/seller-products-dto.spec.ts` | 新增 DTO 校验测试 |
| `backend/src/modules/seller/products/seller-products.service.spec.ts` | 新增草稿相关 Service 测试（新文件，如不存在） |

### Seller Frontend — Modified Files

| File | Change |
|------|--------|
| `seller/src/api/products.ts` | 新增 `createDraft` / `updateDraft` / `submitDraft` 三方法 |
| `seller/src/pages/products/edit.tsx` | `ProductCreateForm` 双按钮 + 自动保存 + draftId 状态 + `draftInitialId` prop；`ProductEditForm` 遇 DRAFT 转发到 `ProductCreateForm` |
| `seller/src/pages/products/index.tsx` | 草稿统计卡 + "草稿" tab + 草稿行操作栏 |
| `seller/src/constants/statusMaps.ts` | `productStatusMap` 增加 DRAFT 映射 |

### Docs — Modified Files

| File | Change |
|------|--------|
| `CLAUDE.md` | 相关文档段落新增两个 md；架构决策表添加商品草稿行 |
| `plan.md` | 追加商品草稿条目 |

---

## Tasks

### Phase 1: 后端

- [ ] **T1. 后端 DTO + Service**
  - `seller-products.dto.ts` 新增 `CreateDraftDto`（title 必填，其他全 @IsOptional） + `UpdateDraftDto`（全 @IsOptional）
  - `seller-products.service.ts` 新增 `createDraft(companyId, dto)`：
    - 事务内 `count({ companyId, status: 'DRAFT' })` ≥ 5 抛 `ConflictException('草稿数量已达上限（5 份），请先清理')`
    - `product.create` 设 `status: 'DRAFT'`
    - skus 可为空数组
  - 新增 `updateDraft(companyId, productId, dto)`：
    - 校验 `product.companyId` + `product.status === 'DRAFT'`
    - 事务内覆盖写（product 字段 + skus 全量替换 + media 全量替换）
  - 新增 `submitDraft(companyId, productId)`：
    - 校验 `product.status === 'DRAFT'`
    - 组装成 `CreateProductDto` 形状，手动跑 `class-validator` 全量校验
    - 事务内：`status: DRAFT → INACTIVE`, `submissionCount: 0 → 1`, `auditStatus` 维持 `PENDING`
    - 触发审核通知（沿用现有 `create` 流程的通知代码）
  - 修改现有 `list(companyId, status?)`：`status` 为空时 `where.status = { not: 'DRAFT' }`；显式 `status='DRAFT'` 时返回草稿
  - 修改现有 `toggleStatus`：`product.status === 'DRAFT'` 抛 `BadRequestException('草稿商品需先提交审核')`
  - 修改现有 `update`：`product.status === 'DRAFT'` 抛错提示用 `updateDraft`
  - 修改现有 `deleteProduct`：允许 `DRAFT` 状态删除（当前只允许 `INACTIVE`）
  - 修改统计接口：商品总数 / 审核中查询加 `status != 'DRAFT'`；新增 `draftCount` 返回字段

- [ ] **T2. 后端 Controller + 管理端排除 DRAFT**
  - `seller-products.controller.ts` 新增 3 个路由：
    - `POST /draft` → `createDraft`
    - `PATCH /:id/draft` → `updateDraft`
    - `POST /:id/submit` → `submitDraft`
  - 检查 `backend/src/modules/admin/products/` 所有审核列表查询，显式 `where.status = { in: ['ACTIVE', 'INACTIVE'] }`

- [ ] **T3. 后端单测**
  - DTO 测试：`CreateDraftDto` 无 title 返回校验失败；`UpdateDraftDto` 全空通过
  - Service 测试：
    - `createDraft` 达 5 份返回 409
    - `createDraft` 无 title 应被 DTO 层挡住（controller 路径）
    - `createDraft` 只填 title 成功
    - `updateDraft` 跨商户抛 403
    - `updateDraft` 对非 DRAFT 抛 400
    - `submitDraft` 不完整草稿返回字段级错误
    - `submitDraft` 完整草稿 DRAFT → INACTIVE
    - `list({ status: undefined })` 不含 DRAFT
    - `list({ status: 'DRAFT' })` 只含 DRAFT
    - `toggleStatus` 对 DRAFT 抛 400
  - 运行 `cd backend && npm test -- seller-products` 通过

### Phase 2: 前端 API + UI

- [ ] **T4. 前端 API client**
  - `seller/src/api/products.ts` 新增 3 方法：`createDraft` / `updateDraft` / `submitDraft`
  - 类型定义对齐后端响应

- [ ] **T5. 创建页双按钮 + 自动保存**
  - `edit.tsx` `ProductCreateForm`：
    - 接收 optional `draftInitialId` prop；若有则 `useQuery(['seller-product', draftInitialId], getProduct)` 加载并 setFieldsValue
    - 页头改为 `[保存草稿] [提交审核]` 双按钮 + "最后保存于 HH:mm:ss" 文字
    - `draftId` state + `lastSavedAt` state + `draftSaving` state
    - `handleSaveDraft(silent = false)`:
      - `form.getFieldsValue()` 不 validate
      - 无 title → `silent` 时静默跳过，否则 `message.warning`
      - 构造 payload（skus 空时不传 basePrice）
      - `draftId` null → `createDraft` → `setDraftId` + `history.replaceState('/products/{id}')`
      - 有 → `updateDraft`
      - 成功 → `setLastSavedAt(new Date())`
      - 409 → 禁用按钮 + `message.error`
    - 自动保存：`import debounce from 'lodash/debounce'`；`useMemo` 包 debounce(30s)；`useEffect` 监听 form values 变化触发；cleanup `cancel()`
    - `handleSubmit` 改造：有 `draftId` 时先 `updateDraft` 再 `submitDraft`；否则走 `createProduct`
  - 测试：`cd seller && npx tsc -b` 无错
  - 浏览器验证：打开 /products/new，填标题点保存，URL 变化；刷新后表单恢复；30 秒后自动保存

- [ ] **T6. 编辑页 DRAFT 分支**
  - `ProductEditForm` 加载 product 后判断：`product.status === 'DRAFT'` → `return <ProductCreateForm draftInitialId={product.id} />`
  - 现有正常商品编辑路径保持不变
  - 测试：访问草稿 URL → 看到创建页 UI；访问 INACTIVE 商品 → 看到原编辑页

- [ ] **T7. 列表页草稿 Tab**
  - `constants/statusMaps.ts` 增加 `productStatusMap.DRAFT = { text: '草稿', color: 'default' }`
  - `index.tsx`：
    - 顶部统计增加"草稿"卡（从 statusCounts.draft 读取，若后端未加字段先用 `getProducts({ status: 'DRAFT', pageSize: 1 })` 拿 total）
    - ProTable 状态 filter options 增加 `{ label: '草稿', value: 'DRAFT' }`
    - 行渲染：status === DRAFT 时，操作栏隐藏上下架 switch、删除按钮行为保持；auditStatus 列显示 `-`
    - 点击草稿行 → 跳 `/products/:id`（由 T6 处理转发）
  - 测试：切换草稿 tab → 只显示草稿；点草稿 → 进入创建页 UI

### Phase 3: 文档与审查

- [ ] **T8. 同步架构文档**
  - `docs/architecture/seller.md` 或 `sales.md`：商品状态机章节（如已有）补 DRAFT
  - `CLAUDE.md`：相关文档段落 + 架构决策表
  - `plan.md`：新增 `- [x] 卖家商品草稿系统（2026-04-24）` 条目

- [ ] **T9. Explore Agent 代码审查**
  - 启动 `subagent_type: Explore` Agent，输入 spec + plan + 所有改动文件列表
  - 重点审查：
    - 是否所有可能暴露 DRAFT 的查询都加了排除条件
    - 前端创建页/编辑页的 DRAFT 分支逻辑
    - 数量上限是否在事务内检查（防竞态）
    - draftId URL 持久化是否会在刷新后正确恢复
    - 图片上传 URL 在草稿里是否正确存储
  - 修复 High/Critical；Medium 说明决策；Low 记录可缓

---

## 验收清单（实施完成后）

- [ ] 卖家新建商品填标题 → 保存草稿 → 刷新 → 表单内容恢复 → 继续编辑 → 提交审核成功
- [ ] 保存 5 份草稿 → 第 6 份报错 + 按钮禁用
- [ ] 填入所有必填字段但不提交 → 30 秒后看到"最后保存于"时间更新
- [ ] 列表页草稿 tab 只显示草稿，统计卡"商品总数"不包含草稿
- [ ] 管理端审核列表不出现任何草稿
- [ ] 买家端商品搜索/feed 不出现任何草稿（已天然排除，只需人工确认）
- [ ] 草稿提交失败（如标题为空）时返回字段级错误，用户能看到是哪个字段有问题
- [ ] `cd backend && npm run build` + `npm test -- seller-products` 全绿
- [ ] `cd seller && npx tsc -b` 无错

---

## 回滚预案

- 数据库无 schema 变更 → 无需 migration 回滚
- Service/Controller/前端全部由单个 PR 合入 → `git revert` 即可
- 如发现草稿意外出现在审核队列/买家端/统计中 → 紧急 SQL `UPDATE "Product" SET status='INACTIVE' WHERE status='DRAFT'`（不会误伤）后再 revert
