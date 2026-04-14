# 智能客服系统设计方案

## 1. 概述

### 1.1 目标
为爱买买平台构建智能客服系统，买家通过 App 内客服入口与 AI 助手对话，AI 无法解决时实时转接人工坐席（管理后台操作）。

### 1.2 核心设计原则
- **三层路由**：FAQ 关键词匹配（零 LLM 成本）→ AI 意图理解 + 动作执行 → 人工坐席兜底
- **AI 先接**：绝大部分咨询在前两层消化，人工坐席是补充角色
- **独立模块**：新建 `CustomerServiceModule`，不污染现有 `AiModule`，通过依赖注入复用 AI 能力
- **后续演进**：Phase 1 买家→平台客服，后续可扩展为纯 AI 自助（Phase D）

### 1.3 技术选型
| 组件 | 选型 | 理由 |
|------|------|------|
| 实时通讯 | Socket.IO | NestJS 原生支持，自动降级、断线重连、房间管理开箱即用 |
| AI 能力 | 复用 AiModule | 意图分类（Qwen-Flash）+ 动作执行框架已有 |
| 管理后台 | admin 新增页面 | 复用现有 ProTable/ProForm/权限体系 |
| 买家端 | App 新增页面 | 复用现有 React Native 组件体系 |

---

## 2. 买家端交互流程

### 2.1 入口
买家可从以下位置进入客服：
- **「我的」页面** → 点击「联系客服」
- **订单详情页** → 点击「联系客服」（自动关联 orderId）
- **售后详情页** → 点击「联系客服」（自动关联 afterSaleId）

### 2.2 初始界面

进入客服后展示 AI 欢迎语 + 两个区域：

**猜你想问（快捷操作按钮）**：网格排列，点击直接执行动作
- 查物流、退换货、改地址、查退款（管理后台可配置）

**大家都在问（自然语言问题列表）**：点击作为用户消息发送，走三层路由
- "我的快递到哪了？"、"怎么申请退货退款？"、"退款多久到账？" 等（管理后台可配置）

**上下文注入**：从订单/售后详情页进入时，AI 自动感知关联的订单信息，无需用户手动输入订单号。

### 2.3 三层路由机制

用户发送消息后，按顺序过三层：

#### 第一层：关键词/规则匹配（0 LLM 调用，<50ms）

管理后台配置 FAQ 规则库，支持关键词组合和正则表达式：

| 触发词/正则 | 回复内容 | 类型 |
|---|---|---|
| `退款.*到账`, `多久退款` | 退款将在1-3个工作日内原路退回... | 纯文本 |
| `怎么退货`, `退换货流程` | （退货流程图文卡片） | 富文本卡片 |
| `运费`, `包邮` | 单笔订单满49元包邮... | 纯文本 |
| `VIP`, `会员` | （VIP权益介绍卡片） | 富文本卡片 |

匹配到 → 直接返回预设回复，结束。未匹配 → 进入第二层。

#### 第二层：AI 意图理解 + 动作执行（1次 LLM 调用，~500ms）

复用现有 AiModule 意图分类能力，新增客服相关意图：

| 意图 | AI 行为 | 示例 |
|---|---|---|
| `query_logistics` | 查订单物流并展示 | "我的快递到哪了" |
| `query_aftersale` | 查退换货进度 | "我的退款处理到哪一步了" |
| `apply_aftersale` | 引导填写退换货申请 | "这个苹果坏了想退货" |
| `cancel_order` | 确认后执行取消 | "我不想要了取消订单" |
| `query_coupon` | 查用户优惠券 | "我有什么优惠券" |
| `general_qa` | AI 基于知识库回答 | "你们发什么快递" |

**关键点**：
- 带上下文：从订单详情页进入自动注入 orderId，AI 直接查该订单
- 需要确认的操作（取消订单、申请退货）AI 先展示确认卡片，用户点确认才执行
- AI 无法理解或置信度低 → 进入第三层

#### 第三层：转人工坐席

**触发条件**（任一）：
- 用户主动说"转人工"、"找客服"
- AI 连续 2 次无法理解（置信度 < 阈值）
- AI 识别到情绪激动/投诉升级
- 涉及资金纠纷类问题（AI 不自行处理）

**转接流程**：
1. 提示买家"正在为你转接人工客服，请稍候..."
2. 创建/更新工单，加入坐席排队
3. 坐席在管理后台接入，之后的消息通过 Socket.IO 实时双向
4. 坐席能看到之前 AI 对话的完整记录
5. 对话结束后弹出满意度评价

