# L17 溯源管理链路审查报告（B 档）

**审查日期**: 2026-04-11
**审查范围**: 溯源批次管理（卖家创建 → 商品关联 → 买家查看 → 管理端 CRUD）
**审查方法**: 只读源码审查 + Schema/API/前端三端交叉对齐

---

## 一、审查对象

| 层 | 路径 |
|---|---|
| Schema | `backend/prisma/schema.prisma` (L160-168 enum / L1218-1264 models) |
| 公开端 | `backend/src/modules/trace/{controller,service,module}.ts` |
| 卖家端 | `backend/src/modules/seller/trace/{controller,service,dto,module}.ts` |
| 管理端 | `backend/src/modules/admin/trace/{controller,service,dto,module}.ts` |
| 买家 App | `app/ai/trace.tsx`, `src/repos/TraceRepo.ts`, `src/types/domain/Trace.ts` |
| 卖家后台 | `seller/src/pages/trace/index.tsx`, `seller/src/api/trace.ts` |
| 管理后台 | `admin/src/pages/trace/index.tsx`, `admin/src/api/trace.ts` |

---

## 二、关键验证点结果

### 1. TraceBatch 数据模型

Schema 实际字段（`schema.prisma:1218-1231`）：
```
id, companyId, batchCode @unique, ownershipClaimId?, meta Json?, createdAt
+ 关系: events[], productTraceLinks[], orderItemTraceLinks[]
```

**不存在** `productId` / `stage` / `status` / `verifiedAt` 等字段。TraceBatch 与商品是"多对多"（通过 `ProductTraceLink`），与企业是"多对一"。

### 2. 卖家创建批次 — OK

`SellerTraceService.create()` 使用 `@CurrentSeller('companyId')` 强制绑定 companyId，DTO 只接受 `batchCode + meta`，防止跨商户伪造。审计日志 `SellerAudit` 装饰器已配置。

### 3. 商品关联溯源 — **High：功能缺失**

卖家端、管理端 **都没有** `ProductTraceLink` 的创建/解除 API。搜索 `productTraceLink.create` 全仓 0 命中。结果：
- 卖家新建批次后无法将其绑定到自己的商品。
- 买家端 `GET /trace/product/:productId` 永远返回 `batches: []`。
- 前端 `seller/src/pages/trace/index.tsx` 列表列显示"关联商品 0"但没有任何管理入口。
- 管理端同样缺失，只有 `include: productTraceLinks` 的只读展示。

### 4. 买家查看时间轴 — Partial

`app/ai/trace.tsx` 走的是 **`AiFeatureRepo.getTraceOverview`**（Mock 的 AI 接口），**不是** `TraceRepo.getProductTrace`。真实的 `TraceRepo` 虽然后端已实现，但买家 App 没有任何页面消费它。
- `/trace/product/:productId` 后端返回 `{productId, productTitle, batches[]}` — 与前端 `ProductTrace` 类型（只有 productId, batches[]）有冗余字段但不冲突。
- `TraceEvent.type` 枚举（FARMING/TESTING/PROCESSING/PACKAGING/WAREHOUSE/SHIPPING/OTHER）与前端 `TraceRepo.ts` mock 里写的 `SEED/PLANT/HARVEST` 不一致（mock 写错，不影响真实数据，但会误导开发）。

### 5. 二维码扫描 — 缺失（可接受）

全仓 `qrcode|扫描|scan` 在 trace 模块 0 命中。后端仅提供 `GET /trace/code?code=xxx` 纯字符串查询（`trace.controller.ts:36`），前端无扫码/生码 UI。B 档范围内可视为 P2。

### 6. OrderTrace `batches[]` 数组格式 — **Medium：语义错误**

`TraceService.getOrderTrace()`（`trace.service.ts:66-74`）:
```ts
items: orderItemLinks.map((link) => ({
  orderItemId: link.orderItem.id,
  batches: [this.mapBatch(link.batch)],  // ← 每个 link 单独一项
}))
```
如果同一个 orderItemId 关联了多个批次（`OrderItemTraceLink` 没有 `@@unique([orderItemId, batchId])`，schema 允许多条），返回结果会出现多个同 orderItemId 项而不是合并 batches 数组。前端类型 `OrderTrace.items[].batches: TraceBatch[]` 预期是合并后的数组。

另外：全仓 **没有任何地方** 在订单创建/发货时写入 `OrderItemTraceLink`（搜索 `orderItemTraceLink.create` 0 命中），所以该接口目前永远返回空。

### 7. 字段对齐 — **High：前端类型与后端不匹配**

