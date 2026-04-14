# 爱买买 v1.0 上线链路审查执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 执行 17 条链路 + 6 项横切关注点的只读代码审查，产出一份权威的 v1.0 上线就绪报告，列出所有🔴 Tier 1 阻塞项和 🟡 Tier 2 待补项。

**Architecture:** 分三批并行派发 Explore agent 对每条链路单独审查；横切关注点先扫一次；主会话负责整合钱流图、耦合矩阵、Executive Summary；最终产出一份可勾选确认的审查报告。

**Tech Stack:** Claude Explore agent / Grep / Read / 只读分析，不修改代码

**Spec**：`docs/superpowers/specs/2026-04-11-launch-readiness-audit.md`

**Estimated effort**：3 天（Day 1 横切 + Batch 1；Day 2 Batch 2+3；Day 3 整合 + 用户确认）

---

## 执行原则（所有任务必读）

1. **只读审查**：所有 agent 任务都必须只读代码，不允许修改任何文件，不允许运行代码
2. **证据必须 file:line**：每个"已实现"结论必须附带 `文件路径:行号` 或 git commit 哈希
3. **禁止 hallucination**：不知道就写"待确认"，不猜测
4. **疑点立即标红**：agent 发现"可能影响钱操作正确性"的疑点必须在输出顶部用 🚨 标记
5. **不读 plan.md**：plan.md 停在 2026-03-27 已严重过时，不作为判断依据
6. **按三档模板输出**：A 档（💰深审）/ B 档（标准）/ C 档（基建迁移）—— 模板定义见下文 §模板

---

## 文件结构

### 新建目录
- `docs/superpowers/reports/2026-04-11-drafts/` — agent 中间产出目录

### 新建文件（agent 产出）
- `docs/superpowers/reports/2026-04-11-drafts/00-cross-cutting-x1-x6.md`
- `docs/superpowers/reports/2026-04-11-drafts/L01-auth.md`
- `docs/superpowers/reports/2026-04-11-drafts/L02-product-ai-search.md`
- `docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md`
- `docs/superpowers/reports/2026-04-11-drafts/L04-alipay.md`
- `docs/superpowers/reports/2026-04-11-drafts/L05-reward-allocation.md`
- `docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md`
- `docs/superpowers/reports/2026-04-11-drafts/L07-after-sale.md`
- `docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md`
- `docs/superpowers/reports/2026-04-11-drafts/L09-customer-service.md`
- `docs/superpowers/reports/2026-04-11-drafts/L10-seller-product.md`
- `docs/superpowers/reports/2026-04-11-drafts/L11-invoice.md`
- `docs/superpowers/reports/2026-04-11-drafts/L12-admin-console.md`
- `docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md`
- `docs/superpowers/reports/2026-04-11-drafts/L14-coupon.md`
- `docs/superpowers/reports/2026-04-11-drafts/L15-inbox-events.md`
- `docs/superpowers/reports/2026-04-11-drafts/L16-address.md`
- `docs/superpowers/reports/2026-04-11-drafts/L17-trace.md`

### 最终报告（主会话整合产出）
- `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md`

### 不修改的文件
- 所有 `backend/`、`app/`、`admin/`、`seller/`、`website/` 下的代码文件
- `docs/superpowers/specs/2026-04-11-launch-readiness-audit.md`（spec 不动）

---

## 模板

### A 档 — 💰 钱链路深审输出模板

每个 A 档 agent 产出必须严格按这个结构：

```markdown
# L{N}. {链路名} 💰 Audit Draft

**Tier**: {1|2}
**审查时间**: 2026-04-11
**Agent**: {agent 标识}

## 🚨 关键疑点（如有）
（只有发现可能影响钱操作正确性的问题才填这个 section，放最顶部）

## 📍 范围
（1-2 句）

## 🔗 端到端路径
（Golden path + 关键分支，用 ASCII 或编号列表）

## 💰 账本完整性检查
| 阶段 | 写入的表 | 预期 | 实际 | 状态 |
|---|---|---|---|---|

## 🔒 并发安全检查
- [ ] Serializable 隔离级别: ✅/🟡/⬜/🔴 + 证据
- [ ] 幂等键: ✅/🟡/⬜/🔴 + 键格式 + DB 约束
- [ ] CAS 更新: ✅/🟡/⬜/🔴 + 证据
- [ ] P2034 重试: ✅/🟡/⬜/🔴 + 证据
- [ ] 金额精度 Float/元: ✅/🟡/⬜/🔴 + 证据

## ↩️ 回滚/退款对称性
| 正向步骤 | 反向步骤 | 对称? | 证据 |
|---|---|---|---|

## ✅ 验证点清单
| # | 验证点 | 状态 | 证据 file:line | 阻塞 T{N}? | 补工作 |
|---|---|---|---|---|---|

## 🚧 已知问题
- TODO / FIXME / 占位符 / 硬编码测试值（列出所有）

## 🔗 耦合依赖
- 依赖: L{X}
- 被依赖: L{Y}

## 🧪 E2E 场景
1. Golden path: ...
2. 并发下单: ...
3. 支付回调重放: ...
4. 部分退款失败重试: ...
5. 退款与分润回滚原子性: ...
6. 链路特定场景: ...

## ❓ 需要用户确认的疑点
| # | 疑点 | 选项 A | 选项 B | 选项 C |
|---|---|---|---|---|

## 🎯 Tier {N} 验收标准
- [ ] 条件 1
- [ ] 条件 2
...
```

### B 档 — 标准审查输出模板

```markdown
# L{N}. {链路名} Audit Draft

**Tier**: 1
**审查时间**: 2026-04-11
**Agent**: {agent 标识}

## 📍 范围
## 🔗 端到端路径

## ✅ 验证点清单
| # | 验证点 | 状态 | 证据 file:line | 阻塞 T1? | 补工作 |
|---|---|---|---|---|---|

## 🚧 已知问题

## 🧪 E2E 场景
1. Golden path
2. 1-2 个关键边界

## ❓ 需要用户确认的疑点

## 🎯 Tier 1 验收标准
- [ ] ...
```

### C 档 — 基建迁移输出模板

```markdown
# L{N}. {链路名} Plan Draft

**Tier**: 1
**审查时间**: 2026-04-11

## 📍 范围

## 📋 实施步骤清单
- [ ] 步骤 1 — 责任人: AI/用户 — 预估工时
- [ ] 步骤 2 — ...

## 🔧 用户线下完成事项
- 申请 ... — 预估周期
- 购买 ... — 预估成本

## ⚠️ 迁移风险
（L8 顺丰专用：列出迁移过程中的回滚点、保留的文件、删除的文件）

## 🎯 完成判定
- [ ] ...
```

---

## Task 0: 准备工作

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/` (directory)
- Create: `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` (空骨架)

- [ ] **Step 1: 创建目录**

```bash
mkdir -p "/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/docs/superpowers/reports/2026-04-11-drafts"
```

- [ ] **Step 2: 创建报告骨架**

写入 `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` 初始内容：

```markdown
# 爱买买 v1.0 上线链路审查报告

> **状态**: 执行中 / 草稿
> **开始时间**: 2026-04-11
> **Spec**: docs/superpowers/specs/2026-04-11-launch-readiness-audit.md
> **审查原则**: 只读审查 + 证据必须 file:line + 不做 v1.1+ 功能

## 0. Executive Summary
（待整合完成后填写）

## 1. 审查范围与方法
（引用 spec）

## 2. 横切关注点 X1-X6
（待 Task 1 完成后填写）

## 3. 钱流图与跨链路耦合
（待 Task 19 完成后填写）

## 4. 链路详细审查
（待所有 Task 2-18 完成后整合）

## 5. 跨链路耦合矩阵
（待 Task 20 完成后填写）

## 6. Tier 1 上线阻塞项汇总
（待 Task 21 完成后填写）

## 7. Tier 2 待补项汇总
（待 Task 21 完成后填写）

## 8. 用户线下完成事项
（待 Task 21 完成后填写）

## 9. 待用户确认疑点清单
（待所有草稿完成后汇总）

## 10. 交接给 writing-plans 的修复实施顺序建议
（待 Task 22 完成后填写）

## 11. 附录
（待最后填写）
```

- [ ] **Step 3: 验证目录和文件存在**

```bash
ls "docs/superpowers/reports/2026-04-11-drafts/"
ls "docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md"
```

Expected: 目录存在（可能为空），报告骨架文件存在

---

## Task 1: 横切关注点 X1-X6 扫描

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/00-cross-cutting-x1-x6.md`

**说明**: 派发一个 Explore agent 做一次性横切扫描，覆盖所有 17 条链路的事务 / 幂等 / Webhook / 权限 / Mock / 性能。

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "X1-X6 cross-cutting scan"`，prompt 如下（完整复制）:

```
你是一个只读审查 agent。对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的后端代码做 6 项横切扫描。禁止修改任何文件，禁止运行代码。

**输出位置**: 把结果写入 `docs/superpowers/reports/2026-04-11-drafts/00-cross-cutting-x1-x6.md`

**需要扫描的 6 项**:

### X1. 事务隔离 + CAS
- 用 Grep 找到所有 `this.prisma.$transaction` 调用
- 对每个事务检查是否显式 `isolationLevel: 'Serializable'`
- 对金额/库存/奖励写操作检查是否使用 `updateMany where: { ...conditions }` CAS 模式
- 检查有没有 P2034 重试策略

输出表格:
| 位置 file:line | 隔离级别 | CAS | 钱操作 | 状态 | 备注 |

### X2. 幂等键
- Grep `idempotencyKey` / `idempotency_key` / `IdempotencyKey`
- 检查 Prisma schema 里这些字段的 @unique 约束
- 检查 catch 块是否处理 P2002
- 所有 Webhook 端点必须有幂等设计

输出表格:
| 场景 | 键格式 | DB 唯一约束 | 冲突处理 | 状态 |

