# L2 — 商品浏览 + AI 搜索链路审查报告

**日期**: 2026-04-11
**档级**: B（中等深度，15 验证点）
**范围**: `backend/src/modules/product/*`, `backend/src/modules/ai/*`, `src/repos/{Product,Category,AiFeature,AiAssistant,Recommend}Repo.ts`, `app/(tabs)/{home,museum}.tsx`, `app/search.tsx`, `app/product/[id].tsx`, `app/ai/*`
**审查方式**: 只读 Explore

---

## 0. 总体结论

| 维度 | 评分 | 说明 |
|------|------|------|
| 商品浏览链路完整性 | A- | list/detail/categories 都打通真实 API；没有独立 `/search` 端点但统一走 `/products?keyword=` |
| AI 真实性（非 mock） | B+ | Qwen 通过 DashScope OpenAI 兼容接口真实调用；但**商品 AI 品质分/企业 AI 信赖分是前端硬编码/伪随机，非真 AI** |
| 语义升级落地度 | C (默认关闭) | 3 个语义开关全部 `false`；代码路径已写好但未激活 |
| Fallback 质量 | B | 所有 Qwen 调用都有 timeout + catch + 字面兜底；聊天链路的空 reply 容错完备 |
| 前后端契约一致性 | A- | ProductRepo.list 参数全部透传到后端，DTO 对齐 |

**关键需确认项**（末尾 `## 6. 必问` 集中列出）：v1.0 是否激活 3 个语义开关、AI 品质分/信赖分是否接入真 AI 或下线 UI。

---

## 1. 验证点逐项结果

### 商品浏览（5 点）

| # | 项目 | 状态 | 位置 | 说明 |
|---|------|------|------|------|
| 1 | GET /products 列表分页 | OK | `backend/src/modules/product/product.controller.ts:11-63` | 支持 page/pageSize/categoryId/keyword/preferRecommended/constraints/maxPrice/recommendThemes + 5 个语义槽位；前端 `src/repos/ProductRepo.ts:164-178` 参数完全对齐 |
| 2 | GET /products/:id 详情 | OK | `product.controller.ts:72-76` → `product.service.ts:302-339` | include media/skus/tags/category/company；`mapToDetail` 返回 images/videos/skus/attributes；平台商品屏蔽；继承式退货政策解析 |
| 3 | GET /products/categories 分类树 | OK | `product.controller.ts:65-70` → `product.service.ts:341-361` | 5 分钟 TTL 内存缓存；前端 `CategoryRepo.list` 调 `/products/categories` 匹配 |
| 4 | GET /companies 企业列表 | 超范围 | — | 由 L2 外的 company 模块承担；museum/search 页用 `CompanyRepo.list` |
| 5 | GET /search 搜索 | **不存在独立端点** | — | 统一搜索走 `/products?keyword=` + 前端 `CompanyRepo.list` 客户端筛选 + `aiSummary` 本地拼字符串（`app/search.tsx:440-472`）。不是 bug，但未来 AI 搜索摘要接入真模型时需要后端专属端点 |

### AI 能力（10 点）

