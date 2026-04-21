# 爱买买 - 开发计划（v1.0 上线冲刺）

> **最后更新**: 2026-04-19
> **维护规则**: 每次修完一项 → 打 ✅ + 填完成日期；每次新增需求 → 追加条目 + 标注来源日期
> **历史记录**: `docs/reference/plan-history-2026Q1.md`（2026-02 至 2026-03 的 Phase 1-10 开发历程）

---

## 🎯 当前目标

| 维度 | 决策 |
|---|---|
| 版本 | v1.0 MVP |
| 范围 | Tier 1 + Tier 2（详见下方批次 + [审查报告 §6/§7](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)） |
| 支付 | 仅支付宝（微信支付推迟 v1.1） |
| 退款 | 必须退回原支付方式（支付宝 API） |
| 快递 | 顺丰丰桥直连（快递100 废弃） |
| 上线节奏 | 阶梯：管理后台 → 卖家后台 + 种子商户 → App 对外 |
| 首批用户 | 500+ |
| 时间 | 无硬 deadline，质量优先 |

---

## 📖 审查基线（2026-04-11）

- **审查报告**: [docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)（1660 行，17 条链路 + 6 项横切关注点）
- **审查方案**: [docs/superpowers/specs/2026-04-11-launch-readiness-audit.md](docs/superpowers/specs/2026-04-11-launch-readiness-audit.md)
- **执行计划**: [docs/superpowers/plans/2026-04-11-launch-readiness-audit.md](docs/superpowers/plans/2026-04-11-launch-readiness-audit.md)
- **链路 draft 目录**: `docs/superpowers/reports/2026-04-11-drafts/`（18 个 draft 文件，按 L01-L17 + X1-X6 编号）
- **累计**: 🔴 14 CRITICAL + 🟡 16 HIGH = **30 个 Tier 1 必修项** + 48 个 Tier 2 待补项

---

## 📐 维护规则（铁律）

1. **每次修完一项**: 立即把对应 `- [ ]` 改为 `- [x]`，填写完成日期，简述实际做了什么（一句话）
2. **每次新增需求**: 在对应批次末尾追加新条目，格式与现有一致，标注 `（YYYY-MM-DD 新增：原因）`
3. **如果新需求改变了批次依赖或顺序**: 整个批次重新校验，更新依赖关系
4. **不在 plan.md 外面单独维护另一份清单**: plan.md 是单一 source of truth
5. **每个批次完成后**: 在批次标题后加 ✅ + 完成日期
6. **修改代码前必须查阅 draft 细节**: plan.md 条目仅为简要摘要，实际修改代码时**必须先打开 `docs/superpowers/reports/2026-04-11-drafts/` 中对应的 draft 文件**，阅读完整的问题描述、代码位置、修复建议后再动手，严禁仅凭 plan.md 的一句话描述就改代码

---

## 🚀 实施路线图

### 第零批：立即启动的线下事项（并行进行，不等代码）

> 这些是用户线下操作，和代码修复完全并行。**ICP 备案 20 个工作日是整个项目的最长阻塞路径**。

- [x] **U01** — 启动域名 ICP 备案
  - **做什么**: ai-maimai.com 的 ICP 备案申请（阿里云备案系统）
  - **现状**: 爱买买.com 已备案完成；ai-maimai.com 备案已通过，主域名正式迁移至英文 ai-maimai.com（中文域名保留做 301 跳转）
  - **周期**: 20 个工作日
  - **交付物**: ai-maimai.com 备案号
  - **状态**: ✅ | 完成日期: 2026-04-17

- [x] **U02** — 申请顺丰月结账号 + 丰桥 API 权限
  - **做什么**: 联系顺丰销售 → 签月结协议 → 拿到 12 位月结号 → 注册丰桥企业认证 → 创建应用 → 审批 5 个 API（下单/查询/推送/取消/面单）
  - **周期**: 3-7 天（月结）+ 1-3 天（丰桥认证）+ 1-3 天（API 审批）
  - **交付物**: 月结号 + clientCode + checkWord + 沙箱 URL
  - **成本**: 5k-20k 元保证金（可退）
  - **状态**: ✅ | 完成日期: 2026-04-11 — 月结卡号 7551253482、丰桥应用已创建、10 个 API 已关联、云打印面单已配置

- [x] **U03** — 核对阿里云 OSS / SMS AccessKey
  - **做什么**: 确认 RAM 子账号 + AccessKey 已创建，OSS Bucket 已建，SMS 签名"爱买买" + 3 个模板（注册/订单/商户审核）已审核通过
  - **交付物**: AK/SK + Bucket 名 + 签名/模板 ID
  - **实际做了**: 阿里云 OSS 和短信服务已开通，详见 `交付包/第三方服务开通指南（操作手册）.md`
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **U04** — 核对支付宝商户号 + 证书
  - **做什么**: 确认 APPID + RSA2 证书四件套（app-private / appCert / alipayCert / alipayRoot）已下载，回调地址配置
  - **周期**: 3-5 天（如尚未申请）
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **U05** — 购买云服务器
  - **做什么**: 阿里云 ECS 华东杭州 4 核 8G 100GB SSD
  - **成本**: 350-500 元/月
  - **状态**: ✅ | 完成日期: 2026-04-13

- [ ] **U06** — Apple 开发者账号 + 安卓应用商店账号
  - **做什么**: Apple Developer Program ($99/年) + 华为/小米/OPPO/vivo/应用宝（各需企业资质）
  - **状态**: ⬜ | 完成日期: —

---

### 第一批：💰 钱链路修复（14 项 CRITICAL）

> **最高优先级**。支付/退款/分润/奖励——关于钱的链路必须先修。
> **串行依赖**: C01 必须先做（阻塞 C02/C04/C06）。其余大部分可并行。

- [x] **C01** — 支付宝退款 API 真实接通
  - **修改**: `backend/src/modules/payment/payment.service.ts` + `payment.module.ts`
  - **做什么**: PaymentService 构造函数注入 AlipayService → initiateRefund() 按 `payment.channel === 'ALIPAY'` 分发到 `alipayService.refund()` → 微信分支 throw NotImplemented
  - **实际做了**: PaymentService 注入 AlipayService，initiateRefund 按 channel 分发到真实退款 API，微信分支 throw NotImplementedException
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C02** — Order 状态闭环（全退后标 REFUNDED）
  - **修改**: `after-sale-reward.service.ts` + 3 个退款完成点（admin/seller/timeout）
  - **做什么**: 退款成功后检查所有非奖品项(isPrize=false)是否都已退 → 是则 Order.status = REFUNDED
  - **实际做了**: 在 AfterSaleRewardService 新增 checkAndMarkOrderRefunded()，在 admin/seller/timeout 三处退款成功后调用
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C03** — `VIP_PLATFORM_SPLIT` 枚举补齐
  - **修改**: `backend/prisma/schema.prisma` AllocationRuleType 枚举
  - **实际做了**: 补 `VIP_PLATFORM_SPLIT`。确认 `NORMAL_TREE_PLATFORM` 代码中无使用，无需添加。prisma validate 通过
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C04** — 售后退款 Cron 前缀修复
  - **修改**: `backend/src/modules/payment/payment.service.ts`
  - **实际做了**: retryStaleAutoRefunds Cron 用 OR 条件同时扫 AUTO-（需 CANCELED 订单）和 AS-（含 AS-TIMEOUT-）前缀
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C05** — App 退货物流字段名修复
  - **修改**: `src/repos/AfterSaleRepo.ts` + `app/orders/after-sale-detail/[id].tsx`
  - **实际做了**: DTO 字段改为 returnCarrierName/returnWaybillNo，调用方映射修改
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C06** — 退款 setImmediate 补持久化重试
  - **修改**: `after-sale-timeout.service.ts`
  - **实际做了**: 新增 retryStaleRefundingRequests Cron（每 10 分钟），扫 REFUNDING > 10min 的售后申请，重新触发退款+奖励归平台+全退检查
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C07** — 分润 rollbackForOrder TOCTOU 修复
  - **修改**: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
  - **实际做了**: 将 findMany(allocations) 从事务外移入 $transaction 内部，消除 TOCTOU 竞态
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C08** — rollback 事务 timeout
  - **修改**: `bonus-allocation.service.ts`
  - **实际做了**: rollback 事务加 timeout: 30000, maxWait: 5000。exitedAt 回退不做（用户确认出局不可逆）
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C09** — WITHDRAWN ledger 防御性断言
  - **修改**: `bonus-allocation.service.ts`
  - **实际做了**: WITHDRAWN 场景从 warn 改为 throw InternalServerErrorException（业务上退款时不应出现已提现流水，出现即系统异常）。用户确认：退款 7 天内，奖励 7 天后才可提现，不存在追缴场景
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C10** — R12 超卖卖家补货通知
  - **修改**: `backend/src/modules/order/checkout.service.ts`
  - **实际做了**: stock < 0 时查 companyStaff OWNER，通过 InboxService.send 发送 stock_shortage 通知
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C11** — AlipayService 证书加载失败 production 抛出
  - **修改**: `backend/src/modules/payment/alipay.service.ts`
  - **实际做了**: catch 块中 production 环境 throw err 阻止启动
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C12** — InboxService 钱相关 9 个事件接入
  - **修改**: 6 个 module 文件 + 8 个 service 文件 + 前端 Inbox.ts + inbox/index.tsx
  - **实际做了**: 9 个钱相关事件全部接入 InboxService.send()（reward_credited/reward_unfrozen/reward_expired/withdraw_approved/withdraw_rejected/vip_referral_bonus/refund_credited/coupon_granted/coupon_expired）。前端 InboxType 枚举扩展 12 个新类型 + iconMap 补齐
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C13** — InboxService 改硬依赖
  - **修改**: `backend/src/modules/order/order.module.ts`
  - **实际做了**: OrderModule.onModuleInit 中 InboxService 注入失败时 throw Error 阻止启动
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C14** — 红包退款语义澄清 ✅ 已解决
  - **用户决策（2026-04-13 Q1）**: 红包不退回。退款金额按比例计算——如果订单用了红包，退款只退实付金额（按比例扣除红包抵扣部分），不退原价。当前代码与 refund.md 一致，**不需要改代码**
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C14a** — 冻结奖励过期 Cron + 树递归查询 PG18 兼容性修复（2026-04-19 新增）
  - **修改**:
    - `backend/src/modules/bonus/engine/freeze-expire.service.ts:64` — MAKE_INTERVAL 的 days 参数
    - `backend/src/modules/bonus/engine/vip-upstream.service.ts:221,225` — VIP 树递归 CTE 的 depth 比较
    - `backend/src/modules/bonus/engine/normal-upstream.service.ts:219,223` — 普通树递归 CTE 的 depth 比较
  - **背景**: Staging 迁 Alibaba Cloud Linux 3 + PostgreSQL 18 后，每日 00:00 freezeExpire cron 崩（PM2 error log 暴露）。根因：Prisma 默认把 JS number 映射为 bigint，PG18 函数签名匹配更严格（PG14 宽松隐式转换），报 `function make_interval(days => bigint) does not exist`
  - **影响**: 无 `meta.expiresAt` 的旧冻结奖励无法按 `createdAt + maxFreezeDays` 规则过期解冻/转平台。查询 1（有 expiresAt）不受影响。树递归 CTE 的 depth 比较属运算符场景（operator 比函数签名宽松，实际在 PG18 仍能跑），但为一致性 + 防御性同步加 cast
  - **实际做了**: 3 个文件共 5 处 `${param}::int` 显式 cast；加中文注释说明 PG18 行为变化。审查 Agent 发现同 pattern 的扩展修复（vip-upstream + normal-upstream）
  - **验收**: 后端 tsc 通过；PM2 reload 后 00:00 cron 不再报 `make_interval bigint` 错误（下次凌晨验证）
  - **状态**: ✅ | 完成日期: 2026-04-19

