# 爱买买 v1.0 上线链路审查方案

> **状态**：审查方案设计稿（非审查报告本身）
> **创建时间**：2026-04-11
> **权威范围**：定义"距离 v1.0 上线还差什么"的审查方法、链路清单、验证标准、执行方式与最终产出格式
> **后续**：此 spec 获批后，交接给 `writing-plans` 生成具体的执行计划；执行计划跑完后产出实际的审查报告 `docs/superpowers/reports/2026-04-XX-launch-readiness-audit-report.md`

---

## 0. 背景与上下文

### 0.1 项目现状摘要

`plan.md` 最新的进度记录停留在 **2026-03-27（推荐码延迟深度链接）**，之后的多个重大功能（智能客服、统一退换货 AfterSaleRequest、VIP 多档位、语义意图升级、可配置标签、发现页筛选、顺丰丰桥直连、支付宝分润出款、发票等）均未在 plan.md 登记，但 `CLAUDE.md` 的「相关文档」章节有引用。

用户目标：**抓紧上线 App，质量优先，无硬 deadline，首批 500+ 用户**。用户自述当前在并行处理 5 项工作：智能客服、支付宝接通、AI 优化、顺丰接通、微信支付接通。

本次审查要做的事：基于代码实际状态（而非文档声明）给出完整的"哪些链路已通、哪些半成品、哪些未开始"的清单，作为上线前的决策依据。

### 0.2 brainstorming 期间确定的 MVP 范围

以下决策在 2026-04-11 的 brainstorming 中已获用户明确确认：

| 维度 | 决策 |
|---|---|
| **支付渠道** | v1.0 只支持支付宝；微信支付推迟到 v1.1（约 4-5 天工作量，零代码进度） |
| **退款方式** | 必须退回到原支付方式（支付宝订单 → 调用支付宝退款 API） |
| **OSS/SMS** | 阿里云账号已购，上线时切 `UPLOAD_LOCAL=false` + `SMS_MOCK=false` + 填 AccessKey 即可 |
| **时间节奏** | 6-8 周，无硬 deadline，质量优先 |
| **首批用户** | 500+ |
| **MVP 范围** | Tier 1 + Tier 2（Tier 3 全部推迟到 v1.1） |
| **上线节奏** | 阶梯上线：管理后台 → 卖家后台（+ 种子商户上货）→ App 对外 |
| **快递方案** | 从快递100迁移到顺丰丰桥直连（用户 2026-04-10 决定），代码尚未开写 |

### 0.3 核心原则

1. **钱相关链路零容忍**：L3/L4/L5/L6/L7/L11/L14 涉及金钱流动，bug 代价不可接受
2. **AI 是差异化**：L2/L9 不能只验证"接通了第三方 API 没"，还要验证用户感知质量
3. **证据必须 file:line**：所有"已完成"声明必须链接到具体代码位置、commit 或测试结果
4. **双向确认**：审查发现必须给用户逐项确认，不单方面标完成
5. **只读审查**：本次审查只读代码/文档，不修改任何代码；修复工作留给后续的 writing-plans 阶段

---

## 1. 审查范围与方法

### 1.1 审查边界

**包含**：
- 17 条链路的代码实现完整度
- 6 项横切关注点（事务、幂等、webhook 安全、权限隔离、mock 开关、性能）
- 跨链路耦合风险点（钱流图 + 事件矩阵 + 交界服务）
- 上线阻塞项汇总（区分 Tier 1 / Tier 2）
- 用户线下必须完成的事项（申请月结、域名、证书等）

**不包含**：
- 真实执行代码（只读）
- 真实发请求到第三方服务
- UI 视觉 / UX 评估
- 功能重新设计
- v1.1+ 的功能（F1-F5 / 微信支付 / 可配置标签 / 发现页筛选 / 微信登录 / 推荐码真机验证 等）
- 重新校对 plan.md / data-system.md 等历史文档

### 1.2 状态图例

| 图标 | 含义 |
|---|---|
| 🟢 | 已实现 + 已真机 / 联调测试通过 |
| ✅ | 已实现 + 代码审查通过（未联调） |
| 🟡 | 部分实现（骨架 / 开关关闭 / 占位符） |
| ⬜ | 未开始 |
| 🔴 | 已实现但有 bug / 硬编码测试值 / 安全漏洞 / 占位符假装完成 |
| 💰 | 涉及金钱流动（适用 A 档深审模板） |
| 🤖 | AI 链路（需验证用户感知质量） |

