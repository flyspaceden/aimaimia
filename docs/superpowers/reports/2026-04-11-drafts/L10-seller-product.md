# L10 — 卖家上货 + 商品审核链路审查（B 档简版）

**审查日期**: 2026-04-11
**审查类型**: Tier 2 / B 档
**审查范围**: `backend/src/modules/seller/products/` / `backend/src/modules/admin/products/` / `backend/src/modules/upload/` / `backend/src/modules/product/` / `backend/src/modules/seller/company/` / `seller/src/pages/products/` / `admin/src/pages/products/`
**总体结论**: **上货主链路与审核闭环可用，但存在一个 HIGH 级权限漏洞（OPERATOR 可创建/删除商品）和一个功能缺口（审核通过后不自动上架）**。OSS 真实接通。超卖容忍机制与上货无耦合，但卖家补货通知仍为 TODO。

---

## 🚨 必答首问

### Q1：OSS 是否真的接通？UPLOAD_LOCAL=false 分支是 mock 吗？
✅ **真实接通，不是 mock**。`backend/src/modules/upload/upload.service.ts:7, 45-58, 155-168`
- `import OSS = require('ali-oss')` — 真实 SDK，`backend/package.json:40 "ali-oss": "^6.23.0"`
- `getOssClient()` 懒加载，校验 `OSS_REGION / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET` 四项配置后 `new OSS({...})`
- 上传分支：`await oss.put(key, Buffer.from(finalBuffer))` → 返回 `result.url`
- 删除分支：`await oss.delete(normalizedKey)`
- 签名 URL：`oss.signatureUrl(key, { expires: ttlSec })`
- `.env.example:106, 114-118` UPLOAD_LOCAL / OSS_* 四变量齐备
- 本地模式（默认）也正确实现：`fs.writeFileSync`、HMAC 签名私有 URL、路径遍历防护 `normalizeKey()` / `resolveLocalPath()`
- **额外加固**：Sharp 转码到 WebP 去除 EXIF、图片 magic number 校验、jsQR 二维码检测（`image-content-scanner.service.ts`）

### Q2：超卖容忍与上货流程有关系吗？stock<0 时卖家能收到补货通知吗？
**上货流程本身不感知超卖**。相关机制在 `backend/src/modules/order/checkout.service.ts:1256-1265`：
```ts
const updatedSku = await tx.productSKU.update({
  where: { id: item.skuId },
  data: { stock: { decrement: item.quantity } },
});
if (updatedSku.stock < 0) {
  this.logger.warn(`R12 超卖: skuId=${item.skuId}, currentStock=${updatedSku.stock}`);
  // TODO: 发送卖家补货通知
}
```
- 🔴 **补货通知是 TODO 占位**，只写了一行 warn 日志，卖家完全无感知
- 卖家端无"负库存/补货提醒"页面或通知 Hook — 已确认缺失
- `seller-products.dto.ts:26 stock @Min(0)` 禁止卖家主动把库存填为负，但系统允许在订单处理中 decrement 为负（符合决策）
- 影响：**用户侧决策承诺"卖家收到补货通知，不退款"未兑现**，违约面表现为卖家可能长期不知晓超卖状态

---

## 关键验证点

### V1. 卖家创建商品表单 ✅
`seller/src/pages/products/edit.tsx` 单页式表单，字段齐全：
- 基本信息：标题(maxLength 100) / 副标题 / 分类(TreeSelect 必选) / 退货政策 / 描述(TextArea rows=4) / 产地
- 图片上传：`<Upload action="${API_BASE}/upload?folder=products">` + Bearer token，最多 9 张
- 价格与库存：成本输入 + 自动售价只读展示(`cost × markupRate`) + 库存 + 单笔限购 + 重量
- 多规格开关 `<Switch>`，单规格→多规格可自动迁移第一条数据
- AI 搜索优化：aiKeywords(逗号分隔) + flavorTags/seasonalMonths/usageScenarios/dietaryTags
- 高级设置折叠：副标题、运营标签、自定义属性（key-value 列表）

