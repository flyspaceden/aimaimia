# conflict1.md

更新时间：2026-02-28（第二版，需求确认后全面重评）
范围：后端全端（买家端 + 管理端 + 卖家端）
目标：基于代码审查 + 需求确认后的完整冲突清单与修复排程。

## 1) 来源说明

- 来源 A：《后端全面逻辑审查报告》（C1~C5 / H1~H13 / M1~M13 / L1~L12）。
- 来源 B：[普通用户分润后端问题.md](./普通用户分润后端问题.md) 历史问题（9 条 + 1 条兼容性风险）。
- 来源 C（新增）：2026-02-28 深度代码审查 — 管理员视角新发现（NEW-A1~A5）。
- 来源 D（新增）：2026-02-28 卖家端全面审查（NEW-S1~S10）。
- 来源 E（新增）：需求确认后引入的架构级新问题（NEW-R1~R7）。

状态口径：
- 存在：当前代码中仍真实存在，需修复。
- 部分成立：问题点存在，但有部分防线抵消。
- 已修复/不成立：当前代码已修或与现状不符。
- 按设计：经需求确认，当前行为符合预期，不修改。
- 失效：因需求变更，原问题场景不再存在。
- 降级：原严重度因批量编辑模式等新方案降低。

---

## 2) 已确认的核心需求变更（影响评估基准）

以下需求经产品确认，直接影响本清单中多个条目的评估：

| # | 需求变更 | 影响范围 |
|---|---------|---------|
| R1 | **付款后才创建订单**（架构级重构）：无 PENDING_PAYMENT 状态，库存在支付成功后扣减 | H3 失效、M9 重评、整个订单模块重构 |
| R2 | **奖品不可退**：清空购物车删除奖品是预期行为，奖品从购物车消失即永久丢失 | H4 按设计、H12 按设计、L9 按设计 |
| R3 | **wonCount 永不回退**：过期/删除/取消均不减 wonCount | H12 按设计 |
| R4 | **不公布概率**：用户 API 不应暴露 probability 字段 | M11 升为 High |
| R5 | **批量编辑模式**：管理员一次性调整所有概率，提交时才校验 100% | H1/H2 降级 |
| R6 | **门槛赠品锁定**（新功能）：THRESHOLD_GIFT 入购物车时为锁定状态，按勾选商品金额实时解锁 | H5 升为 Critical、M3 升为 High |
| R7 | **奖品过期机制**（新功能）：可配置过期时间，从入购物车起算 | M8 升为 Critical |
| R8 | **奖励过期可配置**：VIP/普通分别设定，替换 30 天硬编码 | M13 升为 High |
| R9 | **平台归账必须有记录**：VIP/普通奖励归平台均需 RewardLedger 记录 | H6 升为 Critical |
| R10 | **平台公司"爱买买app"**：所有奖品商品（低价购买+赠品）归属平台公司 | 新增 NEW-R6/R7 |
| R11 | **奖品数量固定**：用户不可更改，后台设定 | 强化 C5 DTO 校验需求 |
| R12 | **超卖容忍**：允许负库存，卖家补货 | 影响订单流程设计 |

---

## 3) 来源 A 全面重评

### 3.1 Critical

| 编号 | 问题 | 旧状态 | 新状态 | 变更原因 | 文件位置 |
|------|------|--------|--------|---------|---------|
| C1 | 奖品重复使用检查在事务外（TOCTOU） | 部分成立 | **部分成立**（维持） | DB 唯一索引兜底有效，但新订单流程下需移入统一事务 | `order.service.ts:563-569` |
| C2 | OrderItem.prizeRecordId 无唯一约束 | 已修复 | **已修复**（维持） | 迁移 20260228140000 已建立 partial unique index | `migrations/20260228140000/` |
| C3 | CartItem.prizeRecordId 无唯一约束 | 存在 | **存在**（维持，锁定功能依赖此约束） | 赠品锁定机制（R6）依赖此约束，不修则锁定状态可能出现重复项 | `schema.prisma:1030-1041` |
| C4 | syncLotteryEnabled 永远传 true | 部分成立 | **降级为 Medium** | 批量编辑模式（R5）减少单条操作频率，admin/config 仍可单独关闭 | `admin-lottery.service.ts:96,152,172,239` |
| C5 | Admin updatePrize Mass Assignment | 存在 | **存在**（维持 Critical） | R11 奖品数量固定使 prizeQuantity 成为安全敏感字段 | `admin-lottery.controller.ts:52,79` + `service:148` |