`src/types/domain/Trace.ts:10-26` 定义：
```ts
TraceBatch { ..., productId, stage, status, meta, ..., ownershipClaim: { verifiedAt } }
```
后端 Schema 根本没有 `productId / stage / status`，也没有 `OwnershipClaim.verifiedAt`（见 `ClaimType` 枚举与 `OwnershipClaim` 模型 L1208-1216 只有 id/type/data/createdAt）。`TraceService.mapBatch()` 返回时没有这些字段，前端消费会 undefined。Mock 里填了假数据，真实 API 上线后会 NPE / 显示空白。

### 8. 管理端 CRUD — 基本 OK

`AdminTraceController` 提供 list/detail/create/update/delete，权限 `trace:read|create|update|delete`，审计齐全。
- **Low**：`findAll()` 没有按 `batchCode` / 时间范围过滤（前端 `ProTable` 也没开对应筛选）。
- **Low**：`remove()` 未级联检查是否还有 `productTraceLinks` / `orderItemTraceLinks` 引用，直接 `delete`，依赖 Prisma 外键报错而非友好提示。

---

## 三、E2E 场景：卖家创建 → 关联商品 → 买家看到

| 步骤 | 现状 | 阻塞 |
|---|---|---|
| 卖家登录 → 创建批次（批次号 + meta） | OK（`POST /seller/trace`） | — |
| 卖家将批次绑定到商品 | **不可达** | 无 API / 无前端入口 |
| 卖家为批次添加 TraceEvent（种植/采收/检测） | **不可达** | 无事件 API（seller/admin/public 都没有 `POST trace/events`） |
| 买家商品详情进入溯源页 | Mock | `app/ai/trace.tsx` 调 AI mock，未对接 `TraceRepo` |
| 后端返回 `ProductTrace.batches[]` | 空数组 | `ProductTraceLink` 永远无数据 |

**结论**: 端到端链路在"关联商品"这一步就断了。当前只有"批次 CRUD + meta"这一半功能可用。

---

## 四、问题汇总

| 编号 | 级别 | 问题 | 位置 | 建议 |
|---|---|---|---|---|
| L17-H1 | High | 缺失 `ProductTraceLink` CRUD API | seller-trace / admin-trace | 补 `POST/DELETE /seller/trace/:id/products/:productId`，含跨租户校验 |
| L17-H2 | High | 缺失 `TraceEvent` CRUD API | seller-trace / admin-trace | 补 `POST /seller/trace/:id/events`，支持 FARMING/TESTING/... |
| L17-H3 | High | 前端 `TraceBatch` 类型含 `productId/stage/status/ownershipClaim.verifiedAt`，Schema 无对应字段 | `src/types/domain/Trace.ts` | 删除不存在字段，或在 Schema 新增（需确认业务语义） |
| L17-H4 | High | 买家 App 溯源页走 AI mock，未对接 `TraceRepo.getProductTrace` | `app/ai/trace.tsx` | 切换到 `TraceRepo`，保留 AI 评分作为补充层 |
| L17-M1 | Medium | `getOrderTrace` 未按 `orderItemId` 合并 `batches[]` | `trace.service.ts:66-74` | `groupBy` orderItemId 后聚合 batches |
| L17-M2 | Medium | `OrderItemTraceLink` 无任何写入点 | 订单/发货流程 | 发货时根据 SKU 默认批次自动写入，或卖家发货单手动选批次 |
| L17-M3 | Medium | `TraceRepo.ts` mock 使用不存在的 event 类型 `SEED/PLANT/HARVEST` | `src/repos/TraceRepo.ts:26-28` | 改用 `FARMING/PROCESSING/...` 与 Schema 对齐 |
| L17-L1 | Low | 管理端列表无 batchCode/时间过滤 | admin trace 页 + service | 补 `ProTable` 搜索 + service where |
| L17-L2 | Low | 删除批次未先检查关联 | admin/seller trace service | 事务内先 count 关联再决定是否允许删除 |
| L17-L3 | Low | 无二维码扫码/生码 | 全链路 | B 档范围可延后，未来补 `/trace/code?code=` 的前端扫码入口 |
| L17-L4 | Low | `seller-trace.module.ts` 未读，假设已在 `SellerModule` 注册（需额外确认） | seller-trace.module.ts | 建议主 agent 顺手验证 |

---

## 五、结论

**总体评价**: 溯源管理链路在 Schema 和后端 CRUD 层面搭好了骨架，但**业务闭环未完成**。
- 批次可以建、可以改、可以删，这部分三端一致，基本能用。
- **商品关联、事件录入、订单挂钩** 三个核心动作全部缺失 API 与前端入口，实际无法产生可供买家查看的数据。
- 买家 App 当前溯源页用的是 AI Mock，真实后端接口处于"接口在线 / 数据永远为空"状态。
- 前端类型定义有不少字段在 Schema 中根本不存在，上线后会出现渲染空洞。

**建议优先级**: 先修 H1-H2（补完关联/事件 API）→ H3（类型对齐）→ H4（买家 App 切真数据）→ M1-M2（订单链路）→ Low 项延后。
