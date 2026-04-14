# L9 智能客服（Customer Service）— B 档审查

**审查日期**：2026-04-11
**审查范围**：`backend/src/modules/customer-service/` 全 20+ 文件，`app/cs/index.tsx`，`admin/src/pages/cs/*`（6 页面），`schema.prisma` 客服域
**近期动向**：最近 5 commits 全部为 `fix(cs)`，围绕 AI 回复 JSON 容错、Qwen 数组包裹兼容、本地/服务端消息对账去重、输入框焦点保持
**文档依据**：`docs/features/智能客服.md`

---

## 🚨 Tier 1 阻塞项（上线前必改，否则生产事故）

### 🔴 BLOCK-1 会话空闲超时常量是测试值 5 秒（预期 2 小时）

**位置**：`backend/src/modules/customer-service/cs.service.ts:26`

```ts
private readonly SESSION_IDLE_TIMEOUT_MS = 5 * 1000; // TODO: 测试用 5 秒，上线前改回 2 * 60 * 60 * 1000
```

**影响**：
- 用户发送一条消息 → 5 秒内如果没再输入 → 再次进入客服页会被当作"超时"，旧会话被自动 `CLOSED`，AI 上下文/转人工历史丢失
- `createSession` 内部逻辑直接 CLOSED 旧会话并新建一个（`cs.service.ts:58-63`）
- 与文档描述的"2 小时无活动自动关闭旧会话"（`docs/features/智能客服.md:35`）严重不符
- **真实用户第一次上线就会遇到**：在客服页发完一句话切到别的 tab，6 秒后切回来，整个会话就没了

**修复**：改为 `2 * 60 * 60 * 1000`（7,200,000 ms = 2 小时），删除 TODO 注释。

---

### 🔴 BLOCK-2 清理服务三个超时常量 + Cron 频率全部是测试值

**位置**：`backend/src/modules/customer-service/cs-cleanup.service.ts:23-34`

```ts
// ⚠️ 测试值：上线前改回生产阈值
private readonly AI_IDLE_TIMEOUT_MS = 10 * 1000;     // 生产: 2 * 60 * 60 * 1000
private readonly QUEUING_TIMEOUT_MS = 30 * 1000;     // 生产: 30 * 60 * 1000
private readonly AGENT_IDLE_TIMEOUT_MS = 60 * 1000;  // 生产: 60 * 60 * 1000

@Cron(CronExpression.EVERY_30_SECONDS)  // 生产: EVERY_10_MINUTES
async cleanupIdleSessions() { ... }
```

**影响**：
- 任何 `AI_HANDLING` 会话空闲 10 秒就被 Cron 强制 `CLOSED`
- 排队中的用户 30 秒没被接入就被强制关闭（文档：30 分钟）
- 坐席会话 60 秒没发新消息就被强制关闭，坐席名额被释放、工单被标记 RESOLVED
- Cron 每 30 秒扫一次全表（而非每 10 分钟），对生产数据库是不必要的压力
- **与 BLOCK-1 叠加**：买家在客服页打一句话停顿一下，10 秒后被 Cron 杀掉会话；如果此时正和真人客服聊，60 秒没回就自动关闭 + 释放坐席 + 发工单 resolved 事件

**修复清单**（4 个常量要同时改）：
1. `AI_IDLE_TIMEOUT_MS` → `2 * 60 * 60 * 1000`
2. `QUEUING_TIMEOUT_MS` → `30 * 60 * 1000`
3. `AGENT_IDLE_TIMEOUT_MS` → `60 * 60 * 1000`
4. `@Cron(CronExpression.EVERY_30_SECONDS)` → `@Cron(CronExpression.EVERY_10_MINUTES)`

**❓ 用户确认**：文档写的是"AI_HANDLING 2 小时"和"AGENT_HANDLING 60 分钟"，确认这就是期望值吗？

---

## ⚠️ Tier 2 High（应修）

### H-1 Gateway `handleSend` 里有一行死代码 — 错误地调用 getActiveSession

**位置**：`backend/src/modules/customer-service/cs.gateway.ts:146`

```ts
// 先验证归属再加入房间
const session = await this.csService.getActiveSession(client.data.userId, '', undefined);
// 通过 handleUserMessage 的内部校验确认归属
const result = await this.csService.handleUserMessage(sessionId, client.data.userId, content, ...);
```

`getActiveSession` 被传入 `source=''`，其内部 Prisma 查询会按 `source: '' as any` 过滤，**永远返回 null**。返回值被赋给 `session` 后从未使用。

