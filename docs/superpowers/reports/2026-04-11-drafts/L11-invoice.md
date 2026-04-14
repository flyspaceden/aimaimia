# L11 — 发票申请链路审查（Tier 2 简版）

**审查日期**: 2026-04-11
**审查类型**: Tier 2 / A 档简版
**权威文档**: `docs/features/invoice.md`（Phase 1-4 全部完成 ✅ 声称状态）
**总体结论**: **后端管理端链路完整可用，买家 App 侧订单入口缺失 — 功能未贯通**。Tier 2，不阻塞 v1.0 上线，但发布前需补订单详情页的"申请发票"入口，否则用户无法从订单发起申请。

---

## 🚨 必答首问

### Q1：Invoice / InvoiceProfile 模型是否在 schema.prisma？字段完整吗？
✅ **已存在，字段完整**。`backend/prisma/schema.prisma:1610-1641`
- `InvoiceProfile`: id/userId/type/title/taxNo/email/phone/bankInfo(Json)/address/timestamps，`@@index([userId])`
- `Invoice`: id/orderId(@unique)/profileSnapshot(Json)/status/invoiceNo/pdfUrl/**failReason**/issuedAt/timestamps，`@@index([status])`
- 枚举 `InvoiceType {PERSONAL, COMPANY}` / `InvoiceStatus {REQUESTED, ISSUED, FAILED, CANCELED}` 完整
- 相对 invoice.md 文档**多了 `failReason String?` 字段**（文档未更新，但代码使用到位）

### Q2：backend/src/modules/invoice/ 目录是否存在？有几个文件？
✅ **存在且实现**。两套独立模块：

**A. 买家端** `backend/src/modules/invoice/`（3 代码文件 + 3 DTO）
- `invoice.module.ts` / `invoice.controller.ts`(99 行) / `invoice.service.ts`(218 行)
- `dto/create-invoice-profile.dto.ts` / `update-invoice-profile.dto.ts` / `request-invoice.dto.ts`
- 已在 `app.module.ts:87` 注册

**B. 管理端** `backend/src/modules/admin/invoices/`（3 代码文件 + 1 DTO 文件）
- `admin-invoices.module.ts` / `admin-invoices.controller.ts`(83 行) / `admin-invoices.service.ts`(245 行)
- `dto/admin-invoice.dto.ts`（含 AdminInvoiceQueryDto / IssueInvoiceDto / FailInvoiceDto）

### Q3：前端发票申请页面是否已建？
| 端 | 状态 | 文件 |
|---|---|---|
| 买家 App | ✅ 5 页齐全（但订单入口缺失）| `app/invoices/{index,request,profiles,profiles/edit,[id]}.tsx` |
| 管理后台 | ✅ 2 页齐全 | `admin/src/pages/invoices/{index,detail}.tsx` + `admin/src/api/invoices.ts` |
| 卖家后台 | ✅ 只读显示 | `seller/src/pages/orders/detail.tsx:385-390` — 订单详情展示 invoiceStatus，无抬头详情（符合隐私保护） |

### Q4：是否集成第三方电子发票服务（诺诺/百望云/自建）？
❌ **未集成，亦不打算集成**（invoice.md 第六章明确排除）。
当前方案：管理员人工录入 `invoiceNo` + `pdfUrl`（由管理员手动去税务系统开完票后回填 URL）。与支付/AI 等模块一致的占位策略，可接受。

---

## 关键验证点

### V1. Invoice 数据模型完整性 ✅
- 订单关联 `orderId @unique` 强约束一单一票 — 正确
- `profileSnapshot: Json` 申请时快照，抬头后续修改不影响已申请发票 — 正确
- `failReason` 字段补充到位，管理端 `failInvoice()` 正确写入 — 正确

### V2. 开票信息字段 ✅
`CreateInvoiceProfileDto` 校验完整（`dto/create-invoice-profile.dto.ts`）：
- `type` IsEnum、`title` 2-100、`taxNo` 企业必填 + `/^[A-Z0-9]{15,20}$/` 正则、`email` IsEmail、`phone` `/^1\d{10}$/`
- `bankInfo` IsObject（但**未校验子字段结构**，建议加 `@ValidateNested` + 子 DTO，Low 级）
- `address` MaxLength(500)

### V3. 订单关联（一对多 Invoice → OrderItem）⚠️
- invoice.md 标题列 "一对多 Invoice → OrderItem" 的说法实际是**一对一 Invoice → Order**（整单开票），**不支持按商品行部分开票**
- 实现与决策一致：整单 `totalAmount` 作为发票金额。**没有按行开票、也没有按部分退款后的应开票金额扣减**（见 V7）
- Tier 2 场景下整单开票合理，可接受

