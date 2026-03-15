# 语义意图理解升级设计方案

> **范围**：方案 B — Prompt + 类型系统 + 数据模型 + 搜索评分
> **目标**：将 AI 语音/文本意图系统从关键词匹配升级为结构化语义理解，使"今晚做饭买什么""找点新鲜海鲜""有没有本地特产"等生活化表达能被正确解析并匹配到商品
> **后续**：方案 C（满减凑单、搭配推荐、场景化推荐卡片、用户历史上下文）作为独立迭代

---

## 1. 扩展语义槽位 Schema

### 1.1 新增槽位

在现有 `AiVoiceIntentSlots` 基础上新增 6 个字段：

```typescript
usageScenario?: string;                                    // 使用场景："做饭"、"送礼"、"野餐"、"宵夜"、"雨天暖食"
promotionIntent?: 'threshold-optimization' | 'best-deal';  // 促销意图（B 阶段降级为 discount 推荐）
bundleIntent?: 'meal-kit' | 'complement';                  // 搭配意图（B 阶段降级为推荐）
dietaryPreference?: string;                                // 饮食偏好："素食"、"低卡"、"高蛋白"
freshness?: string;                                        // 新鲜度要求："当天"、"活的"、"冷冻也行"
originPreference?: string;                                 // 产地偏好（用户需求侧）："本地"、"进口"、"山东"
```

### 1.2 现有槽位调整

| 槽位 | 变化 |
|------|------|
| `query` | 保留，可为空（场景型表达无显式搜索词） |
| `categoryHint` | 保留，LLM 需推断隐含品类 |
| `constraints` | 保留，只放标准化枚举值（organic/fresh/low-sugar 等） |
| `usage` | **废弃**，统一为 `usageScenario`，旧字段标记 `@deprecated` |
| `audience` / `budget` / `recommendThemes` | 保留不动 |

### 1.3 顶层新增字段

`AiVoiceIntent`（非 slots）新增：

```typescript
fallbackReason?: 'out-of-domain' | 'too-vague' | 'unsafe';
```

- `out-of-domain`：问题和平台无关 → 引导式回复
- `too-vague`：表达太模糊 → 澄清话术或 clarify candidates
- `unsafe`：敏感内容 → 拒绝模板，不做商品引导

### 1.4 前后端同步

- 后端 `voice-intent.types.ts` 和前端 `src/types/domain/Ai.ts` 同步扩展
- `AiVoiceResolved` 对应增加 `usageScenario`、`originPreference` 等 resolved 字段

---

## 2. LLM 管道升级

### 2.1 三级管道保持不变

```
Level 1: 规则命中 (~0ms)     → 直接执行（导航/订单/问候等）
Level 2: Fast 命中 (~50ms)   → 直接搜索（商品名/关键词直接匹配 DB）
Level 3: LLM 分类+抽取       → 语义理解（本节改造重点）
```

Level 1 和 Level 2 不改，它们拦截明确指令，保证速度。

### 2.2 Level 3 内部分层：Flash → 条件升级 Plus

```
用户表达落到 Level 3
  │
  ├─ Qwen-Flash 分类+槽位抽取 (~300ms)
  │    返回: { intent, confidence, slots }
  │
  ├─ 质量检查（本地逻辑，~0ms）：
  │    好结果 = confidence ≥ 0.7 且满足以下任一条件：
  │      · 有 categoryHint
  │      · 有任一高价值槽位（usageScenario / promotionIntent / bundleIntent /
  │        originPreference / freshness / dietaryPreference / budget / audience）
  │      · constraints.length ≥ 1
  │
  │    ├─ 好结果 → 直接用，不升级
  │    └─ 差结果（贫瘠） → 升级 Qwen-Plus 重新抽取 (~1-1.5s)
  │
  └─ 最终输出: 统一的 { intent, confidence, slots, fallbackReason? } 结构
```

### 2.3 Flash/Plus 共 Schema 不共 Prompt

输出 schema 统一：`{ intent, confidence, slots }`。但 prompt 分轻重两版：

- **Flash prompt**：偏分类和基础抽取，短、快、保守
- **Plus prompt**：偏补全隐含需求，允许更强推断

示例（Flash prompt 核心片段）：

```
你是农脉App的语义理解器。将用户语音转录解析为结构化意图。
固定类型：navigate / search / company / transaction / recommend / chat
抽取对应槽位，未明确的字段留空。

输出 JSON：{ intent, confidence, slots: { query?, categoryHint?, constraints?,
usageScenario?, dietaryPreference?, freshness?, originPreference?,
promotionIntent?, bundleIntent?, audience?, budget?, recommendThemes? } }
```

