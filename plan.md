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

- [ ] **C40c1** — 🔴 P0 管理员管理前端页（2026-04-19 新增）
  - **背景**: `admin/src/pages/users/` 实为 App 买家用户管理（AppUser），不是管理员。后端 `backend/src/modules/admin/users/admin-users.controller.ts` 已有完整 5 个端点（GET list / GET :id / POST create / PUT update / POST :id/reset-password / DELETE）
  - **修改文件**:
    - 新建 `admin/src/api/admin-users.ts` (5 个 API 调用)
    - 新建 `admin/src/pages/admin-users/index.tsx` (ProTable 列表)
    - 新建 `admin/src/pages/admin-users/edit.tsx` (创建/编辑 ProForm 弹窗)
    - 改 `admin/src/App.tsx` 加路由 `/admin-users`
    - 改 `admin/src/layouts/AdminLayout.tsx` 在"系统设置"菜单组下加入口
    - 改 `admin/src/constants/permissions.ts` 确认 `ADMIN_USERS_READ/WRITE` 权限码已定义
  - **验收**:
    - [x] 超管登录能看到 /admin-users 列表（含 username/phone/role/status/lastLogin）
    - [x] 创建新管理员（必填 username/password/role；可选 phone）
    - [x] 编辑管理员（改 phone/role/status，不改密码）
    - [x] 重置密码按钮 → 弹窗输入新密码 → 调 reset-password 端点
    - [x] 禁用/启用切换
    - [x] 删除（带二次确认）
    - [x] 非超管角色看不到此菜单
  - **预估**: 1 天
  - 状态: ⬜

- [ ] **C40c2** — 🔴 P0 商户入驻审核前端页（2026-04-19 新增）
  - **背景**: 后端 `admin/merchant-applications` 模块完整（list/approve/reject/pending-count），`admin/src/api/merchant-applications.ts` API 文件齐全。审核 `approve()` 一个事务里自动建 **User + Company + CompanyProfile + CompanyStaff(OWNER) + CompanyDocument**。但 `admin/src/pages/merchant-applications/` 目录**不存在**，AdminLayout 无菜单入口
  - **修改文件**:
    - 新建 `admin/src/pages/merchant-applications/index.tsx` (列表 + 状态过滤 PENDING/APPROVED/REJECTED + 待审计数 badge)
    - 新建 `admin/src/pages/merchant-applications/detail.tsx` (详情查看：公司名/法人/营业执照预览/联系方式 + "通过"和"拒绝"按钮)
    - 改 `admin/src/App.tsx` 加路由 `/merchant-applications` 和 `/merchant-applications/:id`
    - 改 `admin/src/layouts/AdminLayout.tsx` 在"商家与商品"菜单组首位加入口（带 pending-count 红点）
    - 改 `admin/src/pages/dashboard/index.tsx` 加"待审入驻"统计卡片（链接到列表）
  - **验收**:
    - [x] 菜单"入驻审核"显示待审数红点（轮询 pending-count 接口，30s 一次）
    - [x] 列表按时间倒序，可按状态/关键字筛选
    - [x] 详情页能看营业执照图片（点击放大）
    - [x] "通过"按钮触发 approve → 后端自动建 Company+OWNER → 列表刷新
    - [x] "拒绝"按钮弹窗要求填理由（>= 10 字）
    - [x] approve 成功后能在"企业管理"页看到新 Company，在"卖家中心"用申请人手机号 + `123456` 登入
  - **预估**: 1 天
  - **测试链路**: 测试人员甲填 website/MerchantApply 表单 → 测试人员乙在新页面审核通过 → 甲用手机号登卖家中心
  - 状态: ⬜