### 3.2 High

| 编号 | 问题 | 旧状态 | 新状态 | 变更原因 | 文件位置 |
|------|------|--------|--------|---------|---------|
| H1 | createPrize 配置死锁 | 存在 | **降级为 Medium** | R5 批量编辑模式已存在（`batchUpdateProbabilities`），可绕过单条死锁 | `admin-lottery.service.ts:44-102` |
| H2 | deletePrize 基本不可成功 | 存在 | **降级为 Medium** | 同 H1，通过批量模式先调概率再删除 | `admin-lottery.service.ts:160-179` |
| H3 | 订单取消后奖品永久丢失 | 存在 | **失效** | R1 付款后才建订单，不存在"取消未付款订单"场景 | ~~`order.service.ts:1337-1397`~~ |
| H4 | clearCart 删除所有项目包括奖品 | 存在 | **按设计** | R2 确认清空购物车删奖品是预期行为 | `cart.service.ts:142-149` |
| H5 | 购物车返回 SKU 原价而非奖品价 | 存在 | **升为 Critical** | R6 锁定状态依赖正确价格计算，用户端需显示奖品价+原价划线 | `cart.service.ts:160-180` |
| H6 | VIP no_ancestor 时 rewardPool 丢失 | 存在 | **升为 Critical** | R9 明确要求归平台必须有记账记录 | `vip-upstream.service.ts:73-89` |
| H7 | frozenAt 写入后未参与引擎判定 | 存在 | **存在**（维持 High） | — | `bonus-allocation.service.ts:481-518` |
| H8 | VIP 分配比例未校验 | 存在 | **存在**（维持 High） | 普通用户比例有 sum=1.0 校验，VIP 无 | `bonus-config.service.ts:218-236` |
| H9 | 奖品 type 可被改坏 | 存在 | **存在**（维持 High） | C5 放大，R10 平台公司要求更严格的类型约束 | `admin-lottery.service.ts:44-102` |
| H10 | 管理员事务隔离级别与用户端冲突 | 部分成立 | **部分成立**（维持） | 新订单流程下事务更重，冲突概率上升 | `admin-bonus.service.ts:76-117` |
| H11 | 管理员抽奖 API 缺 DTO 校验 | 存在 | **存在**（维持 High） | create/update/batch 三个端点全是 `@Body() dto: any` | `admin-lottery.controller.ts:44-95` |
| H12 | wonCount 只增不减 | 存在 | **按设计** | R3 确认 wonCount 永不回退 | — |
| H13 | approveWithdraw 缺 frozen CAS | 存在 | **存在**（维持 High） | 对比 `bonus-allocation.service.ts:373` 有正确 CAS 模式 | `admin-bonus.service.ts:102-105` |

### 3.3 Medium

