# Phase 1-9 全栈开发记录 — Schema 重建与模块实现

> **归档文件** — 本文件记录了 Phase 1-9 的完整开发过程，当前计划见 `plan.md`

## 本文件内容概要

本文件完整记录了爱买买 App 从零搭建到 Phase 9 完工的全过程：

1. **项目状态快照**：前端 39 个页面 + 19 个 Repository + 37 个组件；后端 18 个模块 + 60 个 Prisma 模型 + 39 个 enum
2. **Phase 1 — Schema 全量重建**：废弃 22 个平面模型，基于 data-system.md 一次性重建 60+ 表（覆盖 A-I 全部 9 域）
3. **Phase 2 — Auth + User + Company 重建**：User 拆分为 User/UserProfile/AuthIdentity，JWT payload 统一，级联修复 7 个模块
4. **Phase 3 — Product + Address + Cart**：SPU/SKU 分离、分类树、地址 CRUD、服务端购物车
5. **Phase 4 — Order + Payment + Shipment**：SKU 真实定价、地址快照、库存扣减/恢复、状态流转历史
6. **Phase 5 — 社交与互动模块适配**：Booking/Group/Follow/Task/CheckIn/Inbox 适配新 Schema
7. **Phase 6 — 溯源确权系统（F 域）**：商品溯源链、批次详情、扫码溯源 4 个 API
8. **Phase 7 — AI 系统（H 域）**：会话管理 + 消息发送，占位意图解析，预留 LLM/STT 对接点
9. **Phase 8 — 会员分润奖励系统（I 域）**：三叉树 BFS 插入、奖励钱包、提现、排队队列 9 个 API
10. **Phase 9 — 前端全面对接**：4 个新域类型 + 4 个新 Repo + 6 个新页面 + 5 个已有页面适配

---

> 最后更新：2026-02-15
> 技术栈：Expo 54 + React Native 0.81 + TypeScript（严格模式）+ expo-router 6
> 数据库设计权威来源：`data-system.md`（9 大域，60+ 表）

---

## 一、当前项目状态总览

### 架构概况

| 维度 | 数据 |
|------|------|
| **前端** | |
| 底部 Tab | 3 个（首页 AI买买 / 展览馆 / 我的） |
| 路由页面 | 39 个 .tsx 文件（Phase 9 新增 6 个） |
| Repository | 19 个（4 个已支持 API 模式，15 个 Mock + API 双模式） |
| 域模型类型 | 20 个 domain type 文件（Phase 9 新增 4 个） |
| Mock 数据文件 | 13 个 |
| UI 组件 | 37 个（8 个分类目录） |
| 设计令牌 | 7 个 theme 文件（colors/spacing/radius/typography/shadow） |
| TypeScript 编译 | **0 错误**（主工程，交付包/uniapp 除外） |
| 数据层 | Mock + Zustand（购物车/认证）+ React Query |
| **后端** | |
| 业务模块 | 18 个已实现（Phase 1-8 全部完成） |
| Prisma 模型 | 60 个 + 39 个 enum（基于 data-system.md 全量重建 ✅） |
| 已对接 API 的 Repo | 19 个（全部 Repo 支持 API 模式，通过 USE_MOCK 切换） |
| 全局中间件 | Result\<T\> 包装 / AppError 映射 / JWT 守卫 / DTO 校验 |

### 目录结构

