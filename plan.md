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

---

## 🚀 实施路线图

### 第零批：立即启动的线下事项（并行进行，不等代码）

> 这些是用户线下操作，和代码修复完全并行。**ICP 备案 20 个工作日是整个项目的最长阻塞路径**。

- [ ] **U01** — 启动域名 ICP 备案
  - **做什么**: 提交爱买买.com 的 ICP 备案申请（阿里云/腾讯云备案系统）
  - **周期**: 20 个工作日（**最长路径阻塞**）
  - **交付物**: 备案号
  - **状态**: ⬜ | 完成日期: —

- [x] **U02** — 申请顺丰月结账号 + 丰桥 API 权限
  - **做什么**: 联系顺丰销售 → 签月结协议 → 拿到 12 位月结号 → 注册丰桥企业认证 → 创建应用 → 审批 5 个 API（下单/查询/推送/取消/面单）
  - **周期**: 3-7 天（月结）+ 1-3 天（丰桥认证）+ 1-3 天（API 审批）
  - **交付物**: 月结号 + clientCode + checkWord + 沙箱 URL
  - **成本**: 5k-20k 元保证金（可退）
  - **状态**: ✅ | 完成日期: 2026-04-11 — 月结卡号 7551253482、丰桥应用已创建、10 个 API 已关联、云打印面单已配置

- [ ] **U03** — 核对阿里云 OSS / SMS AccessKey
  - **做什么**: 确认 RAM 子账号 + AccessKey 已创建，OSS Bucket 已建，SMS 签名"爱买买" + 3 个模板（注册/订单/商户审核）已审核通过
  - **交付物**: AK/SK + Bucket 名 + 签名/模板 ID
  - **状态**: ⬜ | 完成日期: —

- [ ] **U04** — 核对支付宝商户号 + 证书
  - **做什么**: 确认 APPID + RSA2 证书四件套（app-private / appCert / alipayCert / alipayRoot）已下载，回调地址配置
  - **周期**: 3-5 天（如尚未申请）
  - **状态**: ⬜ | 完成日期: —

- [ ] **U05** — 购买云服务器
  - **做什么**: 阿里云 ECS 华东杭州 4 核 8G 100GB SSD
  - **成本**: 350-500 元/月
  - **状态**: ⬜ | 完成日期: —

- [ ] **U06** — Apple 开发者账号 + 安卓应用商店账号
  - **做什么**: Apple Developer Program ($99/年) + 华为/小米/OPPO/vivo/应用宝（各需企业资质）
  - **状态**: ⬜ | 完成日期: —

---

### 第一批：💰 钱链路修复（14 项 CRITICAL）

> **最高优先级**。支付/退款/分润/奖励——关于钱的链路必须先修。
> **串行依赖**: C01 必须先做（阻塞 C02/C04/C06）。其余大部分可并行。