### V2. 商品字段齐全 ✅（基本）/ ⚠️（一处）
`seller-products.dto.ts` `CreateProductDto` 必填：
- `title` IsNotEmpty / `description` IsNotEmpty / `categoryId` IsNotEmpty / `origin` IsNotEmpty / `skus` `@ArrayMinSize(1)`
- 可选：`subtitle / basePrice / returnPolicy / tagIds / attributes / aiKeywords / mediaUrls / flavorTags / seasonalMonths / usageScenarios / dietaryTags / originRegion`
- ⚠️ **没有 `@MinLength(20)`**：`description` 只写 `@IsString() @IsNotEmpty()`，前端 `rules={[{min: 10}]}`（edit.tsx:678）放得比需求的 "≥20 字" 还低 → 见「补充问题」H2
- ✅ `origin` JSON 结构未严格约束（any 类型），但有 IsNotEmpty 兜底

### V3. OSS 图片上传 ✅
见 Q1。真实 ali-oss SDK。卖家上传走 `POST /api/v1/upload?folder=products`（`edit.tsx:266`），由 `UploadController.uploadFile()` 经 `AnyAuthGuard`（兼容 buyer/admin/seller JWT）路由到 `uploadService.uploadFile()`。

### V4. SKU 管理 ✅
`updateSkus()` 在 Serializable 事务内：
- 用 `id` 区分更新/新建，存量 SKU 不在新列表中的 → 软删除（`status: INACTIVE`），避免打破 OrderItem 外键
- 每个 SKU 重新计算 `autoPrice = cost × markupRate`
- 更新后重新计算 `product.basePrice = min(所有 ACTIVE SKU.price)`

### V5. 自动定价 ✅
`create()` / `updateSkus()` 均在 Serializable 事务内读取 `sysConfig.markupRate`（`service.ts:125, 246, 421, 489`），防 TOCTOU。前端 `edit.tsx:452` 通过 `getMarkupRate()` API 获取实时 `markupRate`，输入成本即展示售价。售价栏 `disabled` 不可改。
- **奖品商品例外**：代码层 `SellerProductsService` 统一走 markup 公式。奖品商品归属平台公司 `isPlatform=true`，理论上通过 `admin-products` 而非 `seller-products` 创建（seller 查询始终 `where.companyId = companyId`，平台公司只能由超级管理员操作）。此决策与 `CLAUDE.md` 一致。

### V6. 商品描述必填 ≥20 字 🟡 **降级为非 T1（2026-04-11 用户决策）**
- `seller-products.dto.ts:48-50` 仅 `@IsString() @IsNotEmpty()`
- `seller/src/pages/products/edit.tsx:678` 前端规则 `{ min: 10 }` — 和需求 20 字都对不上
- 买家 App 搜索依赖 description 做语义召回，低质描述直接影响检索效果
- **用户 2026-04-11 决策**：不作为 T1 阻塞项。v1.0 保持现状（无 MinLength 强制），v1.1 再根据 AI 搜索实际召回质量决定是否补上

### V7. 企业简介必填 ≥20 字 🟡 **降级为非 T1（2026-04-11 用户决策）**
`seller-company.dto.ts:14-16` `UpdateCompanyDto.description` 是 `@IsOptional() @IsString()`，**没有 MinLength 校验**。企业在"企业信息"页可以留空或填 1 个字。管理端也没对企业简介做审核要求。同 V6 降级。

### V8. 溯源批次关联 ❌ MEDIUM
- Grep `traceBatch|TraceBatch|溯源` 在 `backend/src/modules/seller/products/` 无匹配
- Grep 同样在 `seller/src/pages/products/` 无匹配
- `backend/src/modules/seller/trace/` 模块存在（从目录可见），但**与商品上货流程未打通**：创建/编辑商品时无 `traceBatchId` 字段，前端无关联选择器
- Schema 层是否存在 Product↔TraceBatch 关系未确认（本审查仅限范围内），但至少上货/编辑链路上缺失该入口