```text
爱买买/
├─ app/                          # 路由页面（expo-router 文件系统路由）
│  ├─ _layout.tsx                # 根布局（QueryClient/Theme/GestureHandler/SafeArea/Toast）
│  ├─ index.tsx                  # 启动动画（品牌 Logo + 脉动光环 → 自动跳转首页）
│  ├─ (tabs)/
│  │  ├─ _layout.tsx             # 底部 3 Tab 导航
│  │  ├─ home.tsx                # 首页 AI买买（脉动按钮 + 搜索框 + 快捷入口）
│  │  ├─ museum.tsx              # 展览馆（企业列表/地图双模式 + 筛选 + 语义搜索）
│  │  └─ me.tsx                  # 我的（身份名片/签到/任务/订单/关注/推荐）
│  ├─ product/[id].tsx           # 商品详情（图片/价格/标签/AI推荐/加购）
│  ├─ company/[id].tsx           # 企业详情（7分段：日历/档案/资质/检测/风采/预约/组团）
│  ├─ user/[id].tsx              # 用户主页（关注/亲密度/兴趣标签）
│  ├─ category/[id].tsx          # 分类商品（无限滚动 + 响应式网格）
│  ├─ group/[id].tsx             # 考察团详情（成员/进度/支付选择）
│  ├─ search.tsx                 # 搜索（语义评分 + 商品/企业双结果）
│  ├─ cart.tsx                   # 购物车（数量/删除/小计）
│  ├─ checkout.tsx               # 结算（地址占位/支付方式选择/下单）
│  ├─ settings.tsx               # 设置（账号安全/隐私/帮助 占位入口）
│  ├─ privacy.tsx                # 隐私政策（占位文案）
│  ├─ about.tsx                  # 关于（版本/联系方式）
│  ├─ orders/
│  │  ├─ index.tsx               # 订单列表（状态筛选）
│  │  ├─ [id].tsx                # 订单详情（状态按钮/售后进度）
│  │  ├─ track.tsx               # 物流追踪（时间线 + 产地联动占位）
│  │  └─ after-sale/[id].tsx     # 申请售后（原因选择/备注/提交）
│  ├─ ai/
│  │  ├─ assistant.tsx           # AI农管家（快捷指令编辑/4场景卡片/入口）
│  │  ├─ chat.tsx                # AI聊天（消息气泡/快捷指令/模拟回复）
│  │  ├─ trace.tsx               # AI溯源（育种→种养→加工→流通 时间线）
│  │  ├─ recommend.tsx           # AI推荐（偏好画像/权重/策略优化）
│  │  └─ finance.tsx             # AI金融（信贷/分期/保险 服务卡片）
│  ├─ me/
│  │  ├─ profile.tsx             # 编辑资料（react-hook-form + zod 校验）
│  │  ├─ vip.tsx                 # 会员等级（3 级体系 + 权益列表）
│  │  ├─ appearance.tsx          # 头像/头像框 定制（4 个框选项）
│  │  ├─ recommend.tsx           # 推荐列表（占位空态）
│  │  ├─ tasks.tsx               # 任务列表（完成/奖励/状态）
│  │  └─ following.tsx           # 我的关注（用户/企业 tab + 搜索/排序/取关）
│  └─ inbox/
│     └─ index.tsx               # 消息中心（分类筛选/未读/已读/跳转）
├─ src/
│  ├─ components/                # 37 个组件（cards/layout/feedback/ui/inputs/data/comments/forms/overlay）
│  ├─ theme/                     # 设计令牌（自然绿 #2F8F4E + 科技蓝 #2B6CB0）
│  ├─ types/                     # Result<T> + AppError + 14 个域模型
│  ├─ repos/                     # 14 个 Repository（Mock + simulateRequest）
│  ├─ mocks/                     # 13 个 Mock 数据文件
│  ├─ store/                     # Zustand（useCartStore + useAuthStore）
│  ├─ constants/                 # 8 个常量文件（categories/statuses/tags/copy/payment/identities/map）
│  └─ utils/                     # formatPrice + sleep
├─ backend/                        # NestJS 后端（11 个已实现模块）
│  ├─ prisma/
│  │  ├─ schema.prisma             # 当前 22 模型（重建中 → 60+ 表）
│  │  └─ seed.ts                   # 种子数据
│  └─ src/modules/                 # auth/product/company/user/order/booking/group/follow/task/check-in/inbox/bonus
├─ app.json                       # Expo 配置
├─ tsconfig.json                  # TypeScript 严格模式
├─ babel.config.js                # Babel + Reanimated 插件
├─ CLAUDE.md                      # 项目开发指引
├─ backend.md                     # 后端技术文档
├─ data-system.md                 # 完整数据库设计（权威来源）
└─ plan.md                        # 本文件
```

---

## 二、已完成功能清单

### ✅ 核心导航与框架
- 根布局：QueryClient + ThemeProvider + GestureHandler + SafeArea + ToastProvider
- 品牌启动动画：Logo 缩放 + 脉动光环 → 1.6s 后自动进入首页
- 底部 3 Tab 导航（首页/展览馆/我的）
- 统一页面容器 Screen + AppHeader
- 统一三态：Skeleton / EmptyState / ErrorState
- 全局 Toast 提示系统

### ✅ 首页 AI买买
- 160px 圆形"AI买买"按钮 + reanimated 脉动光环动画
- 短按 → 进入 AI 聊天（/ai/chat）
- 长按 → 进入录音状态（UI 已就绪，STT 待接入）
- 搜索框：文字输入 → 回车跳转 /search
- 购物车入口 + 角标（Zustand 联动）
- AI 快捷入口：AI溯源 · AI推荐 · AI金融