- [ ] **C01** — 支付宝退款 API 真实接通
  - **修改**: `backend/src/modules/payment/payment.service.ts` + `payment.module.ts`
  - **做什么**: PaymentService 构造函数注入 AlipayService → initiateRefund() 按 `payment.channel === 'ALIPAY'` 分发到 `alipayService.refund()` → 微信分支 throw NotImplemented
  - **验收**: 小额（0.01 元）真实退款到支付宝账户，Refund 表状态正确
  - **证据**: [审查报告 C01](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)
  - **预估**: 0.5-1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C02** — Order 状态闭环（全退后标 REFUNDED）
  - **修改**: `backend/src/modules/after-sale/after-sale.service.ts`
  - **做什么**: 退款成功回调中检查"该订单所有非奖品项是否都已退" → 是则 `Order.status = REFUNDED`，须与 voidRewards 同事务
  - **验收**: 全额退款后 Order.status = REFUNDED；部分退货后 Order.status 不变
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C03** — `VIP_PLATFORM_SPLIT` 枚举补齐
  - **修改**: `backend/prisma/schema.prisma` AllocationRuleType 枚举
  - **做什么**: 补 `VIP_PLATFORM_SPLIT`（检查是否还缺 `NORMAL_TREE_PLATFORM`）→ prisma migrate → seed 校验
  - **验收**: VIP 订单分润全链路不崩（`npx prisma validate` 通过 + 手动触发一笔 VIP 分润）
  - **预估**: 0.25 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C04** — 售后退款 Cron 前缀修复
  - **修改**: `backend/src/modules/payment/payment.service.ts:91-161`
  - **做什么**: 补偿 Cron 从只扫 `AUTO-` 扩到同时扫 `AS-` / `AS-TIMEOUT-` 前缀
  - **验收**: 售后退款 REFUNDING 状态 > 10 分钟后被 Cron 接管重试
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C05** — App 退货物流字段名修复
  - **修改**: `src/repos/AfterSaleRepo.ts` 或 `backend/src/modules/after-sale/dto/return-shipping.dto.ts`
  - **做什么**: 统一 `{carrierName, waybillNo}` → `{returnCarrierName, returnWaybillNo}`（建议改 App 侧）
  - **验收**: 买家填寄回单号不再 400
  - **预估**: 0.25 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C06** — 退款 setImmediate 补持久化重试
  - **修改**: `after-sale.service.ts` / `seller-after-sale.service.ts` / `admin-after-sale.service.ts` / `after-sale-timeout.service.ts`
  - **做什么**: 最少加一个 Cron 扫 AfterSaleRequest status=REFUNDING 且 updatedAt > 10min 的记录做重试
  - **验收**: 进程重启后 REFUNDING 的售后不会永久卡住
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C07** — 分润 rollbackForOrder TOCTOU 修复
  - **修改**: `backend/src/modules/bonus/engine/bonus-allocation.service.ts`
  - **做什么**: 将 `findMany(allocations)` 移入 `$transaction` 内部，或事务内重新读取 ledger 状态再聚合
  - **验收**: 并发 freeze-expire + rollback 场景下 account.frozen 无漂移
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C08** — rollback 事务 timeout + VIP exitedAt 回退
  - **修改**: `bonus-allocation.service.ts`
  - **做什么**: (a) rollback 事务加 `timeout: 30000, maxWait: 5000`；(b) 检查退款订单是否是导致 VipProgress.exitedAt 被写入的那一单，如果是则清空 exitedAt
  - **验收**: rollback 不超时；退款后 VIP 不被错误标"出局"
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C09** — WITHDRAWN ledger 退款追缴任务
  - **修改**: `bonus-allocation.service.ts`
  - **做什么**: WITHDRAWN 场景补写持久化追缴任务表 + AdminAuditLog + 告警（不仅仅 warn 日志）
  - **验收**: 退款时若分润已提现，管理后台可看到追缴任务
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C10** — R12 超卖卖家补货通知
  - **修改**: `backend/src/modules/order/checkout.service.ts:1261-1264`
  - **做什么**: 检测 stock < 0 后调 InboxService.send 通知卖家"SKU=X 超卖 N 件，请补货"
  - **验收**: 超卖时卖家 Inbox 收到通知
  - **预估**: 0.25 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C11** — AlipayService 证书加载失败 production 抛出
  - **修改**: `backend/src/modules/payment/alipay.service.ts:66-68`
  - **做什么**: production 环境证书加载失败改 throw（让容器 crash，不静默降级）
  - **验收**: 缺证书时 NestJS 启动失败
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C12** — InboxService 钱相关 9 个事件接入
  - **修改**: 分布在 `bonus/engine/*` / `admin-bonus.*` / `after-sale.*` / `coupon.*` 等多个模块
  - **做什么**: 分润到账 / 解冻 / 过期 / 提现通过 / 拒绝 / VIP 邀请奖励 / 退款到账 / 红包到账 / 红包过期 — 共 9 个场景补接 `InboxService.send()`
  - **同时**: 前端 `src/types/domain/Inbox.ts` InboxType 枚举扩展 + `app/inbox/index.tsx` iconMap 补齐
  - **验收**: 每个事件触发后买家/卖家 Inbox 收到对应消息
  - **预估**: 2-3 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C13** — InboxService 改硬依赖
  - **修改**: `backend/src/modules/order/order.module.ts` + `checkout.service.ts`
  - **做什么**: 去掉 `inboxService: any = null` 软注入，改为正式 constructor DI
  - **验收**: NestJS 启动时如果 InboxModule 未导入会报错（不静默跳过）
  - **预估**: 0.25 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C14** — 红包退款语义澄清（不改代码，需你决策）
  - **做什么**: 回答审查报告 §9 Q1——退款时红包是否按比例归还？当前代码与 refund.md 一致（不退回）
  - **验收**: 你回答 A/B/C 后在此条目标注决策
  - **证据**: [审查报告 §9 Q1](docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md)
  - **状态**: ⬜ | 完成日期: —