示例（Plus prompt 额外指令）：

```
即使用户没说出具体商品名，也要尽力推断隐含需求。
例如"今晚做饭买什么"应推断 usageScenario:"晚餐做饭"，intent:"recommend"。
与农产品/电商/平台无关的问题，intent 设为 "chat"，fallbackReason 设为 "out-of-domain"。
```

### 2.4 `usage` → `usageScenario` 迁移

后端 `extractSearchConstraints()` 中现有 `usage` 提取逻辑改为写入 `usageScenario`。前端 `navigateByIntent.ts` 读取同步改为 `usageScenario`。旧字段保留但标记 `@deprecated`。

---

## 3. Product Schema 语义字段

### 3.1 新增 5 个语义属性字段

```prisma
model Product {
  // ... 现有字段 ...

  // 语义匹配字段（AI 辅助填充 + 人工可改）
  flavorTags      String[]  @default([])    // 口味口感：["甜","脆","鲜","香辣"]
  seasonalMonths  Int[]     @default([])    // 应季月份：[6,7,8] = 夏季应季
  usageScenarios  String[]  @default([])    // 适用场景：["做饭","送礼","火锅","沙拉"]
  dietaryTags     String[]  @default([])    // 饮食属性：["有机","低糖","高蛋白","素食"]
  originRegion    String?                    // 产地："山东青岛"、"云南"
}
```

### 3.2 字段与槽位的匹配关系

| 商品字段 | 对应的用户侧槽位 | 匹配方式 |
|---------|---------------|---------|
| `flavorTags` | 口味类表达 | 交集匹配 |
| `seasonalMonths` | `constraints: ['seasonal']` | 当前月份 ∈ 数组 |
| `usageScenarios` | `usageScenario` | 包含匹配 |
| `dietaryTags` | `constraints` 枚举值 + `dietaryPreference` | 交集匹配 |
| `originRegion` | `originPreference` | 包含/前缀匹配（"山东" ⊂ "山东青岛"） |

### 3.3 排序信号：不入 Schema，动态计算

| 信号 | 计算方式 | 存储 |
|------|---------|------|
| 热度分 | 7日订单量 + 浏览量×0.1 + 收藏量×0.3 | Redis 缓存，定时任务每小时刷新 |
| 折扣率 | (basePrice - SKU.price) / basePrice | 查询时实时算 |
| 当季分 | 当前月 ∈ `seasonalMonths` ? 1.0 : 0.0 | 查询时实时算 |

排序信号是派生值，不是商品本体事实，不落 Schema。

### 3.4 Migration 策略

- 所有新字段有默认值（`[]` 或 `null`），migration 无数据风险
- 上线后跑一次批量 AI 填充任务
- 未填充的商品不会被惩罚，只是不获得语义匹配加分

---

## 4. 搜索引擎多维评分

### 4.1 评分结构

```
总分 = 关键词基础分 + 语义匹配分 + 排序信号分
```

关键词基础分保持现有逻辑主导。语义匹配只加分，不做空字段惩罚。

### 4.2 语义匹配权重

| 槽位 → 字段 | 匹配方式 | 加分 |
|-------------|---------|------|
| `categoryHint` → `category.name/path` | 包含/层级匹配 | +20 |
| `usageScenario` → `usageScenarios[]` | 数组包含 | +20 |
| `originPreference` → `originRegion` | 前缀匹配 | +15 |
| `constraints` → `dietaryTags[]` | 交集，每命中一项 | +10 |
| `dietaryPreference` → `dietaryTags[]` | 模糊包含 | +10 |
| `seasonalMonths` 包含当前月 | 精确匹配 | +10 |
| 口味类表达 → `flavorTags[]` | 交集匹配 | +8 |

`freshness` 槽位只映射到 `constraints` 命中，不额外打 `flavorTags`，避免"鲜"（口感）和"新鲜"（保鲜要求）混淆。

### 4.3 排序信号分

| 信号 | 加分 |
|------|------|
| 热度（Redis 缓存） | 0~+20（归一化后） |
| 折扣（实时算） | 有折扣 +10，折扣率×15 |

### 4.4 三级降级匹配

```
Level A: 多维匹配
  有 categoryHint 且总语义分达到阈值 → 返回结果，按总分排序
  或无 categoryHint 但 usageScenario / dietaryPreference / originPreference 中命中 ≥ 2 项

Level B: 宽泛搜索
  有 categoryHint 但语义分不足 → 该品类下热门商品
  或有 usageScenario / dietaryPreference / budget / promotionIntent 但无品类 → 走推荐兜底

Level C: Chat 兜底
  真正什么槽位都提不出来 → 交给 chatWithContext()
```