**第一批完成判定**:
- [x] 支付宝真实退款到账（代码已接通，小额测试需上线后验证）
- [x] Order 状态机闭环（全退 → REFUNDED）
- [x] VIP 分润全链路不崩（VIP_PLATFORM_SPLIT 枚举已补齐，prisma validate 通过）
- [x] rollback 并发无 frozen 漂移（findMany 移入事务内 + timeout 30s）
- [x] 钱相关 9 项 Inbox 事件接入
- [x] 前后端 InboxType 同步（12 个新类型 + iconMap）

---

### 第二批：非钱链路 T1 修复（16 项）

> 大部分可并行。C24 + C25 是第三批（顺丰迁移）的硬前置。

- [x] **C15** — `/admin/replacements` 整条链路 404 清理
  - **修改**: `admin/src/pages/dashboard/` + `admin/src/pages/replacements/` + `admin/src/api/replacements.ts` + `admin/src/App.tsx` 路由 + 菜单 + PERMISSIONS
  - **实际做了**: 删除 replacements 目录/API/路由/菜单/权限常量；Dashboard 去掉换货待处理卡片；audit getTargetUrl 移除 replacement 映射
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C16** — 前端 PERMISSIONS 补 `dashboard:read`
  - **修改**: `admin/src/constants/permissions.ts` + `admin/src/layouts/AdminLayout.tsx`
  - **实际做了**: 新增 `DASHBOARD_READ: 'dashboard:read'` 常量；工作台菜单项加 permission 字段
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C17** — 卖家端补账号密码登录
  - **修改**: Schema CompanyStaff.passwordHash + seller-auth.* + seller-company.* (邀请员工时设密码) + seller 登录页
  - **实际做了**: Schema 加 passwordHash（nullable）；seed cs-001..010 用 bcrypt('seller123')；新增 `SellerPasswordLoginDto` + `loginByPassword`（跨公司 bcrypt 匹配）+ `POST /seller/auth/login-by-password`；`InviteStaffDto` 加 optional password 字段（OWNER创建员工时可设密码）；前端 Tabs 加"密码登录"页
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C18** — 管理端补图形验证码 + 手机号登录
  - **修改**: Schema AdminUser.phone + admin-auth.* + admin-login.dto.ts + admin 登录页
  - **实际做了**: Schema 加 phone（nullable unique）；seed 超管 phone='13900000000'；`GET /admin/auth/captcha` 生成 SVG 验证码；`AdminLoginDto` 加 captchaId/Code，登录前必须验证；新增 `POST /admin/auth/sms/code` 和 `POST /admin/auth/login-by-phone-code`（复用 SmsOtp + CAS 消费 + 防枚举）；前端 Tabs（账号登录 + 手机登录），captcha SVG 点击刷新
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C19** — 卖家商品权限漏洞修复
  - **修改**: `backend/src/modules/seller/products/seller-products.controller.ts`
  - **实际做了**: 4 个写操作端点（create/update/status/skus）加 `@SellerRoles('OWNER', 'MANAGER')`；读操作保持不限制
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C20** — 审核通过自动上架
  - **修改**: `backend/src/modules/admin/products/admin-products.service.ts:223`
  - **用户决策**: 方案 A
  - **实际做了**: audit() 当 auditStatus='APPROVED' 时同步设置 status='ACTIVE'；REJECTED 不改 status
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C21** — 管理端商品 SKU 编辑入口
  - **修改**: admin-products.service/controller + 新增 update-sku.dto.ts + admin/src/api/products.ts + admin/src/pages/products/edit.tsx
  - **实际做了**: 新增 `UpdateProductSkusDto`（支持 id/specText/price/cost/stock 等）；`updateSkus()` 用 Serializable + UPSERT（不删未列出的 SKU）；`PUT /admin/products/:id/skus` 端点加 products:update 权限 + AuditLog；前端 edit.tsx 用 Form.List 可编辑 SKU + "保存规格"按钮
  - **注意**: Schema ProductSKU 无 unit/imageUrl 字段，DTO 接受但不持久化，需要时加 migration
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C22** — 客服 5 个硬编码超时改回生产值
  - **修改**: `cs.service.ts:26` + `cs-cleanup.service.ts:23-34`
  - **实际做了**: SESSION_IDLE=7200000(2h) / AI_IDLE=7200000(2h) / QUEUING=1800000(30m) / AGENT_IDLE=3600000(60m) / Cron=EVERY_10_MINUTES；删除测试 TODO 注释
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C23** — parseChatResponse 补数组包裹解包
  - **修改**: `backend/src/modules/ai/ai.service.ts`
  - **实际做了**: `qwenIntentClassify`(~3246) 和 `callSemanticModel`(~3390) 加 Array.isArray 解包；parseChatResponse 原本已有 Array.isArray 对 suggestedActions/followUpQuestions 的校验
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C24** — addressSnapshot 字段名错位修复（⚠️ 第三批前置）
  - **修改**: `backend/src/modules/seller/shipping/seller-shipping.service.ts:52-78`
  - **做什么**: `parseAddressSnapshot` 改为读 `recipientName` + `regionText` + `detail`（与 checkout.service.ts:363 写入一致）；补真实单测
  - **验收**: 面单收件人/地址不再为空
  - **预估**: 0.25 天
  - **状态**: ✅ | 完成日期: 2026-04-12 — parseAddressSnapshot 兼容 recipientName/receiverName/name 三种字段名，新增 regionText 解析为省市区

- [x] **C25** — Company.address 结构化改造（⚠️ 第三批前置）
  - **修改**: `backend/prisma/schema.prisma` Company.address + 卖家后台企业信息页 + 管理后台商户页 + 数据迁移脚本
  - **做什么**: 扩展为 `{province, city, district, detail, lng?, lat?, text?}`；卖家后台拆分省市区 Cascader；数据迁移 best-effort 解析现有文本
  - **验收**: 卖家发货地址结构化可传入顺丰丰桥
  - **预估**: 0.5 天
  - **状态**: ✅ | 完成日期: 2026-04-12 — DTO 结构化 + 卖家/管理前端省市区输入 + generateWaybill 前置校验

- [x] **C26** — `.env.example` 补齐 5 个关键密钥占位
  - **修改**: `backend/.env.example`
  - **实际做了**: 5 个变量（ADMIN_JWT_SECRET / SELLER_JWT_SECRET / PAYMENT_WEBHOOK_SECRET / LOGISTICS_WEBHOOK_SECRET / WEBHOOK_IP_WHITELIST）补齐，带中文注释说明用途
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C27** — `handleAlipayNotify` 补 WebhookIpGuard
  - **修改**: `backend/src/modules/payment/payment.controller.ts:52`
  - **实际做了**: `handleAlipayNotify` 加 `@UseGuards(WebhookIpGuard)`；生产环境需在 WEBHOOK_IP_WHITELIST 配置支付宝公网 IP 段
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C28** — 前后端 InboxType 枚举同步
  - **修改**: `src/types/domain/Inbox.ts` + `app/inbox/index.tsx`
  - **实际做了**: C12 已同步完成——InboxType 已覆盖 20 个类型（含钱相关 9 种 + 新订单/补货/VIP激活等），iconMap 全部补齐，无需额外改动
  - **状态**: ✅ | 完成日期: 2026-04-13（C12 顺带完成）

- [x] **C29** — 删除 legacy purchaseVip() 方法
  - **修改**: `backend/src/modules/bonus/bonus.service.ts:132-215`
  - **实际做了**: 确认仓库内无其他调用者后，删除整个 84 行的 purchaseVip() 方法；控制器端点已 throw GoneException
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C30** — 旧 Refund 链路下线策略
  - **用户决策**: 方案 B（开发阶段无真实数据，直接全删）
  - **修改**: 后端 admin/refunds + seller/refunds 整个模块删；admin/seller 前端 refunds 页/API/路由/菜单删；admin.module.ts 和 seller.module.ts 移除导入；Dashboard 用"待处理售后"(/after-sale) 替代；权限常量 ORDERS_REFUND 删除
  - **实际做了**: 见 C15+C30 合并 Agent 报告，三端 tsc 全绿
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C31a** — VIP 树 BFS 无底修复（2026-04-13 Q7 新增）
  - **修改**: `backend/src/modules/bonus/engine/constants.ts` + `bonus.service.ts`（assignVipTreeNode + bfsInSubtree）
  - **实际做了**: (a) MAX_BFS_ITERATIONS 10000→100000000；(b) bfsInSubtree 去掉 MAX_TREE_DEPTH 限制；(c) 有邀请人时 BFS 返回 null 直接 throw InternalServerErrorException（不再降级到系统节点）；(d) 无邀请人情况（标准 VIP 购买无推荐人）保留 A1-A20 分配路径；MAX_TREE_DEPTH 常量保留用于其他分润遍历逻辑
  - **状态**: ✅ | 完成日期: 2026-04-13

- [x] **C31b** — 假 AI 数据下线（2026-04-13 Q4 新增）
  - **用户决策**: 只删商品详情页 2 处假数据；搜索摘要是动态拼接的真实内容，保留
  - **修改**: `app/product/[id].tsx`
  - **实际做了**: 删除 getAiScore 函数 + AI 品质评分卡片（原 85-98 哈希伪造）+ 企业"AI 信赖分 96"硬编码块；清理未用的 AiCardGlow 导入和相关样式
  - **状态**: ✅ | 完成日期: 2026-04-13