| # | 项目 | 状态 | 位置 | 说明 |
|---|------|------|------|------|
| 6 | Qwen 真实调用 | **OK（真实）** | `ai.service.ts:46`, `2280/2390/2992/3212/3357/3782`；`semantic-fill.service.ts:263`；`product.service.ts:52` | 全部走 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，`Authorization: Bearer ${DASHSCOPE_API_KEY}`，OpenAI 兼容模式；5 个独立调用点 + 1 个通用 `callSemanticModel`；非 mock |
| 7 | 意图识别 classify 方法 | OK | `ai.service.ts:566-630` (`classifyIntent`) + `3097-3341` (`qwenIntentClassify`) | 规则优先 → 快速 search 优先 → Qwen-Flash 兜底；置信度阈值按 intent 区分（navigate/search 0.6, transaction 0.8, company/recommend 0.7） |
| 8 | **3 个语义开关默认状态** | **全部默认 false** 🟡 | `backend/.env.example:61-64` | `AI_SEMANTIC_SLOTS_ENABLED=false` / `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=false` / `AI_SEMANTIC_SCORING_ENABLED=false`；代码路径全部完成且有单测覆盖（`ai.service.operation-lane.spec.ts:221-297`）；**待激活**，详见 §5 |
| 9 | 商品 AI 推荐（AiFeatureRepo） | OK | `AiFeatureRepo.getRecommendPlan`（`src/repos/AiFeatureRepo.ts:40-108`）→ `GET /ai/recommend/plan` → `ai.service.ts:3934-4039` (`getRecommendPlan`) | 后端编排：调 `productService.list` 拉候选 + 计算 summary/aiReason/tags/plans；语义槽位透传 |
| 10 | 商品 AI 品质评分 | **伪造** 🔴 | `app/product/[id].tsx:35-51` (`getAiScore`) | **前端基于 productId 字符哈希生成 85-98 区间的伪随机分 + 从 4 条固定文案里取一条**。没有后端 API，没有真 AI；UI 却在 line 222-232 打着"AI 品质评分"标签展示。详见 §4 |
| 11 | 企业 AI 信赖分 | **硬编码** 🔴 | `app/product/[id].tsx:452-462` | 直接写死 `<Text>96</Text>`，没有任何数据源。详见 §4 |
| 12 | 搜索 AI 摘要 | 前端本地拼串 🟡 | `app/search.tsx:440-472`；`app/company/search.tsx:323-370` | `aiSummary` 是 `useMemo` 本地根据结果数和筛选条件拼 `"为您找到 N 款相关商品..."`，不经 AI；**UI 标签"AI 搜索摘要"语义名实不符**。非 bug 但用户感知质量受损 |
| 13 | AI 助手对话 | OK | `app/ai/chat.tsx:216/371` → `AiAssistantRepo.chat` → `POST /ai/assistant/chat` → `ai.service.ts:198-223` (`simpleChat`) → `sendMessage` → 若命中 chat 意图则走 `chatWithContext` (3764) → Qwen-Plus | 完整多轮；自动管理 session；历史上下文注入；超时 10s；空 reply fallback "抱歉 AI 助手暂时繁忙"；非法 JSON fallback 为整段当作 reply |
| 14 | 首页 AI 光球 + 快捷指令 | OK | `app/(tabs)/home.tsx:28/109/603` (`AiOrb`)；快捷指令来自 `ai.service.ts:123-132` (`getShortcuts`) 硬编码 6 条 | 光球 3 态（idle/listening/thinking）接入 `useVoiceRecording` hook；快捷指令前端也自有本地列表，两边定义**未同步**（`app/ai/assistant.tsx:72-75` 只有 4 条"我的订单到哪了..."） |
| 15 | 语音识别集成 | OK | `asr.service.ts:76` (`recognize`) → 阿里云 `gummy-chat-v1` WebSocket；`ai.controller.ts:77-105` (`parseVoiceIntent`) → `ai.service.ts:parseVoiceIntent` → ASR → classify → dispatch | 预建连（`prepareSession`, TTL 15s）；10s 识别超时；MIME 类型映射完整（pcm/wav/mp3/opus/aac/amr/caf）；前端 `AiAssistantRepo.parseVoiceIntent` FormData 上传 |

---

## 2. 🤖 AI 用户感知质量检查

### 2.1 Qwen 系统提示词完整性
- **Chat 主脑 prompt**（`ai.service.ts:60-100`, `CHAT_SYSTEM_PROMPT`）：定义角色 + 回答边界 + 安全规则 + 严格 JSON schema + 字段约束 + 白名单，**质量高**
- **统一分类 prompt**（`semantic-slot.constants.ts:22-162`, `UNIFIED_CLASSIFY_PROMPT`）：分类规则 7 条 + 关键原则 8 条 + 示例 31 条 + 输出格式 + 槽位字段清单；覆盖同音字、"打开 X → search if not whitelist"、爆款/热销→recommend 等细节；**质量高**
- **Out-of-domain bridge prompt** 存在（`OUT_OF_DOMAIN_BRIDGE_PROMPT`，在 `semantic-slot.constants.ts`）用于超范围问题的桥接回复
- **搜索词改写 prompt**（`2262-2275`）：明确只返回 `{"keyword":"..."}`，带 5 个示例
- **推荐参数解析 prompt**（`2365-2385`）：定义 5 字段 schema，带 6 个示例
- **语义字段填充 prompt**（`semantic-fill.service.ts:251-257`）：定义 5 字段，每字段上限 5 个，无法推断返回空