### 1.3 验证点的证据要求

每个验证点的"状态"都必须附带以下**至少一种**证据：
- 代码位置：`文件路径:行号`
- Commit 哈希：指向引入或修复该功能的 commit
- 测试文件：指向覆盖该验证点的单测 / 集成测试
- 用户口头确认："用户在 X 时间确认该功能已上线并通过手工测试"

禁止仅凭 plan.md / CLAUDE.md / 其他文档的声明下结论。

---

## 2. 链路清单（17 条）

### 2.1 核心链路（L1-L13）

| # | 链路 | 范围 | Tier | 标记 | 涉及系统 |
|---|---|---|---|---|---|
| **L1** | **三系统用户认证** | 买家（手机+短信+JWT+session 撤销）/ 卖家（账号密码+多企业切换+companyId 过滤+OWNER/MANAGER/OPERATOR）/ 管理端（账号密码+验证码+bcrypt+AdminSession+RBAC）/ 三套 JWT 密钥隔离 + 交叉伪造测试 | T1 | — | 三端 |
| **L2** | **商品浏览 + AI 搜索** | 商品列表/详情、分类、搜索、AI 推荐、发现页、溯源展示 | T1 | 🤖 | App + 后端 |
| **L3** | **购物车 + 下单（CheckoutSession）** | 加购、规格、库存校验、地址选择、运费计算、CheckoutSession 创建、订单生成 | T1 | 💰 | App + 后端 |
| **L4** | **支付宝支付** | 发起支付 → 唤起支付宝 → 回调 → 验签 → 订单状态机 → 账本记录 | T1 | 💰 | App + 后端 + 支付宝 |
| **L5** | **分润奖励** | 订单确认 → profit 计算 → VIP 上溯 / 普通广播 → RewardLedger → 解锁 → 平台六分 | T1 | 💰 | 后端 |
| **L6** | **VIP 购买（多档位）** | 选档 → 选赠品 → VIP CheckoutSession → 支付 → 激活 → 三叉树插入 → 站内通知 | T2 | 💰 | App + 后端 |
| **L7** | **统一售后（退/换货）** | `refund.md` 23 条规则引擎 + 三种售后类型 + 状态机 + 寄回阈值 + 运费分摊 + 分润回滚 + 库存回填 + 红包归还 + 退款退回原支付方式 | T1+T2 | 💰 | 三端 + 支付宝 |
| **L8** | **顺丰丰桥直连快递** | **从零写 `SfExpressService`**（替换 `Kuaidi100WaybillService` + `Kuaidi100Service`）+ 回调切换 + 4 个 kuaidi100 文件删除 + 环境变量迁移 | T1 | — | 后端 + 顺丰 |
| **L9** | **智能客服** | 三层路由（FAQ → AI Qwen → 转人工）+ Socket.IO + 工单 + 管理后台 6 页面 + 会话超时硬编码修复 | T1 | 🤖 | 三端 |
| **L10** | **卖家上货 + 商品审核** | 登录 → 创建商品 → OSS 图片上传 → SKU/价格 → 提交审核 → 管理后台审核 → 上架 | T1 | — | 卖家 + 管理后台 + 后端 |
| **L11** | **发票申请** | 买家申请 → 开票信息 → 订单关联 → 卖家/平台开具 → PDF 下载 | T2 | 💰 | App + 后端 |
| **L12** | **管理后台全页面联通** | Dashboard / 用户 / 商品 / 订单 / 企业 / 会员 / 提现 / 审计 / 配置 / 溯源 / CS 全 11+ 页面联通 | T1 | — | 管理后台 + 后端 |
| **L13** | **部署 + 基础设施** | 服务器 / DNS / SSL / Nginx / PM2 / 数据库 / Redis / OSS / SMS / 环境变量 / 监控 | T1 | — | 运维 |

### 2.2 新增链路（L14-L17）