**第一批完成判定**:
- [ ] 支付宝真实退款到账（小额测试）
- [ ] Order 状态机闭环（全退 → REFUNDED）
- [ ] VIP 分润全链路不崩
- [ ] rollback 并发无 frozen 漂移
- [ ] 钱相关 9 项 Inbox 事件接入
- [ ] 前后端 InboxType 同步

---

### 第二批：非钱链路 T1 修复（16 项）

> 大部分可并行。C24 + C25 是第三批（顺丰迁移）的硬前置。

- [ ] **C15** — `/admin/replacements` 整条链路 404 清理
  - **修改**: `admin/src/pages/dashboard/` + `admin/src/pages/replacements/` + `admin/src/api/replacements.ts` + `admin/src/App.tsx` 路由 + 菜单 + PERMISSIONS
  - **做什么**: 删除 Dashboard replacement 条目 / 删菜单 / 删路由 / 删页面目录 / 删权限常量 / 更新 audit getTargetUrl
  - **验收**: 管理员登录首页不再 404
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C16** — 前端 PERMISSIONS 补 `dashboard:read`
  - **修改**: `admin/src/constants/permissions.ts`
  - **做什么**: 补 `DASHBOARD_READ = 'dashboard:read'` + 菜单 permission 字段
  - **验收**: 非超管登录首页不再 403
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C17** — 卖家端补账号密码登录
  - **修改**: `seller-auth.dto.ts` + `seller-auth.service.ts` + `seller-auth.controller.ts` + `seller/src/pages/login/`
  - **做什么**: 新增 `SellerPasswordLoginDto` + `loginByPassword` 方法 + `POST /seller/auth/login-by-password` + 前端密码登录 Tab。核对 CompanyStaff.passwordHash 字段是否存在
  - **验收**: 卖家可用手机+验证码 或 账号+密码 两种方式登录
  - **预估**: 1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C18** — 管理端补图形验证码 + 手机号登录
  - **修改**: `admin-auth.*` + `admin-login.dto.ts` + `admin/src/pages/login/`
  - **做什么**: (a) 接入 captcha.service.ts 图形验证码；(b) 新增 `loginByPhoneCode` 方法复用 SmsOtp；(c) 前端 captcha 组件 + SMS 登录 Tab
  - **验收**: 管理员可用 账号密码+captcha 或 手机+短信 两种方式登录
  - **预估**: 1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C19** — 卖家商品权限漏洞修复
  - **修改**: `backend/src/modules/seller/products/seller-products.controller.ts`
  - **做什么**: 所有写操作端点加 `@SellerRoles('OWNER', 'MANAGER')`；读操作放行 OPERATOR
  - **验收**: OPERATOR 角色无法创建/编辑/删除商品
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C20** — 审核通过自动上架（需你先回答 §9 Q2）
  - **修改**: `backend/src/modules/admin/products/admin-products.service.ts:223`
  - **做什么**: 方案 A: audit() 接收 APPROVED 时同时 `status: 'ACTIVE'`；方案 B: 保留现状补通知
  - **验收**: 审核通过后商品可在 App 端搜到
  - **预估**: 0.25 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C21** — 管理端商品 SKU 编辑入口
  - **修改**: `backend/src/modules/admin/products/admin-products.service.ts` + `admin-products.controller.ts` + `admin/src/pages/products/edit.tsx`
  - **做什么**: 补 `PUT /admin/products/:id/skus` 路由 + 服务 + 管理前端 SKU 表单（奖品商品手动定价依赖此项）
  - **验收**: 管理员可在后台编辑商品 SKU 价格和库存
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C22** — 客服 5 个硬编码超时改回生产值
  - **修改**: `cs.service.ts:26` + `cs-cleanup.service.ts:23-34`
  - **做什么**: SESSION_IDLE=7200000 / AI_IDLE=7200000 / QUEUING=1800000 / AGENT_IDLE=3600000 / Cron=EVERY_10_MINUTES
  - **验收**: 客服会话不再 5 秒/10 秒超时
  - **预估**: 5 分钟
  - **状态**: ⬜ | 完成日期: —