### 2.2 回复格式容错
- **bb29234 commit 修复的数组包裹 JSON**：commit 实际改的是 `cs-routing.service.ts`（智能客服模块），**不在本 L2 审查范围**
- **本 L2 范围内的 `parseChatResponse`**（`ai.service.ts:3659-3697`）：
  - 支持 markdown fence `\`\`\`json...\`\`\`` 剥离
  - `JSON.parse` 失败时整段 raw 当作 reply 返回
  - `parsed.reply` 为空时用 raw.trim() 兜底
  - **未处理** `Array.isArray(parsed)` 情形（若 Qwen-Plus 返回 `[{...}]` 会崩到 catch 兜底但 `suggestedActions` 和 `followUpQuestions` 都丢失）
  - 🟡 建议参考 `cs-routing.service.ts` 的修复思路，对 chat 链路也加 `Array.isArray(parsed)` 解包。否则未来 Qwen 偶发数组包裹时，chat 的按钮和追问会降级为空
- **`qwenIntentClassify`**（`ai.service.ts:3245-3246`）：同样用 fence 剥离 + JSON.parse，**也未处理数组包裹**；失败时返回 null → 上层 `classifyIntent` 退化为 chat fallback，体验能保
- **`callSemanticModel`**（`ai.service.ts:3389-3390`）：同上，未处理数组包裹

### 2.3 Fallback 行为
| 场景 | 处理 | 位置 |
|------|------|------|
| `DASHSCOPE_API_KEY` 未配置 | 搜索词改写：返回原 keyword；分类：返回 null → chat 兜底；chat 主脑：返回 `'AI 服务暂未配置，请联系管理员。'` | `2256`, `3102`, `3773` |
| Qwen API 非 2xx | log.error + 返回空/null 走兜底分支 | 所有 fetch 后 `!response.ok` 检查 |
| Qwen 超时 | `AbortController` + `setTimeout`（搜索词改写 3.5s / 推荐解析 4.5s / 意图分类 5s / 语义模型 可配 / chat 10s / ASR 10s） | 6 处 |
| Qwen 返回空 content | log.warn + 返回 fallback | `2307`, `3240`, `3384` |
| Qwen 返回非法 JSON | try/catch → chat 链路整段 raw 当 reply；分类链路返回 null | `3689`, `3335` |
| Out-of-domain | bridge prompt 走 chat 模型再生成 + 失败时硬编码"这个问题超出了我的专业范围" | `1646-1685` |
| too-vague / unsafe | 硬编码礼貌回复 | `1688-1710` |
| 低置信度 | `buildLowConfidenceFallbackIntent` 提示用户重说 | `725-742` |

### 2.4 意图识别槽位提取是否激活
- 槽位抽取**仅在 `AI_SEMANTIC_SLOTS_ENABLED=true`** 时走 `UNIFIED_CLASSIFY_PROMPT`（`ai.service.ts:583-584, 3111`）；默认关闭时只走传统 prompt（`3165-3206`），params 里**也能**输出 `usageScenario/originPreference/...`（因为传统 prompt 第 3174 行也列了这些可选字段），但没有 `HIGH_VALUE_SLOTS` 质量检查 + 升级逻辑
- 所以"槽位部分激活"：Qwen-Flash 即使在关闭状态下也可能返回槽位字段，`params.usageScenario` 等会被原样透传，但不触发 Plus 升级
- 打开开关会启用：统一 prompt + Flash 结果质量检查 + 不够好时沿用 Flash（不升级 Plus，注释里写的是"按操作链路预算直接使用 Flash 结果"，`3147-3156`）——所以"升级到 Plus"这条路径在代码里其实**已经被下掉了**，只保留 Flash-only