| # | 链路 | 范围 | Tier | 涉及系统 |
|---|---|---|---|---|
| **L14** | **平台红包（优惠券）** | 领取 → 展示 → 结算抵扣 → 使用记录 → 过期失效 → 多张叠加 → 售后场景按比例分摊 | T1 | 💰 |
| **L15** | **消息中心（事件盘点）** | 盘点所有需要发通知的业务事件 → 核对 `InboxService.send()` 实际接入情况 → 补漏清单 → 不建新事件驱动中枢（v1.1 再说） | T1 | 三端 |
| **L16** | **地址管理** | CRUD / 默认地址 / 地区码 / 结算选地址 / 卖家发货地址 | T1 | App + 后端 |
| **L17** | **溯源管理** | 卖家创建批次 → 商品关联 → 买家查看时间轴 → 二维码扫描 | T1 | 卖家 + App |

### 2.3 明确排除的功能（Tier 3，推迟到 v1.1）

- 可配置标签系统（TagCategory / CompanyTag）
- 发现页筛选栏动态化
- 五大新功能 F1-F5（订单流程重构 / 赠品锁定 / 奖品过期 / 平台公司 / 奖励过期）
- VIP 赠品多 SKU 组合
- 微信支付
- 微信登录
- 任务 / 签到 / 关注 / 社交互动
- 推荐码延迟深度链接的真机验证（依赖部署完成后再做）

---

## 3. 横切关注点审查（X1-X6）

横切关注点不在每条链路里重复写，在审查报告开头单独成章，对 17 条链路全扫一遍。

### X1. 事务隔离 + CAS

**扫描方法**：
- `grep` 所有 `this.prisma.$transaction` 调用
- 检查每个事务是否显式 `isolationLevel: 'Serializable'`
- 对金额/库存/奖励写操作检查是否使用 `updateMany where: { ...conditions }` CAS 模式
- 检查 P2034 重试策略

**输出格式**：
```markdown
| 位置 | 隔离级别 | CAS | 钱操作 | 状态 | 备注 |
|---|---|---|---|---|---|
| checkout.service.ts:230 | Serializable | ✓ | 是 | ✅ | — |
| bonus-allocation.service.ts:87 | 未指定 | ✗ | 是 | 🔴 | 阻塞 Tier 1 |
```

**覆盖链路**：L3 / L4 / L5 / L6 / L7 / L14

### X2. 幂等键

**扫描方法**：
- `grep` `idempotencyKey` / `idempotency_key` / `IdempotencyKey`
- 检查 Prisma schema 里这些字段的 `@unique` 约束
- 检查 catch 块是否处理 `P2002`（unique 冲突 = 幂等命中）
- 所有 Webhook 端点必须有幂等设计

**输出格式**：
```markdown
| 场景 | 键格式 | DB 唯一约束 | 冲突处理 | 状态 |
|---|---|---|---|---|
| 支付宝回调 | payment:{providerOrderId} | ✓ @unique | P2002 graceful skip | ✅ |
| 分润分配 | ALLOC:{trigger}:{orderId}:{rule} | ? | ? | 待审 |
| 退款 | ? | ? | ? | 待审 |
```

**覆盖链路**：L4 / L5 / L7 / L8 callbacks

### X3. Webhook 安全

**扫描方法**：
找到所有 `@Public()` 控制器端点，逐个检查三件事：
1. **签名验证**（HMAC / RSA，`crypto.timingSafeEqual`）
2. **IP 白名单**（`WebhookIpGuard` 或等价）
3. **Secret 配置**（生产环境 `.env` 必需变量）

**输出格式**：
```markdown
| 端点 | 签名 | IP 白名单 | Secret 配置 | 状态 |
|---|---|---|---|---|
| POST /payments/callback (支付宝) | ✅ 证书验签 | ⬜ | ALIPAY_PUBLIC_KEY | ✅ |
| POST /shipments/callback (顺丰) | ⬜ | ⬜ | ⬜ 等 L8 顺丰写完 | ⬜ |
```

**覆盖链路**：L4 / L8

### X4. 三系统权限隔离