---

## 3. 数据模型

### 3.1 模型关系

```
CsTicket 1:N CsSession 1:N CsMessage
                  │
CsAgentStatus ────┘ (分配坐席)

CsFaq            (第一层路由规则库)
CsQuickEntry     (买家端快捷入口配置)
CsQuickReply     (坐席快捷回复话术)
CsRating         (会话满意度评价)
```

### 3.2 CsTicket（工单）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| userId | String | 买家 ID，关联 User |
| category | CsTicketCategory | `LOGISTICS` / `AFTERSALE` / `PAYMENT` / `PRODUCT` / `ACCOUNT` / `OTHER` |
| priority | CsTicketPriority | `LOW` / `MEDIUM` / `HIGH` / `URGENT` |
| status | CsTicketStatus | `OPEN` / `IN_PROGRESS` / `RESOLVED` / `CLOSED` |
| summary | String? | AI 自动生成的问题摘要 |
| relatedOrderId | String? | 关联订单 ID |
| relatedAfterSaleId | String? | 关联售后单 ID |
| resolvedBy | String? | 处理人（管理员 ID） |
| resolvedAt | DateTime? | 解决时间 |
| createdAt | DateTime @default(now()) | 创建时间 |
| updatedAt | DateTime @updatedAt | 更新时间 |
| sessions | CsSession[] | 关联会话（1:N） |

**状态流转**：`OPEN` → `IN_PROGRESS` → `RESOLVED` → `CLOSED`

### 3.3 CsSession（客服会话）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| ticketId | String? | 关联工单（AI 直接解决的可无工单） |
| userId | String | 买家 ID，关联 User |
| status | CsSessionStatus | `AI_HANDLING` / `QUEUING` / `AGENT_HANDLING` / `CLOSED` |
| source | CsSessionSource | `MY_PAGE` / `ORDER_DETAIL` / `AFTERSALE_DETAIL` |
| sourceId | String? | 来源页关联 ID（orderId 或 afterSaleId） |
| agentId | String? | 接入的坐席（管理员 ID） |
| agentJoinedAt | DateTime? | 坐席接入时间 |
| closedAt | DateTime? | 关闭时间 |
| createdAt | DateTime @default(now()) | 创建时间 |
| ticket | CsTicket? | 关联工单 |
| messages | CsMessage[] | 消息列表 |
| rating | CsRating? | 满意度评价 |

**状态流转**：
```
AI_HANDLING → QUEUING → AGENT_HANDLING → CLOSED
     │                                     ↑
     └────── AI 解决，用户无追问 ───────────┘
```

### 3.4 CsMessage（消息）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| sessionId | String | 所属会话 |
| senderType | CsMessageSender | `USER` / `AI` / `AGENT` / `SYSTEM` |
| senderId | String? | 发送者 ID（USER=userId, AGENT=adminId） |
| contentType | CsContentType | `TEXT` / `RICH_CARD` / `ACTION_CONFIRM` / `ACTION_RESULT` / `IMAGE` |
| content | String | 文本内容 |
| metadata | Json? | 富文本卡片数据、动作结果、图片 URL 等 |
| routeLayer | Int? | 命中的路由层（1=FAQ, 2=AI, 3=人工） |
| createdAt | DateTime @default(now()) | 发送时间 |
| session | CsSession | 所属会话 |

### 3.5 CsAgentStatus（坐席状态）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| adminId | String @unique | 管理员 ID |
| status | CsAgentOnlineStatus | `ONLINE` / `BUSY` / `OFFLINE` |
| currentSessions | Int @default(0) | 当前处理中的会话数 |
| maxSessions | Int @default(5) | 最大并发会话数 |
| lastActiveAt | DateTime | 最后活跃时间 |

**分配策略**：转人工时，从 `ONLINE` 且 `currentSessions < maxSessions` 的坐席中取 `currentSessions` 最少的那个。全忙则排队等待。

### 3.6 CsFaq（FAQ 规则库）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| keywords | String[] | 触发关键词列表 |
| pattern | String? | 正则表达式（可选，高级模式） |
| answer | String | 回复内容 |
| answerType | CsFaqAnswerType | `TEXT` / `RICH_CARD` |
| metadata | Json? | 富文本卡片数据 |
| priority | Int @default(0) | 匹配优先级（多条命中时取最高） |
| enabled | Boolean @default(true) | 启用状态 |
| sortOrder | Int @default(0) | 排序 |
| createdAt | DateTime @default(now()) | 创建时间 |
| updatedAt | DateTime @updatedAt | 更新时间 |