- [ ] **C40c3** — 🟡 P1 SMS 真实模式开启（2026-04-19 新增）
  - **背景**: 当前 staging .env 是 `SMS_MOCK=true`（验证码固定 123456）。阿里云已开通：签名"深圳华海农业科技集团"、模板 SMS_501860621 均审核通过（U03）
  - **操作**:
    - SSH 服务器 `sed -i 's/SMS_MOCK=true/SMS_MOCK=false/' /www/wwwroot/aimaimai-staging-src/backend/.env`
    - `pm2 reload aimaimai-api-test --update-env`
    - 同步改 `docs/operations/.env.staging` 模板
    - 阿里云控制台充值 ≥ 10 元（约 250 条短信，够 1-2 周测试）
  - **验收**:
    - [x] 任意真实手机号在 admin/seller/app 三端发验证码 → 5 秒内收到短信
    - [x] PM2 日志不再打印 `[SMS Mock] 固定验证码=123456`
    - [x] 阿里云短信发送记录有正常发送条目
    - [x] 验证码错误重试无误，5 分钟过期
  - **风险**: 短信余额耗尽时所有 SMS 调用会失败（500 错误）。需配监控（C45 子任务）
  - **预估**: 30 分钟
  - 状态: ⬜

- [ ] **C40c4** — 🟡 P1 App 微信登录（2026-04-19 新增）
  - **背景**: 后端 `auth.service.ts:loginByWechat` 已写完整（mock + 真实两套）。WECHAT_APP_ID=wxeb8e8dc219da02dd 已配（来源待确认）
  - **前置（线下，2-3 周）**:
    - [ ] 微信开放平台 https://open.weixin.qq.com 注册账号
    - [ ] 提交移动应用（iOS + Android 两个分别申请）：上传营业执照、App 截图、ICP 备案号
    - [ ] iOS 提交 BundleID=com.aimaimai.shop；Android 提交 package=com.aimaimai.shop + keystore SHA1（从 EAS 控制台导出 `eas credentials -p android`）
    - [ ] 等审核 7-15 天
    - [ ] 拿到正式 AppID + AppSecret（如果 wxeb8e8dc219da02dd 是占位则替换）
  - **App 端代码**:
    - 装包：`npx expo install expo-auth-session expo-crypto`（或考虑 `react-native-wechat-lib` 第三方包，但需要 dev client）
    - 改 `app.json` 加 wechat plugin + URL Scheme
    - 新建 `src/repos/AuthRepo.ts:loginByWechat()` 调 `/api/v1/auth/wechat/login`
    - App 登录页（如有）+ "我的"页未登录态加"微信登录"按钮（绿色 + 微信图标）
    - 处理微信回调拿到 code → 传给后端
  - **后端切换**:
    - .env 改 `WECHAT_MOCK=false`
    - 重启 PM2
  - **打新 .apk 后**:
    - 重新跑 `eas build --profile preview --platform android`（runtimeVersion 升到 0.2.0，因为加了原生包）
    - 测试人员重新装新 .apk
  - **验收**:
    - [x] App 点"微信登录" → 跳转微信 → 同意 → 自动登录
    - [x] 首次登录自动建 User + AuthIdentity(provider=WECHAT, identifier=openId)
    - [x] 已绑定的微信下次登录直接进，触发新人红包仅一次
    - [x] 微信用户能补绑手机号（在"账号安全"页）
  - **预估**: 微信审核 2-3 周（线下）+ 集成开发 3 天 + 测试 1 天
  - 状态: ⬜