| 编号 | 问题 | 旧状态 | 新状态 | 变更原因 | 文件位置 |
|------|------|--------|--------|---------|---------|
| M1 | LotteryRecord 缺生命周期状态 | 存在 | **升为 High** | 奖品过期机制（R7）需要追踪 WON→IN_CART→EXPIRED→CONSUMED | `schema.prisma:1726-1739` |
| M2 | 抽奖接口无限流保护 | 已修复 | **已修复**（维持） | 全局 Throttler 60req/min 已启用 | `app.module.ts:38-44` |
| M3 | THRESHOLD_GIFT 门槛按整单跨公司计算 | 存在 | **升为 High** | R6 锁定状态按"勾选商品金额"计算，需改为 selectedItemIds 驱动 | `order.service.ts:612-632` |
| M4 | VIP 升级后普通树节点死区 | 设计取舍 | **设计取舍**（维持） | — | — |
| M5 | VIP 无祖先时 selfPurchaseCount 仍递增 | 存在 | **存在**（维持 Medium） | — | `vip-upstream.service.ts:50-81` |
| M6 | ensureNormalTreeEnrollment 缺 VIP 防御 | 存在 | **存在**（维持 Medium） | — | `bonus-allocation.service.ts:740-761` |
| M7 | ensureCart 首次并发创建竞态 | 存在 | **存在**（维持 Medium） | TOCTOU，无 upsert/P2002 重试 | `cart.service.ts:151-158` |
| M8 | 奖品购物车项无过期机制 | 存在 | **升为 Critical** | R7 明确要求可配置过期，需新增 expiresAt + 定时清理 | `schema.prisma` CartItem 无 expiresAt |
| M9 | 下单后普通购物车项未清除 | 存在 | **存在（需随订单流程重构处理）** | R1 新流程下需在支付回调中统一清理 | `order.service.ts:871-876` |
| M10 | lotteryEnabled 默认 true | 按设计 | **按设计**（维持） | — | `bonus-config.service.ts:112` |
| M11 | 用户 API 暴露奖品概率 | 存在 | **升为 High** | R4 确认不公布概率 | `lottery.service.ts:267` |
| M12 | VIP 升级窄窗口双重分配 | 已修复 | **已修复**（维持） | Serializable 隔离保护 | — |
| M13 | 奖励可用列表硬编码 30 天 | 存在 | **升为 High** | R8 确认需可配置，VIP/普通分别设定 | `bonus.service.ts:412` + `order.service.ts:730` |

### 3.4 Low

| 编号 | 问题 | 旧状态 | 新状态 | 文件位置 |
|------|------|--------|--------|---------|
| L1 | Math.random 非密码学安全 | 存在 | **存在**（维持） | `lottery.service.ts:69` |
| L2 | 60s 本地缓存无跨进程失效 | 存在 | **存在**（维持） | `bonus-config.service.ts:122-137` |
| L3 | checkExit 在事务外 | 存在 | **存在**（维持） | `bonus-allocation.service.ts:262-267` |
| L4 | 旧冻结奖励按 max(vipDays, normalDays) | 存在 | **存在**（维持） | `freeze-expire.service.ts:40` |
| L5 | 解锁查询先全量拉取再内存过滤 | 存在 | **存在**（维持） | `vip-upstream.service.ts:224-237` |
| L6 | referralCode 碰撞无重试 | 存在 | **存在**（维持） | `bonus.service.ts:928-935` |
| L7 | create/update 事务外预校验 TOCTOU | 存在 | **存在**（维持） | `cart.service.ts:38-46` |
| L8 | 概率浮点精度累积 | 存在 | **存在**（维持） | `lottery.service.ts:60-66` |
| L9 | removePrizeItem 永久删除无恢复 | 存在 | **按设计** | R2 确认奖品删除不可恢复 |
| L10 | updateItemQuantity 库存检查无事务保护 | 存在 | **存在**（维持） | `cart.service.ts:93-112` |
| L11 | addItem SKU 查询在事务外 | 存在 | **存在**（维持） | `cart.service.ts:38-45` |
| L12 | 购物车端点无 class-validator DTO | 存在 | **存在**（维持） | `cart.controller.ts:14-29` |

---

## 4) 来源 B（历史问题）当前状态

全部维持原判，无变更：

- B1~B8：**已修复/不成立**。
- B9：**部分修复**（管理端概率配置流程仍有 H1/H2 级运营死锁，已降级为 Medium）。
- B10：**已修复/不成立**。

---

## 5) 来源 C — 管理端新发现（2026-02-28 深度审查）