- [ ] **C23** — parseChatResponse 补数组包裹解包
  - **修改**: `backend/src/modules/ai/ai.service.ts`
  - **做什么**: 所有 Qwen 调用点加 `Array.isArray(parsed) ? parsed[0] : parsed` 容错（bb29234 只修了客服，L2 还有 3 处未修）
  - **验收**: Qwen 返回 `[{...}]` 格式时不崩
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

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

- [ ] **C26** — `.env.example` 补齐 5 个关键密钥占位
  - **修改**: `backend/.env.example`
  - **做什么**: 补 `ADMIN_JWT_SECRET` / `SELLER_JWT_SECRET` / `PAYMENT_WEBHOOK_SECRET` / `LOGISTICS_WEBHOOK_SECRET` / `WEBHOOK_IP_WHITELIST`
  - **验收**: 新开发者 clone 后一眼能看到所有必配变量
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C27** — `handleAlipayNotify` 补 WebhookIpGuard
  - **修改**: `backend/src/modules/payment/payment.controller.ts:52`
  - **做什么**: 加 `@UseGuards(WebhookIpGuard)` + 配置支付宝公网 IP 段到 `WEBHOOK_IP_WHITELIST`
  - **验收**: 非白名单 IP POST `/payments/alipay/notify` 返回 403
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C28** — 前后端 InboxType 枚举同步
  - **修改**: `src/types/domain/Inbox.ts` + `app/inbox/index.tsx`
  - **做什么**: 扩展联合类型覆盖 C12 新增的 9 种事件类型 + iconMap 添加图标映射
  - **验收**: 所有新消息类型在 App Inbox 页有正确图标
  - **预估**: 0.25 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C29** — 删除 legacy purchaseVip() 方法
  - **修改**: `backend/src/modules/bonus/bonus.service.ts:132-215`
  - **做什么**: 删除或改为直接 throw GoneException
  - **验收**: 内部误调用会立即报错
  - **预估**: 0.1 天
  - **状态**: ⬜ | 完成日期: —

- [ ] **C30** — 旧 Refund 链路下线策略
  - **修改**: `seller.module.ts` + `admin.module.ts` + `admin-refunds.*` + `seller-refunds.*`
  - **做什么**: 旧 `/refunds` 设只读模式或整体合并到 `/after-sale`；清理权限常量
  - **验收**: 不再有两套售后链路写 Order.status
  - **预估**: 0.5 天
  - **状态**: ⬜ | 完成日期: —

**第二批完成判定**:
- [ ] 管理后台首页无 404
- [ ] 非超管可登录首页
- [ ] OPERATOR 无法创建商品
- [ ] 客服会话超时正常
- [ ] .env.example 密钥齐全
- [ ] C24 + C25（L8 硬前置）完成

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
| Q1 | 红包退款是否归还？refund.md 说不退回 vs 审查建议按比例 | — | — |
| Q2 | 审核通过是否自动上架？ | — | — |
| Q3 | OrderItem.unitPrice 是否已扣减优惠？影响分润 | — | — |

### 🟡 本周回答

| # | 疑点 | 你的选择 | 日期 |
|---|---|---|---|
| Q4 | 假 AI（品质评分/信赖分/摘要）如何处理？下线/改标签/补真实 | — | — |
| Q5 | couponUsage/VIP激活失败是否补偿队列？ | — | — |
| Q6 | 多商户运费分摊尾差 ±0.01 元？ | — | — |
| Q7 | VIP 推荐人子树全满降级到系统节点？ | — | — |
| Q8 | 发票功能是否整体下线 v1.1？ | — | — |
| Q9 | 客服生产超时值确认？ | — | — |
| Q10 | Qwen 宕机降级策略？ | — | — |

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