### ✅ 展览馆
- 企业列表：5 种筛选（全部/附近20km/品质认证/产地直供/低碳种植）
- 语义搜索：距离解析、关键词评分、徽章匹配
- 列表/地图 双视图切换（地图为占位实现）
- 统计卡片：企业总数 / 附近20km / 品质认证

### ✅ 企业详情（7 分段标签页）
- 日历：7 天滚动日历 + 事件状态（可预约/已满/已结束）+ 议程抽屉
- 档案：企业信息 + 距离 + 主营
- 资质：品质徽章列表
- 检测报告：占位卡（PDF 待接入）
- 风采：3 张占位图
- 预约：BookingForm（react-hook-form + zod）+ 预约记录 + 状态管理
- 组团：进度条 + 成员列表 + 支付方式选择

### ✅ 商品与购物
- 商品详情：图片/价格/标签/AI推荐理由/加购/立即购买
- 分类页：无限滚动 + 响应式网格（2-3列）+ 语义关键词过滤
- 搜索：商品 + 企业 双结果 + 语义评分算法
- 购物车：数量修改 / 删除 / 小计计算
- 结算：地址占位 / 支付方式选择 / 下单
- 订单列表：状态筛选（5 种状态）
- 订单详情：状态动作按钮 + 售后进度时间线
- 物流追踪：时间线 + 产地联动占位
- 售后申请：原因选择 + 备注 + 提交

### ✅ AI 功能页面
- AI农管家：快捷指令编辑（增删/重置/最多8条）+ 4 场景卡片
- AI聊天：消息气泡 + 快捷指令 + 关键词匹配模拟回复
- AI溯源：4 步时间线（育种→种养→加工→流通）+ 状态标签
- AI推荐：偏好画像（6标签）+ 权重分析 + 策略优化
- AI金融：3 个服务卡片（可申请/即将上线/需认证）

### ✅ 用户与社交
- 用户主页：头像/名称/城市/粉丝/关注按钮/亲密度进度条/兴趣标签
- 我的关注：用户/企业 tab + 搜索 + 排序（最近/最活跃）+ 取消关注
- 消息中心：4 分类（全部/互动/交易/系统）+ 仅未读 + 全部已读 + 跳转

### ✅ 个人中心
- 身份名片：头像框（VIP/任务/限时）+ 等级 + 进度条 + 欢迎语
- 会员体系：种子→生长→丰收 3 级 + 权益列表
- 签到系统：7 天连续签到 + 奖励递增 + 第 7 天大奖
- 任务系统：任务列表 + 完成奖励（成长值 + 积分）
- 编辑资料：名称/城市/兴趣 + 实时标签解析
- 头像定制：4 种头像 + 4 种头像框（含过期时间）
- 订单状态角标聚合 + 异常订单告警
- 推荐列表：占位空态

### ✅ 设置与合规
- 设置页：账号安全/通知/隐私/关于（入口占位）
- 隐私政策：3 区块占位文案
- 关于页：版本 + 联系方式

### ✅ 认证模态框
- 登录/注册 tab 切换
- 验证码/密码 模式切换
- 手机号输入 + 发送验证码
- 第三方登录入口：微信 / Apple（占位）

---

## 三、当前占位 / TODO 清单

| 模块 | 当前状态 | 优先级 |
|------|----------|--------|
| **Schema 全量重建** | 当前 22 平面模型，需基于 data-system.md 重建 60+ 表 | 🔴 高 |
| **后端模块重建** | 11 个模块需基于新 Schema 重写 Service 层 | 🔴 高 |
| AI 语音录制 | 长按按钮 UI 就绪，`expo-av` 未接入 | 🔴 高 |
| AI 聊天后端 | 关键词匹配 Mock，无真实 LLM | 🔴 高 |
| 会员分润奖励 | 完全未实现（data-system.md I 域已设计 12 张表） | 🔴 高 |
| 地址管理 | 结算页硬编码占位地址，需实现 Address CRUD | 🟡 中 |
| 商品确权溯源 | AI溯源页有 Mock 时间线，无真实数据链路 | 🟡 中 |
| 支付对接 | 微信/支付宝入口占位，无真实 SDK | 🟡 中 |
| 地图 SDK | 高德/腾讯占位实现，mapSdkReady=false | 🟡 中 |
| 登录注册 | AuthModal UI 完成，后端 API 已实现（4 个 Repo 已对接） | 🟡 中 |
| 前端 Repo 全面对接 | 10 个 Repo 仍为纯 Mock，需切换 API | 🟡 中 |
| PDF 预览 | 检测报告为占位卡 | 🟢 低 |
| 推送通知 | 未实现 | 🟢 低 |
| 卖家管理后台 | 未实现（当前仅买家端 API） | 🟢 低 |
| 推荐列表页 | me/recommend.tsx 为空态占位 | 🟢 低 |