### 2.5 搜索评分是否激活
- `computeSearchScore`（`product.service.ts:697-772`）：base 分数（标题/副标题/分类/tags/keywords）+ 推荐信号 + 约束加分 + 主题加分 + 折扣分 + 新鲜度分**始终启用**
- **语义加分（`computeSemanticScore`）仅在 `AI_SEMANTIC_SCORING_ENABLED=true` 且 `slots` 非空时启用**（`739-755`）；默认关闭时，`categoryHint/usageScenario/originPreference/dietaryPreference/flavorPreference` 等槽位**不参与评分**

### 2.6 商品语义字段是否激活
- `SemanticFillService.fillProduct` / `batchFill`（`product/semantic-fill.service.ts:44, 179`）：**顶部硬拦截** `if (process.env.AI_PRODUCT_SEMANTIC_FIELDS_ENABLED !== 'true') return;`
- 默认关闭时，`flavorTags/seasonalMonths/usageScenarios/dietaryTags/originRegion` 字段**永远为空数组/null**，导致 `computeSemanticScore` 即便开启也无从匹配

---

## 3. 发现的问题清单

### 🔴 P1（影响 v1.0 用户感知，需在上线前决策）

**P1-01 商品 AI 品质评分是前端伪造**
- 文件：`app/product/[id].tsx:35-51`
- 证据：`getAiScore()` 基于 `productId.charCodeAt(i)` 哈希 + `Math.abs(hash % 14)` 生成 85-98 伪随机分数；`comment` 从 4 条写死文案里哈希取一条
- UI：line 222-232 标签写着 "AI 品质评分"，配 `AiBadge variant="score"`，视觉上让用户相信这是真 AI 分析
- 风险：用户信任度风险；若被发现（同一个商品每次访问都是同一个分数，新建商品立刻就有"AI 品质分"）会显著折损品牌可信度
- 行动选项：① 下线 UI 等真后端 API 接入；② 接 `backend/src/modules/product` 新增 `/products/:id/ai-score` 让 Qwen 真推断；③ 保留但把标签改成"示例评分 DEMO"
- 注释 `line 35` 已经明确写了 `"I04修复：基于商品ID动态生成AI品质评分（真实场景应从后端获取）"` — 即作者自己也知道是临时方案

**P1-02 企业 AI 信赖分硬编码 96**
- 文件：`app/product/[id].tsx:460`（`<Text>96</Text>`）
- 证据：无任何数据源，纯字符串常量
- 风险：同 P1-01
- 行动：同 P1-01

**P1-03 搜索 AI 摘要是本地拼字符串**
- 文件：`app/search.tsx:440-472`, `app/company/search.tsx:323-370`
- 证据：`aiSummary = useMemo(() => \`为您找到${pCount}款相关商品${...}\`)`
- 严重度低于 P1-01/02，因为拼出来的内容事实上是对的，只是没有"真 AI 摘要"的语言自然度
- 行动：① 保留现状但把 UI 标签改成"智能搜索总结"避免"AI"字样；② v1.1 接入 Qwen 对结果 top3 做一句话总结

### 🟡 P2（代码健壮性，建议修复）

**P2-01 `parseChatResponse` 未处理 Qwen 数组包裹 JSON**
- 文件：`ai.service.ts:3668`
- 智能客服模块 bb29234 commit 的 root cause 描述明确：**Qwen 会偶发返回 `[{...}]`**。当前 chat 链路若遇到这种情况会落到 catch 兜底，把整个 raw（含方括号）当作 reply 展示给用户
- 建议：在 `JSON.parse(cleaned)` 后加 `const parsed = Array.isArray(raw) ? raw[0] : raw;` 和 `{ result: {...} }` 解包
- 同问题存在于 `qwenIntentClassify`（`3246`）和 `callSemanticModel`（`3390`）—— 影响面：分类失败会退化为 chat 兜底（可接受），但**会偶发将完整商品搜索意图识别成 chat**

**P2-02 首页快捷指令 vs 后端 shortcuts 不同步**
- 文件：`app/ai/assistant.tsx:72-75`（前端 4 条）vs `ai.service.ts:123-132`（后端 6 条）
- 两边写的是不同的文案；assistant 页也没调 `/ai/assistant/shortcuts` 拉取
- 建议：统一从 `AiAssistantRepo.listShortcuts()` 拉