| 编号 | 严重度 | 问题 | 说明 | 文件位置 |
|------|--------|------|------|---------|
| NEW-A1 | **Critical** | AuditLog modelMap 不含 LotteryPrize | 奖品操作审计日志 before/after/diff 全为 null，无法追踪概率变更 | `audit-log.interceptor.ts:114-124` |
| NEW-A2 | **High** | rejectWithdraw 同样缺 frozen CAS | 与 H13 同类：拒绝提现时 `frozen decrement` 无 `gte` 保护 | `admin-bonus.service.ts:673-728` |
| NEW-A3 | **High** | UpdateConfigDto value 字段无类型校验 | `value: any` 无装饰器，管理员可把布尔配置设为字符串或数字 | `admin-config.dto.ts:4` |
| NEW-A4 | **Medium** | 配置回滚 deleteMany 后恢复快照可能丢失新增 key | 快照不含后续新增的配置项，回滚后这些项永久消失 | `admin-config.service.ts:102-140` |
| NEW-A5 | **Medium** | createPrize vs updatePrize 概率校验阈值不一致 | create 允许 `> 100.01` 才拒绝，update 允许 `> 100` 就拒绝 | `admin-lottery.service.ts:59 vs :127` |

---

## 6) 来源 D — 卖家端全面审查（2026-02-28）

**数据隔离评估：通过** — 所有查询均通过 `@CurrentSeller('companyId')` 过滤，无跨公司数据泄露。
**认证授权评估：通过** — 所有端点正确使用 `SellerAuthGuard + SellerRoleGuard`，无角色提权漏洞。

| 编号 | 严重度 | 问题 | 说明 | 文件位置 |
|------|--------|------|------|---------|
| NEW-S1 | **Critical** | 退款审批库存恢复缺 Serializable | 并发退款可导致库存增量丢失 | `seller-refunds.service.ts:158-207` |
| NEW-S2 | **High** | 发货操作缺 Serializable | 与买家取消/退款并发冲突可致状态不一致 | `seller-orders.service.ts:139-171` |
| NEW-S3 | **High** | 换货审批/拒绝无事务包裹 | 并发操作可导致双重审批 | `seller-replacements.service.ts:85-117` |
| NEW-S4 | **High** | 商品创建时 markupRate 在事务外获取 | 管理员中途改价可致商品定价错误 | `seller-products.service.ts:84-157` |
| NEW-S5 | **High** | OWNER 角色保护仅在业务层 | 缺数据库级约束，并发删除可致公司无 OWNER | `seller-company.service.ts:147-172` |
| NEW-S6 | **Medium** | JSON 字段（contact, meta）无大小/结构校验 | 可提交超大 JSON 导致数据库膨胀 | 多个卖家 DTO 文件 |
| NEW-S7 | **Medium** | 快递单号无长度校验 | 接受任意长度字符串 | `seller-orders.dto.ts:5-17` |
| NEW-S8 | **Medium** | 分析接口缺专用限流 | 全局 120req/min 对 SQL 密集的分析查询不够 | `seller-analytics.controller.ts` |
| NEW-S9 | **Low** | 卖家写操作缺 @AuditLog 装饰器 | 无法追踪卖家数据变更 | 全部卖家 controller |
| NEW-S10 | **Low** | 隐私遮蔽不一致 | addressSnapshot 和 addressMasked 同时返回 | `seller-orders.service.ts:50-66` |

---

## 7) 来源 E — 需求变更引入的架构级新问题