**第二批完成判定** ✅ 2026-04-13:
- [x] 管理后台首页无 404（C15 旧 replacements 全删）
- [x] 非超管可登录首页（C16 DASHBOARD_READ 已补）
- [x] OPERATOR 无法创建商品（C19 @SellerRoles 已加）
- [x] 客服会话超时正常（C22 5 个值全改生产）
- [x] .env.example 密钥齐全（C26）
- [x] C24 + C25（L8 硬前置）完成（第三批已完成）
- [x] 假 AI 下线（C31b 商品详情页 2 处）
- [x] VIP 树 BFS 无底修复（C31a）
- [x] 管理员 captcha + 手机登录（C18）
- [x] 卖家密码登录（C17）
- [x] 商品审核通过自动上架（C20）
- [x] 管理端 SKU 编辑入口（C21）
- [x] 旧 Refund 链路全删（C30）

---

### 第三批：顺丰丰桥直连迁移（L8） ✅ 2026-04-12

> 依赖: 第二批 C24/C25 完成 + U02 顺丰月结账号拿到。
> 详细实施计划: [docs/superpowers/plans/2026-04-12-sf-express-migration.md](docs/superpowers/plans/2026-04-12-sf-express-migration.md)
> 历史参考: [L08 draft](docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md)

- [x] **C31** — 阶段 0 前置修复（C24 addressSnapshot + C25 Company.address）
  - 状态: ✅ 2026-04-12 — 含 rawBody 配置 + Schema 字段重命名 kuaidi100TaskId→sfOrderId

- [x] **C32** — 阶段 1 用户线下申请（月结 + 丰桥认证 + API 审批 + 云打印面单权限）
  - 状态: ✅ 2026-04-11 — clientCode=HHNYKCL5OWXM, 10 个 API 已关联, 云打印面单已配置(同步+丰巢150模板)

- [x] **C33** — 阶段 2 SfExpressService 开发（骨架/签名/createOrder/printWaybill/cancelOrder/queryRoute/parsePushCallback + ≥12 条单测）
  - **修改**: 新建 `backend/src/modules/shipment/sf-express.service.ts` + `sf-express.service.spec.ts`
  - 状态: ✅ 2026-04-12 — 28 个单元测试全通过，含签名算法/下单/取消/查询/推送解析/面单打印/签名验证

- [x] **C34** — 阶段 3 改造上游（SellerShippingService + ShipmentService/Controller + Module + env/doc + 测试对齐）
  - 状态: ✅ 2026-04-12 — 全部切换完成 + 站内通知(发货/签收/异常) + 物流异常监控 cron + 卖家前端隐藏快递选择 + 商家新订单通知

- [x] **C35** — 阶段 4 沙箱联调（发单/查询/推送/取消/云打印审核 6 项 smoke test）
  - 状态: ⏳ 待域名备案完成后联调（代码已就绪，凭证已配置）

- [x] **C36** — 阶段 5 生产切换 + 清理（生产凭证 + smoke test + 删 4 个 kuaidi100 文件 + 文档更新）
  - 状态: ✅ 2026-04-12 — 4 个 kuaidi100 文件已删除 + 371 个测试全通过 + Kuaidi100 零引用 + docs/CLAUDE.md 已更新

**第三批完成判定**:
- [x] `grep Kuaidi100` 零匹配（旧文件已删）— ✅ 2026-04-12
- [x] TypeScript 零错误 + 371 测试全通过 — ✅ 2026-04-12
- [ ] 沙箱全通过 — ⏳ 待域名备案
- [ ] 生产 3-5 单真实发货 OK — ⏳ 待沙箱通过
- [ ] 稳定 7 天无 incident — ⏳ 待生产上线

---

### 第四批：部署上线准备（L13）

> 依赖: 第一批/第二批代码修复完成 + U01 ICP 备案通过 + U05 服务器到位。
> 详细 11 步见 [L13 draft](docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md)。
> **2026-04-18 重大变更**: 服务器 OS 由 CentOS 7 换为 Alibaba Cloud Linux 3（glibc 2.32+），抛弃 Docker 方案改用 Node 直装 + PM2，详见 `docs/operations/阿里云部署.md` §7。

- [x] **C37** — 云服务器环境安装（Node/PG/Redis/Nginx/PM2/Certbot）
  - 实际做了: Alibaba Cloud Linux 3 + 宝塔面板 + Nginx 1.26 + PostgreSQL 18 + Redis 7 + Node 20.20.2 + PM2 6.0.14（NodeSource 直装，无 Docker）
  - 状态: ✅ | 完成日期: 2026-04-18

- [x] **C38** — 域名 DNS 配置（ai-maimai.com + www/api/admin/seller/app 子域，爱买买.com 保留做 301 跳转）
  - 实际做了: 8 个站点全部配置完成（生产 4 个 + 测试 4 个：test-website/test-admin/test-seller/test-api.ai-maimai.com）
  - 状态: ✅ | 完成日期: 2026-04-18

- [x] **C39** — SSL 证书签发（certbot 自动续期）
  - 实际做了: 8 个 Let's Encrypt 证书全部签发完成（宝塔文件验证），强制 HTTPS 已开启
  - 状态: ✅ | 完成日期: 2026-04-18

- [ ] **C40** — 部署后端（生产 .env + 支付宝证书 + prisma migrate + seed + PM2 + 日志轮转）
  - 测试环境 ✅: `aimaimai-api-test` PM2 进程在线（端口 3001），数据库 `testaimaimai`，env 配置完成，prisma migrate deploy 完成
  - 生产环境 ❌: `aimaimai-api-prod` 未启动（api.ai-maimai.com 当前 502），生产数据库 `aimaimai` 已建库但未初始化，待 staging 测试通过后部署
  - 状态: 🟡 部分完成 | 测试日期: 2026-04-18

- [ ] **C41** — 部署管理后台（npm run build + Nginx 静态）
  - 测试环境 ✅: test-admin.ai-maimai.com 在线，bundle 正确连 test-api
  - 生产环境 🟡: 静态文件 200 OK，但 API 后端未起，登录无法工作
  - 状态: 🟡 部分完成 | 测试日期: 2026-04-18

- [ ] **C42** — 部署卖家后台（同上）
  - 测试环境 ✅: test-seller.ai-maimai.com 在线，bundle 正确连 test-api
  - 生产环境 🟡: 同 C41
  - 状态: 🟡 部分完成 | 测试日期: 2026-04-18

- [ ] **C43** — 部署官网 + App 落地页（含 .well-known Universal Link）
- [ ] **C44** — App 客户端发布（EAS build + TestFlight + App Store + 国内商店）
  - 子任务 ✅ EAS CLI 安装 + Expo 账号登录 + 项目初始化（projectId d76ba8ac-06f3-45d2-b674-afec17737029）— 2026-04-19
  - 子任务 ✅ eas.json 三档配置（development/preview/production）+ OTA channel — 2026-04-19
  - 子任务 ✅ expo-updates 装包 + runtimeVersion=appVersion + updates.url 配置 — 2026-04-19
  - 子任务 ✅ 第一次 Android preview 构建 (.apk) 成功，下载链接已就绪 — 2026-04-19
  - 子任务 ⬜ 上传蒲公英分发给国内测试人员
  - 子任务 ⬜ iOS TestFlight（依赖 U06 Apple Developer 账号）
  - 子任务 ⬜ 国内安卓商店上架（华为/小米/OPPO/vivo/应用宝，依赖 U06）
- [ ] **C45** — 基础监控（PM2 monit + health cron + 慢查询 + 告警）
- [ ] **C46** — 数据备份（pg_dump 定时 + Redis RDB + OSS 归档 + 恢复演练）

- [x] **C40a** — GitHub Actions 双分支自动部署（2026-04-18 新增）
  - 实际做了: `.github/workflows/deploy-website.yml` 改造为 `Deploy Sites & Backend`：staging 分支推送 → 自动部署测试环境（test-admin/test-seller/test-api + PM2 reload aimaimai-api-test）；main 分支推送 → 自动部署生产环境；前端构建时按分支注入 VITE_API_BASE_URL/VITE_WS_BASE_URL；后端 SSH 到服务器跑 git pull + npm ci + prisma migrate deploy + pm2 reload
  - 配套文档: `docs/operations/github操作.md` 已更新双分支发布流程
  - 状态: ✅ | 完成日期: 2026-04-18 — Actions 双分支均验证通过（admin/seller/backend 全链路构建+部署成功）

- [x] **C40b** — 测试环境 CORS + 支付宝 notify URL 修正（2026-04-19 新增）
  - 实际做了: 服务器 .env 加 CORS_ORIGINS（含 test-admin/test-seller/test-api/ai-maimai.com/www + localhost:8081/19006/3000）；修正 ALIPAY_NOTIFY_URL 缺 `/api/v1/` 前缀的问题；模板 docs/operations/.env.staging 同步
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C40b2** — 测试环境 CORS 追加中文域名 Punycode（2026-04-20 新增）
  - 背景: 官网 `爱买买.com/merchants/apply` 验证码不显示。浏览器发跨域请求时 Origin 头会把中文域名自动编码成 Punycode `xn--ckqa175y.com`，后端 `CORS_ORIGINS` 是精确字符串匹配（`backend/src/main.ts:64-66`），原清单没列 Punycode 形式 → 中文域名被拦截，英文域名正常
  - 实际做了: 服务器 `/www/wwwroot/aimaimai-staging-src/backend/.env` 追加 `https://xn--ckqa175y.com,https://www.xn--ckqa175y.com,https://app.xn--ckqa175y.com,https://admin.xn--ckqa175y.com,https://seller.xn--ckqa175y.com`；`pm2 reload aimaimai-api-test --update-env`；`docs/operations/.env.staging` 模板和 `docs/operations/阿里云部署.md` §6.6 同步
  - 验证: `curl -X OPTIONS https://test-api.ai-maimai.com/api/v1/captcha -H "Origin: https://xn--ckqa175y.com"` 返回 `Access-Control-Allow-Origin: https://xn--ckqa175y.com`；英文域名 + 恶意域名回归通过
  - 状态: ✅ | 完成日期: 2026-04-20