**扫描方法**：
- 扫所有 `@Controller()` 类，提取使用的 Guard 栈
- 分三类登记：买家控制器 / 卖家控制器（需 `@Public()` + `SellerAuthGuard`）/ 管理控制器（需 `@Public()` + `AdminAuthGuard` + `PermissionGuard`）
- 特别检查：卖家控制器漏写 `@Public()` 被全局买家 Guard 错误处理
- 伪造测试清单：
  - 买家 JWT 访问 `/admin/*` → 应 401
  - 卖家 JWT 访问 `/admin/*` → 应 401
  - 管理员 JWT 访问 `/seller/*` → 应 401
  - 买家 A 访问买家 B 的订单 → 应 403
  - 卖家 A 访问公司 B 的商品 → 应 403（`companyId` 过滤）

**输出**：JWT 密钥隔离矩阵（3×3 表） + 每个控制器的 Guard 栈快照 + 伪造测试场景清单

**覆盖链路**：L1 + 贯穿全部

### X5. Mock 开关 + 环境变量

**扫描方法**：
- `grep` `_MOCK | _LOCAL | _ENABLED` 整个 `backend/src`
- 读 `backend/.env.example` / `.env.example` / `.env.production`（如存在）
- 逐项登记默认值、生产期望值、当前状态

**输出格式**：
```markdown
| 变量 | 默认 | 生产期望 | 代码引用 | 状态 |
|---|---|---|---|---|
| SMS_MOCK | true | false | auth.service.ts:45 | ⬜ 待切换 |
| UPLOAD_LOCAL | true | false | upload.service.ts:12 | ⬜ 待切换 |
| WECHAT_MOCK | true | true (v1.1) | auth.service.ts:89 | 🟡 保持 |
| AI_SEMANTIC_SLOTS_ENABLED | false | true | ai.service.ts:? | ⬜ 待激活 |
```

**覆盖链路**：L4 / L8 / L9 / L13

### X6. 性能红线

**扫描方法**：
- N+1 查询反模式（`for ... await prisma.xxx.findXxx`）
- 分页钳制（全局 `PaginationInterceptor` 生效 + `pageSize` 上限）
- 缓存失效（每个 `TtlCache` 实例有对应的 `invalidate*()` 调用）
- 金额精度统一（`grep Number | parseFloat | toFixed` 在金额计算处，确认用 Float/元）
- 热点索引（L5 分润查询、L7 售后查询的 where 字段）

**输出**：N+1 清单 / 缓存失效漏洞 / 慢查询候选 / 金额精度不一致点

**覆盖链路**：全部

---

## 4. 链路详细审查模板（三档）

### 4.1 A 档：💰 钱链路深审模板

**适用**：L3 / L4 / L5 / L6 / L7 / L11 / L14（7 条）

```markdown
## L{N}. {链路名} 💰 (Tier {1|2})

### 📍 范围
一两句话说清覆盖什么、不覆盖什么

### 🔗 端到端路径（含钱的流动）
Golden path + 关键分支（退款路径 / 失败路径 / 并发路径）

### 💰 账本完整性检查
Payment / Order / RewardLedger / Inventory / Coupon 之间每一步的对账点
检查是否存在"钱入账了但状态没更新"的时间窗口

### 🔒 并发安全检查
- [ ] Serializable 隔离级别
- [ ] 幂等键设计（格式 + 唯一约束）
- [ ] CAS 更新（updateMany where: { condition }）
- [ ] P2034 重试策略
- [ ] 金额精度统一（Float 元）

### ↩️ 回滚/退款对称性
正向流程每一步，反向流程（退款/取消/失败）是否对称回滚？
列出所有正反对账点。

### ✅ 验证点清单
| # | 验证点 | 状态 | 证据 (file:line / commit) | 阻塞 T{N} | 补工作 |
|---|--------|------|---------------------------|-----------|---------|

### 🚧 已知问题
TODO / FIXME / 占位符 / 硬编码测试值

### 🔗 耦合依赖
- 依赖：L{X}
- 被依赖：L{Y}

### 🧪 E2E 场景（含反向 + 并发）
1. Golden path
2. 并发下单同一 SKU（超卖）
3. 支付成功但回调丢失（幂等重放）
4. 部分退款 / 退款失败重试
5. 退款与分润回滚的事务原子性
6. 其他链路特定场景

### ❓ 需要用户回答的疑点
逐条列出，每条给 2-3 个选项供选

### 🎯 Tier {N} 验收标准
checkbox 列表，全部通过才算该 Tier 完成
```