**影响**：
- 每次买家通过 Socket 发消息都多一次无用的数据库查询
- 注释说"先验证归属再加入房间"但代码实际没有做任何验证
- 真正的归属验证在 `handleUserMessage` 内部（`cs.service.ts:119`），注释误导

**修复**：直接删掉第 146 行（连同注释）。

---

### H-2 `consecutiveFailures` Map 内存泄漏

**位置**：`cs.service.ts:15`

```ts
private consecutiveFailures = new Map<string, number>();
```

- 只在 `closeSession` 和消息处理成功时 `.delete()`
- 会话如果被 Cron（`cs-cleanup.service.ts` 的 `cleanupIdleSessions`）直接 update 为 CLOSED（没走 `csService.closeSession`），**Map 条目永不释放**
- 长时间运行后，Map 里会累积所有历史会话 id

**修复**：
- 方案 A：Cron 清理时也调用 `csService.closeSession`（但 Cron 在独立服务里注入 `CsService` 会有循环依赖风险）
- 方案 B：加一个定时 GC（每次 Cron 清理后，把 Map 里 key 对应 session 已 CLOSED 的条目删掉）
- 方案 C：最稳妥的是把计数器持久化到 `CsSession` 的一个字段（`aiConsecutiveFailures Int @default(0)`），彻底摆脱内存 Map

推荐方案 C。

---

### H-3 `BANK_CARD_REGEX` 会误吃订单号/物流单号

**位置**：`cs-masking.service.ts:26`

```ts
private readonly BANK_CARD_REGEX = /(?<![0-9])(\d{13,19})(?![0-9])/g;
```

13-19 位连续数字在电商场景里大量存在：
- 订单号（26+ 位 cuid 不会中招，但用户可能会贴短订单号）
- 快递单号（多数在 12-15 位之间，如顺丰 15 位、EMS 13 位、圆通 12 位）
- 时间戳 + 随机数组合

**影响**：用户说"我的快递单号 SF1234567890123 没更新" → 单号被替换为 `[银行卡号已隐藏]`，AI 完全无法帮他查询物流。

**修复建议**：银行卡正则加强：要求必须是纯数字 15/16/19 位（VISA/MasterCard/银联的实际长度），或改为只匹配特定前缀（62xx 银联、4xxx VISA 等）。`docs/features/智能客服.md` 里看维护指南要求每次客服 bug/优化同步更新文档。

---

### H-4 Socket 消息到 session 房间的权限校验缺失

**位置**：`cs.gateway.ts:130-195` `handleSend`

买家发消息时，代码在 `handleUserMessage` 校验通过后才 `client.join(session:${sessionId})`。但是：
- 房间广播 `this.server.to('session:'+sessionId).emit(...)`
- 之前已经加入过该房间的客户端（例如之前合法接入过会话 B 的用户 A）不会被踢出
- 如果 userId 复用或坐席切换会话，有可能收到不属于自己的会话消息

**缓解**：`handleUserMessage` 已校验 `session.userId !== userId` 会抛错，但房间成员不会被清理。长连接切换上下文时有隐患。

**建议**：进入房间前先 `client.rooms` 里排查，离开旧会话房间。生产环境影响较低，列为 High 是出于深度防御考虑。

---

### H-5 `cs.controller.ts:90` 的"先验证归属"又是一个废 call

```ts
// 先验证归属
const session = await this.csService.getSessionMessages(sessionId, userId);
await this.csService.closeSession(sessionId);
```

`getSessionMessages` 返回消息数组，不抛错就算验证通过（因为它本身会校验归属）。但这里把结果赋给 `session` 变量然后忽略，读起来很奇怪。逻辑其实是对的（`getSessionMessages` 内部会 throw NotFoundException），但代码可读性差。

**修复**：改为 `await this.csService.verifySessionOwnership(sessionId, userId)` 或直接写明注释 `// 借用 getSessionMessages 的归属校验，结果丢弃`。

---

## Tier 3 Medium（建议修）

### M-1 AI prompt 订单上下文通过字符串内插注入
`cs-routing.service.ts:108-120` 已经用 `JSON.stringify` 转义 ID，Sec2 防注入做得到位 ✅。但 `safeContextInfo` 是拼进 systemPrompt 的大字符串（`${safeContextInfo}`），而 `orderInfo` 里的 `productSnapshot.title`（商品名）直接被 JSON.stringify。如果商家在商品标题里放反斜杠+引号组合，JSON 字符串里会合法出现 `\"`，Qwen 解析后仍可能被识别为 prompt 内容。