**P2-03 语义升级 Plus 管道已下线**
- 文件：`ai.service.ts:3134-3156`
- 代码注释："Flash 槽位不充分（...），按操作链路预算直接使用 Flash 结果"
- `docs/ai/ai.md` 设计方案里原本是 "Flash 不够好 → 升级到 Plus" 的双层管道；当前代码里**升级到 Plus 已经不会发生**，无论 Flash 是否 good 都直接返回 Flash 结果
- 风险：与设计文档不一致；槽位抽取完全依赖 Flash，在复杂 query 上可能欠拟合
- 行动：确认是故意下线还是未实现；若故意，同步更新 `docs/ai/ai.md`

### 🟢 P3（信息性/文档对齐）

**P3-01 `Qwen` 宕机时的降级策略在代码里是一致的但未集中成文档**
- 每个调用点独立处理 timeout/catch，行为一致但没有集中定义 SLA 目标（例如"Qwen 连续失败 N 次后是否熔断"）
- 建议：在 `docs/ai/ai.md` 补一节"Qwen 降级策略与 SLO"

**P3-02 `DASHSCOPE_API_KEY` 单点依赖**
- 所有 6 处 fetch 都读 `process.env.DASHSCOPE_API_KEY`；没有多 key 轮询或副 key 兜底
- 风险：单 key 额度耗尽或被限流时 AI 能力全面降级
- 行动：v1.0 接受，v1.1 考虑 key 池

**P3-03 `isFlashResultGood` 质量检查**
- 导出自 `semantic-slot.constants.ts`，未读取内部逻辑；但由于 Plus 升级管道已下线（P2-03），该函数当前只是记日志用，**没有决策作用**

---

## 4. 跨系统一致性审查

| 项 | 结果 |
|---|---|
| ProductRepo.list 参数 ↔ product.controller.ts Query | ✅ 完全对齐（page/pageSize/categoryId/keyword/preferRecommended/constraints/maxPrice/recommendThemes/usageScenario/originPreference/dietaryPreference/flavorPreference/categoryHint）|
| CategoryRepo.list 路径 | ✅ `/products/categories` 匹配 |
| AiFeatureRepo.getRecommendPlan 参数 ↔ AiRecommendPlanQueryDto | ✅ 对齐；前端多了 `promotionIntent/bundleIntent` 透传，后端 controller（`ai.controller.ts:137-143`）也接收 |
| AiAssistantRepo.chat 路径 | ✅ `/ai/assistant/chat` 匹配 |
| AiAssistantRepo.parseVoiceIntent 路径 | ✅ `/ai/voice-intent` 匹配 |
| Shortcuts 前端本地列表 ↔ 后端 getShortcuts | 🟡 两边文案不同（4 条 vs 6 条），见 P2-02 |
| 语义槽位枚举 `semantic-score.ts CONSTRAINT_LABEL_MAP` ↔ 前端 `ProductRepo constraintKeywordMap` | ✅ 8 个约束对齐（organic/low-sugar/fresh/seasonal/traceable/cold-chain/geo-certified/healthy）|
| AiRecommendTheme 枚举 | ✅ hot/discount/tasty/seasonal/recent 三端统一 |

---

## 5. 语义开关激活影响分析

三个开关默认 false，若要在 v1.0 打开：

| 开关 | 打开后启用的能力 | 依赖 | 已知 bug |
|------|---------------|------|------|
| `AI_SEMANTIC_SLOTS_ENABLED` | 统一 classify+slots prompt；返回更丰富 params | Qwen-Flash 额外 tokens | 无已知 bug；但 Plus 升级管道已下线（P2-03），开启后仍只有 Flash |
| `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` | 商品创建/批量跑 Qwen 填充 `flavorTags/seasonalMonths/usageScenarios/dietaryTags/originRegion` 字段 | 数据库需有这些 Prisma 字段（已确认存在于 `product.service.ts:39-43`）；batch job 会对每条 Qwen 调用一次（批量 500 条 = 500 次 Qwen + 200ms 间隔） | 无已知 bug；但**默认没被任何 cron 调起**，batch 没接 scheduler |
| `AI_SEMANTIC_SCORING_ENABLED` | 搜索排序额外加语义匹配分（`computeSemanticScore`） | 依赖上面字段已填充 | 无已知 bug |