---

## 四、数据层清单

### Repositories（14 个）

| Repo | 核心方法 | 状态 |
|------|----------|------|
| AuthRepo | loginWithPhone / registerWithPhone / loginWithEmail / requestSmsCode / loginWithWeChat / loginWithApple | ✅ Mock + API |
| ProductRepo | list(分页) / getById | ✅ Mock + API |
| CompanyRepo | list / getById | ✅ Mock + API |
| UserRepo | profile / updateProfile / applyRewards | ✅ Mock + API |
| OrderRepo | list / getById / createFromCart / payOrder / applyAfterSale / advanceAfterSale / getStatusCounts / getLatestIssue | ✅ Mock |
| AiAssistantRepo | listShortcuts / getGreeting / chat | ✅ Mock |
| AiFeatureRepo | getTraceOverview / getRecommendInsights / getFinanceServices | ✅ Mock |
| InboxRepo | list / markRead / markAllRead / getUnreadCount | ✅ Mock |
| BookingRepo | list / listByCompany / listByGroup / create / review / inviteToGroup / confirmJoin / joinGroup / markPaid | ✅ Mock |
| CompanyEventRepo | listByCompany / getById | ✅ Mock |
| GroupRepo | list / listByCompany / getById / create / updateStatus / join | ✅ Mock |
| FollowRepo | listFollowing / toggleFollow / getAuthorProfile | ✅ Mock |
| RecommendRepo | listForMe / markNotInterested | ✅ Mock |
| CheckInRepo | getStatus / checkIn / reset | ✅ Mock |
| TaskRepo | list / complete | ✅ Mock |

> 前 4 个 Repo 已支持 `USE_MOCK=false` 切换真实 API，其余 10 个待后续 Phase 改造。

### 后端接入模式
```
Mock 模式：  Repo 方法 → simulateRequest(mockData, {delay, failRate}) → Result<T>
API 模式：   Repo 方法 → ApiClient.get/post(url) → 错误映射 → Result<T>
切换方式：   环境变量 EXPO_PUBLIC_USE_MOCK=false
```

### 后端技术栈（已确定）

| 层 | 技术 | 用途 |
|----|------|------|
| 框架 | NestJS | 模块化后端框架，TypeScript 全栈统一 |
| ORM | Prisma | 类型安全数据库访问，schema 与前端 domain types 对齐 |
| 数据库 | PostgreSQL | ACID 事务（分润奖励）、JSONB（灵活数据）、ltree（VIP 三叉树） |
| 缓存/队列 | Redis | 奖励排队队列、验证码、Token 黑名单、AI 会话缓存 |
| 支付 | wechatpay-node-v3 + alipay-sdk | 微信支付 / 支付宝 |
| 语音识别 | 讯飞 WebSocket API | STT 语音转文字 |
| 地图 | 高德 Web服务 REST API | 地理编码 / 距离计算 |
| 存储 | 阿里云 OSS (ali-oss) | 图片 / PDF / 音频文件 |
| 短信 | 阿里云/腾讯云 SMS SDK | 验证码发送 |

### 后端模块状态

**已实现模块（11 个）**：

| 模块 | 目录 | 端点数 | Schema 重建后需要 |
|------|------|--------|-------------------|
| Auth | `modules/auth/` | 7 | 重写：User 拆分为 User+UserProfile+AuthIdentity，VerificationCode→SmsOtp |
| Product | `modules/product/` | 2 | 重写：Product 拆分为 SPU+SKU+Media+Tag，新增 Category |
| Company | `modules/company/` | 2 | 重写：Company 拆分为 Company+CompanyProfile+CompanyDocument+CompanyActivity |
| User | `modules/user/` | 2 | 重写：User 拆分为 User+UserProfile，AvatarFrame 移除 |
| Order | `modules/order/` | 7 | 重写：Order/OrderItem 重建，新增 OrderStatusHistory/Payment/Refund |
| Booking | `modules/booking/` | 8 | 适配：对应 data-system.md 中社交域 |
| Group | `modules/group/` | 6 | 适配：对应 data-system.md 中社交域 |
| Follow | `modules/follow/` | 3 | 适配：保持关注关系 |
| Task | `modules/task/` | 2 | 适配：保持任务系统 |
| CheckIn | `modules/check-in/` | 3 | 适配：保持签到系统 |
| Inbox | `modules/inbox/` | 4 | 适配：保持消息系统 |

**待新建模块（7 个）**：