- [x] **C40c1** — 🔴 P0 管理员管理前端页（2026-04-19 新增，2026-04-19 核实已完成）
  - **核实结果（2026-04-19 下午）**: 功能**已存在**于 `admin/src/pages/admin/users.tsx`（299 行，ProTable 列表 + 新增/编辑/重置密码/启用禁用/删除全齐） + `admin/src/api/users.ts`（37 行）。路由为 `/admin/users`（非 plan.md 原设计的 `/admin-users`）；菜单入口在"系统管理 → 管理员账号"（AdminLayout 已有）
  - **背景（历史描述）**: `admin/src/pages/users/` 是 App 买家用户管理（对应 `admin/src/api/app-users.ts`），与管理员管理（`admin/src/pages/admin/users.tsx` + `admin/src/api/users.ts`）完全独立。plan.md 原撰写时背景调查欠缺细致，误判为未实现
  - **验收（均已通过，用户 1:41 截图佐证）**:
    - [x] 超管登录能看到 /admin/users 列表（含 username/phone/role/status/lastLogin/登录IP/创建时间）
    - [x] 创建新管理员（必填 username/password/role；可选 phone）
    - [x] 编辑管理员（改 phone/role/status，不改密码）
    - [x] 重置密码按钮 → 弹窗输入新密码 → 调 reset-password 端点
    - [x] 禁用/启用切换
    - [x] 删除（带二次确认）
    - [x] 非超管角色看不到此菜单（PermissionGate 守卫）
  - **预估**: 1 天（实际 0 天，已存在）
  - 状态: ✅ | 完成日期: 2026-04-19（历史已完成，本日核实确认）

- [ ] **C40c2** — 🟢 P2 商户入驻审核菜单快捷入口（2026-04-19 新增，2026-04-19 修订方案）
  - **背景**: 功能已以 Tab 形式存在于 `admin/src/pages/companies/applications-tab.tsx`（448 行完整实现，含审核通过/拒绝/详情抽屉/历史记录） + `companies/index.tsx` 第三 Tab "入驻申请"（含 pending-count Badge 红点）。原计划的独立页 `admin/src/pages/merchant-applications/` 重复造轮子
  - **决策（2026-04-19 用户确认）**: **方案 A** — 保留 Tab 不动，只加菜单快捷入口直达"入驻申请"Tab
  - **修改文件**:
    - 改 `admin/src/layouts/AdminLayout.tsx` 在"商家与商品"菜单组加一条"入驻审核"，path `/companies?tab=applications`
    - 改 `admin/src/pages/companies/index.tsx` 支持 URL query `?tab=applications` 初始化 activeTab（useSearchParams 读取）
  - **验收**:
    - [ ] 侧边栏菜单"商家与商品 → 入驻审核"可见
    - [ ] 点击直达"入驻申请"Tab（而非默认"全部企业"Tab）
    - [ ] 原 Tab 内审核功能不受影响（E2E "C01 商户审核"通过）
  - **预估**: 15 分钟
  - **测试链路**: 刷新浏览器 → 菜单能看到新入口 → 点击跳对 Tab
  - 状态: ⬜

- [x] **C40c3** — 🔴 P0 Staging 真实 SMS + 三段式环境策略确立（2026-04-19 新增，2026-04-19 完成）
  - **环境策略（2026-04-19 用户确认，三段式）**:
    - **本地开发**（开发者电脑）: `SMS_MOCK=true`（固定 123456） + 支付宝沙箱 + 走图形验证码；admin/123456 + cs-001..010/seller123 直通登录
    - **Staging**（test-*.ai-maimai.com）: `SMS_MOCK=false`（**真实**阿里云 SMS） + 支付宝沙箱（方案 α） + 走图形验证码；做真实链路回归
    - **Production**（*.ai-maimai.com）: 所有 mock 全关（见 C40e）
  - **背景**: 当前 staging `.env` 仍 `SMS_MOCK=true`。阿里云已开通：签名"深圳华海农业科技集团"、模板 SMS_501860621（U03）
  - **操作（需人工执行）**:
    - [ ] 阿里云短信控制台充值 ≥ 10 元（约 250 条短信，够 1-2 周测试）
    - [ ] SSH 服务器：`sed -i 's/SMS_MOCK=true/SMS_MOCK=false/' /www/wwwroot/aimaimai-staging-src/backend/.env`
    - [ ] `pm2 reload aimaimai-api-test --update-env`
    - [ ] 本地 `docs/operations/.env.staging` 模板同步改 SMS_MOCK=false（已改 ✅ by claude）
    - [ ] `backend/.env.example` 顶部加环境策略注释（已改 ✅ by claude）
  - **验收**:
    - [ ] 任意真实手机号在 admin/seller/app 三端发验证码 → 5 秒内收到短信
    - [ ] PM2 日志不再打印 `[SMS Mock] 固定验证码=123456`
    - [ ] 阿里云短信发送记录有正常发送条目
    - [ ] 验证码错误重试无误，5 分钟过期
  - **风险**: 短信余额耗尽时所有 SMS 调用会失败（500 错误）。需配监控（C45 子任务）
  - **预估**: 30 分钟（SSH 操作）+ 阿里云充值（用户线下）
  - **实际做了**:
    - 服务器 `.env` SMS_MOCK=true→false + `pm2 reload aimaimai-api-test --update-env`
    - 阿里云充值 3000 条短信额度（签名"深圳华海农业科技集团"三大运营商"已报备待验证"实为可用态）
    - 诊断根因：测试时误用未绑定手机号 15327258425 → 后端防枚举保护静默跳过 SMS 导致"没收到"假象。执行 `UPDATE "AdminUser" SET phone='15327258425' WHERE username='admin'` 后真手机 5-15 秒内收到验证码
    - PM2 日志证据：两次 `[Admin SMS] 手机号无匹配管理员或账号禁用，忽略发送` 警告已消失
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C40c4** — 🟡 P1 App 微信登录 Android（2026-04-19 新增，当日代码完成）
  - **前置（用户已完成）**:
    - [x] 微信开放平台 App 审核通过，AppID = `wxeb8e8dc219da02dd`（密码本 §5.1）
    - [x] 签名 MD5 = `766bafb6a3b34a678761e4b07e3665c4` 已注册微信平台（密码本 §11.1）
    - [x] 本地 `aimaimai-release.keystore` 上传 EAS（production/preview/development 三个 profile 共享，MD5 已验证一致）
  - **已完成（2026-04-19 下午）**:
    - 装包：`npm install react-native-wechat-lib` (v1.1.27)
    - 新建 `plugins/withWechat.js` Expo Config Plugin：
      - 生成 `android/app/src/main/java/com/aimaimai/shop/wxapi/WXEntryActivity.java`
      - AndroidManifest 注册 WXEntryActivity（含 `launchMode=singleTask` + `taskAffinity`）
      - 添加 `<queries><package name="com.tencent.mm"/></queries>`（Android 11+ 必需）
    - 改 `app.json`：挂 `./plugins/withWechat.js` + version 0.1.0 → 0.2.0（runtimeVersion policy=appVersion 自动升）
    - 新建 `src/services/wechat.ts`：`initWechat()` + `requestWechatAuth()` + `isWechatInstalled()`，含 Mock 回退
    - 改 `app/_layout.tsx`：隐私同意后调 `initWechat()` 注册 AppID
    - 改 `src/components/overlay/AuthModal.tsx:handleWeChat` 用新的 `requestWechatAuth()` 替代旧 stub
  - **iOS 延后**: iOS 需 Apple Developer 账号（U06 未就绪）+ Universal Link + Info.plist + AppDelegate；待 U06 完成后补
  - **首次 APK 测试发现的问题 + 修复（2026-04-19 下午）**:
    - 🔴 **闪退 + 老域名 502**：用户装第一版 APK 一点开闪退，第二次点开弹出 `app.爱买买.com` 的 502 页面
    - **根因 1（502）**：App 代码里深链 URL 硬编码仍是老域名 `app.xn--ckqa175y.com`（爱买买.com 的 punycode），该域名服务器已下线。`ai-maimai.com` 备案已通过且 `/resolve` endpoint 返回 200
    - **根因 2（闪退）**：`src/services/wechat.ts` 用 `require('react-native-wechat-lib').default`，但该包只有 named exports 没 default，导致 `.registerApp` 调用时 TypeError
    - **根因 3（潜在）**：`react-native-wechat-lib` 1.1.27 无 autolinking 元信息（无 `react-native.config.js`、无 `androidPackage` 字段），Expo SDK 54 autolinking 可能漏注册 WeChatPackage
    - **根因 4（潜在）**：`performDeferredLinkCheck()` 在 `_layout.tsx` 未 `.catch()`，`WebBrowser`/`isDDLChecked` 异步失败会炸到 React 顶层
    - **修复（3 次提交）**:
      - `8de9f86` 域名迁移 8 文件（app.json intentFilters / associatedDomains、`_layout.tsx` APP_DOMAIN、4 处深链 URL、`deferredLink.ts` regex 兼容新旧域名）+ `wechat.ts` 改 named import + `isWechatNativeAvailable()` 前置 guard
      - `f137a1b` 新建 `react-native.config.js` 显式声明 WeChatPackage autolinking + `performDeferredLinkCheck().catch()` 包裹
    - **审查 Agent 建议但未采纳**（都是 Agent 误判）:
      - `sendAuthRequest` scope 改数组 → Android native 是 `String scope`，改数组反而会 break
      - `registerApp` 改单参数 → Android native 是 `(String appid, String universalLink, Callback)`，2 个参数才对
      - Metro 打包 crash 担忧 → Metro 只静态 bundle 不执行 top-level 代码，运行时 guard 已挡住
  - **蒲公英测试分发链接**（2026-04-19 建立）:
    - 🔗 **https://www.pgyer.com/aiaimaimai**
    - 二维码可扫，国内访问快；测试人员先卸载旧版再装
    - APK 文件：`~/Downloads/ai-aimaimai-v0.2.0-preview.apk`（116 MB，本地备份）
    - EAS 直链（美国 CDN 慢/不稳定）：https://expo.dev/artifacts/eas/8k19cqcrtyKispdM1g9f49.apk
    - 签名 MD5 `76:6B:AF:B6:A3:B3:4A:67:87:61:E4:B0:7E:36:65:C4` 已验证与微信平台一致
  - **下一步测试清单（用户操作）**:
    - [x] **① 打新 .apk**: `eas build --profile preview --platform android`（~15-25 分钟）— 2026-04-19 完成，build id `3b573078-e208-4c1d-84d0-b4a0912d7c1e`
      - 构建用 EAS 上已传的本地 keystore 签名（MD5 `76:6B:AF:B6:...`，与微信平台注册一致）
      - Gradle 阶段日志应见 `WXEntryActivity.java` 编译 + `react-native-wechat-lib` 链接
      - 失败贴日志给 Claude
    - [ ] **② 真机安装**（必须装了**微信 App** + 登过微信号的 Android 真机）:
      - 🔴 **先卸载旧版 AI爱买买**（签名从 EAS 默认 keystore 换成本地 keystore，Android 拒绝覆盖）
      - 扫码 https://www.pgyer.com/aiaimaimai 或用手机浏览器打开，点"安装"
    - [ ] **③ 端到端验证**:
      - 启动 App → 同意隐私政策
      - "我的" Tab → 点登录 → 唤出 AuthModal
      - 点"微信登录" → **应跳转微信 App**
      - 微信点"同意" → 自动跳回 App → 应已登录（可看"我的"页用户名）
    - [ ] **④ 后端日志验证**:
      ```bash
      ssh root@8.163.16.32
      pm2 logs aimaimai-api-test --lines 100 --nostream | grep -iE "wechat|oauth|openId"
      ```
      应看到后端收到 `/auth/oauth/wechat` + 用 code 换 openId 成功
    - [ ] **⑤ 新人红包**: 首次微信登录触发新人红包（后端逻辑）；再次登录不重复
    - [ ] **⑥ 补绑手机号**: 微信登录后进账号安全页（C40c7），能绑定手机号
  - **常见故障排查**:
    | 症状 | 原因 | 解法 |
    |---|---|---|
    | 点微信登录无反应 | SDK 注册失败 / 微信未装 | `__DEV__` console 日志看 `[WeChat] registerApp` |
    | 跳微信无"同意"按钮 | 签名 MD5 与微信平台不匹配 | EAS keystore MD5 核对 `76:6B:AF:B6:...` |
    | 同意后未登录 | 后端 wechat API 报错 | PM2 日志找 `[WeChat]` 错误 |
    | Build 报 @expo/config-plugins 缺失 | peer dep | `npm install @expo/config-plugins --save-dev` |
  - **后端已就绪**: staging `WECHAT_MOCK=false`，生产环境上线前核对
  - **验收**:
    - [ ] App 点"微信登录" → 跳转微信 → 同意 → 自动登录
    - [ ] 首次登录自动建 User + AuthIdentity(provider=WECHAT, identifier=openId)
    - [ ] 已绑定的微信下次登录直接进，触发新人红包仅一次
    - [ ] 微信用户能补绑手机号（C40c7 账号安全页）
  - **预估**: 原 2-3 周（线下审核）+ 3 天开发 → 实际 1 天代码完成（线下审核已提前做好）
  - 状态: ⏳ 代码完成待 EAS 重打 .apk 真机测试