**建议**：把 orderInfo 作为独立 system message 传入，而不是拼接到主 prompt 字符串里。这样 role=system 边界清晰。

### M-2 HTTP 轮询 5 秒 + Socket 两套通道并存
`app/cs/index.tsx:32` 的 `POLL_INTERVAL = 5000`。买家 App 同时用 HTTP 轮询 + Socket（管理端）作为降级。但从代码看，**买家 App 没有 Socket.IO 客户端初始化**，只有 HTTP 轮询 + HTTP POST。这意味着：
- 买家发消息 → HTTP POST → 后端写库 + 广播 Socket
- 坐席的回复 → Socket 广播到 `session:xxx` 房间，**但买家没在房间里**
- 买家只能通过 5 秒一次的 HTTP 轮询拿到坐席回复

这虽然可用，但「实时通讯」名不副实。文档 `docs/features/智能客服.md:32` 明确说"Socket.IO 双向实时聊天，支持买家↔坐席"。

**建议**：买家 App 加 Socket.IO 客户端（至少接收坐席消息）。或降低期望写清"买家端采用 5s 轮询，坐席端 Socket 实时"。

### M-3 AI 回复 JSON fallback 的防御可能掩盖真实问题
`cs-routing.service.ts:247-255` 在 JSON 解析失败时，把 raw（<500字）当作 general_qa 回复返回。这是 bb29234 commit 修的 bug。**但这会掩盖 prompt 工程的退化**：如果某次 Qwen 模型升级后总是返回非 JSON，日志里只会看到 warning，业务上继续工作。

**建议**：加一个 metric（例如 `cs_ai_json_parse_failure_total`），超过阈值报警；并在管理后台 dashboard 展示 AI JSON 解析成功率。

### M-4 `cs:new_ticket` 事件在 HTTP 路径和 Socket 路径里重复发送
`cs.controller.ts:65-76` 和 `cs.gateway.ts:176-189` 都会在 `shouldTransferToAgent` 时广播 `cs:new_ticket`。
- 买家通过 HTTP POST → Controller 广播一次
- Controller 内部调用的 `handleUserMessage` 如果触发了 `transferToAgent`，里面并不会 emit，这里是安全的
- 但如果**买家通过 Socket 发消息（M-2 说的场景目前不存在）**，Gateway 会单独再广播一次

目前两条路径互斥，安全。但未来买家加 Socket 发消息后会重复。建议抽一个 `emitNewTicket` helper 在一处统一。

### M-5 工单 category 全部是 'OTHER'
`cs.gateway.ts:180`、`cs.controller.ts:68`、`cs-ticket.service.ts:15` 的默认值都是 `'OTHER'`。AI 路由服务拿到了 `intent`（`query_logistics`/`query_aftersale`/`apply_aftersale` 等），但从不映射到 category。

**影响**：工单列表里所有转人工的工单 category 都是 OTHER，分类筛选形同虚设，坐席看不到物流/售后等分类。

**修复**：在 `transferToAgent` 或路由结果传到 `createTicket` 时，按 intent 映射到 category（intent='query_logistics' → category='DELIVERY' 等）。

### M-6 cs-cleanup 批量关闭会话无事务
`cs-cleanup.service.ts:60-82` 对每个会话单独 update + releaseAgent + ticket update，任何一步失败只在 catch 里打 warn。如果 Cron 扫出 100 个会话，第 50 个卡住一半（会话已 CLOSED 但坐席名额没回收），数据会处于中间态。

**建议**：每个会话用单独事务包住三步操作；或至少先批量 CLOSED 会话（updateMany），再单独处理坐席名额和工单。

---

## Tier 4 Low（记录备忘）

- **L-1** `cs.gateway.ts:29` 写死了默认 CORS origins 里的 localhost 端口，生产环境依赖 `ALLOWED_ORIGINS` env 不要忘了设置。
- **L-2** `cs-routing.service.ts:15` CONFIDENCE_THRESHOLD 0.6 没做成可配置。
- **L-3** `cs-routing.service.ts:6` 的 TRANSFER_KEYWORDS / EMOTION_KEYWORDS 常量硬编码，不能运营动态调整。
- **L-4** `app/cs/index.tsx:300-308` welcomeMessage 是每次 render 都重新生成对象（id 固定所以影响小，但多余）。
- **L-5** 管理端 workstation `VITE_WS_BASE_URL || 'http://localhost:3000'` 兜底到 localhost（`workstation.tsx:586`），生产如果忘记设置会静默连不上，建议加明显报错。
- **L-6** `cs.service.ts:391` 统计 aiResolved 的口径是 `status:CLOSED, agentId:null`，但 AI_HANDLING 超时被 Cron 关掉的也会计入"AI 解决"，数据失真。
- **L-7** `cs-masking.service.ts` 服务构造一次正则后复用，由于都是带 `/g` flag 的，连续 `.test()` 会因为 lastIndex 状态产生假阴性（`containsSensitive` 方法里 4 个连续 test）。