### 4.2 B 档：标准审查模板

**适用**：L1 / L2 / L9 / L10 / L12 / L15 / L16 / L17（8 条）

```markdown
## L{N}. {链路名} (Tier 1)

### 📍 范围
### 🔗 端到端路径
### ✅ 验证点清单
| # | 验证点 | 状态 | 证据 | 阻塞 T1 | 补工作 |
### 🚧 已知问题
### 🧪 E2E 场景
1. Golden path
2. 1-2 个关键边界
### ❓ 需要用户回答的疑点
### 🎯 Tier 1 验收标准
```

### 4.3 C 档：基建 + 迁移模板

**适用**：L8 顺丰 / L13 部署（2 条）

```markdown
## L{N}. {链路名} (Tier 1)

### 📍 范围
### 📋 实施步骤清单（不是审查，是执行）
- [ ] 步骤 1 — 责任人（AI / 用户）
- [ ] 步骤 2 ...

### 🔧 需要用户线下完成的事
申请账号 / 购买服务 / 证书 / 域名 / 备案 ...

### 🎯 完成判定
```

---

## 5. 钱流图与跨链路耦合审查

本节是在每条链路单独审查之外，专门盯"链路交界处"的 bug 温床。

### 5.1 三条关键钱流路径

**路径 1：支付成功 → 订单确认 → 分润发放（正向）**

```
用户点支付 (L3)
 └→ CheckoutSession 创建 (L3, checkout.service.ts)
    └→ 跳支付宝 → 用户支付 → 回调 (L4, payment.controller.ts)
       └→ AlipayService.verifyNotify() (L4)
          └→ payment.service.ts: handlePaymentSuccess()
             ├→ Payment 表 PAID (L4)
             ├→ Order 表 PAID (L3)
             ├→ CheckoutSession 状态 (L3)
             ├→ VIP 激活？(L6, bonus.service.activateVipAfterPayment)
             ├→ 卖家通知（发货待办）(L10 + L15)
             └→ 站内消息 (L15, inbox.service.send)
 [等待发货 L8] → 签收 → 自动确认 7 天后
 └→ order-auto-confirm.service.ts: confirmReceive()
    └→ bonus-allocation.service.ts: allocateForOrder() (L5)
       ├→ VIP 上溯 or 普通广播
       ├→ RewardAllocation + RewardLedger
       ├→ RewardAccount.balance += x
       └→ 站内消息"奖励到账" (L15) ← 需要验证是否接入
```

**路径 2：退款 → 全量回滚（反向）**

```
买家发起售后 (L7, app/orders/after-sale/[id].tsx)
 └→ 售后规则引擎判定（refund.md 23 条）
    ├→ 价格阈值 → 决定是否寄回 (L7)
    ├→ 可退判定 (L7, Category.returnPolicy + Product.returnPolicy)
    └→ 平台红包分摊 (L14, coupon 比例计算)
 └→ 卖家审核通过 / 平台仲裁 (L7)
    └→ AfterSaleRequest 状态机 → REFUND_APPROVED
       └→ 原子回滚事务：
          ├→ AlipayService.refund() ← 🔴 目前是 TODO 占位
          ├→ Payment 退款记录
          ├→ Order 状态回滚 (L3)
          ├→ 分润 VOID (L5, rollbackForOrder)
          │   ├→ RewardLedger 条目 VOID
          │   ├→ RewardAccount.balance -= x
          │   ├→ VipEligibleOrder.valid = false
          │   └→ NormalEligibleOrder.valid = false
          ├→ 库存回填 (L3)
          ├→ 平台红包解锁 (L14, couponInstance 退回未使用)
          └→ 站内消息"退款成功" (L15)
```

**路径 3：VIP 购买 → 激活 → 分润豁免**