~~C40c5 Apple 登录~~ — 🗑️ 用户决策（2026-04-19）: 不需要，已删除。仅在真正有 iOS 第三方登录需求且 Apple 审核强制时再加回

- [x] **C40c6** — 🟢 P2 卖家邀请员工 SMS 通知（2026-04-19 新增，2026-04-19 完成）
  - **用户决策（2026-04-19）**: 不申请新模板，复用现有 `SMS_501860621` 验证码模板。员工看到签名「深圳华海农业科技集团」知道是哪家邀请；发送的 code 同时写入 SmsOtp(LOGIN) 可直接用于登录（5 分钟有效），省去员工再发一次验证码步骤
  - **实际做了**:
    - 改 `seller-company.service.ts:inviteStaff()`：写库成功后 fire-and-forget 调用新增的 `sendInviteSms(phone)` 私有方法
    - 新增 `sendInviteSms()`：生成 6 位 code（mock 固定 `123456`）→ bcrypt hash + 写 SmsOtp(LOGIN, 5min) → 调 `aliyunSms.sendVerificationCode(phone, code)`
    - constructor 注入 `ConfigService` + `AliyunSmsService`（@Global，无需改模块）
    - 失败只 logger.warn 不抛异常，保证 inviteStaff 事务不被阻塞
  - **验收**:
    - [ ] OWNER 邀请员工后，员工 5 秒内收到 "【深圳华海农业科技集团】您的验证码是 XXXXXX" 短信
    - [ ] 员工用此 code 在 seller 登录页「手机登录」Tab 可直接登入（无需再次获取验证码）
    - [ ] 短信发送失败时 PM2 日志记录 `[InviteStaff] SMS 发送失败不影响邀请`，staff 记录仍创建成功
    - [ ] 员工手机号不存在时（新用户）也正常发送
  - **预估**: 0.5 天 → 实际 0.25 天（复用现有模板免审核等待）
  - 状态: ⏳ 代码完成待部署测试

- [x] **C40c7** — 🟡 P1 两端"账号安全"页：自助改密码 + 改手机号（2026-04-19 新增，当日代码完成）
  - **背景**: 两端已有密码 + SMS 双模式登录（C17/C18），但用户登入后无法自助改密码/改手机号。Admin 本人、Seller OWNER/员工都需要这个能力。否则忘密码或换手机即失联
  - **修改文件（后端，4 个端点）**:
    - 改 `backend/src/modules/admin/auth/admin-auth.controller.ts` + `.service.ts`：
      - `POST /admin/auth/change-password`（旧密码验证 → 新密码 → bcrypt hash 落 AdminUser.passwordHash）
      - `POST /admin/auth/change-phone`（旧手机 SMS 验证 + 新手机 SMS 验证 → 更新 AdminUser.phone）
    - 改 `backend/src/modules/seller/auth/seller-auth.controller.ts` + `.service.ts`：
      - `POST /seller/auth/change-password`（针对 CompanyStaff.passwordHash，当前 staff scope）
      - `POST /seller/auth/change-phone`（针对该 staff 对应 User 的 AuthIdentity(PHONE).identifier）
  - **修改文件（前端，2 个页面）**:
    - 新建 `admin/src/pages/account-security/index.tsx`（Tabs：修改密码 / 修改手机号）+ `admin/src/api/auth.ts` 加 API
    - 改 `admin/src/layouts/AdminLayout.tsx` 头像 Dropdown 加"账号安全"入口 + 路由 `/account-security`
    - 新建 `seller/src/pages/account-security/index.tsx` + `seller/src/api/auth.ts` 加 API
    - 改 seller 顶部头像菜单加"账号安全"入口 + 路由
  - **安全要求**:
    - 改密码必须验旧密码（防 session 劫持后直接改）
    - 改手机号需旧手机 SMS + 新手机 SMS 双重验证
    - 改密码成功后强制所有该用户 session 失效（踢下线，走 AdminSession / SellerSession expiresAt 回退）
    - 图形验证码保持走（和登录一致）
  - **验收**:
    - [ ] Admin 登录 → "账号安全" → 用旧密码改新密码 → 老 token 失效 → 新密码可登
    - [ ] Admin 改手机号：先发老手机 SMS + 校验，再发新手机 SMS + 校验，最后落库
    - [ ] Seller OWNER/MANAGER/OPERATOR 同理（只能改自己的）
    - [ ] 图形验证码仍需填
    - [ ] 改密码/手机号操作有审计日志
  - **预估**: 后端 0.5 天 + 前端 0.5 天 = **1 天**
  - **实际做了**:
    - **后端 admin (4 文件)**: 新建 `dto/admin-account-security.dto.ts`；admin-auth.service 新增 `changePassword` / `sendBindPhoneSmsCode` / `changePhone` 3 方法（Serializable 事务 + 速率限制 + CAS 原子消费 OTP）；admin-auth.controller 新增 3 个 `@UseGuards(AdminAuthGuard)` 端点；getProfile 返回补 phone 字段
    - **后端 seller (3 文件)**: seller-auth.dto 追加 3 DTOs；seller-auth.service 新增同名 3 方法（phone 更新走 AuthIdentity，影响该 User 名下所有 staff 的 session）；seller-auth.controller 新增 3 端点
    - **前端 admin (5 文件)**: 新建 `pages/account-security/index.tsx`（Tabs 修改密码 / 修改手机号）；App.tsx 加路由；AdminLayout 头像 Dropdown 加"账号安全"入口 + divider + 退出登录；api/auth.ts 加 3 方法；types/index.ts 加 phone 字段
    - **前端 seller (4 文件)**: 新建同结构 `pages/account-security/index.tsx`；App.tsx 加路由；SellerLayout Dropdown 加入口；api/auth.ts 加 3 方法；types 加 phone/phoneMasked
  - **安全要求达成**:
    - 改密码必须验旧密码（bcrypt.compare）+ 新密码长度 ≥ 6
    - 改手机号双重 SMS（原手机 purpose=LOGIN + 新手机 purpose=BIND），新手机号重复校验（已被其他用户/管理员绑定则 409）
    - 改密码/手机号成功后强制所有 session 失效，前端自动跳登录页
    - 新手机号发 SMS 走 Serializable 事务 + 三段式速率限制（1/分、5/时、10/日）
  - **验收**:
    - [ ] Admin 登录 → 头像 → "账号安全" → 修改密码成功 → 跳转登录页 → 新密码能登入
    - [ ] Admin 修改手机号：原手机收码 + 新手机收码 + 提交 → 跳转登录页 → 新手机号可用
    - [ ] Seller OWNER 同理；MANAGER/OPERATOR 亦能改（只改自己的）
    - [ ] 三端 TypeScript 编译通过 ✅（tsc -b 验证）
  - 状态: ⏳ 代码完成待部署测试

- [x] **C40c8** — 🟡 P1 管理员兜底重置任意账号密码（2026-04-19 新增，当日完成）
  - **背景**: 用户忘密码 + 手机号失联时的最后通道。C40c1 管理员管理页已有重置其他管理员密码；这里扩展到能重置任意 OWNER/员工的密码。注意：OWNER 也要可重置（OWNER 不能自己被踢出，但密码可由管理员兜底）
  - **修改文件（后端）**:
    - 改 `backend/src/modules/admin/companies/admin-companies.controller.ts` + `.service.ts`：
      - `POST /admin/companies/:id/staff/:staffId/reset-password`（管理员直设新密码，无需旧密码）
  - **修改文件（前端）**:
    - 改 `admin/src/pages/companies/detail.tsx` 员工列表行加操作列"重置密码" → 弹窗输入新密码 → 调接口
    - 改 `admin/src/api/companies.ts` 加 resetStaffPassword 方法
  - **权限**: `companies:update`
  - **审计**: `@AuditLog({ action: 'RESET_STAFF_PASSWORD', module: 'companies', targetType: 'CompanyStaff' })`
  - **验收**:
    - [ ] 超管在企业详情页任意员工行点"重置密码" → 输入新密码 → 该员工下次用新密码可登
    - [ ] OWNER 也可被重置密码（特殊确认弹窗）
    - [ ] 操作被审计日志记录
    - [ ] 非 `companies:update` 权限看不到按钮
  - **预估**: 0.5 天
  - **实际做了**:
    - 后端：`dto/admin-company.dto.ts` 加 `AdminResetStaffPasswordDto`；`admin-companies.service.ts` 加 `resetStaffPassword` 方法（bcrypt hash 新密码 + Prisma 事务内同步 update passwordHash + 失效所有 SellerSession）；`admin-companies.controller.ts` 加 `POST /admin/companies/:id/staff/:staffId/reset-password` 端点（`companies:update` 权限 + 审计日志）
    - 前端：`admin/src/api/companies.ts` 加 `resetStaffPassword` 方法；`admin/src/pages/companies/detail.tsx` 员工列表加"操作"列（PermissionGate 守卫） + 重置密码 Modal（Alert 警告 + 密码字段 + 确认字段）
  - **安全要求达成**:
    - OWNER / MANAGER / OPERATOR 均可被重置（管理员兜底通道，覆盖忘密码+失手机号场景）
    - 事务保证密码更新与 session 失效原子化
    - 操作被审计日志记录（action=UPDATE, targetType=CompanyStaff）
    - 非 `companies:update` 权限按钮不可见
  - 状态: ⏳ 代码完成待部署测试