| 模块 | 目录 | 对应 data-system.md 域 | 说明 |
|------|------|----------------------|------|
| Address | `modules/address/` | G1 | 收货地址 CRUD |
| Cart | `modules/cart/` | G2 | 购物车 CRUD（当前由前端 Zustand 管理） |
| Payment | `modules/payment/` | G6-G7 | 支付/退款（微信/支付宝统一封装） |
| Shipment | `modules/shipment/` | G8-G9 | 物流追踪（顺丰等） |
| Trace | `modules/trace/` | F 域 | 商品溯源确权 |
| AI | `modules/ai/` | H 域 | AI 语音/意图/动作 |
| Bonus | `modules/bonus/` | I 域 | 分润奖励（已有空目录占位） |

**前后端对应关系**：
```
前端 src/repos/ProductRepo.ts    ←→  后端 modules/product/product.controller.ts + product.service.ts
前端 src/types/domain/Product.ts ←→  后端 prisma/schema.prisma (Product model)
前端 simulateRequest()           ←→  后端真实 HTTP 请求（通过 USE_MOCK 环境变量切换）
```

---

## 五、下一步路线图（9 Phase 计划，对齐 data-system.md）

> 旧 Phase A-G 已废弃。新计划以 Schema 全量重建为起点，按依赖顺序逐步重建后端模块。
> 关键决策：金额 Float/元 | 仅买家端 API | data-system.md 为权威来源 | VIP 树 A1-A10 十根

> **开发流程（强制）**：每个 Phase 完成后必须 → 测试验证 → 对齐检查 → 标记完成 → 更新本文件 → 才能进入下一个 Phase

---

### Phase 1：Schema 全量重建 + 种子数据 ✅（2026-02-15 完成）

> 一次性建好全部 60+ 表，避免迭代迁移痛苦。
> ✅ Schema 重写完成：60 个 model + 39 个 enum，覆盖 A-I 全部 9 域。prisma validate / format / tsc --noEmit 全部通过。

**目标**：废弃当前 22 个平面模型，基于 data-system.md 重建完整 Schema

**核心工作**：
- 重写 `prisma/schema.prisma`（60+ model + Prisma 原生 enum）
- 金额字段使用 Float/元（与前端一致，不用 data-system.md 的 Int/分）
- 主键策略：`@id @default(cuid())`（保持不变）
- 迁移：`prisma migrate dev --name schema-rebuild`
- 重写 `prisma/seed.ts` 种子数据

**覆盖所有 data-system.md 域**：
- A 域：User / UserProfile / AuthIdentity / SmsOtp / Session / Device / LoginEvent / UserConsent
- B 域：RuleConfig / RuleVersion（仅配置表，Admin 系统暂不实现）
- D 域：Company / CompanyProfile / CompanyDocument / CompanyActivity
- E 域：Category / Tag / Product / ProductSKU / ProductMedia / ProductTag / InventoryLedger
- F 域：OwnershipClaim / TraceBatch / TraceEvent / ProductTraceLink / OrderItemTraceLink
- G 域：Address / Cart / CartItem / Order / OrderItem / OrderStatusHistory / Payment / Refund / Shipment / ShipmentTrackingEvent / ShippingTemplate
- H 域：AiSession / AiUtterance / AiIntentResult / AiActionExecution
- I 域：MemberProfile / VipPurchase / ReferralLink / VipTreeNode / VipProgress / VipEligibleOrder / RewardAccount / RewardAllocation / RewardLedger / NormalBucket / NormalQueueMember / WithdrawRequest

---

### Phase 2：Auth + User + Company 重建（A 域 + D 域） ✅（2026-02-15 完成）

> 基础模块，所有其他模块依赖用户和企业数据。
> ✅ Auth/User/Company 三大模块全部重建完成。额外修复了 Product/Order/Booking/Follow/Group/Task/CheckIn 7 个模块的级联类型错误。seed.ts 适配新 Schema。npx tsc --noEmit / prisma validate 全部通过。

**Auth 模块重建** ✅：
- User 拆分为 User + UserProfile + AuthIdentity
- VerificationCode → SmsOtp（bcrypt 哈希存储）
- Session 表替代 RefreshToken（SHA-256 哈希 token）
- JWT payload 简化为 { sub: userId }
- 注册事务：User + UserProfile + AuthIdentity 原子创建
- 密码存储迁移到 AuthIdentity.meta JSON

**User 模块重建** ✅：
- 资料读写走 UserProfile（nickname→name, avatarUrl→avatar, city→location）
- AvatarFrame 合并到 UserProfile 内联字段
- 自动创建 UserProfile（向后兼容）