```
用户选 VIP 档位 + 赠品 (L6, app/vip/gifts.tsx)
 └→ CheckoutService.checkoutVipPackage() (L6)
    └→ bizType = VIP_PACKAGE
       └→ 支付回调 (L4)
          └→ handlePaymentSuccess() → activateVipAfterPayment() (L6)
             ├→ VipProgress 创建
             ├→ MemberProfile.tier = VIP
             ├→ 三叉树 BFS 插入 (L6)
             ├→ VIP 赠品商品 Order 创建（走 L8 发货）
             └→ 站内消息"VIP 已激活" (L15)
 └→ 这笔订单在 L5 分润中必须被跳过
    └→ allocateForOrder() 入口守卫：bizType === VIP_PACKAGE → return (L5)
```

**审查产出**：每条路径画成 ASCII / mermaid 图，节点标 🟢/✅/🟡/⬜/🔴，一眼看出断点。

### 5.2 关键交界服务盘点

| Service | 调用者（链路） | 变更风险 |
|---|---|---|
| `CheckoutService` | L3 / L6 / L14 (coupon apply) | 改一点影响三条 |
| `PaymentService.handlePaymentSuccess` | L4 / L3 / L5 / L6 / L15 | 正向扇出最多 |
| `BonusAllocationService.allocateForOrder` | L5 / L3 (订单确认触发) / L6 (豁免) | 钱的核心 |
| `BonusAllocationService.rollbackForOrder` | L7 / L5 | 反向回滚必须对称 |
| `ShipmentService` | L8 / L7 (质量问题退货运费) / L10 (卖家发货入口) | 顺丰迁移时改这里 |
| `InboxService.send` | L3-L17 各处 | 消息发漏不崩但体验差 |
| `AfterSaleService` (todo) | L7 + 调用 L3/L4/L5/L14 | refund.md 23 条规则集中地 |

### 5.3 事件 → 监听者矩阵（L15 消息中心核心输出）

| 事件 | 发射位置 | 监听者（预期） | 实际接入 |
|---|---|---|---|
| 订单支付成功 | payment.service:handlePaymentSuccess | Order 状态 / VIP 激活 / 发货待办 / 站内消息 | 待审 |
| 订单确认收货 | order.service:confirmReceive + autoConfirm | 分润发放 / 分润解冻 / 站内消息 | 待审 |
| 售后通过 | after-sale.service:approve (todo) | 退款 / 分润 VOID / 库存回填 / 红包退回 / 站内消息 | 待审 |
| VIP 激活 | bonus.service:activateVipAfterPayment | VIP 徽章 / 邀请人奖励 / 站内消息 | 待审 |
| 分润奖励到账 | reward-*.service:* | 站内消息 / App 红点 | 待审 |
| 奖励解冻 | reward-*.service:unlock* | 站内消息 / App 红点 | 待审 |
| 商品审核通过 | admin-products.service:approve | 卖家通知 / 上架 | 待审 |
| 入驻审核通过 | merchant-application.service:approve | 创建 Company/User/Staff / 卖家通知 | 待审 |
| 发货创建 | seller-orders.service:ship | 顺丰创建运单 / 买家通知 / 物流订阅 | 待审 |
| 物流签收 | shipment.service:onCallback delivered | Order 状态 / 7 天自动确认计时 / 买家通知 | 待审 |

### 5.4 六个高风险耦合点

1. **支付回调 → 多扇出写操作的事务边界**（L4→L3/L5/L6）—— 部分成功半状态
2. **退款原子回滚**（L7→L3/L4/L5/L14）—— 正反对称性，漏一个字段金额就错
3. **分润事务 + VIP 激活事务**（L5↔L6）—— VIP 激活过程中触发分润可能死锁/重复
4. **CheckoutSession 同一套代码走普通单 + VIP 单**（L3↔L6）—— bizType 分支必须覆盖所有钱操作
5. **顺丰回调 → 订单自动确认 → 分润发放**（L8→L3→L5）—— 顺丰迁移时这条链必须重新 E2E
6. **平台红包抵扣 → 退款时按比例归还**（L14↔L7）—— 部分退货 × 多张红包叠加的数学

---

## 6. 审查报告最终结构

审查执行后产出的报告文件位置：
`docs/superpowers/reports/2026-04-XX-launch-readiness-audit-report.md`

报告结构 11 节：