### 3.7 CsQuickEntry（快捷入口配置）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| type | CsQuickEntryType | `QUICK_ACTION` / `HOT_QUESTION` |
| label | String | 显示文字（"查物流" / "退款多久到账？"） |
| action | String? | 动作标识（QUICK_ACTION 用，如 `query_logistics`） |
| message | String? | 发送消息（HOT_QUESTION 用） |
| icon | String? | 图标名（QUICK_ACTION 用） |
| enabled | Boolean @default(true) | 启用状态 |
| sortOrder | Int @default(0) | 排序 |

### 3.8 CsQuickReply（坐席快捷回复）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| category | String | 分组（"物流" / "退款" / "通用"） |
| title | String | 标题（坐席看到的简称） |
| content | String | 回复内容 |
| sortOrder | Int @default(0) | 排序 |
| enabled | Boolean @default(true) | 启用状态 |

### 3.9 CsRating（满意度评价）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 主键 |
| sessionId | String @unique | 关联会话 |
| userId | String | 评价人 |
| score | Int | 1-5 分 |
| tags | String[] | 预设标签（"回复快速" / "解决了问题" / "态度友好" / "专业解答"） |
| comment | String? | 文字评价（选填） |
| createdAt | DateTime @default(now()) | 评价时间 |
| session | CsSession | 关联会话 |

### 3.10 枚举定义

```prisma
enum CsTicketCategory {
  LOGISTICS
  AFTERSALE
  PAYMENT
  PRODUCT
  ACCOUNT
  OTHER
}

enum CsTicketPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum CsTicketStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  CLOSED
}

enum CsSessionStatus {
  AI_HANDLING
  QUEUING
  AGENT_HANDLING
  CLOSED
}

enum CsSessionSource {
  MY_PAGE
  ORDER_DETAIL
  AFTERSALE_DETAIL
}

enum CsMessageSender {
  USER
  AI
  AGENT
  SYSTEM
}

enum CsContentType {
  TEXT
  RICH_CARD
  ACTION_CONFIRM
  ACTION_RESULT
  IMAGE
}

enum CsAgentOnlineStatus {
  ONLINE
  BUSY
  OFFLINE
}

enum CsFaqAnswerType {
  TEXT
  RICH_CARD
}

enum CsQuickEntryType {
  QUICK_ACTION
  HOT_QUESTION
}
```

---

## 4. Socket.IO 实时通讯架构

### 4.1 连接认证

买家端和管理端各自用自己的 JWT 连接 Socket.IO Gateway：
- 买家 App：`connect({ auth: { token: buyerJWT } })`
- 管理后台：`connect({ auth: { token: adminJWT } })`

Gateway 在 `handleConnection` 中验证 token，失败则断开。

### 4.2 房间设计

| 房间 | 用途 |
|---|---|
| `user:{userId}` | 买家个人通道（接收消息、状态变更通知） |
| `agent:{adminId}` | 坐席个人通道（新会话通知、消息推送） |
| `session:{sessionId}` | 会话房间（买家 + AI/坐席共享，消息同步） |
| `agent:lobby` | 坐席大厅（广播排队通知、未领取会话） |

### 4.3 核心事件

**客户端 → 服务端**：
| 事件 | 发送方 | 数据 | 说明 |
|---|---|---|---|
| `cs:send` | 买家/坐席 | `{ sessionId, content, contentType }` | 发送消息 |
| `cs:accept_ticket` | 坐席 | `{ sessionId }` | 领取排队中的会话 |
| `cs:close_session` | 坐席 | `{ sessionId }` | 结束会话 |
| `cs:typing` | 买家/坐席 | `{ sessionId }` | 正在输入状态 |
| `cs:agent_status` | 坐席 | `{ status }` | 更新在线状态 |

**服务端 → 客户端**：
| 事件 | 接收方 | 数据 | 说明 |
|---|---|---|---|
| `cs:message` | 会话房间 | `{ message }` | 新消息推送 |
| `cs:agent_joined` | 会话房间 | `{ agentName }` | 坐席已接入 |
| `cs:session_closed` | 会话房间 | `{ sessionId }` | 会话已关闭 |
| `cs:new_ticket` | agent:lobby | `{ ticket概要 }` | 新排队会话通知 |
| `cs:queue_update` | agent:lobby | `{ queueCount }` | 排队数更新 |
| `cs:typing` | 会话房间 | `{ senderType }` | 对方正在输入 |