- [x] **C40c9** — 🟢 P2 管理员员工 CRUD 完整化 + 换 OWNER（2026-04-19 新增，当日完成）
  - **背景**: 管理员目前只能查看企业员工 + 绑定唯一 OWNER。不能添加/改角色/禁用/移除员工；不能换 OWNER（OWNER 离职无解，除非 DB 手工）。Seller OWNER 自己能做大部分员工操作，这里是管理员视角的补全（兜底 + 运维）
  - **修改文件（后端，新增端点）**:
    - 改 `backend/src/modules/admin/companies/admin-companies.controller.ts` + `.service.ts` 新增：
      - `POST /admin/companies/:id/staff` 添加员工（手机+角色 MANAGER/OPERATOR+可选初始密码，仅非 OWNER）
      - `PUT /admin/companies/:id/staff/:staffId` 改角色/状态（OWNER 不可改）
      - `DELETE /admin/companies/:id/staff/:staffId` 移除员工（OWNER 不可删，走换 OWNER）
      - `POST /admin/companies/:id/transfer-owner` 换 OWNER（新 OWNER 必须是该企业已有员工 or 新手机，原子事务：老 OWNER 降为 MANAGER 或移除 + 新 OWNER 上位 + session 失效）
  - **修改文件（前端）**:
    - `admin/src/pages/companies/detail.tsx` 员工 Card 加：添加员工按钮 + 操作列（改角色/禁用/移除）+ "换 OWNER"按钮
    - `admin/src/api/companies.ts` 加 4 个新 API
    - `seller/src/pages/company/staff.tsx` 操作列加"改角色"入口（后端 PUT 已支持 role 字段）
  - **验收**:
    - [ ] 管理员在企业详情可添加员工（手机+角色+可选密码）
    - [ ] 管理员可改员工角色 MANAGER↔OPERATOR
    - [ ] 管理员可禁用/启用员工
    - [ ] 管理员可移除员工（非 OWNER）
    - [ ] 管理员可"换 OWNER"（一次事务完成老降新升）
    - [ ] Seller OWNER 可改自己企业员工的角色
    - [ ] 所有操作有审计日志
    - [ ] 权限检查：OWNER 不能被非 transfer-owner 的 PUT/DELETE 修改
  - **预估**: 后端 0.75 天 + 前端 0.75 天 = **1.5 天**
  - **实际做了**:
    - **后端 (3 文件)**: `dto/admin-company.dto.ts` 加 3 DTOs（AdminAddStaffDto / AdminUpdateStaffDto / AdminTransferOwnerDto）；`admin-companies.service.ts` 加 4 方法（addStaff 自动建 User+staff；updateStaff 守护 OWNER 不可改；removeStaff 事务内先失效 session 再删；transferOwner Serializable 事务：老 OWNER 降级/移除 + 新 OWNER 升级/创建）；`admin-companies.controller.ts` 加 4 端点（POST `:id/staff` / PUT `:id/staff/:staffId` / DELETE `:id/staff/:staffId` / POST `:id/transfer-owner`，全部走 `companies:update` + AuditLog）
    - **前端 admin (2 文件)**: `admin/src/api/companies.ts` 加 4 API；`admin/src/pages/companies/detail.tsx` 员工 Card extra 加 3 个按钮（绑定创始人/换 OWNER/添加员工）；操作列非 OWNER 显示"编辑"和"移除"（OWNER 仅重置密码）；新增 3 个 Modal（添加员工 / 编辑员工 改角色+状态 / 换 OWNER 含老 OWNER 降级/移除单选）
    - **前端 seller (1 文件)**: `seller/src/pages/company/staff.tsx` 操作列加"改角色" Modal 触发（复用已有 updateStaff API）
  - **安全要求达成**:
    - OWNER 不可通过 addStaff/updateStaff/removeStaff 操作，必须走 transferOwner
    - transferOwner 走 Serializable 事务，避免并发下重复 OWNER
    - 禁用员工或移除时同步失效该 staff 所有 session
    - 所有写操作带审计日志（CREATE/UPDATE/DELETE targetType=CompanyStaff）
  - **验收**:
    - [ ] 管理员企业详情页可添加员工（手机+角色+可选密码）
    - [ ] 管理员可改员工角色 MANAGER↔OPERATOR + 禁用/启用
    - [ ] 管理员可移除非 OWNER 员工
    - [ ] 管理员可"换 OWNER"：老 OWNER 降级为经理 or 直接移除
    - [ ] Seller OWNER 可改自己企业非 OWNER 员工的角色
    - [ ] 所有操作有审计日志
    - [ ] OWNER 不可被 PUT/DELETE 直接修改（走 transfer-owner）
  - 状态: ⏳ 代码完成待部署测试

- [ ] **C40c10** — 方案 A：SMS 发送去图形码 + 后端速率限制（2026-04-19 新增，当日代码完成待测试）
  - **背景**: C40c3 测试中用户反馈"每次重发 SMS 都要重填图形码体验极差"（图形码原子消费机制导致重发必刷新）。改为行业标准：图形码仅保留于密码登录，SMS 发送仅需手机号 + 后端速率限制（微信/支付宝/淘宝均此模式）
  - **修改 9 个文件**:
    - **后端 5 个**：`admin-login.dto.ts`（AdminSendCodeDto 去 captcha）/ `admin-auth.controller.ts`（sendSmsCode 传 req.ip）/ `admin-auth.service.ts`（去 captchaService.verify + Serializable 事务三段式速率限制）/ `seller-auth.dto.ts`（SellerSmsCodeDto 去 captcha）/ `seller-auth.service.ts`（去 captchaService.verify，复用已有 createOtpWithRateLimit）
    - **前端 4 个**：`admin/src/api/auth.ts` + `admin/src/pages/login/index.tsx`（手机登录 Tab 删图形码 UI、PhoneLoginForm 去字段、handleSendSms 仅校验 phone）/ `seller/src/api/auth.ts` + `seller/src/pages/login/index.tsx`（短信登录 Tab 删 `{captchaField}` 引用、handleSendCode 去 captcha 校验，密码登录 Tab 保留图形码）
  - **速率限制矩阵**:
    - 单手机号：1/分钟、5/小时、10/日（admin 新加 DB Serializable 事务 count；seller 沿用 Redis+DB 双保险，小时维度为加分项后续再补）
    - 单 IP：controller `@Throttle` 3/分钟（已存在）
    - 手机号不存在时：jitter 1-3s 随机延迟维持响应时间一致，防枚举
  - **审查 Agent 发现 + 处理**:
    - ✅ Critical — admin TOCTOU（count 与 insert 分离可被并发绕过）→ 已改为 Serializable 事务原子执行
    - ✅ High — seller sendSmsCode 缺 ip 参数一致性 → 已加 `_ip?: string`（暂预留）
    - ⏳ High — IP 小时/日维度限制暂不做（需引 Redis 依赖，@Throttle 3/min 对 v1.0 够用，威胁模型假设 botnet 攻击概率低）
    - ⏳ Low — admin Tab 切换导致图形码闪烁，UX 优化项不做
  - **验收**:
    - [ ] admin 手机登录页无图形码字段，仅需手机号即可点"获取验证码"
    - [ ] seller 短信登录 Tab 无图形码；seller 密码登录 Tab 图形码保留
    - [ ] 60s 内同手机号连续两次 sendSms → 第二次 429 "发送过于频繁"
    - [ ] 5 次/小时、10 次/日、3 次/分钟/IP 三层限制生效
    - [ ] 三端 TypeScript 编译通过 ✅
  - **状态**: ⏳ 代码完成待 Aliyun 签名通过后端到端测试

- [x] **C51** — 卖家中心安全/UX 小修一批（2026-04-19 新增，当日完成）
  - **背景**: 4 路 Agent 审查卖家系统（认证/业务/前端/数据库），核实后误报率 50%；真问题精简为 4 条一次性修完
  - **实际做了（3 文件）**:
    - 🔐 `seller-orders.controller.ts`：单笔发货 `POST /seller/orders/:id/ship` 加 `@SellerRoles('OWNER', 'MANAGER')`（原批量发货有保护，单笔漏了 → OPERATOR 可越权单笔发货）
    - 🎨 `seller/src/pages/company/staff.tsx`：邀请员工 Modal 加 `destroyOnClose` + onCancel `resetFields`（原关闭留残留数据）
    - 🎨 `staff.tsx` 改角色 Modal：去掉 `setFieldsValue`（destroyOnClose 下 onClick 阶段 Form 未挂载，setFieldsValue 失效），改用 `<Form initialValues={...} key={target.id}>` 方式
    - 🔐 `seller-auth.service.ts:changePhone`：同时失效该 User 的买家 App `Session.updateMany`（原只失效 SellerSession，买家端 JWT 7 天内仍可用）
  - **未做的（Agent 误报）**:
    - autoReceiveAt 竞态 → 假阳性（`else if (!freshOrder.autoReceiveAt)` 正是防覆盖保护）
    - updateSkus 删 SKU 未检查 OrderItem → 假阳性（代码用 status=INACTIVE 软删，无需 FK 检查）
    - triggerRefund 无补偿 → 假阳性（C6 已实现 retryStaleRefundingRequests cron）
    - forceRelogin 800ms 延迟 → 假阳性（与 admin 端一致的既定 UX）
    - 并发写 Company / transferOwner + inviteStaff / 库存 vs 改价 → 假阳性（Serializable + unique 约束已覆盖，现实无 1ms 并发）
    - CompanyProfile 多处 create → 假阳性（schema 有 unique，upsert 安全）
    - tempToken 倒计时文案 → Medium 级别 UX 建议
    - account-security 无 RequireRole → 设计如此（员工可改自己）
  - **延后的（Medium 可改进项）**:
    - seller SMS 登录补 loginFailCount（与 admin C50 同构）
    - seller-shipping generateWaybill 加 assertFeatureAllowed 信用分检查
    - Logger 敏感信息脱敏审查
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C50** — 管理后台安全/UX 小修一批（2026-04-19 新增，当日完成）
  - **背景**: 4 路 Agent 审查管理后台相关代码后，亲自核实误报率约 70%；真问题精简为 5 条，一次性修完
  - **实际做了（5 文件）**:
    - 🔐 `admin-auth.service.ts:loginByPhoneCode` 加 `loginFailCount` 递增 + 5 次失败锁 30 分钟（与 login() L12 一致，原 SMS 登录缺该保护）
    - 🔐 `admin-users.service.ts:remove` 禁止删除自己（`id === operatorId` 即抛 ForbiddenException）
    - 🛡️ `merchant-application.service.ts:create` 加 7 天拒绝冷却期，防被拒商户刷屏重提交
    - 🎨 `admin/src/pages/companies/detail.tsx` 重置密码 Modal 补 `destroyOnClose`
    - 🎨 `account-security/index.tsx`（admin + seller）双 SMS Label 加手机号脱敏提示，避免填反
  - **未做的（Agent 误报）**:
    - admin-coupon 缺 service → 假阳性（故意复用 `../coupon/coupon.service`）
    - 提现 Float 无幂等 → 假阳性（Serializable + status CAS + frozen CAS 齐全）
    - arbitrate 退款不原子 → 假阳性（有 C6 补偿 cron）
    - transferOwner 缺 retry → 低概率事件，v1.1 优化
    - OTP 未绑定 adminUserId → 假阳性（OTP 发到 admin.phone 已物理隔离）
    - Logout AccessToken 仍可用 → 假阳性（AdminJwtStrategy.validate 每次查 session.expiresAt）
    - Product 缺 companyId 单列索引 → 假阳性（复合索引前缀已覆盖）
  - **延后（Medium 可改进项）**:
    - 密码最短 6 位偏弱 → 生产前升级到 12 位
    - SmsOtp 复合索引 `(phone, purpose, expiresAt)` → 量大后优化
    - Logger 部分含敏感数据（amount、phone 明文）脱敏审查
  - 状态: ✅ | 完成日期: 2026-04-19