---

## ✅ 做得好的地方

- **并发安全**：`createSession` 用 Serializable + 重试处理序列化冲突（D3）；`transferToAgent` 用 CAS updateMany 防并发重复转接；`agentAcceptSession` 用 `FOR UPDATE SKIP LOCKED` 原子选择坐席 — 这是教科书级别的正确做法。
- **D2 修复得当**：路由完成后再次校验 session.status，防止 LLM 期间状态已变（CLOSED/转人工）产生幽灵 AI 消息。
- **D4/D9 前端对账**：本地 `sending`/`failed` 三态，按 `(createdAt, id)` 复合排序避免同毫秒乱序，polling 和 POST 响应的去重逻辑在 `app/cs/index.tsx:112-138` 和 `230-249` 做得很细致。
- **Qwen prompt 针对客服场景优化到位**：greeting 意图（"在吗/你好/谢谢"）单独处理并给了 few-shot 示例（`cs-routing.service.ts:161-166`）；"转人工"关键词识别优先于 AI；情绪词 → 直接转人工。
- **Prompt 注入防护**：历史对话用独立 message role 传入（而非拼到 system prompt），context ID 用 JSON.stringify 转义，system prompt 内置安全规则（`cs-routing.service.ts:151-155`）。Sec2 做得很规范。
- **AI 回复 JSON 容错**：bb29234 commit 加的数组包裹兼容 (`Array.isArray(parsed)`)、`result` 字段兼容、空 reply fallback 默认回复都是防御性好习惯。
- **测试覆盖**：20+ 个 `.spec.ts` 文件，10 个套件 172/172 通过（依文档），面向 routing/faq/agent/ticket/masking/gateway/controller/admin-crud/dto 全覆盖。
- **订单/售后上下文注入完整**：`buildAiContext` 把订单、商品清单、物流、售后、地址（脱敏）全部传给 AI，U7 修复做得到位。

---

## ❓ 必问清单（回应用户问题）

1. **`SESSION_IDLE_TIMEOUT` 当前真实值？** → `5 * 1000` (5 秒)，`cs.service.ts:26`，有 TODO 注释。🔴 BLOCK-1。
2. **其他测试用硬编码未改回？** → 是。`cs-cleanup.service.ts` 里有 **4 处**：`AI_IDLE_TIMEOUT_MS=10s`、`QUEUING_TIMEOUT_MS=30s`、`AGENT_IDLE_TIMEOUT_MS=60s`、`@Cron(EVERY_30_SECONDS)`。🔴 BLOCK-2。此外 `POLL_INTERVAL=5000` (app/cs/index.tsx:32) 虽然不是"测试用"但较激进，建议确认。
3. **推荐订单上下文是否接入？** → **已接入**且很完整。`cs.service.ts:453-626` 的 `buildAiContext` 当 `source='ORDER_DETAIL'` 或 `'AFTERSALE_DETAIL'` 时，会查询 Order 或 AfterSaleRequest，并注入订单 items/shipment/addressSnapshot/afterSale 到 AI prompt。`cs-routing.service.ts:108-120` 把 orderInfo JSON 序列化后拼进 system prompt。买家点击订单页的客服按钮时，路由参数带上 source=ORDER_DETAIL + sourceId=订单ID（`app/cs/index.tsx:38-41, 70` 从 `useLocalSearchParams` 取），传递链路打通。

---

## 总体判断

**架构成熟度：高。并发/事务/CAS 处理得非常规范，是整个仓库里代码质量较好的模块之一。**

**🚨 但上线前必须修 5 个硬编码超时值（BLOCK-1 + BLOCK-2），这 5 个值让"会话记忆"彻底不可用，用户体验会是灾难性的。修复只需改 5 行代码 + 删 1 个 TODO 注释。**

其他 5 个 High 和 6 个 Medium 多数是防御性/可维护性问题，可进入 backlog。M-3（AI JSON 解析失败降级）和 M-5（工单 category 全 OTHER）建议这一轮就解决。

**审查人员**：只读 agent（B 档）
**总行数**：约 280 行