### 4.4 消息流转

**AI 阶段（HTTP + Socket 推送）**：
```
买家 ── cs:send ──→ Gateway ──→ CsRoutingService（三层路由）──→ 得到回复
                                                                    │
买家 ←── cs:message ──────────────────────────────────────────────┘
```

**转人工**：
```
CsRoutingService 判断需转人工
  → CsSession.status = QUEUING
  → 广播 cs:new_ticket 到 agent:lobby
  → 坐席点击「接入」发送 cs:accept_ticket
  → CsAgentService 分配坐席，坐席加入 session:{id} 房间
  → 广播 cs:agent_joined 到会话房间
  → 后续消息通过 cs:send / cs:message 双向实时传输
```

### 4.5 断线处理

| 场景 | 处理 |
|---|---|
| 买家断线 | 消息暂存数据库，重连后通过 HTTP 同步未读消息 |
| 坐席断线 | 30 秒内重连恢复会话；超时标记 `OFFLINE`，排队中会话重新分配 |
| 买家长时间无回复 | 10 分钟无消息提示"还在吗？"；再 5 分钟自动关闭会话 |
| 坐席长时间无回复 | 5 分钟无回复推送提醒；不自动关闭 |

---

## 5. 管理后台页面

在 admin 侧边栏新增「客服中心」菜单组，包含 6 个页面。

### 5.1 实时对话工作台（/admin/cs/workstation）

三栏布局，客服人员的主要工作界面：

**左栏（会话列表）**：
- 按「排队中 / 处理中 / 今日已结束」分组
- 排队中的显示等待时长、问题类别标签，可点击「接入」领取
- 处理中的显示最新消息预览，新消息红点提醒
- 搜索：按用户昵称搜索

**中栏（对话区）**：
- 完整对话流：AI 阶段灰色背景区域、人工阶段白色背景，视觉区分
- 消息类型：文字、图片、富文本卡片（操作确认、操作结果）、系统通知
- 快捷回复面板：显示在输入框上方，按分类折叠，点击直接填入
- 支持发送文字和图片
- 顶部操作：转接（给其他坐席）、结束会话

**右栏（信息面板）**：
- 用户信息：昵称、VIP 状态、注册天数、累计订单数、累计消费、客服咨询次数
- 关联订单/售后单详情卡片：状态、金额、商品，可跳转查看
- AI 自动摘要：本次问题的结构化总结
- 工单信息：工单号、类别、优先级、状态
- 历史工单列表：该用户的往期工单

### 5.2 工单管理（/admin/cs/tickets）

ProTable 列表页：
- 列：工单号、用户昵称、类别、优先级、状态、AI 摘要、处理人、创建时间
- 筛选：类别下拉、优先级下拉、状态 Tab 切换（全部/待处理/处理中/已解决/已关闭）、处理人下拉、日期范围
- 行操作：查看详情（展开关联会话记录 + 操作日志）

### 5.3 FAQ 管理（/admin/cs/faq）

ProTable + ProForm 增删改：
- 关键词列表编辑（Tag 输入组件）
- 正则表达式（可选，高级模式）
- 回复内容编辑（纯文本 / 富文本卡片）
- 优先级、启用状态开关
- 测试功能：输入一句话，实时展示匹配结果

### 5.4 快捷入口配置（/admin/cs/quick-entries）

管理「猜你想问」和「大家都在问」两个区域：
- 按类型 Tab 切分（QUICK_ACTION / HOT_QUESTION）
- 拖拽排序
- 启用/禁用开关
- 预览效果

### 5.5 坐席快捷回复管理（/admin/cs/quick-replies）

ProTable 增删改：
- 按分类管理（物流/退款/通用等）
- 标题、内容编辑
- 排序、启用/禁用

### 5.6 数据看板（/admin/cs/dashboard）

统计卡片 + 图表：
- 数据卡片：今日会话数、AI 解决率、平均响应时间、满意度评分、排队等待数
- 按类别分布饼图
- 近 7 天趋势折线图（会话量、AI 解决率、满意度）

---

## 6. 买家 App 页面和组件

### 6.1 客服对话页（app/cs/index.tsx）

**页面结构**：
- 顶部导航：返回按钮、标题（"智能客服" / 转人工后显示坐席名）、更多按钮
- 消息列表区：滚动展示对话流
- 底部输入栏：加号（图片上传）、文本输入框、语音按钮、发送按钮