### X3. Webhook 安全
找到所有 `@Public()` 控制器端点（backend/src/modules/payment/payment.controller.ts 和 backend/src/modules/shipment/shipment.controller.ts 是主要关注点），逐个检查:
1. 签名验证（HMAC/RSA，crypto.timingSafeEqual）
2. IP 白名单（WebhookIpGuard 或等价）
3. Secret 配置（环境变量）

输出表格:
| 端点 | 签名 | IP 白名单 | Secret 配置 | 状态 |

### X4. 三系统权限隔离
- 扫所有 @Controller() 类，提取使用的 Guard 栈
- 分三类登记: 买家控制器 / 卖家控制器 (@Public + SellerAuthGuard) / 管理控制器 (@Public + AdminAuthGuard + PermissionGuard)
- 检查卖家控制器是否漏写 @Public()

输出:
- JWT 密钥隔离矩阵（3×3）
- 每个控制器的 Guard 栈快照（列前 20 个代表性控制器，不用全列）
- 3-5 个可疑点（如果有）

### X5. Mock 开关 + 环境变量
- Grep `_MOCK | _LOCAL | _ENABLED` 整个 backend/src
- 读 backend/.env.example（如果有 .env.production 也读一下）
- 逐项登记默认值、代码引用位置

输出表格:
| 变量 | 默认 | 代码引用 file:line | 生产期望 (v1.0) | 当前切换状态 |

生产期望参考:
- SMS_MOCK=false (v1.0 要真实 SMS)
- UPLOAD_LOCAL=false (v1.0 要真实 OSS)
- WECHAT_MOCK=true (v1.0 保持 mock, v1.1 再切)
- AI_SEMANTIC_SLOTS_ENABLED=true (v1.0 要激活)
- AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=true (v1.0 要激活)
- AI_SEMANTIC_SCORING_ENABLED=true (v1.0 要激活)
- PAYMENT_WEBHOOK_SECRET=必须配 (v1.0)
- LOGISTICS_WEBHOOK_SECRET=必须配 (v1.0)