```
0. Executive Summary（一页内）
1. 审查范围与方法
2. 横切关注点审查结果（X1-X6）
3. 钱流图 & 跨链路耦合审查
4. 链路详细审查（L1-L17，按 Tier 钱/非钱分类排序）
5. 跨链路耦合矩阵快查表
6. 🔴 Tier 1 上线阻塞项汇总（可勾选 checkbox）
7. 🟡 Tier 2 待补项汇总
8. 用户需要线下完成的事（申请 / 购买 / 备案）
9. 待用户逐项确认的疑点清单
10. 交接给 writing-plans 的实施顺序建议
11. 附录（统计矩阵 / 扫描命令记录 / 未覆盖范围声明）
```

### 6.1 Executive Summary 模板

```markdown
## Executive Summary

**审查时间**：2026-04-XX
**审查范围**：17 条链路 + 6 项横切关注点
**MVP 目标**：Tier 1 + Tier 2，支付宝唯一支付，6-8 周，首批 500+ 用户

### 整体健康度
- 🟢 已完成 + 联调通过：X 条链路（Y%）
- ✅ 代码完成但未联调：X 条
- 🟡 部分完成：X 条
- ⬜ 未开始：X 条
- 🔴 有 bug / 占位符 / 硬编码测试值：X 条

### Tier 1 上线阻塞项（P0，必须修）
| # | 问题 | 链路 | 预估工时 |
|---|------|------|----------|

### Tier 2 待补项（P1，MVP 完整体验需要）
- ...

### 3-5 条关键风险提示
1. ...

### 预估到"可上线"的剩余总工时
- 最优估计：X 人日
- 正常估计：Y 人日
- 悲观估计：Z 人日（考虑顺丰申请延期 / bug 未知数）
```

---

## 7. 审查执行方式

### 7.1 Batch 分组

**Batch 1 — 钱链路深审**（L3 / L4 / L5 / L6 / L7 / L11 / L14，7 条，全部 A 档模板）
- L11 发票 💰 虽是 Tier 2，但因金钱属性同样走 A 档深审
- 用 Opus agent，重点审事务/幂等/对称回滚
- 预估时间：1-1.5 天

**Batch 2 — 非钱标准审查**（L1 / L2 / L9 / L10 / L12 / L15 / L16 / L17，8 条，全部 B 档模板）
- L15 消息中心是事件盘点任务，但审查方法属于 B 档功能性审查
- 可用 Sonnet agent 并行，功能性审查
- 预估时间：1 天

**Batch 3 — 基建 + 迁移计划**（L8 / L13，2 条，C 档模板）
- L8 是写作任务（规划 SfExpressService 迁移步骤 + 4 个 kuaidi100 文件的替换对照）
- L13 是部署 checklist（服务器/DNS/SSL/Nginx/PM2/.env 切换）
- 预估时间：0.5 天

**横切扫描 X1-X6**：在 Batch 1 开始前单独跑一次，结果被所有 Batch 引用；可与 Batch 1 部分并行。

### 7.2 主会话职责

- 分配 agent 任务
- 整合 agent 输出
- 处理 agent 发现的"需要用户确认"的疑点（立即停下来问用户）
- 写 Executive Summary / 跨链路耦合 / 实施顺序建议 这些需要跨链路推理的部分
- 最终收尾 + 让用户逐项打勾确认

### 7.3 执行节奏

- **Day 1**：X1-X6 横切扫描 + Batch 1 草稿 → 用户当日审一次
- **Day 2**：Batch 2 + Batch 3 草稿 + 钱流图 → 用户当日审一次
- **Day 3**：整合全文 + Executive Summary + 用户逐项打勾 → 终稿提交

### 7.4 疑点处理原则

- **关键疑点**（可能影响审查正确性或钱相关判断）→ 立即暂停审查，红色标注，提交给用户
- **小疑点**（功能细节、v1.0 是否需要某体验）→ 每条链路末尾批量列出，审查完成时一次性问

---

## 8. 明确不做的事

- 真实跑代码 / 发请求到第三方
- UI 视觉 / UX 评估
- 重新设计功能
- 修代码（留给 writing-plans 阶段）
- v1.1+ 功能（F1-F5 / 微信支付 / 微信登录 / 可配置标签 / 发现页筛选 / 推荐码真机验证）
- 重新校对 plan.md / data-system.md 等历史文档

---

## 9. Brainstorming 期间确定的所有决策（追溯）