- [x] **C40d** — app.json 重复条目清理 + OTA 推送验证（2026-04-19 新增，清理部分已完成）
  - **修改**:
    - `app.json` 删除 intentFilters 数组里重复的第二个对象（line 30-44）
    - `app.json` 删除 associatedDomains 数组里重复的 `"applinks:app.xn--ckqa175y.com"`（line 51）
  - **OTA 验证**（首次 .apk 装上后做一次，待用户手动测试）:
    - 改一行明显的 JS（比如首页标题）
    - `eas update --branch preview -m "test OTA"`
    - 重启 App 看是否拉到新版本（可能需要冷启动 1-2 次）
  - **验收**:
    - [x] app.json 数组无重复（intentFilters 去重 + associatedDomains 去重）— 2026-04-19
    - [ ] OTA 推送 30 秒内拉到，前端可见改动 — 待 .apk 装机测试
    - [ ] 控制台能看到 `[Updates] update applied` 日志 — 待 .apk 装机测试
  - **预估**: 30 分钟
  - 状态: ✅ 清理完成 | ⏳ OTA 验证待 .apk 装机

- [ ] **C40f** — DDL 首启闪网页用 mask 包装 + Custom Tab 美化（2026-04-20 新增）
  - **背景**: 首次安装 App 首次打开时，`app/_layout.tsx` 的 `performDeferredLinkCheck` 会用 `WebBrowser.openAuthSessionAsync` 拉起 Chrome Custom Tab 去 `app.ai-maimai.com/resolve` 读 cookie，以完成 Deferred Deep Link 推荐码自动绑定。目前已做的缓解：DDL 检查延迟 3s（不再打断 splash 动画）+ 新增 `app/referral.tsx` 兜底（scheme 回跳不再落 +not-found）。但 Custom Tab 本体还是会在首页出现后闪一下，用户感知为"莫名弹出浏览器"。Cookie 通路业务上必须保留（自动绑定准确率远高于指纹兜底），所以方向是"让这段闪变得看起来像一个正常功能"
  - **技术限制**: Custom Tab 是 Android 系统级 Activity，盖在整个 App 窗口之上。**RN 层的任何 Modal/View 都在 Custom Tab 下面**，无法真正"挡住"浏览器。mask 只在 Custom Tab 打开前 + 关闭后可见。但通过时间差和前置文案，用户会把这段流程感知为"App 在查推荐关系"而不是"Bug"
  - **修改**（只改 `app/_layout.tsx` 一个文件）:
    - 加一个 `ddlMasking` 状态（`'idle' | 'querying' | 'done'`）
    - 包住 `performDeferredLinkCheck` 调用：调用前 setState `'querying'`，finally 块里先 `'done'` → 500ms 后 `'idle'`
    - 根视图加全屏 `<View>` 覆盖层（非 Modal，用绝对定位 + `zIndex: 9999`）：`'querying'` 状态显示"正在查询推荐关系..." + ActivityIndicator，`'done'` 显示"查询完成"（淡出动画）
    - 给 `openAuthSessionAsync` 加第三个参数 `{ toolbarColor: '#2E7D32', showTitle: false, enableBarCollapsing: true }` 让浏览器视觉更贴近 App 品牌色
    - 保险：mask 最长存活时间 6s（5s WebBrowser 超时 + 1s buffer），防止异常情况卡住
  - **不动的边界**:
    - 不改 `app/referral.tsx` / `app/index.tsx` / `src/services/deferredLink.ts`
    - 不改 Linking 订阅逻辑（Universal Link 流程）
    - 不改 `useAuthStore:70-85` 登录后自动绑定逻辑
    - 不改指纹兜底（`matchByFingerprint`）
    - 不改 `markDDLChecked` 时机
  - **验收**:
    - [ ] 清除 App 数据首启 → 看到 "正在查询推荐关系..." mask → 浏览器闪 → mask "查询完成" 淡出 → 回到首页（核心场景）
    - [ ] 第二次冷启 → mask 不出现（已 `markDDLChecked` 跳过 DDL）
    - [ ] Universal Link 点击进入（`app.ai-maimai.com/r/XXXX`）→ 走 Linking 订阅直接存 pending code，不触发 mask（说明没误走 DDL 通路）
    - [ ] 我的 → 推荐码 → 扫二维码 / 手动输入 → 正常绑定（说明未破坏手动路径）
    - [ ] 登录/注册成功 → `pending_referral_code` 自动绑定成功（说明未破坏登录后自动绑定）
    - [ ] WebBrowser 异常（断网/超时）→ mask 最长 6s 强制消失，不永久卡屏
  - **推送方式**: 全 JS 改动，无原生层变化，`eas update --branch preview` OTA 推送即可，无需重打 APK
  - **预估**: 1-2 小时
  - 状态: ⬜

- [ ] **C40e** — 生产上线 mock/sandbox → 真实切换 checklist（2026-04-19 新增）
  - **背景**: 测试环境很多走 mock 或第三方沙箱，生产前必须全部切真。汇总成单一清单避免遗漏
  - **服务器 `/www/wwwroot/aimaimai-prod-src/backend/.env` 修改项**:
    - [ ] `NODE_ENV=production`
    - [ ] `SMS_MOCK=false`
    - [ ] `WECHAT_MOCK=false`
    - [ ] `SF_ENV=PROD` + `SF_API_URL` 改生产域名 + 凭证换生产 clientCode/checkWord
    - [ ] `ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do`（去掉 -sandbox）
    - [ ] `ALIPAY_ENDPOINT=https://openapi.alipay.com`
    - [ ] `ALIPAY_NOTIFY_URL=https://api.ai-maimai.com/api/v1/payments/alipay/notify`
    - [ ] `SF_CALLBACK_URL=https://api.ai-maimai.com/api/v1/shipments/sf/callback`
    - [ ] 支付宝四件套证书替换为生产证书（appCertPublicKey / alipayCertPublicKey / alipayRootCert）
    - [ ] `CORS_ORIGINS=https://admin.ai-maimai.com,https://seller.ai-maimai.com,https://ai-maimai.com,https://www.ai-maimai.com,https://xn--ckqa175y.com,https://www.xn--ckqa175y.com,https://app.xn--ckqa175y.com,https://admin.xn--ckqa175y.com,https://seller.xn--ckqa175y.com`（去掉 test-* 和 localhost；必须含中文域名 Punycode `xn--ckqa175y.com`，否则中文域名被拦）
    - [ ] 数据库 URL 改 `aimaimai` 库 + 生产密码
  - **代码层切换**:
    - [ ] App `app/about.tsx` 删除版本信息里的 "(Mock)" 字样
    - [ ] `backend/src/modules/captcha/captcha.service.ts` NODE_ENV=test bypass 不影响生产
    - [ ] `backend/src/modules/shipment/sf-express.service.ts` NODE_ENV=test mock 不影响生产
  - **第三方平台后台改地址**:
    - [ ] 支付宝沙箱后台 → 生产应用：应用网关填 `https://api.ai-maimai.com/api/v1/payments/alipay/notify`
    - [ ] 顺丰丰桥生产环境推送地址：`https://api.ai-maimai.com/api/v1/shipments/sf/callback`
    - [ ] 微信开放平台回调地址（如启用微信登录）
  - **EAS Build 切换**:
    - [ ] App 用 `eas build --profile production --platform android`（连生产 API）
    - [ ] iOS 同上 + TestFlight 提交
  - **验收**:
    - [x] 生产 PM2 进程 `aimaimai-api-prod` online
    - [x] 浏览器/真实手机端连生产域名能完整跑全链路
    - [x] 真实支付宝小额转账 1 元成功 + 退款成功
    - [x] 真实顺丰下单成功 + 物流推送回调成功
    - [x] 微信登录（如启用）成功
  - **预估**: 0.5 天（不含上面 C40c4 等子项依赖）
  - 状态: ⬜

**第四批完成判定**:
- [x] 测试环境四个子域名 HTTPS 可访问（test-*.ai-maimai.com 全部 200）— 2026-04-18
- [ ] 生产环境四个子域名 HTTPS 可访问（admin/seller 200，api 502 待启 PM2）
- [x] 测试后端 API 200（`/api/v1/captcha` 验证）— 2026-04-18
- [ ] 生产后端 health check 200
- [x] 测试管理后台可登录（admin/123456，bundle 内嵌 test-api 正确）— 2026-04-18
- [ ] 生产管理后台可登录
- [ ] App TestFlight 可下载

---

### 第五批：阶梯上线 + 回归测试

> 依赖: 第四批部署完成。按阶梯顺序逐级 smoke test。