### 4.5 `promotionIntent` 降级处理

B 阶段不做真正凑单计算。`promotionIntent: 'threshold-optimization'` 映射为 `recommendThemes: ['discount']`，搜索当前有促销价的商品。

---

## 5. 引导式回复与 out-of-domain 处理

### 5.1 `chat + fallbackReason` 分流

当 LLM 返回 `intent: 'chat'` 时，执行层检查 `fallbackReason`：

| fallbackReason | 处理 |
|----------------|------|
| `out-of-domain` | 注入 bridge prompt → 生成引导式回复 + suggestedActions |
| `too-vague` | 走澄清流程，返回澄清话术或 clarify candidates |
| `unsafe` | 走拒绝模板，不做商品引导，最多给安全范围内的泛化入口 |
| 无（正常 chat） | 走现有 `chatWithContext()` |

### 5.2 out-of-domain bridge prompt

```
你是农脉App的AI助手，专注于农产品和食材推荐。
用户刚刚问了一个和平台无关的问题。

你的策略：
1. 先礼貌承认边界："我更擅长帮你挑食材和农产品"
2. 找到自然的桥接点，将话题引向平台商品
3. 给出 1-2 个具体的 suggestedActions
4. 语气亲切不生硬，像朋友聊天而非客服话术
```

**核心原则**：所有对话最终导向购买行为，但不硬拉，先承认边界再柔性引导。

### 5.3 前端改动

前端不需要新增 UI 组件，复用现有 chat 回复卡片 + suggestedActions 按钮。

---

## 6. 实施顺序

### 6.1 分两期上线

**Phase 1：理解升级（不动数据模型）**

改动范围：
- 前后端类型定义：扩展 slots（6 个新槽位）、`AiVoiceIntent.fallbackReason`、`usage` → `usageScenario` 迁移
- 后端 LLM 管道：Flash/Plus 双 prompt、质量检查 + 条件升级逻辑
- `chatWithContext()` 注入 `fallbackReason` 分流逻辑
- 前端 `navigateByIntent.ts` 适配新槽位

降级策略：Product 没有语义字段，搜索引擎只用现有 `categoryHint → category` 匹配 + 关键词基础分。新槽位被抽取但暂不参与评分。

开关：`AI_SEMANTIC_SLOTS_ENABLED`，默认 `false`。先在测试环境和内部账号开启，验证日志稳定后再全量打开。

**Phase 2：数据模型 + 搜索评分**

前置条件：Phase 1 已上线稳定运行。

改动范围：
- Prisma Schema：Product 加 5 个语义字段
- AI 自动填充服务 + 存量批量填充任务
- 管理后台/卖家后台：语义字段编辑入口
- 搜索引擎：`computeSearchScore()` 加语义匹配分 + 三级降级
- Redis 排序信号缓存 + 定时刷新任务

开关拆分为两个：
- `AI_PRODUCT_SEMANTIC_FIELDS_ENABLED`：控制 AI 填充（可以先让填充跑着积累数据）
- `AI_SEMANTIC_SCORING_ENABLED`：控制搜索评分（填充稳定后再开）

### 6.2 依赖关系

```
Phase 1 类型定义 → Phase 1 LLM管道 → Phase 1 前端适配
                                          ↓
                                    Phase 1 稳定后
                                          ↓
Phase 2 Schema migration → Phase 2 AI填充 → Phase 2 搜索评分
                         → Phase 2 后台编辑入口
```

Phase 1 内部：类型先行，LLM 管道和前端可并行（不同文件）。
Phase 2 内部：Schema migration 先行，AI 填充和后台编辑可并行。

---

## 7. 管理后台与数据填充

### 7.1 编辑权限

- **卖家后台**：商品编辑页新增"语义标签"折叠区域，卖家可编辑自己商品的语义字段
- **管理后台**：商品审核/详情页展示语义字段，运营可覆盖任意语义字段

### 7.2 来源追踪（`semanticMeta`）

按字段独立记录来源，存入 Product 的 JSON `attributes` 字段：

```typescript
semanticMeta: {
  flavorTags: 'ai' | 'seller' | 'ops',
  seasonalMonths: 'ai' | 'seller' | 'ops',
  usageScenarios: 'ai' | 'seller' | 'ops',
  dietaryTags: 'ai' | 'seller' | 'ops',
  originRegion: 'ai' | 'seller' | 'ops',
}
```