### X6. 性能红线
- Grep 反模式 `for (.+of.+) {[^}]*await this.prisma` 找 N+1
- 查 backend/src/common/ttl-cache.ts 的使用点，每个 TtlCache 实例是否有对应 invalidate* 调用
- Grep 金额处理函数（Number, parseFloat, toFixed）的混用
- 查 L5 分润查询 (backend/src/modules/bonus/engine/*) 和 L7 售后查询的 where 子句对应的 Prisma schema 索引

输出:
- N+1 清单（最多 10 条最严重的）
- 缓存失效漏洞清单
- 金额精度不一致点（文件:行号）
- 缺失索引候选（3-5 条）

**输出格式**: 严格 markdown，6 个 H2 section，每个 section 有标题、表格、结论。总长度控制在 600 行以内。

**禁忌**:
- 不要修改任何代码文件
- 不要运行 npm/node/prisma 命令
- 不读 plan.md（已过时）
- 不读 docs/superpowers/specs/2026-04-11-launch-readiness-audit.md 之外的其他 spec

完成后回复我: "X1-X6 cross-cutting scan written to docs/superpowers/reports/2026-04-11-drafts/00-cross-cutting-x1-x6.md"
```

- [ ] **Step 2: 验证输出存在且格式合规**

读 `docs/superpowers/reports/2026-04-11-drafts/00-cross-cutting-x1-x6.md`，检查：
- 文件存在
- 包含 6 个 H2 section (X1-X6)
- 每个 section 有至少一个表格或列表
- 没有 "TODO" / "TBD" / "待填写" 等占位符

---

## Task 2: L3 购物车 + 下单（CheckoutSession）审查 💰

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L3 cart+checkout audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L3 购物车 + 下单链路做 A 档深审（💰 钱链路）。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md

**审查范围**:
- 加购: src/store/CartStore.ts (买家 App 前端 Zustand), backend/src/modules/cart/
- 下单入口: app/checkout.tsx
- CheckoutSession 创建: backend/src/modules/order/checkout.service.ts
- 规格/库存校验 (CAS 扣减)
- 地址选择
- 运费计算
- 订单生成: backend/src/modules/order/order.service.ts + schema.prisma Order 模型

**使用模板**: A 档 💰 钱链路深审模板（见 spec docs/superpowers/specs/2026-04-11-launch-readiness-audit.md 的 §4.1）

**关键验证点**（必须全部覆盖）:
1. CheckoutSession 创建是否在 Serializable 事务中
2. 库存 CAS 扣减 (updateMany where: { stock: { gte: qty } }) 是否正确
3. idempotencyKey 在 CheckoutSession / Order 表上的设计
4. 金额精度是否全程 Float/元（不要 Int/分 或 parseFloat 误用）
5. 地址选择是否强制 addressId 校验
6. 运费计算是否支持 ShippingRule（三维度：金额×地区×重量）
7. 购物车空态处理
8. 并发下单同一 SKU 的防超卖逻辑
9. CheckoutSession → 支付 → 订单的状态转换
10. 订单拆单（多商户）是否正确
11. 是否存在 `createFromCart` 旧接口并返回 410 Gone

**钱流**:
- CartStore.items → CheckoutSession (预留) → Payment 回调 → Order 创建 (PAID)
- 这条路径中的任何断点都必须在 "💰 账本完整性检查" section 列出

**已知背景**:
- 项目使用 CheckoutSession 流程（付款后才建订单），旧 `createFromCart` 应返回 410
- 金额单位统一 Float/元（CLAUDE.md 约定）
- 超卖容忍：允许库存变负，通知卖家补货，不退款

**禁忌**:
- 不要修改任何代码
- 不要读 plan.md
- 不要审查 L4 支付回调本身（那是 L4 的工作）
- 不要审查 L5 分润（L5 的工作）

**输出长度**: 控制在 400 行以内

完成后回复: "L3 cart+checkout audit written to docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md"
```

- [ ] **Step 2: 验证输出**

读 `docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md`，检查:
- A 档模板的所有 section 都存在
- 至少 5 个验证点被填写
- 证据列包含 file:line 或 commit 哈希
- 没有 TODO/TBD 占位符

---

## Task 3: L4 支付宝支付审查 💰

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L04-alipay.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L4 alipay audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L4 支付宝支付链路做 A 档深审（💰 钱链路）。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L04-alipay.md

**审查范围**:
- backend/src/modules/payment/alipay.service.ts
- backend/src/modules/payment/payment.service.ts
- backend/src/modules/payment/payment.controller.ts
- backend/src/modules/payment/payment.module.ts
- backend/.env.example (ALIPAY_* 变量)
- schema.prisma Payment 模型

**使用模板**: A 档 💰 钱链路深审模板

**关键验证点**（必须全部覆盖）:
1. AlipaySdk 是否真实 import + 真实调用（不只是 mock 分支）
2. createAppPayOrder 创建支付是否完整实现
3. verifyNotify 回调验签是否用支付宝证书/公钥正确验证
4. POST /payments/callback 是否有 WebhookIpGuard（支付宝官方 IP 可以是空白名单，要有文档说明）
5. handlePaymentSuccess 的事务边界：是否 Serializable？扇出到哪些表？
6. idempotencyKey 设计：格式 + DB 唯一约束 + P2002 处理
7. Payment 状态机：PENDING → PAID → REFUNDED → REFUND_FAILED
8. Payment 和 Order 状态一致性（时间窗口问题）
9. **支付宝退款 API 是否真实接入**（重点！initiateRefund 方法当前是 TODO 占位还是已实现？）
10. 退款流水记录 RefundRecord 或类似模型
11. PAYMENT_WEBHOOK_SECRET 环境变量的生产环境必需性

**🚨 关键风险**:
- `payment.service.ts:76` 附近有 `TODO: 接入真实支付退款 API`，这是 v1.0 的最大阻塞项之一
- 用户要求退款必须退回原支付方式，所以这个 TODO 必须实现
- 请在 "🚨 关键疑点" section 明确标注这个 TODO 的当前真实状态

**钱流**:
- App 发起支付 → Alipay SDK createAppPayOrder → 唤起支付宝 → 用户支付 → 回调 /payments/callback → verifyNotify → handlePaymentSuccess → Payment+Order 状态更新

**禁忌**:
- 不要审查 L3 购物车下单
- 不要审查 L5 分润
- 不要修改代码
- 不要测试真实支付宝 API

**输出长度**: 400 行以内

完成后回复: "L4 alipay audit written to docs/superpowers/reports/2026-04-11-drafts/L04-alipay.md"
```

- [ ] **Step 2: 验证输出**

读 L04-alipay.md，特别检查:
- 🚨 section 必须明确说明 initiateRefund TODO 的真实状态
- 账本完整性检查 section 覆盖 Payment + Order 两张表
- 至少列出 10 个验证点

---

## Task 4: L5 分润奖励审查 💰

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L05-reward-allocation.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L5 reward allocation audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L5 分润奖励链路做 A 档深审（💰 钱链路）。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L05-reward-allocation.md

**审查范围**:
- backend/src/modules/bonus/engine/ 全目录（重点）
  - bonus-allocation.service.ts
  - reward-calculator.service.ts
  - normal-broadcast.service.ts
  - normal-platform-split.service.ts
  - vip-upstream.service.ts (如果存在)
  - vip-platform-split.service.ts
  - platform-split.service.ts
  - freeze-expire.service.ts
  - bonus-config.service.ts
- backend/src/modules/bonus/bonus.service.ts (核心业务)
- schema.prisma: RewardAccount, RewardAllocation, RewardLedger, VipEligibleOrder, NormalEligibleOrder, VipProgress, VipTreeNode, MemberProfile

**使用模板**: A 档 💰 钱链路深审模板

**关键验证点**（必须全部覆盖）:
1. allocateForOrder 入口的幂等键设计（格式: ALLOC:{trigger}:{orderId}:{rule}）
2. VIP 上溯分配：第 k 单 → 第 k 个祖先，祖先解锁检查 (selfPurchaseCount >= k)
3. 普通广播分配：桶队列 + 滑动窗口 + 等额分配
4. 六分利润计算 (VIP: 50/30/10/2/2/6, 普通: 50/16/16/8/8/2)
5. RewardLedger 流水完整性：FREEZE / RELEASE / WITHDRAW / VOID / ADJUST 五种 entryType
6. RewardAccount 余额更新原子性 (balance + frozen 一致性)
7. 分润事务是否 Serializable
8. rollbackForOrder 退款回滚：VOID 对应 Ledger + 余额恢复对称
9. VIP_PACKAGE bizType 豁免（allocateForOrder 入口守卫，不产生 VipEligibleOrder）
10. 平台账户 PLATFORM_USER_ID 是否存在（外键约束）
11. 冻结过期 Cron 任务：freeze-expire.service.ts 的扫描逻辑
12. VIP 解锁扫描：新的 selfPurchaseCount 增加时批量释放 requiredLevel 匹配的冻结奖励
13. 四舍五入精度处理（rewardPool / N 的余数归属）
14. 配置读取缓存失效（BonusConfigService 的缓存）

**💰 账本完整性检查** 必须覆盖:
- profit 计算 → 六分拆分 → 每一分都有对应 RewardLedger + RewardAccount 更新
- 是否存在"RewardAccount.balance 更新了但 RewardLedger 没写"的可能性

**钱流**:
- Order 确认收货 → BonusAllocationService.allocateForOrder → profit 计算 → 分流路由 (VIP/普通) → RewardAllocation 创建 → RewardLedger 条目 → RewardAccount 余额更新

**↩️ 回滚对称性检查**:
- 每个正向的 `balance += x` 必须有对应的 `balance -= x` 退款路径
- 每个 VipEligibleOrder.valid = true 必须有对应的 valid = false 回滚
- entryType FREEZE / RELEASE 必须有对应 VOID

**禁忌**:
- 不要审查 L6 VIP 购买（那是 L6 的工作）
- 不要审查 L7 退款发起（L7 的工作，但退款回滚的 rollbackForOrder 调用链是 L5 的范围）
- 不要修改代码

**输出长度**: 500 行以内（这是最复杂的链路，允许多一些）

完成后回复: "L5 reward allocation audit written to docs/superpowers/reports/2026-04-11-drafts/L05-reward-allocation.md"
```

- [ ] **Step 2: 验证输出**

读 L05-reward-allocation.md，检查:
- ↩️ 回滚对称性 section 必须存在且有对账表
- 验证点至少 12 个
- E2E 场景覆盖 VIP 上溯 + 普通广播 + 退款回滚三类

---

## Task 5: L6 VIP 购买（多档位）审查 💰

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L6 VIP purchase audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L6 VIP 购买（多档位）链路做 A 档深审（💰 钱链路）。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md

**审查范围**:
- schema.prisma: VipPackage, VipGiftOption, VipPurchase, VipActivationStatus, VipTreeNode, VipProgress, MemberProfile
- backend/src/modules/order/checkout.service.ts: checkoutVipPackage 方法
- backend/src/modules/order/order.controller.ts: POST /orders/vip-checkout 端点
- backend/src/modules/bonus/bonus.service.ts: activateVipAfterPayment, purchaseVip, assignVipTreeNode
- backend/src/modules/bonus/vip-activation-retry.service.ts (如果存在)
- backend/src/modules/admin/bonus/vip-gift-options*（管理端 VIP 赠品方案 CRUD）
- app/vip/gifts.tsx (买家 App 赠品选择页)
- app/checkout.tsx (结账页 VIP 模式)
- app/vip/ 目录其他文件
- backend/src/modules/bonus/bonus-allocation.service.ts（VIP_PACKAGE bizType 豁免）

**使用模板**: A 档 💰 钱链路深审模板

**关键验证点**（必须全部覆盖）:
1. **VipPackage 多档位模型是否存在**（schema.prisma）
2. VipPackage CRUD 管理端页面是否存在
3. 档位选择 → 赠品组合 → 价格计算是否正确
4. VipCheckoutDto 的 class-validator 校验（giftOptionId, giftSkuId, price）
5. CheckoutService.checkoutVipPackage 是否 Serializable 事务
6. POST /orders/vip-checkout 端点实现
7. bizType = VIP_PACKAGE 的传递：CheckoutSession → Order
8. 支付回调触发 activateVipAfterPayment 是否有 3 次重试
9. VipActivationStatus 状态机 (PENDING/ACTIVATING/SUCCESS/FAILED/RETRYING)
10. 三叉树插入 (assignVipTreeNode) 的 BFS 逻辑（有推荐人在推荐人子树 BFS；无推荐人在 A1-A10 系统用户中找空位，满了创建 A11）
11. VIP 激活成功后站内消息发送（InboxService.send）
12. **VIP 订单在分润中的豁免**：bonus-allocation.service.ts 入口是否检查 bizType === VIP_PACKAGE
13. VIP 购买的幂等性（防重复激活）
14. 买家 App 前端：app/vip/gifts.tsx 档位选择 UI 是否完整
15. VIP 赠品商品的 Order 创建和发货流程（走 L8）
16. VIP 订单在买家 App 订单列表和详情的展示（VIP 礼包标签）
17. VIP 订单不可退款的拦截（replacement.service.apply + after-sale.service）

**🚨 关键疑点**:
- VIP 多档位前端是否完整实现（用户自述 "半成品"）—— 请核对 app/vip/ 目录所有文件
- VipPackage CRUD 管理端是否完成
- 价格计算逻辑：多档位 × 多赠品的组合

**钱流**:
- App 选档 + 赠品 → vip-checkout API → CheckoutSession (bizType=VIP_PACKAGE) → Alipay 支付 → payment callback → activateVipAfterPayment → VipProgress 创建 + MemberProfile.tier=VIP + 三叉树插入 + 站内消息

**禁忌**:
- 不要审查 L5 分润本身（L5 的工作）
- 不要修改代码
- 不要执行 prisma validate / tsc

**输出长度**: 400 行以内

完成后回复: "L6 VIP purchase audit written to docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md"
```

- [ ] **Step 2: 验证输出**

读 L06-vip-purchase.md，特别关注:
- 多档位实现完整度的明确结论
- 三叉树插入逻辑是否正确
- VIP 订单豁免分润的证据

---

## Task 6: L7 统一售后（退/换货）审查 💰

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L07-after-sale.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L7 after-sale audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L7 统一售后（退/换货）链路做 A 档深审（💰 钱链路）。这是最复杂的链路，refund.md 定义了 23 条规则，审查必须逐条核对。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L07-after-sale.md

**必读文档**:
- docs/features/refund.md（23 条退换货规则，权威来源）

**审查范围**:
- schema.prisma: AfterSaleRequest, AfterSaleItem, AfterSaleType, AfterSaleStatus (如果存在)
- schema.prisma: 旧的 ReplacementRequest, Refund 模型（检查是否还在使用）
- backend/src/modules/after-sale/ 目录（如果存在）
- backend/src/modules/replacement/ 目录（旧的）
- backend/src/modules/refund/ 目录（旧的）
- app/orders/after-sale/[id].tsx (买家 App 售后页)
- seller/src/pages/refunds/ (卖家后台售后审核页)
- admin/src/pages/refunds/ 或类似（管理端仲裁页）
- backend/src/modules/bonus/bonus-allocation.service.ts: rollbackForOrder 方法

**使用模板**: A 档 💰 钱链路深审模板

**🚨 必须首先回答的问题**:
1. AfterSaleRequest 模型是否已在 schema.prisma 中？
2. `backend/src/modules/after-sale/` 目录是否存在完整 Service/Controller？还是只有设计文档？
3. 旧的 ReplacementRequest 是否还在被使用？迁移进度如何？

**refund.md 23 条规则逐条核对**（每条给出 状态 + 证据）:

1. 退货窗口起算点 (DELIVERED 时间 + 168 小时)
2. 不可退商品判定（Category.returnPolicy + Product.returnPolicy 两级 INHERIT）
3. 不可退商品质量问题仍可退
4. 审核模式（卖家审核 + 平台仲裁）
5. 价格阈值决定是否寄回
6. 退款只退商品价格不退运费
7. 平台红包按比例分摊
8. 七天无理由退货规则
9. 质量问题退货运费平台承担
10. 生鲜商品特殊规则（24 小时申报时限）
11. 非生鲜商品质量问题申报时限
12. 统一售后入口 - 三种售后类型（纯退款 / 退货退款 / 换货）
13. 部分退货支持
14. 退货换货后奖励归平台
15. 分润奖励两层冻结机制
16. 完整状态机（REQUESTED → UNDER_REVIEW → APPROVED/REJECTED → ...）
17. 卖家验收不通过处理
18. 超时自动处理机制
19. 买家撤销规则
20. 订单状态与售后的关系
21. 多售后并行规则
22. 换货后再退货限制
23. 换货也按阈值决定是否寄回

**23 条规则表格**:
| # | 规则 | 状态 ✅/🟡/⬜/🔴 | 证据 file:line | 阻塞 T1? | 阻塞 T2? |

**💰 账本完整性检查**（退款路径）:
- AlipayService.refund() 调用 → Payment 表更新 → RefundRecord → Order 状态回滚 → RewardLedger VOID → RewardAccount 余额扣减 → 库存回填 → 红包退回 → 站内消息
- 这条完整路径是否在一个事务内？事务边界在哪里？

**↩️ 回滚对称性（refund.md 规则 7 平台红包分摊）**:
- 部分退款时，平台红包的抵扣金额如何按比例归还？
- 多张红包叠加时的数学是否正确？
- CouponInstance 的 usedAt / status 字段的回滚

**🚨 关键疑点**:
- 23 条规则中很可能大部分还未实现，请如实评估
- L7 是 T1+T2 跨 Tier 的链路：基本的"能申请+能退款"是 T1，完整的规则引擎是 T2
- 明确标注哪些规则是 T1 必需，哪些是 T2

**用户要求**:
- 退款必须退回原支付方式（支付宝订单 → Alipay 退款 API）
- 不允许做余额退回或人工处理

**禁忌**:
- 不要审查 L4 支付宝退款 API 本身（那是 L4 的工作）
- 不要审查 L5 分润 rollbackForOrder 内部实现（L5 的工作）
- 不要修改代码

**输出长度**: 600 行以内（允许更长，因为 23 条规则）

完成后回复: "L7 after-sale audit written to docs/superpowers/reports/2026-04-11-drafts/L07-after-sale.md"
```

- [ ] **Step 2: 验证输出**

读 L07-after-sale.md，特别检查:
- 🚨 section 明确回答 3 个必答问题
- 23 条规则表格完整填写
- T1 / T2 分界清晰

---

## Task 7: L11 发票申请审查 💰

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L11-invoice.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L11 invoice audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L11 发票申请链路做 A 档深审（💰 钱链路）。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L11-invoice.md

**必读文档**: docs/features/invoice.md（权威来源）

**审查范围**:
- schema.prisma: Invoice, InvoiceProfile, InvoiceItem (如果存在)
- backend/src/modules/invoice/ 目录（如果存在）
- app/ 下的发票相关页面（grep "invoice"）
- seller/src/pages/ 下的发票相关页面（grep "invoice"）
- admin/src/pages/ 下的发票相关页面

**使用模板**: A 档 💰 钱链路深审模板（发票是 T2 所以深度可以稍浅）

**🚨 必须首先回答**:
1. Invoice / InvoiceProfile 模型是否在 schema.prisma？
2. `backend/src/modules/invoice/` 目录是否存在？有几个文件？
3. 前端发票申请页面是否已建？
4. 是否集成了任何第三方电子发票服务（诺诺 / 百望云 / 自建）？

**关键验证点**:
1. Invoice 数据模型完整性
2. 开票信息（抬头 / 税号 / 银行账号等）字段
3. 订单关联（一对多 Invoice → OrderItem）
4. 开票申请流程（买家申请 → 卖家/平台开具）
5. PDF 生成 / 下载逻辑
6. 发票状态机
7. 金额计算（部分退款后的应开票金额）

**Tier 分类**:
- 本链路整体是 T2（MVP 可延后，不影响 v1.0 核心交易）
- 即使完全未开始也不阻塞 v1.0 上线
- 但如果已有骨架，要评估完成度以决定 v1.1 工作量

**输出长度**: 250 行以内（T2 简短即可）

完成后回复: "L11 invoice audit written to docs/superpowers/reports/2026-04-11-drafts/L11-invoice.md"
```

- [ ] **Step 2: 验证输出**

读 L11-invoice.md，检查:
- 必答问题都有明确答案
- 完成度清晰

---

## Task 8: L14 平台红包审查 💰

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L14-coupon.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L14 coupon audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L14 平台红包（优惠券）链路做 A 档深审（💰 钱链路）。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L14-coupon.md

**必读文档**: docs/features/redpocket.md（权威来源）

**审查范围**:
- schema.prisma: CouponCampaign, CouponInstance, CouponUsageRecord, CouponTriggerCondition 或类似
- backend/src/modules/coupon/ 目录
- backend/src/modules/coupon/coupon-engine.service.ts
- backend/src/modules/order/checkout.service.ts: 红包抵扣计算部分
- admin/src/pages/coupons/ 或 admin/src/pages/redpocket/ (管理端红包管理)
- app/ 下的红包相关页面 (app/me/redpackets 或类似)
- src/repos/CouponRepo.ts (如果存在)

**使用模板**: A 档 💰 钱链路深审模板

**关键验证点**（必须全部覆盖）:
1. CouponCampaign / CouponInstance / CouponUsageRecord 数据模型完整性
2. 领取流程（自动发放触发条件 + 手动领取）
3. 红包展示（可用 / 已用 / 已过期三态）
4. 结算抵扣计算：多张红包叠加的数学
5. 结算时的 Serializable 事务（红包锁定 + 订单金额扣减）
6. 红包使用记录 CouponUsageRecord 流水
7. 过期失效的 Cron 扫描
8. **L7 退款场景下的红包按比例归还**（refund.md 规则 7）
9. 红包与分润奖励的概念隔离（分润不能用于抵扣，红包不能提现）
10. 自动发放引擎（事件监听 → 发放条件判定 → 发放）
11. 管理端红包活动 CRUD
12. 管理端发放记录 / 使用记录查询
13. 数据统计 Dashboard

**💰 账本完整性检查**:
- 结算抵扣: CheckoutSession 金额 - 红包抵扣 = Order 实付金额；CouponInstance.usedAt 标记
- 退款归还: CouponInstance.usedAt = null；是否重置 status？
- 多张叠加: 按领取顺序抵扣还是按面值大小？总抵扣 = 各 CouponInstance 面值之和？

**↩️ 回滚对称性检查**:
- 每个"使用"操作都要有对称的"归还"操作
- 过期的红包在退款时不应归还（变成永久失效）

**钱流**:
- 领取 → CouponInstance 创建 (status: ACTIVE) → 结算 (status: LOCKED) → 支付成功 (status: USED, usedAt 设置) → 退款场景按比例归还 (status: ACTIVE, usedAt = null)

**禁忌**:
- 不要审查 L7 售后流程本身（L7 的工作）
- 不要把"红包"和"分润奖励"概念混淆（CLAUDE.md 有明确区分）
- 不要修改代码

**输出长度**: 400 行以内

完成后回复: "L14 coupon audit written to docs/superpowers/reports/2026-04-11-drafts/L14-coupon.md"
```

- [ ] **Step 2: 验证输出**

读 L14-coupon.md，检查:
- 多张叠加的数学逻辑清晰
- 退款归还的对称性有证据

---

## Task 9: L1 三系统用户认证审查

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L01-auth.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L1 auth audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L1 三系统用户认证链路做 B 档标准审查。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L01-auth.md

**审查范围**:
- **买家端**:
  - backend/src/modules/auth/ 全部文件
  - backend/src/common/guards/ (JwtAuthGuard)
  - backend/src/modules/auth/strategies/jwt.strategy.ts
  - app/(auth)/ 或 src/components/overlay/AuthModal.tsx
  - src/store/useAuthStore.ts
- **卖家端**:
  - backend/src/modules/seller/seller-auth/ 或 backend/src/modules/seller-auth/
  - backend/src/modules/seller/common/seller-jwt.strategy.ts
  - backend/src/modules/seller/common/seller-auth.guard.ts
  - backend/src/modules/seller/common/current-seller.decorator.ts
  - seller/src/pages/login/
  - seller/src/stores/authStore.ts
- **管理端**:
  - backend/src/modules/admin/auth/
  - backend/src/modules/admin/common/admin-jwt.strategy.ts
  - backend/src/modules/admin/common/admin-auth.guard.ts
  - backend/src/modules/admin/common/permission.guard.ts
  - admin/src/pages/login/
  - admin/src/stores/authStore.ts

**使用模板**: B 档标准审查模板

**关键验证点**（必须全部覆盖）:

买家端:
1. 手机号 + 短信验证码登录
2. JWT 签发 (JWT_SECRET) + 刷新 token
3. session 撤销（登出时服务端清理）
4. 封禁用户 token 拦截
5. AuthIdentity 模型 (provider: PHONE/EMAIL/WECHAT)

卖家端:
6. 账号密码登录
7. 多企业切换（一个用户多个 CompanyStaff）
8. SELLER_JWT_SECRET 独立密钥（必须与买家 JWT 不同）
9. OWNER/MANAGER/OPERATOR 角色隔离
10. SellerAuthGuard + companyId 强制过滤
11. @CurrentSeller() 装饰器注入上下文

管理端:
12. 账号密码 + 验证码登录
13. bcrypt 成本因子（生产环境 >= 10）
14. AdminSession 软过期
15. ADMIN_JWT_SECRET 独立密钥
16. RBAC 权限矩阵 (AdminRole + AdminPermission + AdminUserRole + AdminRolePermission)
17. @Public() + AdminAuthGuard + PermissionGuard 组合
18. @RequirePermission 装饰器
19. 超级管理员绕过权限检查

三系统隔离（关键！）:
20. **三套 JWT 密钥是否真的不同**（.env 变量 JWT_SECRET / SELLER_JWT_SECRET / ADMIN_JWT_SECRET）
21. **交叉伪造测试清单**:
    - 买家 JWT → /api/v1/admin/* → 必须 401
    - 买家 JWT → /api/v1/seller/* → 必须 401
    - 卖家 JWT → /api/v1/admin/* → 必须 401
    - 卖家 JWT → /api/v1/me → 必须 401（卖家不应能访问买家接口）
    - 管理员 JWT → /api/v1/seller/* → 必须 401
22. 买家 A 访问买家 B 的 /orders/:id → 必须 403
23. 卖家 A 访问公司 B 的商品 → 必须 403 (companyId 过滤)

**🚨 关键疑点**:
- 检查所有卖家控制器是否都有 @Public() 装饰器（不加就被买家全局 Guard 错误处理）
- 检查所有管理控制器同上

**E2E 场景**:
1. 买家 Golden path: 发送短信 → 登录 → 访问 /me
2. 卖家 Golden path: 账号密码 → 选企业 → 访问 /seller/dashboard
3. 管理员 Golden path: 账号密码 + 验证码 → 访问 /admin/dashboard
4. 交叉伪造: 买家 JWT 尝试 /admin/*

**禁忌**:
- 不要审查具体业务 API（比如订单、商品），只审查认证+授权框架
- 不要修改代码

**输出长度**: 400 行以内

完成后回复: "L1 auth audit written to docs/superpowers/reports/2026-04-11-drafts/L01-auth.md"
```

- [ ] **Step 2: 验证输出**

读 L01-auth.md，特别检查:
- 3 个 JWT 密钥确认独立
- 交叉伪造测试清单完整

---

## Task 10: L2 商品浏览 + AI 搜索审查 🤖

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L02-product-ai-search.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L2 product+ai audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L2 商品浏览 + AI 搜索链路做 B 档标准审查。本链路带 🤖 标记，需要验证 AI 用户感知质量（不仅是 API 连通）。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L02-product-ai-search.md

**审查范围**:
- backend/src/modules/product/ (商品服务)
- backend/src/modules/category/ (分类)
- backend/src/modules/ai/ai.service.ts (AI 搜索/推荐)
- backend/src/modules/ai/voice-intent.types.ts (意图类型)
- backend/src/modules/ai/voice-intent.service.ts (如果存在)
- backend/src/modules/semantic/ 或类似（语义意图）
- backend/.env.example: AI_* 变量
- src/repos/ProductRepo.ts, AiFeatureRepo.ts, AiAssistantRepo.ts, RecommendRepo.ts
- app/(tabs)/home.tsx, museum.tsx (首页 + 发现页)
- app/search/
- app/product/[id].tsx (商品详情)
- app/ai/ 目录

**使用模板**: B 档标准审查模板

**关键验证点**:

商品浏览:
1. GET /products 列表分页
2. GET /products/:id 详情（含 skus / media / tags / 溯源）
3. GET /categories 分类树
4. GET /companies 企业列表（发现页）
5. GET /search 搜索

AI 能力:
6. Qwen 真实调用（非 mock）
7. 意图识别 classify 方法
8. 语义意图开关 (AI_SEMANTIC_SLOTS_ENABLED 等三个开关) 是否激活
9. 商品 AI 推荐（AiFeatureRepo）
10. 商品 AI 品质评分（商品详情页）
11. 企业信赖分（企业详情页）
12. 搜索 AI 摘要
13. AI 助手对话（app/ai/assistant.tsx）
14. 首页 AI 光球交互 + 快捷指令
15. 语音识别集成（讯飞或直接 Qwen）

**🤖 AI 用户感知质量检查**:
- Qwen 系统提示词是否完整（backend/src/modules/ai/ai.service.ts 头部）
- 回复格式容错（bb29234 commit 修复的数组包裹 JSON 问题）
- Fallback 行为（AI 超时 / 返回空 / 拒答时的用户体验）
- 意图识别的槽位提取是否激活（AI_SEMANTIC_SLOTS_ENABLED）
- 搜索评分 (AI_SEMANTIC_SCORING_ENABLED) 是否激活
- 商品语义字段 (AI_PRODUCT_SEMANTIC_FIELDS_ENABLED) 是否激活

**❓ 必问疑点**:
- v1.0 是否需要激活全部 3 个语义开关？激活后有没有已知 bug？
- 意图识别准确率目标是多少？
- 如果 Qwen 宕机，降级策略是什么？

**E2E 场景**:
1. Golden path: 首页加载 → 商品列表 → 商品详情
2. 搜索 Golden: 输入关键词 → 搜索结果 → 点击商品
3. AI 对话: 首页光球 → 语音/文字问 → Qwen 回复 → 商品推荐

**禁忌**:
- 不要审查 L9 智能客服的 AI 部分（L9 的工作）
- 不要修改代码
- 不要真实调用 Qwen API

**输出长度**: 350 行以内

完成后回复: "L2 product+ai audit written to docs/superpowers/reports/2026-04-11-drafts/L02-product-ai-search.md"
```

- [ ] **Step 2: 验证输出**

读 L02-product-ai-search.md，检查:
- 3 个 AI 语义开关状态明确
- Qwen 真实调用证据

---

## Task 11: L9 智能客服审查 🤖

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L09-customer-service.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L9 customer service audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L9 智能客服链路做 B 档标准审查。本链路带 🤖 标记。用户自述"正在收尾"，最近 5 个 commit 都是 fix(cs)。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L09-customer-service.md

**必读文档**: docs/features/智能客服.md（权威运维与开发文档）

**审查范围**:
- backend/src/modules/customer-service/ 全目录（约 25 个文件）
  - cs.service.ts
  - cs.gateway.ts (Socket.IO)
  - cs-routing.service.ts (三层路由)
  - faq.service.ts
  - agent.service.ts (人工客服)
  - ticket.service.ts
  - ai-intent.service.ts（如果存在）
- app/cs/ 目录（买家 App）
- admin/src/pages/cs/ 目录（管理后台 6 个页面）
- schema.prisma: CsSession, CsMessage, CsTicket, CsFaq, CsAgent, CsIntent, CsQuickReply, CsQuickEntry（8 个数据模型）

**使用模板**: B 档标准审查模板

**🚨 关键验证点 #1**:
- `backend/src/modules/customer-service/cs.service.ts` 附近是否有 SESSION_IDLE_TIMEOUT 常量
- 当前值是多少？（预期是 2 小时 = 2 * 60 * 60 * 1000 ms）
- 是否有 "TODO: 上线前改回 2h" 的注释
- 如果当前是 5000（5 秒），这是 🔴 Tier 1 阻塞项，必须报告

**关键验证点**:
1. 三层路由实现完整度:
   - Layer 1: FAQ 关键词匹配
   - Layer 2: AI 意图分类（Qwen）
   - Layer 3: 转人工
2. Socket.IO Gateway 实时双向通信
3. 会话状态机（ACTIVE / IDLE / CLOSED / WAITING_AGENT）
4. 消息去重（最近 bb29234 修复的数组包裹 JSON + 空回复 fallback）
5. 输入框焦点保持（最近修复的 submitBehavior='submit'）
6. 本地/服务端消息对账（避免重复渲染）
7. AI 回复格式容错
8. 人工客服工作台（admin workstation.tsx）
9. 工单创建与追踪
10. FAQ 管理
11. 快捷回复 / 快捷入口
12. 管理后台 CS dashboard

**🤖 AI 用户感知质量**:
- Qwen 提示词是否针对客服场景优化
- 寒暄处理（"在吗"等问候语，最近修复）
- 意图分类准确率保障
- 转人工触发条件清晰度

**E2E 场景**:
1. Golden path: 用户进入 CS → 发消息 → FAQ 命中 → 返回答案
2. Fallback: FAQ 未命中 → AI 处理 → AI 返回答案
3. 转人工: AI 失败 → 转人工 → 工单创建 → 管理端回复
4. 会话超时: 5 分钟无消息 → 提示 → 关闭（前提是 TIMEOUT 已改回正常值）

**❓ 必问疑点**:
- SESSION_IDLE_TIMEOUT 当前真实值？
- 是否还有其他测试用硬编码未改回生产值？
- 推荐订单上下文是否接入？

**禁忌**:
- 不要审查 L2 AI 搜索（L2 的工作）
- 不要修改代码

**输出长度**: 400 行以内

完成后回复: "L9 customer service audit written to docs/superpowers/reports/2026-04-11-drafts/L09-customer-service.md"
```

- [ ] **Step 2: 验证输出**

读 L09-customer-service.md，特别检查:
- SESSION_IDLE_TIMEOUT 真实值明确
- 🚨 section 明确标注所有硬编码测试值

---

## Task 12: L10 卖家上货 + 商品审核审查

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L10-seller-product.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L10 seller product audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L10 卖家上货 + 商品审核链路做 B 档标准审查。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L10-seller-product.md

**审查范围**:
- backend/src/modules/seller/seller-products/ 或 seller-product/
- backend/src/modules/admin/products/ (管理端审核)
- backend/src/modules/upload/ (OSS 上传模块)
- backend/src/modules/product/ (商品核心)
- seller/src/pages/products/ (卖家后台商品管理)
- admin/src/pages/products/ (管理后台审核)
- backend/src/modules/seller/seller-company/ (企业资料)

**使用模板**: B 档标准审查模板

**关键验证点**:

上货流程:
1. 卖家登录 → 创建商品 → 编辑 → 提交审核
2. 商品表单字段齐全（名称、描述、产地、分类、AI 关键词、属性、SKU、图片）
3. OSS 图片上传（upload.service.ts, UPLOAD_LOCAL 开关）
4. SKU 管理（规格 + 价格 + 库存）
5. 自动定价（cost × MARKUP_RATE，奖品商品例外）
6. 商品描述必填 ≥20 字 + AI 提示语
7. 企业简介必填 ≥20 字
8. 溯源批次关联

商品审核:
9. 管理端审核队列 Tab 切换
10. 审核通过 / 驳回
11. 审核日志 AuditLog
12. 审核通过后自动上架
13. 卖家修改后重新提交审核
14. 下架商品的重新提交

权限:
15. 卖家只能管理自己公司的商品（companyId 过滤）
16. OWNER/MANAGER 才能提交审核
17. 管理员审核权限

**🚨 关键疑点**:
- OSS 是否真的接通（UPLOAD_LOCAL=false 时的代码是否执行）
- 图片上传失败时的错误处理
- 超卖容忍机制（stock < 0 时的通知）

**E2E 场景**:
1. Golden: 卖家登录 → 新建商品 → 上传 5 张图 → 填 SKU → 提交 → 管理员审核 → 通过 → App 端可见
2. 修改: 卖家修改已上架商品 → 重新审核
3. 驳回: 管理员驳回 → 卖家改正 → 重新提交

**禁忌**:
- 不要审查 L2 商品浏览（L2 的工作）
- 不要修改代码

**输出长度**: 300 行以内

完成后回复: "L10 seller product audit written to docs/superpowers/reports/2026-04-11-drafts/L10-seller-product.md"
```

- [ ] **Step 2: 验证输出**

---

## Task 13: L12 管理后台全页面联通审查

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L12-admin-console.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L12 admin console audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L12 管理后台全页面联通链路做 B 档标准审查。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L12-admin-console.md

**审查范围**:
- admin/src/pages/ 全部目录（逐页审查联通状态）
- admin/src/api/ 或 admin/src/repos/ (API 调用层)
- backend/src/modules/admin/ 全部子模块（对比前后端路径）

**使用模板**: B 档标准审查模板

**关键验证点 — 每个管理端页面必须逐页检查**:

根据 CLAUDE.md 和 spec，管理端至少包含以下页面（核对每个的联通状态）:
1. Dashboard (/)
2. 用户列表 (/users) → GET /admin/app-users
3. 管理员账号 (/admin/users) → GET /admin/users
4. 角色权限 (/admin/roles) → GET /admin/roles
5. 审计日志 (/audit) → GET /admin/audit
6. 商品列表 (/products) → GET /admin/products
7. 商品编辑 (/products/:id/edit)
8. 商品分类 (/categories)
9. 订单列表 (/orders) → GET /admin/orders
10. 订单详情 (/orders/:id)
11. 企业列表 (/companies) → GET /admin/companies
12. 企业详情 (/companies/:id)
13. 入驻申请 (/companies?tab=applications)
14. 会员列表 (/bonus/members) → GET /admin/bonus/members
15. 会员详情 (/bonus/members/:id)
16. 提现审核 (/bonus/withdrawals)
17. 溯源管理 (/trace)
18. 系统配置 (/config)
19. 发现页筛选 (/config/discovery-filters)
20. VIP 赠品方案 (/bonus/vip-gift-options)
21. CS Dashboard / FAQ / Tickets / Workstation / Quick Replies / Quick Entries (6 页)
22. 红包活动管理（如存在）

**对每个页面检查**:
- API 请求路径与后端 @Controller / @Get/@Post 路由是否完全匹配
- 请求参数与后端 DTO 是否匹配
- ProTable 列定义 / ProForm 字段与后端返回的 JSON 字段匹配
- 权限标识与 @RequirePermission 一致
- PermissionGate 按钮显隐
- 加载/空态/错误态处理

**输出格式** — 一张大表:
| 页面 | 路由 | 主 API 端点 | 联通状态 | 权限标识 | 已知问题 |
|---|---|---|---|---|---|

**🚨 关注点**:
- 新功能对应的管理页是否都有（VIP 赠品、发现页筛选、CS、红包等）
- 菜单 / 路由配置是否都注册了新页面
- 审计日志是否覆盖所有写操作

**禁忌**:
- 不要审查买家 App 页面
- 不要审查卖家后台页面
- 不要修改代码

**输出长度**: 600 行以内（页面多，表格长）

完成后回复: "L12 admin console audit written to docs/superpowers/reports/2026-04-11-drafts/L12-admin-console.md"
```

- [ ] **Step 2: 验证输出**

读 L12-admin-console.md，检查:
- 所有主要页面都有一行记录
- 联通状态列全部填写

---

## Task 14: L15 消息中心（事件盘点）审查

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L15-inbox-events.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L15 inbox events audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L15 消息中心（事件盘点）链路做 B 档标准审查。本任务的核心是**盘点所有业务事件，核对哪些已接 InboxService.send()，哪些漏了**。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L15-inbox-events.md

**审查范围**:
- backend/src/modules/inbox/ 全目录（现状：3 个文件，约 140 行）
- schema.prisma: InboxMessage 模型
- app/me/inbox/ 或 app/(tabs)/me/inbox.tsx 买家 App 消息中心页面
- **全项目 Grep `InboxService` 或 `inbox.service` 或 `InboxMessage` 找所有调用点**

**使用模板**: B 档标准审查模板（L15 主要产出是事件→监听者矩阵）

**必做事项 #1: 事件→监听者矩阵**（这是本审查最重要的产出）

列出所有"应当发通知的业务事件"，逐项核对是否已接 InboxService.send():

| 事件 | 发射位置 file:line | 应发通知给 | 是否已接 | 证据 |
|---|---|---|---|---|
| 订单支付成功 | payment.service.ts:? | 买家+卖家 | | |
| 订单已发货 | seller-orders.service.ts:? | 买家 | | |
| 物流签收 | shipment.service.ts:? | 买家 | | |
| 订单已完成（自动确认） | order-auto-confirm.service.ts:? | 买家 | | |
| 分润奖励到账 | reward-*.service.ts:? | 用户 | | |
| 奖励解冻 | freeze-expire.service.ts? 或 bonus.service:? | 用户 | | |
| 奖励过期失效 | freeze-expire.service.ts:? | 用户 | | |
| 提现申请成功 | bonus.service.ts:? | 用户 | | |
| 提现审核通过 | admin-bonus.service.ts:? | 用户 | | |
| 提现审核拒绝 | admin-bonus.service.ts:? | 用户 | | |
| VIP 激活成功 | bonus.service.ts:activateVipAfterPayment | 用户 | | |
| VIP 邀请人奖励 | bonus.service.ts:grantVipReferralBonus | 用户（邀请人） | | |
| 售后申请已提交 | after-sale.service.ts:? | 卖家 | | |
| 售后卖家审核通过 | after-sale.service.ts:? | 买家 | | |
| 售后卖家审核驳回 | after-sale.service.ts:? | 买家 | | |
| 售后平台仲裁结果 | after-sale.service.ts:? | 买家+卖家 | | |
| 退款到账 | after-sale.service.ts:? | 买家 | | |
| 换货运单创建 | after-sale.service.ts:? | 买家 | | |
| 商品审核通过 | admin-products.service.ts:? | 卖家 | | |
| 商品审核驳回 | admin-products.service.ts:? | 卖家 | | |
| 入驻申请审核通过 | merchant-application.service.ts:? | 商户 | | |
| 入驻申请审核驳回 | merchant-application.service.ts:? | 商户 | | |
| 卖家邀请员工 | seller-company.service.ts:? | 被邀请用户 | | |
| 新客服消息（AI 或人工） | cs.service.ts:? | 用户/客服 | | |
| 红包到账 | coupon.service.ts:? | 用户 | | |
| 红包即将过期 | coupon-expire cron:? | 用户 | | |

**必做事项 #2**: InboxMessage 数据模型字段（category / tag / priority）
- 是否支持消息分类（系统通知/订单通知/客服消息/奖励通知）
- App 端是否按分类分 Tab

**必做事项 #3**: 推送通道现状
- 是否接入 Expo Push？SMS 通知？
- 如果都未接，作为 v1.0 是否可接受（spec 决策是"不建新事件驱动中枢"）

**🚨 关键结论**:
- 该链路输出两份清单:
  1. **已接清单**: 哪些事件已经发通知
  2. **漏接清单**: 哪些事件应该发但没发（这是补漏工作的输入）
- 作为 Tier 1 审查标准：所有钱相关事件（奖励、提现、退款）必须全部已接，否则 🔴 阻塞

**禁忌**:
- 不要建议建立事件驱动中枢（spec 明确 v1.0 不做）
- 不要修改代码

**输出长度**: 500 行以内

完成后回复: "L15 inbox events audit written to docs/superpowers/reports/2026-04-11-drafts/L15-inbox-events.md"
```

- [ ] **Step 2: 验证输出**

读 L15-inbox-events.md，特别检查:
- 事件→监听者矩阵至少 20 行
- 每行都有"是否已接"的明确结论（不是"待审"）

---

## Task 15: L16 地址管理审查

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L16-address.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L16 address audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L16 地址管理链路做 B 档标准审查。这是简单链路，审查应简短。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L16-address.md

**审查范围**:
- backend/src/modules/address/
- schema.prisma: Address 模型
- app/addresses/ 或 app/me/addresses.tsx
- src/repos/AddressRepo.ts
- app/checkout.tsx 中地址选择部分
- seller/src/pages/company/ 中的发货地址（如果独立）

**使用模板**: B 档标准审查模板

**关键验证点**:
1. Address CRUD (GET/POST/PATCH/DELETE /addresses)
2. 默认地址设置（setDefault 返回完整 Address）
3. 字段对齐: receiverName / province / city / district / detail
4. 地区码是否准确
5. 结算页地址选择
6. addressSnapshot 存入订单（防止后续修改影响历史订单）
7. 卖家发货地址（如独立）
8. 无地址空态处理

**E2E 场景**:
1. 新建地址 → 设为默认 → 结算时自动选中
2. 修改地址 → 不影响已下的订单

**输出长度**: 200 行以内

完成后回复: "L16 address audit written to docs/superpowers/reports/2026-04-11-drafts/L16-address.md"
```

- [ ] **Step 2: 验证输出**

---

## Task 16: L17 溯源管理审查

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L17-trace.md`

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L17 trace audit"`，prompt:

```
你是一个只读审查 agent，对爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）的 L17 溯源管理链路做 B 档标准审查。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L17-trace.md

**审查范围**:
- backend/src/modules/trace/
- backend/src/modules/seller/seller-trace/
- backend/src/modules/admin/trace/
- schema.prisma: TraceBatch, OrderTrace, OrderItemTraceLink 或类似
- app/trace/ 或商品详情页中的溯源时间轴组件
- seller/src/pages/trace/
- admin/src/pages/trace/

**使用模板**: B 档标准审查模板

**关键验证点**:
1. TraceBatch 数据模型
2. 卖家创建批次（seller-trace）
3. 商品关联溯源批次
4. 买家查看时间轴（商品详情页）
5. 二维码扫描查询（如存在）
6. OrderTrace 格式（batches[] 数组，非单个 batch）
7. TraceBatch 字段对齐（productId / stage / status / verifiedAt）
8. 管理端溯源管理 CRUD

**E2E 场景**:
1. 卖家创建批次 → 关联商品 → 买家在商品详情看到溯源信息

**输出长度**: 200 行以内

完成后回复: "L17 trace audit written to docs/superpowers/reports/2026-04-11-drafts/L17-trace.md"
```

- [ ] **Step 2: 验证输出**

---

## Task 17: L8 顺丰丰桥直连迁移计划

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md`

**说明**: L8 不是"审查已有代码"，而是"规划从零写 SfExpressService + 迁移路径"。这是 C 档模板。

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L8 SF migration plan"`，prompt:

```
你是一个只读规划 agent。任务是为爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）规划从快递100迁移到顺丰丰桥直连的详细步骤。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md

**必读文档**:
- docs/features/shipping.md 的第 0 节（迁移决策背景）和第 7 节（顺丰直连改造方案）
- backend/src/modules/shipment/kuaidi100.service.ts（332 行）
- backend/src/modules/shipment/kuaidi100-waybill.service.ts（246 行）
- backend/src/modules/shipment/shipment.service.ts（484 行，核心业务逻辑）
- backend/src/modules/shipment/shipment.controller.ts
- backend/src/modules/shipment/dto/shipment-callback.dto.ts
- backend/src/modules/shipment/shipment.module.ts
- 4 个 spec 文件（kuaidi100*.spec.ts）

**使用模板**: C 档基建迁移模板

**规划任务**:

### 📋 实施步骤清单
写出至少 15 个细粒度步骤，每个步骤:
- 责任人 (AI / 用户)
- 预估工时（小时/天）
- 依赖（哪些步骤必须先完成）
- 详细做什么

参考顺序:
1. 用户申请顺丰月结账号 + 丰桥 API 权限（用户做，周期 3-5 天）
2. 注册丰桥沙箱账号，拿到 sandbox credentials（用户做）
3. AI: 新建 backend/src/modules/shipment/sf-express.service.ts 骨架
4. AI: 实现 SfExpressService.createOrder (电子面单创建，替代 Kuaidi100WaybillService)
5. AI: 实现 SfExpressService.printWaybill
6. AI: 实现 SfExpressService.cancelOrder
7. AI: 实现 SfExpressService.queryRoute (物流查询，替代 Kuaidi100Service)
8. AI: 实现 SfExpressService.parsePushCallback (回调解析)
9. AI: 环境变量迁移 KUAIDI100_* → SF_*
10. AI: ShipmentController.handleKuaidi100Callback → handleSfPush
11. AI: shipment.module.ts 注入切换
12. 用户: 沙箱联调测试发单
13. 用户: 沙箱联调测试物流查询
14. 用户: 沙箱联调测试回调推送
15. AI: 切换生产环境变量
16. AI: 删除 4 个 kuaidi100 文件（kuaidi100.service.ts, kuaidi100-waybill.service.ts, 两个 spec）
17. AI: 更新单元测试，105 个测试的大部分可以改名复用
18. 用户: 生产环境 smoke test

### 🔧 用户线下完成事项
- 申请顺丰月结账号（哪里申请？流程？预估周期？）
- 丰桥 API 权限申请
- 顺丰月结结算账号
- 测试账号 / 正式账号切换

### ⚠️ 迁移风险
- 保留的文件（ShipmentService 核心不动）
- 删除的文件（4 个 kuaidi100）
- 替换的文件（shipment.controller.ts handler 名字）
- 回滚方案：如果沙箱测试失败，如何临时回退到快递100？
- 数据库 Shipment 表 carrier 字段的新旧值对照

### 🎯 完成判定
- [ ] SfExpressService 所有方法实现并单测通过
- [ ] 沙箱环境 E2E 走通（发单 + 查询 + 回调）
- [ ] 生产环境 smoke test 通过
- [ ] 4 个 kuaidi100 文件已删除
- [ ] .env.example 的 KUAIDI100_* 已删除
- [ ] 卖家后台发货功能无感知切换

**输出长度**: 500 行以内（详细的步骤清单）

完成后回复: "L8 SF migration plan written to docs/superpowers/reports/2026-04-11-drafts/L08-sf-migration.md"
```

- [ ] **Step 2: 验证输出**

---

## Task 18: L13 部署上线清单

**Files:**
- Create: `docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md`

**说明**: L13 不是代码审查，是部署上线 checklist。C 档模板。

- [ ] **Step 1: 派发 Explore agent**

使用 Agent 工具，`subagent_type: Explore`，`description: "L13 deployment checklist"`，prompt:

```
你是一个只读规划 agent。任务是为爱买买项目（/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/）生成完整的 v1.0 部署上线 checklist。禁止修改任何文件，禁止运行代码。

**输出位置**: docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md

**必读文档**: docs/operations/deployment.md (如果存在)

**使用模板**: C 档基建迁移模板

**背景约束**（来自 spec）:
- 阶梯上线：管理后台 → 卖家后台 → App
- 三系统：买家 App / 卖家 Web / 管理后台 Web / 后端 NestJS
- 首批 500+ 用户
- 支付宝唯一支付（v1.0）
- 顺丰直连（需先完成 L8）
- 阿里云 OSS + SMS 已购
- 域名: 爱买买.com (app / seller / admin 子域)

**必须规划的 11 个步骤**（参考 plan.md 阶段十 10.3，但重新评估每一项的完成度）:
1. 购买云服务器（2核4G 或更高）— 规格建议 + 区域选择
2. 安装环境（Node.js 20+ / PostgreSQL 15+ / Redis / Nginx / PM2 / git）
3. 域名 DNS 配置（@/app/seller/admin 子域）
4. SSL 证书（certbot + 自动续期）
5. 部署后端（git clone + npm install + .env 配置 + prisma migrate + PM2 启动 + 日志轮转）
6. 部署管理后台（npm run build + Nginx 静态托管）
7. 部署卖家后台（npm run build + Nginx 静态托管）
8. 部署官网 / App 落地页（npm run build + Nginx + .well-known）
9. App 客户端发布（Expo build + 上架应用商店 / TestFlight）
10. 基础监控（PM2 monit + 日志查看 + 错误告警）
11. 数据备份策略（PostgreSQL pg_dump 定时 + OSS 归档）

**每个步骤包含**:
- [ ] 勾选框
- 责任人（用户 / AI）
- 预估工时
- 依赖
- 前置检查
- 执行命令或操作步骤
- 验证方式
- 失败回滚

### 🔧 用户线下完成事项
- 购买云服务器（费用估算）
- 域名购买 + ICP 备案（周期 15-20 天）
- SSL 证书申请
- 阿里云 OSS / SMS AccessKey 就位（用户自述已有，核对）
- 支付宝商户号 + 证书
- 顺丰月结账号
- App 应用商店账号（苹果开发者 $99/年 + 各安卓应用商店）

### ⚠️ 生产环境 .env 必配变量清单
完整列出上线前必须填写的所有环境变量:
- DATABASE_URL, REDIS_URL
- JWT_SECRET, SELLER_JWT_SECRET, ADMIN_JWT_SECRET (三套独立)
- PAYMENT_WEBHOOK_SECRET, LOGISTICS_WEBHOOK_SECRET
- ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY, ALIPAY_PUBLIC_KEY (或 ALIPAY_ALIPAY_PUBLIC_KEY)
- SF_* (顺丰相关，L8 完成后)
- OSS_BUCKET, OSS_ACCESS_KEY, OSS_SECRET
- SMS_ACCESS_KEY, SMS_SECRET, SMS_SIGN, SMS_TEMPLATE_*
- QWEN_API_KEY (AI_CS_INTENT_MODEL, QWEN_API_URL)
- SMS_MOCK=false, UPLOAD_LOCAL=false
- WECHAT_MOCK=true (v1.0 保持 mock)
- AI_SEMANTIC_SLOTS_ENABLED=true, AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=true, AI_SEMANTIC_SCORING_ENABLED=true

### 🎯 完成判定
全部 11 步骤勾选完成 + 生产环境 smoke test 通过

**输出长度**: 600 行以内

完成后回复: "L13 deployment checklist written to docs/superpowers/reports/2026-04-11-drafts/L13-deployment.md"
```

- [ ] **Step 2: 验证输出**

---

## Task 19: 用户审阅检查点 #1（Day 1 结束）

**说明**: 这不是 agent 任务，是主会话与用户的同步点。执行 Tasks 1-18 后停下来。

- [ ] **Step 1: 列出所有 draft 文件**

```bash
ls "docs/superpowers/reports/2026-04-11-drafts/"
```

Expected: 至少 18 个 .md 文件（00 + L01-L17）

- [ ] **Step 2: 向用户汇报进度**

主会话产出一段 200 字以内的摘要:
- 所有 agent 完成状况
- 🚨 关键疑点数量（从各 draft 的 🚨 section 统计）
- 🔴 Tier 1 阻塞项初步数量
- 待用户回答的疑点清单（从各 draft 的 ❓ section 聚合，去重）

- [ ] **Step 3: 等用户确认**

用户要做的事:
- 翻看所有 draft 文件
- 回答聚合的疑点清单
- 授权主会话进入 Task 20 整合阶段

---

## Task 20: 整合钱流图与跨链路耦合分析

**Files:**
- Modify: `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` (填充 §3)

**说明**: 主会话读取 L03-L07, L14 的 draft，整合出 3 条钱流路径的状态，并填充跨链路耦合矩阵。

- [ ] **Step 1: 读取所有钱链路 draft**

Read 以下文件:
- docs/superpowers/reports/2026-04-11-drafts/L03-cart-checkout.md
- docs/superpowers/reports/2026-04-11-drafts/L04-alipay.md
- docs/superpowers/reports/2026-04-11-drafts/L05-reward-allocation.md
- docs/superpowers/reports/2026-04-11-drafts/L06-vip-purchase.md
- docs/superpowers/reports/2026-04-11-drafts/L07-after-sale.md
- docs/superpowers/reports/2026-04-11-drafts/L14-coupon.md
- docs/superpowers/reports/2026-04-11-drafts/L15-inbox-events.md

- [ ] **Step 2: 填充报告 §3 钱流图**

在报告 §3 section 写入三条路径的完整 ASCII 图：

**路径 1：支付成功 → 订单确认 → 分润发放** — 从 spec §5.1 复制模板图，每个节点标上从 draft 中提取的状态（🟢/✅/🟡/⬜/🔴）

**路径 2：退款 → 全量回滚** — 同上

**路径 3：VIP 购买 → 激活 → 分润豁免** — 同上

每条路径图下方列出:
- 该路径的阻塞节点（🔴 和 🟡）
- 该路径的 E2E 测试场景

- [ ] **Step 3: 填充报告 §3 交界服务盘点**

从 spec §5.2 复制 7 个交界服务表格，每个服务从 draft 中提取：
- 当前实现状态
- 发现的问题

- [ ] **Step 4: 填充报告 §3 事件矩阵**

从 L15-inbox-events.md 复制完整的事件→监听者矩阵

- [ ] **Step 5: 填充报告 §3 六个高风险耦合点**

从 spec §5.4 复制 6 个耦合点，对每个标注:
- 当前状态（基于 draft）
- 是否有 bug / 是否已验证

---

## Task 21: 整合 Executive Summary + 阻塞项汇总

**Files:**
- Modify: `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` (填充 §0, §6, §7, §8, §9)

- [ ] **Step 1: 读取所有 17 个 draft + 横切 draft**

Read 所有 18 个 draft 文件（00-cross-cutting + L01-L17），从中提取:
- 每个链路的整体状态（🟢/✅/🟡/⬜/🔴）
- 每个链路的 🚨 关键疑点
- 每个链路的 Tier 1 阻塞项列表
- 每个链路的 Tier 2 待补项列表
- 每个链路的"用户线下完成事项"
- 每个链路的"待用户确认疑点"

- [ ] **Step 2: 填充 §0 Executive Summary**

按 spec §6.1 的模板填写:
- 整体健康度统计（🟢/✅/🟡/⬜/🔴 各多少条）
- Tier 1 阻塞项 top 10 表格
- Tier 2 待补项列表
- 3-5 条关键风险
- 预估总工时（最优 / 正常 / 悲观）

- [ ] **Step 3: 填充 §6 Tier 1 上线阻塞项汇总**

所有 draft 中标记"阻塞 T1"的验证点汇总成一张表:
| # | 问题 | 链路 | 严重度 | 预估工时 | 归属 Batch |

按严重度排序。

每项包含 checkbox 供用户勾选。

- [ ] **Step 4: 填充 §7 Tier 2 待补项汇总**

同上，按 Tier 2 整理。

- [ ] **Step 5: 填充 §8 用户线下完成事项**

聚合所有 draft 的"用户线下完成事项"，按紧急度排序:
- 最紧急（影响 L8 / L13）:
  - 顺丰月结申请（周期 3-5 天）
  - 域名备案（周期 15-20 天）
- 中紧急（影响上线）:
  - 阿里云 OSS / SMS AccessKey 填入 .env
  - 支付宝商户证书配置
  - 服务器购买
- 一般:
  - 应用商店账号

- [ ] **Step 6: 填充 §9 待用户确认疑点清单**

聚合所有 draft 的 "❓ 需要用户确认的疑点" section，去重，按紧急度分类:
- 🔴 必须立即回答（影响审查正确性）
- 🟡 影响实施计划（希望本周回答）
- 🟢 可延后（在实施期间随时回答）

每条格式:
| # | 疑点 | 链路来源 | 选项 A | 选项 B | 选项 C |

---

## Task 22: 整合修复实施顺序建议

**Files:**
- Modify: `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` (填充 §10)

- [ ] **Step 1: 根据 §6 阻塞项，规划修复顺序**

按以下逻辑排序:
1. **Week 1: 零成本快速修复**
   - CS SESSION_IDLE_TIMEOUT 改回 2h（5 分钟）
   - Mock 开关切换（SMS / OSS）
   - AI 语义开关激活
   - PAYMENT_WEBHOOK_SECRET / LOGISTICS_WEBHOOK_SECRET 填入

2. **Week 1-2: 钱链路补齐**
   - AlipayService.refund() 真实实现（L4/L7 依赖）
   - L5 分润 rollbackForOrder 对称性检查
   - L7 after-sale 核心 T1 功能（纯退款 + 卖家审核）
   - L14 红包退款归还逻辑

3. **Week 2-3: 基础设施 + 部署**
   - L8 顺丰从零写（并行申请月结）
   - L10 OSS 实际接入验证
   - L13 部署上线 11 步

4. **Week 3-4: Tier 2 补齐**
   - L6 VIP 多档位前端
   - L11 发票骨架
   - L7 退换货完整规则引擎
   - L15 消息事件补漏

5. **Week 4-6: E2E 测试 + 种子商户**
   - 阶梯上线：管理后台 → 卖家后台 → 种子商户上货 → App 对外

- [ ] **Step 2: 写入 §10 修复实施顺序建议**

每个 batch 包含:
- 起止周
- 并行 / 串行
- 依赖关系
- 完成判定
- 风险提示

- [ ] **Step 3: 为 writing-plans 输出提示**

§10 末尾写一段话，告诉后续的 writing-plans 阶段:
- 每个 batch 将拆成独立的 plan 文件
- Batch 1 的 plan 最急（拆成 Task 级别的 TDD 步骤）
- 建议用 subagent-driven-development 执行

---

## Task 23: 整合链路详细审查 §4

**Files:**
- Modify: `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` (填充 §4)

- [ ] **Step 1: 按顺序拼接 17 个 draft**

进入 §4 section，按以下顺序拼接（不是简单 copy，是每个 draft 提取核心内容）：

1. T1 钱链路 (A 档): L3 / L4 / L5 / L14
2. T2 钱链路 (A 档): L6 / L7 / L11
3. T1 非钱链路 (B 档): L1 / L2 / L9 / L10 / L12 / L15 / L16 / L17
4. 基建 (C 档): L8 / L13

每条链路的 §4.Lx section 包含完整的 draft 内容（保留 🚨 / 💰 / ↩️ 等所有 section）。

- [ ] **Step 2: 填充 §5 跨链路耦合矩阵**

一张 17×17 的表（行=链路，列=链路），单元格仅在有耦合关系时填写一两句说明 + 风险级别。

对角线留空。大部分单元格也会为空，只在实际有耦合的点填写（预计 30-40 个非空单元格）。

- [ ] **Step 3: 填充 §11 附录**

- 17 条链路 × 5 类状态的统计矩阵
- 所有扫描命令的记录（供复跑）
- 本次审查未覆盖的范围明确声明（v1.1+ 功能 / UI 视觉 / 性能压测 / 安全渗透测试）

---

## Task 24: 最终用户审阅

**Files:**
- Read: `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md`

- [ ] **Step 1: 向用户汇报**

主会话给出 300 字以内的最终摘要:
- 报告总页数
- Tier 1 阻塞项数量
- Tier 2 待补项数量
- 预估上线剩余工时
- 待用户回答的疑点数量
- 用户线下必须完成事项数量

- [ ] **Step 2: 等用户审阅**

用户打开报告文件，逐项确认:
- §6 Tier 1 阻塞项清单逐条打勾（或标红不同意）
- §7 Tier 2 待补项逐条打勾
- §9 待确认疑点逐条回答
- §8 线下事项确认已启动

- [ ] **Step 3: 根据反馈修正**

如果用户发现错误或有补充，修改报告。修改后再次请用户确认。

- [ ] **Step 4: 报告定稿**

用户同意后，报告状态改为 "定稿"，更新 CLAUDE.md 的「相关文档」section 添加:
```
- `docs/superpowers/reports/2026-04-11-launch-readiness-audit-report.md` — v1.0 上线链路审查报告（17 条链路 + 6 项横切关注点，Tier 1/2 阻塞项汇总，**上线决策权威来源**）
```

- [ ] **Step 5: 提示下一步**

告诉用户:
- 此报告完成后，下一步是调用 `writing-plans` skill 为每个 batch 生成具体的修复实施计划
- 建议从 Week 1 零成本快速修复开始
- 其余 batch 可以根据用户的节奏逐个启动

---

## Self-Review

完成规划后自查（plan 作者运行，不是 agent 运行）:

**1. Spec 覆盖**:
- ✅ 17 条链路每条都有对应的 Task（L1→Task9, L2→Task10, L3→Task2, L4→Task3, L5→Task4, L6→Task5, L7→Task6, L8→Task17, L9→Task11, L10→Task12, L11→Task7, L12→Task13, L13→Task18, L14→Task8, L15→Task14, L16→Task15, L17→Task16）
- ✅ X1-X6 横切 → Task 1
- ✅ 钱流图 → Task 20
- ✅ 跨链路耦合矩阵 → Task 23 §5
- ✅ Executive Summary → Task 21
- ✅ 阻塞项汇总 → Task 21 §6/§7
- ✅ 用户线下事项 → Task 21 §8
- ✅ 待确认疑点 → Task 21 §9
- ✅ 修复实施顺序 → Task 22 §10

**2. Placeholder 扫描**:
- 无 "TBD" / "implement later"
- 每个 agent prompt 都是完整的 self-contained
- 文件路径都是绝对路径或相对项目根

**3. 类型一致性**:
- 所有 draft 文件名都用 L{NN} 两位数格式
- 所有 agent prompt 都要求输出到 `docs/superpowers/reports/2026-04-11-drafts/`
- 最终报告固定路径

**4. 执行依赖关系**:
- Task 0 → Task 1 (目录必须先创建)
- Tasks 2-18 可并行（但建议分批执行避免 agent 过载）
- Task 19 ← Tasks 1-18 (所有 draft 完成)
- Task 20 ← L03-L07, L14, L15 draft
- Task 21 ← 所有 draft
- Task 22 ← Task 21 阻塞项清单
- Task 23 ← 所有 draft
- Task 24 ← Tasks 20-23 完成

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-launch-readiness-audit.md`.

Two execution options:

**1. Subagent-Driven (推荐)**
- 主会话每派一个 Task，开一个全新 subagent 执行
- Task 之间有 review checkpoint
- 适合：需要严格按顺序 + 每条链路的 draft 立即 review
- 用 sub-skill: `superpowers:subagent-driven-development`

**2. Inline Execution**
- 主会话自己派 agent + 整合
- 批量执行 + 关键 checkpoint 给用户 review
- 适合：信任主会话的判断 + 快速推进
- 用 sub-skill: `superpowers:executing-plans`

**建议**: 由于本审查有 24 个 Task 且 Task 2-18 可并行，Inline Execution 效率更高（可在一个 turn 内并行派 5-7 个 agent）。Subagent-Driven 会严格 1:1 派发更慢但更稳。

哪种方式？