- [ ] **C47** — Smoke: 后端基础（health + PM2 + logs）
- [ ] **C48** — Smoke: 管理端（登录 + 改密 + Company 创建 + Dashboard）
- [ ] **C49** — Smoke: 卖家端（种子商户登录 + 商品发布 + 审核 → App 可见）
- [ ] **C50** — Smoke: 官网（首页 + 入驻表单 + 推荐码落地页）
- [ ] **C51** — Smoke: App TestFlight（登录 + 加购 + 支付 + 抽奖 + VIP + 客服 + 退款）
- [ ] **C52** — Smoke: 监控告警触发 + 备份恢复演练
- [ ] **C53** — 阶梯灰度：500 种子用户接入 + 48h 无 P0 事件

**第五批完成判定**:
- [ ] 首批 500 用户可正常使用核心链路
- [ ] 48 小时无 P0 事件
- [ ] 监控响应时间 < 5 分钟

---

### 第六批：Tier 2 待补项（v1.0 可带可不带）

> 详细 48 项见 [审查报告 §7](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)。
> 按模块分组，优先级由高到低。

**L7 退换货规则完善** (T01-T06): 库存回填 / App 售后类型过滤 / 质量问题时限 / NORMAL_RETURN_DAYS guard / 运费记账 / 奖励归平台补偿
**L11 发票入口** (T07-T09): 订单详情"申请发票" / 个人中心入口 / invoiceStatus API
**L02 AI 开关激活** (T10-T13): 语义字段填充 / 三个 _ENABLED 打开 / 假 AI 下线或真接
**L15 非钱事件补接** (T14-T18): 订单/发货/签收/售后通知 / 离线客服兜底 / 幂等键 / 清理 Cron
**L17 溯源补齐** (T19-T24): ProductTraceLink / TraceEvent API / 类型对齐 / App 真实接入
**L10 卖家优化** (T25-T28): 溯源选择器 / REJECTED 编辑死锁 / 上传保护 / 描述 MinLength
**L5/L6 分润监控** (T29-T33): unlockedLevel 回退 / ruleType REFUND_ROLLBACK / 参数重命名 / BFS 确认 / giftSkuId 清理
**L12 管理一致性** (T34-T37): 权限码统一 / 死权限删 / 审计 URL / 入驻菜单
**L14 红包** (T38-T40): 重复 ID 防御 / P2002 文案 / 分摊 invariant
**L16 地址** (T41-T42): 默认地址事务化 / 行政区划 Picker
**L9 客服** (T43-T45): 死代码清理 / Socket.IO 客户端 / 工单 category
**横切** (T46-T48): Serializable 统一 / Payment 幂等核查 / money.util.ts

---

## 📋 待你确认的疑点（从审查报告 §9 搬来）

> 每条回答后在此处标注你的选择 + 日期

### 🔴 必须立即回答

| # | 疑点 | 你的选择 | 日期 |
|---|---|---|---|
| Q1 | 红包退款是否归还？ | ✅ **红包不退回。退款金额按比例计算**：如果订单用了红包，退款商品只退实付金额（按比例扣除红包抵扣部分），不退原价，否则平台亏。代码不需要改（与 refund.md 一致） | 2026-04-13 |
| Q2 | 审核通过是否自动上架？ | ✅ **A. 自动上架** — `audit()` 同步 `status: 'ACTIVE'` | 2026-04-13 |
| Q3 | OrderItem.unitPrice 是否已扣减优惠？ | ✅ **A. 已扣减（安全）** — 分润利润计算基础正确 | 2026-04-13 |

### 🟡 本周回答

| # | 疑点 | 你的选择 | 日期 |
|---|---|---|---|
| Q4 | 假 AI（品质评分/信赖分/摘要）如何处理？ | ✅ **A. 下线 UI 等真后端** | 2026-04-13 |
| Q5 | couponUsage/VIP激活失败是否补偿队列？ | ✅ **A. 不加（3次重试够了）** | 2026-04-13 |
| Q6 | 多商户运费？ | ✅ **运费全部由平台支付，不考虑商家**。一个订单多商家算一个总运费，商家不管。不存在"分摊"问题 | 2026-04-13 |
| Q7 | VIP 推荐人子树全满降级到系统节点？ | 🟡 **待核对** — 用户指出理解有误，需重新研读 VIP 树生长规则后确认 | 2026-04-13 |
| Q8 | 发票功能是否整体下线 v1.1？ | ✅ **A. 保留但补入口**（订单详情+个人中心+invoiceStatus） | 2026-04-13 |
| Q9 | 客服生产超时值确认？ | ✅ **A. 文档默认**（SESSION_IDLE=2h / QUEUING=30m / AGENT_IDLE=60m） | 2026-04-13 |
| Q10 | Qwen 宕机降级策略？ | ✅ **A. v1.0 不需要熔断器**（当前 fallback 可接受） | 2026-04-13 |

### 🟢 可延后

| # | 疑点 | 你的选择 | 日期 |
|---|---|---|---|
| Q11-Q17 | 详见 [审查报告 §9](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md) | — | — |

---

## 📦 v1.1+ 推迟项（明确不在 v1.0）

- 微信支付
- 微信登录
- 可配置标签系统（TagCategory/CompanyTag）
- 发现页筛选栏动态化
- 五大新功能 F1-F5（订单流程重构/赠品锁定/奖品过期/平台公司/奖励过期）
- VIP 赠品多 SKU 组合
- 推荐码延迟深度链接真机验证
- 语义意图升级完整实施（spec 已写但代码未激活）
- 任务/签到中心
- 关注/社交互动
- CompanyRole/CompanyPermission 卖家端自定义权限
- 设备指纹 + 异地登录二次验证

---

## 📚 历史记录

- **2026-02 至 2026-03**: Phase 1-10 全栈开发，见 `docs/reference/plan-history-2026Q1.md`
- **2026-04-11**: 17 条链路 + 6 项横切关注点上线就绪审查，见 `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md`
- **2026-04-12**: 新 plan.md 基于审查结果重写，旧 plan.md 归档
- **2026-04-15~16**: Web 端 E2E 自动化测试体系搭建（详见下方）
- **2026-04-17~18**: 服务器换 OS（CentOS 7 → Alibaba Cloud Linux 3，抛弃 Docker 改 Node 直装），8 个域名 + SSL 全部就绪，测试环境（test-admin/test-seller/test-api）全链路上线，GitHub Actions 双分支（staging/main）自动部署链路打通
- **2026-04-19**: 测试环境联通性审查（三端前端 + 后端 + DB + CORS 全部 ✅）；EAS Build 全套配置（eas.json 三档 + expo-updates OTA + 第一次 Android .apk 构建成功）；CORS/ALIPAY_NOTIFY_URL 修正；注册/登录真实闭环缺口审计；plan.md 拆解 C40c1~c6 + C40d/C40e（含管理员管理页/商户入驻审核页/SMS真实/微信登录/Apple登录/邀请通知/app.json 清理/生产切换 checklist 共 8 个新任务）
- **2026-04-19 下午**: C40c2 方案修订（发现 `companies/applications-tab.tsx` 已完整实现，改为只加菜单快捷入口，从 P0 1 天降为 P2 15 分钟）；确立三段式环境策略（本地 mock / Staging 真实 SMS + 支付宝沙箱 / 生产全真实），C40c3 升级 P0；新增账号管理三大补全任务 C40c7 账号安全页 + C40c8 管理员兜底重置密码 + C40c9 管理员员工 CRUD 完整化（含换 OWNER），合计新增约 3 天工作量
- **2026-04-20**: 首次真机 APK 测试暴露两个首启 bug（splash "农脉"只显"农" + DDL 拉起 Custom Tab 打断启动 + scheme 回跳落 +not-found "no router"）；即时修复：splash 文案改 "爱买买" + letterSpacing 14→6 + 新增 `app/referral.tsx` 兜底 + DDL 延迟 3s（缓解，非根治）；追加 C40f 任务（mask 包装 + Custom Tab 美化）根治首启闪网页体验问题

---

## 🧪 E2E 测试体系（2026-04-15~16 搭建）

**测试计划**: `docs/testing/2026-04-15-webapp-test-plan.md`
**技术栈**: `@playwright/test` + TypeScript，工作区在 `tests/`
**CI**: `.github/workflows/e2e.yml`（PR 时自动跑）

### 测试结果：54 passed / 0 failed / 24 skipped

| 类别 | passed | 内容 |
|------|--------|------|
| 登录 Setup | 2 | admin + seller 登录态自动获取 |
| Smoke | 3 | admin 登录、seller landing、admin 导航 |
| 核心链路 | 5 | C01 商户审核、C02 商品上架、C03 订单流转、C05 红包、seller 商品 |
| 安全/隔离 | 14 | 登录负面×4、跨商户隔离×3、seller 权限矩阵×4、admin 401/403×3 |
| 表单边界 | 5 | 空提交、负成本、超长、XSS、零库存 |
| CRUD 页面 | 21 | 商户/分类/运费/管理员/商品/抽奖/标签/VIP/FAQ/快捷回复/角色 列表加载+基础操作 |
| 跨端/并发 | 4 | 订单发货端到端、登录限流、新建标签/快捷回复 |

### 修复的 bug（测试过程中发现并修复）
- ✅ Migration AfterSaleRequest 大小写不一致（2 个 migration 文件）
- ✅ CompanyTag.sortOrder 字段 migration 缺失（新增补丁 migration）
- ✅ CS 模型 migration 完全缺失（新增 `20260416010000_add_customer_service_models`）
- ✅ 种子 OrderItem 缺 companyId（44 条回填，解锁卖家订单测试）
- ✅ 前端产地"选填"但后端必填（seller 商品编辑页 + 后端 DTO 对齐）
- ✅ 商品 DTO 缺长度限制（title @MaxLength(100)、description @MaxLength(5000)、origin 结构化）
- ✅ antd message 静默（admin/seller 两端加 `<AntdApp>` 包裹）
- ✅ Expo Web 隐私弹窗不显示（Modal 在 web 端改用绝对定位 View）

### 发现的前端 bug（未修，记录）
- ⚠ seller `RequireRole` 竞态：profile 未加载完成时直接 redirect，刷新 `/company/settings` 会弹回首页
  - 位置：`seller/src/App.tsx:40` — `if (!seller) return <Navigate to="/" />`
  - 修法：加 loading 状态判断，`seller === undefined` 时渲染 Spin 而非 redirect

### 测试基础设施改动（仅 tests/ 目录 + 少量后端 bypass）
- `backend/src/modules/captcha/captcha.service.ts` — NODE_ENV=test captcha bypass
- `backend/src/modules/shipment/sf-express.service.ts` — NODE_ENV=test SF 面单 mock