**Company 模块重建** ✅：
- Company 拆分为 Company + CompanyProfile（highlights/address JSON）
- CompanyEvent → CompanyActivity（DateTime startAt/endAt + content JSON）
- company-event.controller 改为委托 CompanyService

**级联修复**（Prisma client 重新生成后所有模块类型错误）✅：
- Product: isActive→status enum, price→basePrice, images/tags 从关联表读取
- Order: status 字符串→OrderStatus enum, totalPrice→totalAmount, OrderItem 使用 skuId+productSnapshot
- Booking: eventId→activityId, 状态字符串→BookingStatus enum
- Follow: followedType 字符串→FollowType enum
- Group: 状态字符串→GroupStatus enum
- Task/CheckIn: user.points→userProfile.points（upsert 模式）
- seed.ts: 全面适配新 Schema（嵌套创建、枚举值、新字段结构）

---

### Phase 3：Product + Address + Cart 重建（E 域 + G1-G2） ✅（2026-02-15 完成）

> 电商基础，订单依赖商品和地址。
> ✅ Product 模块增强（SPU/SKU 详情、分类树、搜索）、Address 模块新建（CRUD + 默认地址）、Cart 模块新建（服务端购物车）全部完成。npx tsc --noEmit / prisma validate 全部通过。

**Product 模块增强** ✅：
- 列表接口新增 categoryId/keyword 查询参数（分类筛选 + 关键词搜索）
- 详情接口返回完整 SKU 列表、所有媒体（图片+视频）、分类信息、企业名称
- 新增 `GET /products/categories` 分类树接口
- 保持前端旧 Product 类型兼容（price/image 字段）

**新建 Address 模块** ✅：
- `GET /addresses` — 用户地址列表（默认地址优先排序）
- `POST /addresses` — 新增地址（第一个自动设为默认）
- `PATCH /addresses/:id` — 更新地址
- `DELETE /addresses/:id` — 删除地址（自动重选默认）
- `PATCH /addresses/:id/default` — 设为默认地址
- 所有操作验证归属权（ForbiddenException）

**新建 Cart 模块** ✅：
- `GET /cart` — 获取购物车（含 SKU 价格/库存 + 商品标题/图片）
- `POST /cart/items` — 添加商品（skuId + quantity，库存校验，重复累加）
- `PATCH /cart/items/:skuId` — 更新数量（库存校验）
- `DELETE /cart/items/:skuId` — 删除购物车项
- `DELETE /cart` — 清空购物车
- Cart 自动创建（ensureCart 模式）
- CartItem 通过 SKU 关联，返回完整商品信息

---

### Phase 4：Order + Payment + Shipment 重建（G3-G9） ✅（2026-02-15 完成）

> 核心交易流程。
> ✅ Order 模块完全重建（SKU 真实价格、地址快照、库存扣减/恢复、状态流转历史）。Payment/Shipment 模块新建。npx tsc --noEmit / prisma validate 全部通过。

**Order 模块重建** ✅：
- 创建订单：从 SKU 读取真实价格（不信任前端），生成 productSnapshot JSON
- 地址快照：下单时关联 addressId，快照到 addressSnapshot JSON
- 库存管理：下单事务内扣减 SKU.stock + 写 InventoryLedger（RESERVE）；取消订单恢复库存（RELEASE）
- 支付：创建 Payment 记录（channel/amount/merchantOrderNo），更新 Order.paidAt
- 售后：创建 Refund 记录（amount/merchantRefundNo/reason）
- 新增端点：`POST :id/receive`（确认收货）、`POST :id/cancel`（取消订单 + 库存恢复）
- 全程 OrderStatusHistory 记录状态变更
- DTO 重构：CreateOrderDto 只需 skuId + quantity（不再传价格）
- Controller 统一使用 `@CurrentUser('sub')` 获取 userId

**新建 Payment 模块** ✅：
- `GET /payments/order/:orderId` — 查询支付记录
- `GET /payments/order/:orderId/refunds` — 查询退款记录
- Payment/Refund 记录由 OrderService 在事务中创建

**新建 Shipment 模块** ✅：
- `GET /shipments/:orderId` — 查询物流信息（含 trackingEvents 时间线）
- 预留物流回调接口

---

### Phase 5：Social & Engagement 适配 ✅（2026-02-15 完成）

> 这些模块变化较小，主要适配新 Schema 的关联关系。
> ✅ 关键修复：所有控制器 @CurrentUser('userId') → @CurrentUser('sub')，与 Phase 2 JWT payload 对齐。6 个社交/互动模块已确认适配完成。npx tsc --noEmit / prisma validate 全部通过。