| 编号 | 严重度 | 问题 | 说明 |
|------|--------|------|------|
| NEW-R1 | **Critical** | 订单流程重构：现有 PENDING_PAYMENT 基础设施变为死代码 | 过期清理、库存预扣、奖励预锁、支付到达已取消订单等逻辑全部需重做 |
| NEW-R2 | **Critical** | 购物车缺少"勾选"概念 | 赠品锁定按勾选金额计算，CartItem 无 isSelected 字段 |
| NEW-R3 | **Critical** | 支付流程需要 CheckoutSession 中间态 | 付款前的结算数据（地址、奖励、选品快照）需临时存储 |
| NEW-R4 | **High** | 奖品过期定时清理任务不存在 | 需新增定时扫描 + 访问时检查混合机制 |
| NEW-R5 | **High** | 付款前检查库存与付款后扣库存间的新竞态窗口 | 支付处理期间库存可能被其他订单消耗 |
| NEW-R6 | **Medium** | 平台公司种子数据需更新 | 当前叫"爱买买平台自营"，需改为"爱买买app" |
| NEW-R7 | **Medium** | 奖励商品需从普通用户商品搜索结果中排除 | 奖品商品不应出现在常规商品浏览中 |

---

## 8) 去重后修复主清单（按优先级排序）

### P0 — 立即修复（安全 + 资金 + 阻塞新功能）

| # | 编号 | 问题 | 修复方案 |
|---|------|------|---------|
| 1 | C5/H11/H9 | 管理端 DTO 白名单化 + 业务约束校验 | 创建 `CreateLotteryPrizeDto`/`UpdateLotteryPrizeDto` 含 class-validator 装饰器，移除 `as any`。NO_PRIZE 强制 productId/skuId 为 null |
| 2 | H6 | VIP rewardPool 归平台必须有记账记录 | `vip-upstream.service.ts` 的 no_ancestor/system-root 路径增加 `creditToPlatform()` 调用，对齐 `normal-upstream.service.ts` 已有模式 |
| 3 | H13 + NEW-A2 | 提现审批/拒绝 frozen CAS | `approveWithdraw` 和 `rejectWithdraw` 的 frozen decrement 改为 `updateMany where: { frozen: { gte: amount } }` |
| 4 | C3 | CartItem.prizeRecordId 唯一约束 | 新增 partial unique index（prizeRecordId 非空时唯一），迁移前清理脏数据 |
| 5 | NEW-A1 | AuditLog modelMap 补 LotteryPrize | `audit-log.interceptor.ts` modelMap 增加 `LotteryPrize: 'lotteryPrize'` |
| 6 | NEW-S1 | 卖家退款审批加 Serializable | `seller-refunds.service.ts` 事务增加 `isolationLevel: Serializable` |

### P1 — 高优（业务逻辑正确性）

| # | 编号 | 问题 | 修复方案 |
|---|------|------|---------|
| 7 | H5 | 购物车返回奖品价（非原价） | `mapCartItem()` 读取 `LotteryRecord.meta.prizePrice`，返回 prizePrice + originalPrice + isLocked + threshold |
| 8 | M11 | 移除用户 API 中的概率字段 | `lottery.service.ts` getPrizes() 的 select 移除 `probability: true` |
| 9 | M13 | 奖励过期天数改为可配置 | 新增 `VIP_REWARD_EXPIRY_DAYS`/`NORMAL_REWARD_EXPIRY_DAYS` 配置项，替换两处硬编码 30 天 |
| 10 | M1 | LotteryRecord 增加生命周期状态 | 新增 `status` 枚举：WON → IN_CART → EXPIRED → CONSUMED |
| 11 | M3 | 门槛计算改为按勾选商品 | 接收 `selectedItemIds` 参数，仅按勾选的非奖品商品计算门槛 |
| 12 | H8 | VIP 分配比例 sum 校验 | `bonus-config.service.ts` 增加 VIP 比例 sum=1.0 校验（对齐已有的普通用户校验） |
| 13 | NEW-A3 | UpdateConfigDto value 类型校验 | 按配置 key 定义 value schema，拒绝不合法类型 |
| 14 | NEW-S2/S3/S4 | 卖家端事务隔离级别修复 | 发货/换货审批/商品创建均加 Serializable + markupRate 移入事务内 |

### P2 — 新功能实现（按依赖顺序）