**初始状态**（进入时展示）：
- AI 欢迎语气泡
- 猜你想问：2×2 网格快捷操作按钮
- 大家都在问：可点击的问题列表

**对话状态**：
- AI 消息：品牌色头像 + 白色气泡，可包含操作按钮（"申请退货"/"转人工"）
- 用户消息：品牌色气泡靠右
- 坐席消息：坐席头像 + 白色气泡带浅边框
- 系统消息：居中灰色标签（"客服小美已接入"/"会话已结束"）
- 操作结果卡片：绿色背景卡片，展示操作成功信息
- 正在输入指示器：三点跳动动画

**满意度评价**（会话结束后弹出）：
- 1-5 星评分
- 预设标签多选（回复快速/解决了问题/态度友好/专业解答）
- 文字评价（选填）
- 提交按钮

### 6.2 路由参数

```
app/cs/index.tsx?source=order_detail&sourceId=xxx
app/cs/index.tsx?source=aftersale_detail&sourceId=xxx
app/cs/index.tsx?source=my_page
```

### 6.3 新增组件

| 组件 | 位置 | 说明 |
|---|---|---|
| CsMessageBubble | src/components/cs/ | 消息气泡（区分 USER/AI/AGENT/SYSTEM） |
| CsActionCard | src/components/cs/ | 操作确认/结果卡片 |
| CsQuickActions | src/components/cs/ | 猜你想问网格按钮 |
| CsHotQuestions | src/components/cs/ | 大家都在问列表 |
| CsRatingSheet | src/components/cs/ | 满意度评价底部弹窗 |
| CsTypingIndicator | src/components/cs/ | 正在输入三点动画 |

### 6.4 入口按钮添加

在以下页面添加「联系客服」入口：
- `app/(tabs)/me.tsx`：菜单项
- `app/orders/[id].tsx`：订单详情页底部或顶部操作栏
- `app/orders/after-sale-detail/[id].tsx`：售后详情页

---

## 7. 后端模块结构

```
backend/src/modules/customer-service/
├── cs.module.ts                    # 模块注册（imports: AiModule, OrderModule, AfterSaleModule）
├── cs.gateway.ts                   # Socket.IO Gateway（连接认证、事件路由）
├── cs.controller.ts                # HTTP 端点（历史记录、配置查询等）
├── cs-admin.controller.ts          # 管理端 HTTP 端点（工单 CRUD、FAQ 管理、统计）
├── cs.service.ts                   # 核心业务逻辑（会话生命周期、消息处理）
├── cs-routing.service.ts           # 三层路由引擎（FAQ → AI → 人工）
├── cs-agent.service.ts             # 坐席分配、状态管理、排队逻辑
├── cs-faq.service.ts               # FAQ 关键词/正则匹配引擎
├── cs-ticket.service.ts            # 工单管理（创建、更新、AI 摘要生成）
├── cs-stats.service.ts             # 统计数据（会话量、AI 解决率、满意度）
├── dto/
│   ├── cs-send-message.dto.ts      # 发送消息 DTO
│   ├── cs-create-session.dto.ts    # 创建会话 DTO
│   ├── cs-submit-rating.dto.ts     # 提交评价 DTO
│   ├── cs-admin-faq.dto.ts         # FAQ 管理 DTO
│   ├── cs-admin-quick-entry.dto.ts # 快捷入口管理 DTO
│   └── cs-admin-quick-reply.dto.ts # 快捷回复管理 DTO
└── types/
    └── cs.types.ts                 # 类型定义（事件 payload、路由结果等）
```

### 7.1 核心服务职责

**CsService**：会话生命周期管理
- `createSession(userId, source, sourceId)` → 创建会话，返回 sessionId
- `sendMessage(sessionId, content)` → 接收用户消息，触发路由
- `closeSession(sessionId)` → 关闭会话
- `getSessionHistory(sessionId)` → 获取会话消息记录
- `getActiveSession(userId, source, sourceId?)` → 获取用户当前活跃会话（按 source + sourceId 匹配，避免不同入口的会话互串）

**CsRoutingService**：三层路由引擎
- `route(sessionId, message)` → 依次尝试 FAQ → AI → 判断是否转人工
- 返回路由结果（匹配层级 + 回复内容 + 是否需要转人工）

**CsAgentService**：坐席管理
- `assignAgent(sessionId)` → 分配坐席（最少会话优先）
- `updateAgentStatus(adminId, status)` → 更新在线状态
- `handleAgentDisconnect(adminId)` → 断线处理
- `getQueueStatus()` → 获取排队状态

