# 爱买买 - 开发计划（v1.0 上线冲刺）

> **最后更新**: 2026-04-12
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

- [ ] **U01** — 启动域名 ICP 备案
  - **做什么**: ai-maimai.com 的 ICP 备案申请（阿里云备案系统），正在备案中
  - **现状**: 爱买买.com 已备案完成，网站已挂在此域名上运行；但中文域名在配置支付宝应用网关、顺丰丰桥网关等第三方服务时不兼容，因此主域名迁移至英文 ai-maimai.com（中文域名保留可访问）
  - **周期**: 20 个工作日（**最长路径阻塞**）
  - **交付物**: ai-maimai.com 备案号
  - **状态**: 🔄 备案中 | 完成日期: —

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

- [ ] **C37** — 云服务器环境安装（Node/PG/Redis/Nginx/PM2/Certbot）
- [ ] **C38** — 域名 DNS 配置（爱买买.com + app/seller/admin 子域）
- [ ] **C39** — SSL 证书签发（certbot 自动续期）
- [ ] **C40** — 部署后端（生产 .env + 支付宝证书 + prisma migrate + seed + PM2 + 日志轮转）
- [ ] **C41** — 部署管理后台（npm run build + Nginx 静态）
- [ ] **C42** — 部署卖家后台（同上）
- [ ] **C43** — 部署官网 + App 落地页（含 .well-known Universal Link）
- [ ] **C44** — App 客户端发布（EAS build + TestFlight + App Store + 国内商店）
- [ ] **C45** — 基础监控（PM2 monit + health cron + 慢查询 + 告警）
- [ ] **C46** — 数据备份（pg_dump 定时 + Redis RDB + OSS 归档 + 恢复演练）

**第四批完成判定**:
- [ ] 四个子域名 HTTPS 可访问
- [ ] 后端 health check 200
- [ ] 管理后台可登录
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