**联动风险**：`AI_SEMANTIC_SCORING_ENABLED=true` 但 `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=false` 会导致商品字段全空，语义加分恒为 0，相当于开关打开但无效果。建议这两个开关**一起打开**或**都不打开**。

---

## 6. ❓ 必问（需用户决策）

1. **v1.0 是否激活全部 3 个语义开关？**
   - 激活：搜索精准度和意图识别能力提升，但需要先跑一次 `SemanticFillService.batchFill` 给现有商品填字段（当前没接 cron），且 Qwen 调用量翻倍（每次意图识别从 1 次变成 1 次更大 prompt；每次搜索多一次 compute，不额外调 Qwen）
   - 不激活：留作 v1.1；当前行为是传统 prompt 分类 + 关键词评分，体验稳定
   - **我的建议**：`AI_SEMANTIC_SLOTS_ENABLED=true`（低风险，纯 prompt 变化）；`AI_PRODUCT_SEMANTIC_FIELDS_ENABLED` + `AI_SEMANTIC_SCORING_ENABLED` **打包后延**到 v1.1 一起开，避免字段未填但加分启用的空转状态

2. **商品 AI 品质评分（P1-01）和企业 AI 信赖分（P1-02）如何处理？**
   - 选项 A：上线前下线两个 UI 块（最保守）
   - 选项 B：保留 UI 但改标签为"示例评分"或"社区评分"去掉 AI 字样
   - 选项 C：后端补真实 API（工作量中等：需定义分数计算规则，跑 Qwen 或用启发式打分）
   - **我的建议**：v1.0 选 B（改标签），v1.1 选 C

3. **Qwen 宕机时的降级策略是否达标？**
   - 当前：每个调用点独立 catch + 硬编码兜底文案；无熔断、无多 key 轮询
   - 风险：大面积失败时用户连续看到"网络异常，请稍后再试"
   - 是否需要 v1.0 加熔断器？（我的建议：v1.0 不需要，当前 fallback 文案是可接受的；监控接入后再加熔断）

4. **`parseChatResponse` 是否要补数组包裹解包（P2-01）？**
   - bb29234 证明 Qwen 确实会偶发返回 `[{...}]`；chat/classify/semantic 三条链路都有这个风险
   - **我的建议**：v1.0 就补，10 行代码，低风险

5. **Plus 升级管道是否故意下线（P2-03）？**
   - 如果是故意，需更新 `docs/ai/ai.md`；如果是遗忘，需确认是否重新启用

---

## 7. 需要跟进的文件清单（绝对路径）

**后端 AI 核心**
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/ai/ai.service.ts`（4240 行，Qwen 调用 + 意图识别 + 聊天 + session）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/ai/ai.controller.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/ai/asr.service.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/ai/semantic-slot.constants.ts`

**后端商品核心**
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/product/product.service.ts`（934 行）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/product/product.controller.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/product/semantic-fill.service.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/src/modules/product/semantic-score.ts`

**环境变量**
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/backend/.env.example:42-64`

**前端 Repo 层**
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/src/repos/ProductRepo.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/src/repos/CategoryRepo.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/src/repos/AiFeatureRepo.ts`
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/src/repos/AiAssistantRepo.ts`

**前端页面（需修改的）**
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/product/[id].tsx:35-51, 222-232, 452-462`（P1-01/02）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/search.tsx:440-472`（P1-03）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/company/search.tsx:323-370`（P1-03）
- `/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台/app/ai/assistant.tsx:72-75`（P2-02）

---

**审查完成。重点提醒主 Agent：**
1. **P1-01/02 前端伪造 AI 分数**是用户可见质量问题，v1.0 上线前必须决策
2. **3 个语义开关默认关闭**是设计决定还是遗忘？需用户确认
3. **P2-01 数组包裹解包**10 行代码可补，建议 v1.0 直接补