**CsFaqService**：FAQ 匹配
- `match(message)` → 关键词 + 正则匹配，返回最高优先级的命中结果
- CRUD 管理接口

**CsTicketService**：工单管理
- `createTicket(sessionId, category)` → 创建工单
- `generateSummary(sessionId)` → 调用 LLM 生成 AI 摘要
- CRUD + 筛选查询

### 7.2 API 端点

**买家端（需要买家认证）**：
| Method | Path | 说明 |
|---|---|---|
| POST | `/cs/sessions` | 创建客服会话 |
| GET | `/cs/sessions/active` | 获取当前活跃会话 |
| GET | `/cs/sessions/:id/messages` | 获取会话消息记录 |
| POST | `/cs/sessions/:id/rating` | 提交满意度评价 |
| GET | `/cs/quick-entries` | 获取快捷入口配置 |

**管理端（需要管理员认证）**：
| Method | Path | 说明 |
|---|---|---|
| GET | `/admin/cs/sessions` | 会话列表（支持状态筛选） |
| GET | `/admin/cs/sessions/:id` | 会话详情（含消息和用户信息） |
| GET | `/admin/cs/tickets` | 工单列表 |
| PATCH | `/admin/cs/tickets/:id` | 更新工单状态/优先级 |
| GET | `/admin/cs/faq` | FAQ 列表 |
| POST | `/admin/cs/faq` | 创建 FAQ |
| PATCH | `/admin/cs/faq/:id` | 更新 FAQ |
| DELETE | `/admin/cs/faq/:id` | 删除 FAQ |
| POST | `/admin/cs/faq/test` | 测试 FAQ 匹配 |
| GET | `/admin/cs/quick-entries` | 快捷入口列表 |
| POST | `/admin/cs/quick-entries` | 创建快捷入口 |
| PATCH | `/admin/cs/quick-entries/:id` | 更新快捷入口 |
| DELETE | `/admin/cs/quick-entries/:id` | 删除快捷入口 |
| PATCH | `/admin/cs/quick-entries/sort` | 批量更新排序 |
| GET | `/admin/cs/quick-replies` | 快捷回复列表 |
| POST | `/admin/cs/quick-replies` | 创建快捷回复 |
| PATCH | `/admin/cs/quick-replies/:id` | 更新快捷回复 |
| DELETE | `/admin/cs/quick-replies/:id` | 删除快捷回复 |
| GET | `/admin/cs/stats` | 统计数据 |
| GET | `/admin/cs/agent-status` | 坐席状态列表 |

---

## 8. 索引设计

```prisma
@@index([userId, status])          // CsTicket: 按用户查活跃工单
@@index([status, createdAt])       // CsTicket: 按状态+时间排序
@@index([userId, status])          // CsSession: 按用户查活跃会话
@@index([agentId, status])         // CsSession: 按坐席查处理中会话
@@index([status, createdAt])       // CsSession: 排队列表排序
@@index([sessionId, createdAt])    // CsMessage: 按会话查消息列表
@@index([enabled, sortOrder])      // CsFaq: 启用规则排序查询
@@index([type, enabled, sortOrder])// CsQuickEntry: 按类型查询
```

---

## 9. 安全考虑

- **会话归属校验**：买家只能访问自己的会话和消息，防止越权
- **Socket.IO 认证**：连接时验证 JWT，无效 token 立即断开
- **消息内容过滤**：对用户输入做 XSS 清洗
- **坐席权限**：客服操作需要对应权限标识，通过 PermissionGuard 控制
- **敏感操作确认**：AI 执行取消订单、申请退货等操作前必须用户二次确认
- **速率限制**：用户消息发送频率限制（防刷）

---

## 10. 后续演进路径

### Phase D：纯 AI 自助
- 扩充 FAQ 知识库，覆盖 90%+ 常见问题
- 增强 AI 动作执行能力（自动退款、自动补发、自动修改地址）
- AI 置信度持续提升，减少转人工比例
- 引入 RAG（检索增强生成）：将平台规则、商品信息、物流知识结构化入库

### Phase B：买家→卖家客服
- CsSession 增加 `targetType`（PLATFORM / SELLER）和 `companyId`
- 卖家后台增加客服模块（seller 端复用 admin 端的工作台设计）
- 路由逻辑区分：商品咨询类→对应卖家，平台类→平台客服