以下决策按确认顺序记录，作为审查执行时的准绳：

1. **微信支付推迟到 v1.1**（零代码进度，4-5 天工作量，推迟以换取 6-8 周节奏）
2. **时间节奏 6-8 周，无硬 deadline，质量优先**（首批 500+ 用户）
3. **MVP = Tier 1 + Tier 2**（Tier 3 全部推迟 v1.1）
4. **退款必须退回原支付方式**（支付宝订单调用 Alipay 退款 API，不做余额退回）
5. **阿里云 OSS + SMS 已购**（上线时切开关即可）
6. **阶梯上线：管理后台 → 卖家 → App**（避免空城）
7. **分 3 档验证模板**（A 钱链路深审 / B 标准 / C 基建迁移）
8. **🟢 状态颜色用于"已真机联调"**（区分于代码通过）
9. **顺丰丰桥直连从零写**（2026-04-10 决定，代码未开始）
10. **L1 认证扩展为三系统**（买家 + 卖家 + 管理端）
11. **L7 退换货按 refund.md 23 条规则审查**
12. **L15 消息中心只做事件盘点**（不建新事件驱动中枢，v1.1 再说）
13. **疑点处理：关键疑点立即停 / 小疑点末尾批量**
14. **审查不真跑代码**（只读审查）
15. **三个系统上线前都要做 E2E 测试**（golden path + 关键边界）
16. **钱链路零容忍**（L3/L4/L5/L6/L7/L11/L14 加 A 档模板深审）
17. **AI 链路验证用户感知质量**（L2/L9 不仅验证 API 连通）

---

## 10. 开放问题（审查执行时需用户回答）

这些是 brainstorming 过程中未敲定、但会在审查阶段必问的问题，提前登记避免遗漏：

1. **L8 顺丰月结账号申请状态** — 是否已提交？预计多久拿到？
2. **L13 服务器** — 阿里云 ECS 规格？区域？是否已购？
3. **L13 域名** — `爱买买.com` 是否已购 + 备案？
4. **L4 支付宝商户号** — 是否已开通？有沙箱还是已有正式？证书在哪？
5. **L7 退换货业务代码** — `backend/src/modules/after-sale/` 目录是否存在完整的 Service/Controller？或只有 schema？
6. **L6 VIP 多档位前端** — 档位选择页当前是否已实现？
7. **L11 发票** — 有没有选定第三方电子发票服务（诺诺 / 百望云 / 自建）？
8. **L12 管理后台** — 最新的页面清单是否和 plan.md 2.3 一致？新功能是否都有对应管理页面？
9. **L10 卖家上货** — OSS 图片上传当前是否真的走 OSS（`UPLOAD_LOCAL=false`），还是本地存储？
10. **L15 消息推送通道** — v1.0 是否需要 Expo Push？还是只有 App 内 Inbox 就够了？
11. **L14 平台红包** — 当前有没有预设的活动 / 发放规则？发放引擎（Phase F）是否已完整实施？
12. **L2/L9 AI 验收标准** — 意图识别准确率目标？回复相关性人工评估标准？

---

## 11. 交接给 writing-plans 的内容

本 spec 获批后，调用 `superpowers:writing-plans` skill 生成执行计划，输入内容：

- 本 spec 的链路清单（17 条 + Tier 标签）
- 三档验证模板（A/B/C）
- 横切关注点 X1-X6 的扫描方法
- Batch 分组（3 批）
- 钱流图 + 耦合点 + 事件矩阵的审查方法
- 审查报告最终结构（11 节）
- 疑点处理原则

writing-plans 的产出是：
`docs/superpowers/plans/2026-04-XX-launch-readiness-audit.md`

该计划文件包含：
- 每个 agent 任务的完整 prompt
- 任务依赖关系（X1-X6 先跑，Batch 1-3 并行）
- 每个任务的输出位置
- 用户审核检查点（Day 1 / Day 2 / Day 3）
- 对于主会话的集成步骤

---

## 12. 本 spec 之后不做的事

- 不写实施代码
- 不派 agent 开始跑审查
- 不直接生成审查报告

本 spec 只负责定义"审查怎么做"。真正跑起来在 writing-plans → executing-plans 阶段。