| 顺序 | 功能 | 复杂度 | 依赖 | 详见 |
|------|------|--------|------|------|
| F5 | 奖励过期可配置 | 低 | 无 | `new-features-design.md` §5 |
| F4 | 平台公司"爱买买app"设置 | 低 | 无 | `new-features-design.md` §4 |
| F2 | 赠品锁定机制 | 中 | F4 | `new-features-design.md` §2 |
| F3 | 奖品过期机制 | 中 | F2（共享 CartItem schema 变更） | `new-features-design.md` §3 |
| F1 | 订单流程重构（付款后建单） | 高 | F2 + F3（结算需处理锁定+过期） | `new-features-design.md` §1 |

### P3 — 中低优

| # | 编号 | 问题 | 修复方案 |
|---|------|------|---------|
| 15 | H7/M6 | frozenAt 引擎判定 + VIP 入树防御 | `determineRouting` 检查 frozenAt，`ensureNormalTreeEnrollment` 增加 VIP 判断 |
| 16 | H1/H2 | 奖池配置流程优化 | 允许 createPrize 以 probability=0 创建，deletePrize 允许不检 sum=100% 但自动禁用抽奖 |
| 17 | C4 | syncLotteryEnabled 逻辑优化 | 删除所有活跃奖品后自动传 false |
| 18 | C1 | 奖品重复使用 TOCTOU | 新订单流程中将 prize 校验移入 Serializable 统一事务 |
| 19 | M7 | ensureCart 并发竞态 | 改为 upsert 或 P2002 重试 |
| 20 | M9 | 下单后购物车清理 | 随 F1 订单流程重构统一处理 |
| 21 | NEW-A4 | 配置回滚丢失新 key | 回滚前检查快照包含所有当前必要 key |
| 22 | NEW-A5 | 概率校验阈值不一致 | 统一为 `Math.abs(sum - 100) > 0.01` |
| 23 | NEW-S5 | OWNER 角色数据库约束 | 增加 partial unique index `@@unique([companyId]) where role = 'OWNER'` |
| 24 | NEW-R6/R7 | 平台公司种子数据 + 商品隔离 | 种子数据改名 + 用户商品搜索排除 `isPlatform` |
| 25 | L1-L8,L10-L12 | 低优问题 | 逐步修复 |
| 26 | NEW-S6-S10 | 卖家端中低优问题 | JSON 校验、快递单号长度、限流、审计日志、隐私遮蔽 |

---

## 9) 统计总览

| 类别 | 合计 | Critical | High | Medium | Low | 按设计/失效 |
|------|------|----------|------|--------|-----|------------|
| 来源 A 原始条目 | 43 | 5 | 13 | 13 | 12 | — |
| 重评后按设计/失效 | -5 | — | -3(H3/H4/H12) | — | -1(L9) | +5 → 按设计/失效 |
| 重评后升级 | +0 | +2(H5↑,M8↑) | +3(M1↑,M3↑,M11↑,M13↑) | — | — | — |
| 重评后降级 | +0 | -1(C4↓) | -2(H1↓,H2↓) | +3(C4↓,H1↓,H2↓) | — | — |
| 管理端新发现 | 5 | 1 | 2 | 2 | 0 | — |
| 卖家端新发现 | 10 | 1 | 4 | 3 | 2 | — |
| 需求引入新问题 | 7 | 3 | 2 | 2 | 0 | — |
| **当前待处理总计** | **55** | **11** | **17** | **17** | **13** | **5（不计入）** |

---

## 10) 备注

- 本文档是"冲突汇总与去重视图 v2"，基于 2026-02-28 代码审查 + 产品需求确认。
- 覆盖范围：后端买家端、管理端、卖家端。前端尚未开发，不在本清单范围。
- 新功能设计方案详见 `new-features-design.md`。
- 对于"按设计"类项（H4/H12/L9/M4/M10），已在产品需求中明确确认，不作缺陷处理。
- P0 条目应在任何新功能开发前完成，因其涉及数据安全和资金正确性。