覆盖规则：
- 卖家修改 → 该字段来源标记为 `seller`
- 运营修改 → 该字段来源标记为 `ops`
- AI 重跑时只更新来源为 `ai` 的字段，不覆盖 `seller` 或 `ops`
- 管理后台可一键"重新 AI 生成"，清除指定字段的来源标记

### 7.3 AI 自动填充触发时机

**两个触发点：**

1. **商品创建/更新后异步填充**
   - 商品保存成功后，发 Redis 队列异步任务
   - Worker 调用 Qwen-Flash，根据 `title + subtitle + description + category.name` 推断 5 个字段
   - 不阻塞上架流程，失败静默跳过

2. **存量批量填充（一次性）**
   - 上线后跑一次批量任务，筛选条件：5 个语义字段中至少 3 个为空
   - 分批处理（每批 50 个），控制 Qwen 调用频率

### 7.4 空字段商品处理

- 不强制卖家填写
- 卖家后台商品列表显示"语义标签待完善"提示
- 搜索评分不惩罚空字段，只是不加分

---

## 8. 验证与观测

### 8.1 核心评测样本集

| 输入 | 期望 intent | 期望关键槽位 |
|------|-----------|-----------|
| "找点新鲜海鲜" | search | categoryHint:海鲜, constraints:[fresh] |
| "有没有本地特产" | search | categoryHint:特产, originPreference:本地 |
| "今晚做饭买什么" | recommend | usageScenario:晚餐做饭 |
| "下雨天适合吃什么" | recommend | usageScenario:雨天暖食 |
| "帮我凑个满减" | recommend | promotionIntent:threshold-optimization |
| "推荐搭配商品" | recommend | bundleIntent:complement |
| "有机低糖的零食" | search | categoryHint:零食, constraints:[organic,low-sugar] |
| "山东的苹果" | search | categoryHint:苹果, originPreference:山东 |
| "今天去哪吃饭" | chat | fallbackReason:out-of-domain |
| "打开购物车" | navigate | targetPage:cart |

每次改 prompt 必须对样本集回归。

### 8.2 埋点日志结构

```typescript
{
  timestamp: string;
  userId?: string;
  transcript: string;                                    // ASR 转录文本
  pipeline: 'rule' | 'fast' | 'flash' | 'plus';         // 最终解析来源（非搜索降级层）
  wasUpgraded: boolean;                                  // Flash 是否升级到 Plus
  intent: string;
  confidence: number;
  slots: Record<string, any>;
  fallbackReason?: string;
  degradeLevel: 'A' | 'B' | 'C';                        // 搜索降级层（与 pipeline 独立）
  resultCount: number;
  userClicked: boolean;                                  // v1 先用布尔，后续扩展见下
  latencyMs: number;
}
```

> **后续扩展**：`userClicked` 将拆分为 `clickedActionType` / `clickedItemId` / `addToCart` / `purchase` 等细粒度前端事件。

### 8.3 成功指标

| 指标 | 含义 | 关注阈值 |
|------|------|---------|
| 搜索点击率 | 返回结果后用户点击比例 | > 40% 为健康 |
| 推荐转化率 | recommend 结果被加购/购买比例 | 持续观察趋势 |
| 澄清率 | 触发 clarify 的比例 | < 15% 为健康 |
| out-of-domain 占比 | fallbackReason:out-of-domain 比例 | 持续观察 |
| Plus 升级率 | Flash 升级到 Plus 的比例 | < 25% 控制成本 |
| Level C 降级率 | 搜索降级到 chat 兜底的比例 | < 10% 为健康 |
| 平均延迟 | 转录完成到结果返回 | P50 < 500ms, P95 < 2s |

### 8.4 观测工具

B 阶段：后端日志写入现有日志系统，按 `pipeline` / `intent` / `wasUpgraded` / `degradeLevel` 维度可查。
C 阶段：管理后台新增"AI 意图分析"页面，展示指标趋势图。

---

## 设计约束与硬性要求

- **成本控制**：绝大多数请求走 Flash（规则和 Fast 层先拦截），仅复杂表达升级 Plus，Plus 升级率 < 25%
- **延迟优先**：规则 ~0ms → Fast ~50ms → Flash ~300ms → Plus ~1.5s，越快越好，分级 loading 消息缓解感知延迟
- **向后兼容**：所有新字段有默认值，空字段不扣分只是不加分，开关关闭时行为与改造前一致
- **数据隔离**：语义属性（flavorTags 等）是商品本体事实，排序信号（hotScore 等）是派生值，分层存储
- **商业导向**：所有对话最终导向购买行为，out-of-domain 先承认边界再柔性引导