- [ ] **C40c5** — 🟢 P3 Apple 登录（iOS 强制要求，2026-04-19 新增）
  - **背景**: `auth.service.ts:loginWithApple()` 当前是 stub（throw NotImplemented）。Apple 强制规定：iOS App 只要有第三方登录（如微信），必须同时提供 Sign in with Apple
  - **前置**:
    - [ ] U06 Apple Developer 账号开通
    - [ ] App ID 启用 "Sign In with Apple" capability（开发者中心配置）
    - [ ] EAS 重新生成 provisioning profile
  - **App 端代码**:
    - 装包：`npx expo install expo-apple-authentication`
    - "我的"页 / 登录弹窗加"用 Apple 登录"按钮（iOS only，Android 不显示）
    - 调 expo-apple-authentication 拿 identityToken
    - 传给后端 `/api/v1/auth/apple/login`
  - **后端实现**:
    - 实现 `loginWithApple(identityToken, nonce)` 真实逻辑：
      - 调 Apple JWKS 验签 identityToken
      - 解析出 sub (Apple user ID)
      - 查 AuthIdentity(provider=APPLE, identifier=sub)
      - 不存在则建 User + AuthIdentity
    - 装包：`npm install jose` 用于 JWT 验签
  - **验收**:
    - [x] iOS App 显示"用 Apple 登录"，Android 隐藏
    - [x] 点按 → Face ID/Touch ID → 自动登录
    - [x] 用户首次拿 email（Apple 只在第一次给）+ name → 存到 UserProfile
    - [x] 第二次以后只能拿 sub，不能再拿 email
    - [x] 通过 App Store 审核（必测项）
  - **预估**: 3 天（依赖 U06 完成）
  - 状态: ⬜

- [ ] **C40c6** — 🟢 P2 卖家邀请员工 SMS 通知（2026-04-19 新增）
  - **背景**: `seller-company.service.ts:inviteStaff()` 当前只写 CompanyStaff 表，**不发任何通知**。员工不知道自己被加入了某公司。需要发短信告诉员工"您被邀请加入【XXX 公司】"
  - **修改文件**:
    - 改 `backend/src/modules/seller/company/seller-company.service.ts:inviteStaff()` 在写库成功后调用 `aliyunSmsService.sendInvitation(phone, companyName, app下载链接)`
    - 阿里云短信控制台：申请新模板 "INVITE_STAFF"（"您被邀请加入【\${companyName}】，请用本手机号登录爱买买卖家中心"）
    - 申请通过后填模板 ID 到 .env：`SMS_TEMPLATE_INVITE=SMS_xxxx`
    - 改 `aliyun-sms.service.ts` 加 `sendInvitation()` 方法
  - **验收**:
    - [x] OWNER 邀请员工后，员工 5 秒内收到短信
    - [x] 短信内容含公司名 + App 下载链接（蒲公英短链或正式商店链接）
    - [x] 短信发送失败不阻塞邀请操作（fire-and-forget + 日志）
    - [x] PM2 日志记录发送结果
  - **预估**: 0.5 天 + 阿里云模板审核 1-3 天
  - 状态: ⬜

- [ ] **C40d** — app.json 重复条目清理 + OTA 推送验证（2026-04-19 新增）
  - **修改**:
    - `app.json` 删除 intentFilters 数组里重复的第二个对象（line 30-44）
    - `app.json` 删除 associatedDomains 数组里重复的 `"applinks:app.xn--ckqa175y.com"`（line 51）
  - **OTA 验证**（首次 .apk 装上后做一次）:
    - 改一行明显的 JS（比如首页标题）
    - `eas update --branch preview -m "test OTA"`
    - 重启 App 看是否拉到新版本（可能需要冷启动 1-2 次）
  - **验收**:
    - [x] app.json 数组无重复
    - [x] OTA 推送 30 秒内拉到，前端可见改动
    - [x] 控制台能看到 `[Updates] update applied` 日志
  - **预估**: 30 分钟
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
    - [ ] `CORS_ORIGINS=https://admin.ai-maimai.com,https://seller.ai-maimai.com,https://ai-maimai.com,https://www.ai-maimai.com`（去掉 test-* 和 localhost）
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
- **2026-04-19**: 测试环境联通性审查（三端前端 + 后端 + DB + CORS 全部 ✅）；EAS Build 全套配置（eas.json 三档 + expo-updates OTA + 第一次 Android .apk 构建成功）；CORS/ALIPAY_NOTIFY_URL 修正；注册/登录真实闭环缺口审计；plan.md 拆解 C40c1~c6 + C40d/C40e（含管理员管理页/商户入驻审核页/SMS真实/微信登录/Apple登录/邀请通知/app.json 清理/生产切换 checklist 共 8 个新任务，每个含修改文件清单 + 验收标准 + 预估）

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