### V9. 管理端审核队列 Tab 切换 ✅
`admin/src/pages/products/index.tsx:35-41` 五个 Tab：ALL / ACTIVE / INACTIVE / AUDIT_PENDING / AUDIT_REJECTED
- 顶部 5 个 `Statistic` 卡片点击联动 Tab
- 后端 `AdminProductsService.getStats()` 分别 groupBy status / auditStatus 返回计数
- `AUDIT_PENDING` / `AUDIT_REJECTED` 行高亮（黄/红底，`rowClassName`）
- 筛选参数 `auditStatus` 透传到 `GET /admin/products?auditStatus=PENDING`

### V10. 审核通过/驳回 ✅
- `POST /admin/products/:id/audit` `AuditProductDto { auditStatus: 'APPROVED'|'REJECTED', auditNote? }`（H16 修复：已用 DTO 校验替代裸 `@Body`）
- `admin-products.service.ts:223-231 audit()` 正确 update `auditStatus` + `auditNote`
- 前端 `index.tsx:95` Modal 弹窗展示商品摘要 + 备注输入框，通过/拒绝双按钮

### V11. AuditLog 审计链 ✅
`AdminProductsController`:
- `update()` `@AuditLog({action: 'UPDATE', module: 'products', targetType: 'Product', isReversible: true})`
- `toggleStatus()` `@AuditLog({action: 'STATUS_CHANGE', ...})`
- `audit()` `@AuditLog({action: 'APPROVE', ...})`
- `@UseInterceptors(AuditLogInterceptor)` 在 Controller 级生效，before/after 快照写入
- 卖家端 `@UseInterceptors(SellerAuditInterceptor) + @SellerAudit(...)` 对卖家侧的 create/update/toggle/updateSkus 同样有审计

### V12. 审核通过自动上架 ❌ HIGH
- `admin-products.service.ts:223-231 audit()` **只更新 auditStatus，不动 status**
- `seller-products.service.ts:389-403 toggleStatus()` 允许上架但要求 `auditStatus === 'APPROVED'`
- **结果**：管理员审批通过后商品 `status` 仍为 `INACTIVE`，卖家必须手动再去点一次上架开关。与需求"审核通过自动上架"不符。
- 可接受的替代方案：业务决策为"需卖家再次确认上架"，但 CLAUDE.md 与本审查清单明确写了"审核通过自动上架"→ 视为缺口

### V13. 卖家修改后重新提交 ✅
`seller-products.service.ts:264-285 update()`：
```ts
const needReAudit = product.auditStatus === 'APPROVED';
// ...
auditStatus: needReAudit ? 'PENDING' : undefined,
```
- 编辑已审核通过的商品自动回到 PENDING 状态
- 已是 PENDING / REJECTED 的商品编辑不覆盖 auditStatus（REJECTED 状态下再编辑不会自动回 PENDING，需要管理员再审时手动判断 — 轻微瑕疵，可能让被驳回商品"卡住"，见 L1）

### V14. 已下架商品重新提交 ✅
- 卖家下架商品 `status=INACTIVE`，`auditStatus` 保持不变
- 重新编辑时走 V13 路径，APPROVED → PENDING
- `toggleStatus('ACTIVE')` 要求 `auditStatus === APPROVED`，保证未通过审核的下架商品不能直接上架

### V15. 卖家 companyId 过滤 ✅
所有 seller-products 方法签名都以 `companyId` 为第一参数，来自 `@CurrentSeller('companyId')`（注入自 JWT）：
- `findAll()` `where: { companyId }`
- `findById() / update() / toggleStatus() / updateSkus()` 均先 `findUnique` 后 `if (product.companyId !== companyId) throw ForbiddenException`
- 创建时 `companyId` 直接写入 `product.data.companyId`，不从请求体读取

### V16. OWNER/MANAGER 提交权限 ❌ HIGH
- `seller-products.controller.ts:26-104` 每个端点只有 `@UseGuards(SellerAuthGuard, SellerRoleGuard)`
- **完全没有 `@SellerRoles('OWNER', 'MANAGER')` 装饰器**
- `seller-role.guard.ts:32-34`: "无角色要求则放行（只要通过 SellerAuthGuard 即可）"
- **结果**：OPERATOR 角色可以创建商品、编辑商品、修改 SKU、上下架商品。与决策"OWNER/MANAGER 提交权限"冲突
- 对比 `seller-company.controller.ts:39, 50, 62, 70, 82, 90, 111, 123, 131` — 企业/员工端点全都有 `@SellerRoles('OWNER', 'MANAGER')` 或 `@SellerRoles('OWNER')`，唯独商品端点漏掉