### V4. 开票申请流程 ⚠️
**后端完整**：`invoice.service.ts:104 requestInvoice()` 正确校验：
- 订单归属（`order.userId !== userId` → Forbidden）
- 订单状态必须 `RECEIVED`（✅）
- 一单一票幂等检查（查 `order.invoice`）
- 抬头归属校验
- 快照写入（解密后快照，避免读取时再次解密）

**❌ 前端链路断裂（HIGH）**：Grep `app/orders/[id].tsx` 全文无 `invoice/发票` 关键词，订单详情页**完全没有"申请发票"按钮**。结果：
- 买家可以通过 `/invoices/request?orderId=xxx` 深链接访问申请页，但找不到入口
- 侧面证据：`app/invoices/request.tsx:19` 从 `useLocalSearchParams<{orderId}>` 读取，说明入口本应由订单详情跳转而来
- 同样地，买家 App 的"我的中心/个人中心"里没有"我的发票"入口（grep `app/` 未匹配）

### V5. PDF 生成 / 下载 ⚠️
- **不做生成**：管理员人工录入 PDF URL（符合占位策略）
- **下载路径**：买家 App 发票详情页 `app/invoices/[id].tsx` 应该通过 `pdfUrl` 点击下载 — 已读前 30 行未确认，但 InvoiceRepo 已返回 `pdfUrl`，前端常见用 `Linking.openURL()` 处理
- **Low**: 无 PDF 有效性校验（URL 可用性 / 有效期），接入真实开票系统前可暂缓

### V6. 发票状态机 ✅
`admin-invoices.service.ts:174-243` **标杆级实现**：
- `issueInvoice()` / `failInvoice()` **均使用 Serializable 隔离级别 + updateMany CAS**（`where: {id, status: 'REQUESTED'}`）
- 重试机制：`MAX_RETRIES=3`，P2034 错误自动重试 — 符合 CLAUDE.md 的"涉及金额/状态转换必须使用 Serializable"规则
- 状态流转严格：
  - `REQUESTED → ISSUED` (admin issue)
  - `REQUESTED → FAILED` (admin fail)
  - `REQUESTED → CANCELED` (buyer cancelInvoice)
  - 其他状态转换一律拒绝
- `@AuditLog()` 装饰器已挂载，审计完整

**⚠️ Medium 瑕疵**: 买家 `cancelInvoice()` (`invoice.service.ts:151`) **未使用 Serializable/CAS**，只有普通 update。与管理端并发开票之间存在竞态：若管理员刚好 CAS 成功写入 ISSUED，而买家同时读到 REQUESTED 状态并 update 为 CANCELED，可能覆盖 ISSUED 状态。建议改为 `updateMany where {id, status: REQUESTED}` + CAS。

### V7. 金额计算（部分退款后的应开票金额）❌ Medium
- 买家发票详情 `getInvoiceDetail()` 只 select `totalAmount / goodsAmount / shippingFee`
- 管理端 `findById()` 同样
- **未扣减已退款金额**：若订单发生部分退货后再申请发票，开票金额仍按原始 totalAmount，**可能导致发票金额 > 实际成交金额**
- 决策：Tier 2 场景下 invoice.md 未要求此规则，但从**税务合规角度**是潜在问题，建议 v1.1 补
- 缓解：业务规则要求 `status === RECEIVED` 才能申请，已发货退款通常在此之前完成，**实际暴露面有限**

---

## 补充问题与发现

### 🔴 HIGH — 买家 App 订单详情缺少申请发票入口
**位置**: `app/orders/[id].tsx`
**影响**: 用户无法从订单页发起开票申请，整条产品链路"后端通 + 前端页面存在 + 入口断开"
**修复**: 在订单详情页 RECEIVED 状态增加"申请发票"按钮，跳 `/invoices/request?orderId={id}`；已申请显示状态；ISSUED 显示"查看发票"跳 `/invoices/[id]`

### 🔴 HIGH — 买家 App 个人中心缺少"我的发票"入口
**位置**: `app/me.tsx` 或等效个人中心页
**影响**: 即使通过订单成功申请，买家也找不到自己的发票历史列表
**修复**: 个人中心菜单增加一项，跳 `/invoices`