**关键修复 — JWT payload 对齐** ✅：
- Phase 2 将 JWT payload 改为 `{ sub: userId }`，但 7 个旧控制器仍使用 `@CurrentUser('userId')`
- 运行时会导致 userId 为 undefined，所有认证接口无法工作
- 已统一修复：Booking / Follow / Task / CheckIn / Inbox / User / Group 控制器全部改为 `@CurrentUser('sub')`
- 确认全部 11 个认证控制器（41 处引用）一致使用 `@CurrentUser('sub')`

**适配确认** ✅：
- Booking — Phase 2 已适配 activityId + BookingStatus 枚举，控制器已修复
- Group — Phase 2 已适配 GroupStatus 枚举，控制器已修复
- Follow — Phase 2 已适配 FollowType 枚举 + User/Company profile join，控制器已修复
- Task — Phase 2 已改用 UserProfile.points upsert，控制器已修复
- CheckIn — Phase 2 已改用 UserProfile.points upsert，控制器已修复
- Inbox — Schema 完全对齐无需改动，控制器已修复

---

### Phase 6：溯源确权系统（F 域） ✅（2026-02-15 完成）

> ✅ Trace 模块新建完成。覆盖 5 个 F 域表，提供商品溯源链、订单溯源、批次详情、批次码查询 4 个买家端 API。npx tsc --noEmit / prisma validate 全部通过。

**新建 Trace 模块** ✅：
- `GET /trace/product/:productId` — 商品溯源链（公开，通过 ProductTraceLink → TraceBatch → TraceEvent）
- `GET /trace/order/:orderId` — 订单溯源（需认证，通过 OrderItemTraceLink 关联）
- `GET /trace/batch/:batchId` — 批次详情（公开，含 OwnershipClaim + 事件时间线）
- `GET /trace/code?code=xxx` — 通过批次码查询（公开，扫码溯源入口）
- 完整数据映射：TraceBatch（meta JSON）/ TraceEvent（type + data + occurredAt）/ OwnershipClaim（type + data）

---

### Phase 7：AI 系统（H 域） ✅（2026-02-15 完成）

> ✅ AI 模块新建完成。覆盖 4 个 H 域表，提供会话管理 + 消息发送 4 个 API。意图解析/STT 为占位实现，预留 LLM 对接点。npx tsc --noEmit / prisma validate 全部通过。

**新建 AI 模块** ✅：
- `POST /ai/sessions` — 创建会话（page + context）
- `GET /ai/sessions` — 会话列表（最近 20 条，含最后一条消息摘要）
- `GET /ai/sessions/:id` — 会话详情（完整对话链：Utterance → IntentResult → ActionExecution）
- `POST /ai/sessions/:id/messages` — 发送消息（transcript + audioUrl）
- 占位意图检测：关键词匹配 → SearchProduct/AddToCart/PlaceOrder/QueryOrder/QueryTrace/SearchCompany/GeneralQuery
- 占位动作执行：SHOW_CHOICES + 简单回复生成
- TODO：对接讯飞 STT WebSocket + LLM 意图解析（替换 detectIntent/extractSlots）

---

### Phase 8：会员分润奖励系统（I 域 + B 域 RuleConfig） ✅（2026-02-15 完成）

> 最复杂的模块，12 张互相关联的表。
> ✅ Bonus 模块完整实现。覆盖 MemberProfile/VipPurchase/ReferralLink/VipTreeNode/VipProgress/RewardAccount/RewardLedger/NormalQueueMember/WithdrawRequest 等 I 域核心表。提供 9 个买家端 API。三叉树 BFS 插入算法实现。npx tsc --noEmit / prisma validate 全部通过。

**Bonus 模块实现** ✅：
- `GET /bonus/member` — 会员信息（tier/referralCode/vipProgress 自动创建）
- `POST /bonus/referral` — 使用推荐码（绑定邀请关系 + 防重复）
- `POST /bonus/vip/purchase` — 购买 VIP（事务：VipPurchase + MemberProfile 升级 + VipProgress 初始化 + 三叉树节点分配）
- `GET /bonus/wallet` — 奖励钱包余额（balance/frozen/total）
- `GET /bonus/wallet/ledger` — 奖励流水（分页）
- `POST /bonus/withdraw` — 申请提现（余额校验 + 冻结 + WithdrawRequest）
- `GET /bonus/withdraw/history` — 提现记录
- `GET /bonus/vip/tree` — VIP 三叉树可视化（2 层深，含 children）
- `GET /bonus/queue/status` — 普通奖励排队状态（位置计算）