### V17. 管理员审核权限 ✅
`admin-products.controller.ts:97-98`:
```ts
@Post(':id/audit')
@RequirePermission('products:audit')
```
- `PermissionGuard` 读取 metadata，通过 AdminUser → Role → Permission 链校验
- 审核按钮 UI 侧 `<PermissionGate permission={PERMISSIONS.PRODUCTS_AUDIT}>` 控制显隐

---

## 补充问题与发现

### 🔴 HIGH H1 — OPERATOR 可创建/修改/删除商品（权限漏洞）
见 V16。影响：企业雇佣的代运营/运营岗通常应只能管订单或运营数据，不应能自行发布商品。修复：`seller-products.controller.ts` 所有写操作端点加 `@SellerRoles('OWNER', 'MANAGER')`（`findAll` / `findById` 读操作可放行给 OPERATOR）。同时加一份守卫单测。

### ~~🔴 HIGH H2~~ → 🟡 **降级为非 T1（2026-04-11 用户决策）**
原标题：商品描述 / 企业简介无 ≥20 字长度校验
见 V6 / V7。用户确认不作为 v1.0 阻塞项。修复动作推迟到 v1.1：
- `seller-products.dto.ts` `CreateProductDto.description` + `UpdateProductDto.description` 加 `@MinLength(20)`
- `seller-company.dto.ts` `UpdateCompanyDto.description` 加 `@MinLength(20)`
- 前端 `seller/src/pages/products/edit.tsx:678` 规则 `min: 10` 改成 `min: 20`
- 前端企业信息页同步加提示

### 🔴 HIGH H3 — 审核通过后不自动上架
见 V12。修复方案 A（推荐）：`admin-products.service.ts:223 audit()` 接收 `APPROVED` 时同时 set `status: 'ACTIVE'`。方案 B（保守）：保留当前行为但向卖家发一条通知"审核通过，请上架"。需要与用户确认决策。

### 🔴 HIGH H4 — 超卖后卖家补货通知未实现
见 Q2。`checkout.service.ts:1264` 仍是 `// TODO: 发送卖家补货通知`。修复：
- 引入 `SellerNotification` / `NotificationLedger` 或复用 `SellerAuditLog`
- 触发点：`updatedSku.stock < 0` 时异步 push 一条"商品 {title} 库存超卖 {abs(stock)} 件，请尽快补货"
- 卖家后台 `seller/src/pages/products/index.tsx` 或 Dashboard 顶部增加一个"超卖告警"入口

### 🟡 MEDIUM M1 — 溯源批次未在上货链路体现
见 V8。Tier 2 场景下可接受，但 CLAUDE.md 项目概述中强调"AI 赋能农业"且溯源是农业电商关键卖点。v1.1 建议补 `traceBatchId` 字段 + 选择器 UI。

### 🟡 MEDIUM M2 — REJECTED 编辑不回 PENDING
V13 中提到：`needReAudit = product.auditStatus === 'APPROVED'`，**只处理 APPROVED**。如果商品是 REJECTED 后被卖家再次修改，auditStatus 仍保持 REJECTED。卖家没有"再次提交审核"的入口，且管理端队列里再也看不到这个商品（待审核 Tab 只查 PENDING）→ 死锁。修复：`needReAudit = product.auditStatus === 'APPROVED' || product.auditStatus === 'REJECTED'`。

### 🟡 MEDIUM M3 — 图片上传无"上传中"保护
前端 `seller/src/pages/products/edit.tsx:364-370` `buildPayload()` 只过滤 `f.status === 'done'`，若卖家未等上传完成就点保存，会丢失上传中的图片但不报错。建议 `onChange` 中禁用保存按钮，或 `handleSave` 开头检查 `fileList.some(f => f.status === 'uploading')` 则阻止提交。