### 🔴 HIGH — 买家订单详情 API 未返回 invoiceStatus
**位置**: `backend/src/modules/order/` — grep 未发现 `invoice?` / `invoiceStatus` 字段被 include 或映射
**对比**: 卖家端 `seller-orders.service.ts:255` 有 `invoiceStatus: order.invoice?.status || null`
**影响**: 即使买家端订单详情页补 UI，也拿不到发票状态来渲染"已申请/已开票"标签
**修复**: `OrdersService.findById` include `invoice: {select: {id, status, invoiceNo, pdfUrl}}` 并映射到返回 DTO

### 🟡 MEDIUM — cancelInvoice 无 Serializable/CAS
见 V6 分析。

### 🟡 MEDIUM — keyword 搜索语义偏差
**位置**: `admin-invoices.service.ts:21-25`
```
where.OR = [
  { invoiceNo: { contains: query.keyword } },
  { order: { id: query.keyword } },   // ← 精确匹配，不是 contains
]
```
- invoice.md 第 3.2 节要求 "关键字搜索（订单号、发票抬头）"
- **实际实现**：搜发票号（contains）+ 订单 ID 精确匹配，**缺了"发票抬头"搜索**
- `profileSnapshot` 是 Json 字段，若要按 `profileSnapshot.title` 搜索需用 Prisma `path` 查询，略复杂
- 前端列 `title: '关键词'` 存在但后端不能按抬头命中 → 用户搜抬头无结果

### 🟡 MEDIUM — 管理端 findAll 缺 userId/phone 关联查询
**位置**: `admin-invoices.service.ts:47-53` — `user.select` 只取 `profile.nickname`，**缺 phone**
**对比**: 管理端前端 `admin/src/pages/invoices/index.tsx:131-143` 显示 `r.user?.phone`，但后端从未返回
**影响**: 管理端列表买家列永远显示"-"

### 🟢 LOW — DTO 缺失
缺少 `IssueInvoiceDto` / `FailInvoiceDto` 文件在 `backend/src/modules/invoice/dto/`（文档列出但实际未建），而是合并在管理端 `admin/invoices/dto/admin-invoice.dto.ts`。非功能问题，但文档与实现不一致。

### 🟢 LOW — bankInfo 无子字段结构校验
`@IsObject()` 太宽松，建议 `@ValidateNested` + `BankInfoDto {bankName, accountNo}`。

### 🟢 LOW — 订单号搜索不符合常规
`admin-invoices.service.ts:24` `order: {id: query.keyword}` — Order 表用 cuid 主键，用户侧"订单号"习惯输入部分 ID，contains 搜索体验更好。

---

## 完成度评估

| 维度 | 完成度 | 说明 |
|---|---|---|
| Schema | 100% | 完整，含 failReason |
| 后端买家端 Service/Controller | 95% | cancelInvoice 无 CAS |
| 后端管理端 Service/Controller | 90% | keyword 不覆盖抬头、user.phone 未返回 |
| 买家 App 独立页面 | 100% | 5 页齐全 |
| 买家 App 集成入口 | **0%** | 订单详情 + 个人中心入口缺失，订单 API 未返 invoiceStatus |
| 管理后台 | 95% | 功能通，字段映射小瑕疵 |
| 卖家后台只读 | 100% | 符合隐私保护设计 |
| 种子权限 | 100% | `invoices:read` / `invoices:issue` 在 seed.ts:1333-1334 |
| 并发安全 | 80% | 管理端满分，买家取消待加 CAS |

**整体完成度**: **~85%**。功能骨架和核心业务逻辑已完成，**买家侧的"最后一公里"入口集成缺失**，导致实际不可用。

---

## 发布建议（Tier 2）

### v1.0 前必须修复（HIGH，阻塞真实业务）
1. 订单详情页 `app/orders/[id].tsx` 增加"申请发票/查看发票"区块
2. 买家订单详情 API 补 `invoice` include 并返回 `{id, status, invoiceNo, pdfUrl}`
3. 个人中心增加"我的发票"入口

> 如果这三项来不及，**可将 L11 从 v1.0 完全下线**（UI 入口全部隐藏），作为 v1.1 功能。对核心交易链路无影响。

### v1.1 补强（Medium）
4. `cancelInvoice()` 改为 CAS + Serializable
5. 管理端 keyword 支持按抬头 title 搜索（Prisma Json path）
6. 管理端 findAll 补 user.phone select
7. 部分退款后的应开票金额计算（如业务需要）

### v1.2+（Low）
8. 补独立 DTO 文件 / 细化 bankInfo 校验 / 订单号 contains 搜索
9. 如接入真实税务系统，重写 issueInvoice 为异步开票回调模式

---

**审查者**: Claude (Opus 4.6, L11 subagent)
**只读确认**: 未修改任何项目代码，仅写入本报告文件