**三叉树 BFS 插入算法** ✅：
- 根据推荐人确定 rootId（A1-A10）
- BFS 查找第一个 childrenCount < 3 的节点（按 level + position 排序）
- 原子事务：创建节点 + 更新父节点 childrenCount + 更新 MemberProfile.vipNodeId

**前端新增页面**（Phase 9 实现）：
- `app/me/wallet.tsx` — 奖励钱包
- `app/me/bonus-tree.tsx` — VIP 三叉树可视化
- `app/me/bonus-queue.tsx` — 排队队列

---

### Phase 9：前端全面对接 + 第三方集成 ✅（2026-02-15 完成）

> ✅ 前端 Phase 9 完成。4 个新域类型 + 4 个新 Repo + 6 个新页面 + 5 个已有页面适配。npx tsc --noEmit / prisma validate / 后端 tsc 全部通过。

**新增域类型（4 个）** ✅：
- `Address` — 收货地址（receiverName/phone/province/city/district/detail/isDefault）
- `ServerCart` / `ServerCartItem` — 服务端购物车（skuId + 商品快照）
- `Trace` 系列 — ProductTrace/OrderTrace/TraceBatch/TraceEvent（溯源链）
- `Bonus` 系列 — MemberProfile/Wallet/WalletLedgerPage/WithdrawRecord/VipTree/VipTreeNode/QueueStatus

**新建 Repo（4 个）** ✅：
- `AddressRepo` — 地址 CRUD + 设为默认（Mock + API 双模式）
- `CartRepo` — 服务端购物车（get/addItem/updateQuantity/removeItem/clear）
- `TraceRepo` — 溯源查询（getProductTrace/getOrderTrace/getBatchDetail/searchByCode）
- `BonusRepo` — 会员奖励全功能（getMember/useReferralCode/purchaseVip/getWallet/getWalletLedger/requestWithdraw/getWithdrawHistory/getVipTree/getQueueStatus）

**新增前端页面（6 个）** ✅：
- `app/me/addresses.tsx` — 地址管理（列表 + 新增/编辑表单 + 删除确认 + 设为默认）
- `app/me/wallet.tsx` — 奖励钱包（余额大卡片 + 收支明细列表 + 提现入口）
- `app/me/withdraw.tsx` — 提现申请（金额输入 + 渠道选择 + 余额校验）
- `app/me/bonus-tree.tsx` — VIP 三叉树（3 层可视化 + 统计卡片 + 空位占位 + 非 VIP 升级引导）
- `app/me/bonus-queue.tsx` — 排队队列（排位数字 + 消费区间 + 进度条 + 规则说明）
- `app/checkout-address.tsx` — 结算选择地址（地址列表选择 + 新增入口）

**已有页面适配（5 个）** ✅：
- `checkout.tsx` — 收货地址从占位替换为真实地址选择（AddressRepo + 路由参数传回 addressId）
- `me.tsx` — 新增 4 个入口（奖励钱包/VIP 三叉树/排队奖励/收货地址）
- `me/vip.tsx` — 接入 BonusRepo 会员数据（VIP 状态卡片 + 推荐码 + 快捷入口）
- `ai/trace.tsx` — 导入 TraceRepo（预留真实溯源数据对接点）
- `cart.tsx` — CartRepo 已就绪（当前保持 Zustand 本地购物车，后续 API 模式切换即可）

**待后续对接（第三方服务）**：
- 微信支付 / 支付宝 SDK（占位流程已就绪）
- 讯飞 STT WebSocket（AI 聊天页预留）
- 高德地图 REST API（展览馆地图占位）
- 阿里云 OSS / SMS（后端已预留配置）
- 顺丰等物流回调（Shipment 模块已就绪）

---

## 六、技术约定速查

| 约定 | 说明 |
|------|------|
| 数据获取 | 所有页面通过 React Query 调用 Repo 方法 |
| 错误处理 | Repo 返回 `Result<T>`，页面处理 `ok/error` 分支 |
| 状态管理 | 仅购物车和认证用 Zustand，其余用 React Query 缓存 |
| 样式 | 使用 `src/theme/` 下的设计令牌，不硬编码颜色/间距 |
| 表单 | react-hook-form + zod 校验 |
| 动画 | react-native-reanimated |
| 组件 | 按功能分目录，新组件放到对应分类下 |
| 类型 | 域模型在 `src/types/domain/`，每个实体一个文件 |
| 命名 | 组件 PascalCase，工具/常量 camelCase，注释用中文 |
| 新增实体 | 同时创建：Type → Mock → Repo → 页面 |