### 🟡 MEDIUM M4 — admin update 商品缺少 SKU 编辑
`admin-products.service.ts:123 update()` 不包含 SKU 操作（成本/库存）。管理端若要手工调整价格或纠错库存，只能直接改数据库。**对奖品商品手动定价尤其关键**（CLAUDE.md 决策：奖品商品管理员手动设价）— 当前路径不通。确认：admin 路由无 `PUT /admin/products/:id/skus`。

### 🟢 LOW L1 — admin products update 未使用 Serializable
`admin-products.service.ts:134` 普通事务。更新语义字段 `attributes` 时理论上存在与 AI 后台填充的并发覆盖。影响面小，v1.1 可补。

### 🟢 LOW L2 — 上传单文件大小/数量限制一致性
`upload.controller.ts:72` 批量上传 `FilesInterceptor('files', 9)`，seller UI 也限制 9 张。但 `UPLOAD_MAX_FILE_SIZE` 从 `upload.constants.ts` 读，前端 UI 硬编码 "10MB"（`edit.tsx:282`），改过常量就脱节。

### 🟢 LOW L3 — description 前端规则与后端 DTO 不一致
前端 `min:10`，后端 `IsNotEmpty`。即便修复 H2，也应考虑把校验规则做成配置下发，而非两边硬编码。

---

## 完成度评估

| 维度 | 完成度 | 说明 |
|---|---|---|
| Schema / Product 模型 | 100% | 字段齐备 |
| 后端 seller-products Service | 85% | 逻辑健全，缺 @SellerRoles |
| 后端 seller-products Controller | 70% | 权限装饰器缺失 |
| 后端 admin-products 审核 | 90% | 不自动上架，REJECTED 编辑死锁 |
| OSS 接入 | 100% | 真实 SDK，双模式完备 |
| 图片安全扫描 | 70% | jsQR 真跑，OCR 仍为 TODO（IMAGE_SCAN_ENABLED 默认 false） |
| 卖家前端创建/编辑页 | 85% | 功能齐全，缺描述长度/上传中保护/溯源 |
| 管理端商品列表/审核 | 95% | Tab/统计/行高亮/审计齐全 |
| 管理端编辑页 | 80% | 无 SKU 编辑入口 |
| 超卖通知 | 0% | TODO 占位 |
| 溯源关联 | 0% | 未接入 |
| 企业简介校验 | 50% | 无长度限制 |

**整体完成度**: **~80%**。主链路可跑，审核闭环成立，但权限漏洞（H1）会被 OPERATOR 角色直接触发，属于必须在 v1.0 前堵上的问题。

---

## 发布建议（Tier 2）

### v1.0 前必须修复（HIGH，阻塞）
1. **H1 权限漏洞**：`seller-products.controller.ts` 所有写操作加 `@SellerRoles('OWNER', 'MANAGER')`（必做）
2. **H3 审核通过自动上架**：与用户确认决策后，在 `admin-products.service.ts audit()` 同步 set `status: ACTIVE`（或明确保留当前行为、补通知替代）
3. ~~**H2 描述长度校验**~~ → 🟡 **降级到 v1.1**（2026-04-11 用户决策）

### v1.0 前强烈建议修复（HIGH 或 Medium 但业务明显）
4. **H4 超卖补货通知**：哪怕先做一个最基础的 SellerNotification 表 + 轮询，也比完全无感好
5. **M2 REJECTED 编辑死锁**：一行代码修复，代价极低
6. **M4 admin 商品 SKU 编辑**：**奖品商品手动定价强依赖**，若 v1.0 要上奖品系统，此项必做

### v1.1 补强（Medium/Low）
7. M1 溯源批次选择器 / M3 上传中保护 / L1 Serializable / L2 上传常量统一 / L3 规则一致性
8. **H2（降级）** 商品描述 + 企业简介 @MinLength(20)——v1.0 不做，v1.1 根据 AI 搜索召回质量决定

### 与 L7（售后）/ L5（分润）/ L3（下单）的联动复核
- L3 结账时超卖路径未走通到卖家 → 与 H4 合并处理
- 奖品商品定价走向：`seller-products` 归口走 markup，奖品走 `admin-products` 手动定价 → M4 一定要在奖品系统上线前修

---

**审查者**: Claude (Opus 4.6, L10 subagent)
**只读确认**: 未修改任何项目代码，仅写入本报告文件
