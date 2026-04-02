# 语义意图理解升级 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 语音意图系统从关键词匹配升级为结构化语义理解，分两期上线（Phase 1 理解升级 → Phase 2 数据模型+评分）

**Architecture:** 保留现有三级管道（规则→Fast→LLM），在 LLM 层增加 Flash→Plus 条件升级、7 个新语义槽位、fallbackReason 分流。Phase 2 给 Product 加 5 个语义字段 + 多维评分引擎。

**Tech Stack:** NestJS / Prisma / Qwen-Flash & Qwen-Plus / TypeScript / React Native / React + Ant Design

**Spec:** `docs/superpowers/specs/2026-03-15-semantic-intent-design.md`

---

## File Structure

### Phase 1: 理解升级

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/src/modules/ai/voice-intent.types.ts` | Modify | 新增 7 个槽位 + chatResponse 类型 |
| `src/types/domain/Ai.ts` | Modify | 前端类型同步 |
| `backend/src/modules/ai/ai.service.ts` | Modify | Flash/Plus 双 prompt + 质量检查 + fallbackReason 分流 |
| `backend/src/modules/ai/semantic-slot.constants.ts` | Create | 语义槽位常量（高价值槽位列表、Flash/Plus prompt 模板） |
| `src/utils/navigateByIntent.ts` | Modify | 适配新槽位 |
| `src/hooks/useVoiceRecording.ts` | Modify | 处理 chatResponse 跳转 |

### Phase 2: 数据模型 + 搜索评分

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/prisma/schema.prisma` | Modify | Product 加 5 个语义字段 |
| `backend/src/modules/product/product.service.ts` | Modify | 多维评分 + 降级逻辑 |
| `backend/src/modules/product/semantic-score.ts` | Create | 语义评分独立模块 |
| `backend/src/modules/product/semantic-fill.service.ts` | Create | AI 自动填充服务（fire-and-forget async，不用 Redis 队列） |
| `backend/src/modules/seller/products/seller-products.service.ts` | Modify | create/update 后触发填充任务 |
| `backend/src/modules/seller/products/seller-products.dto.ts` | Modify | DTO 加语义字段 |
| `seller/src/pages/products/edit.tsx` | Modify | 卖家后台语义标签编辑区 |
| `admin/src/pages/products/edit.tsx` | Modify | 管理后台语义字段编辑 |

---

## Chunk 1: Phase 1 — 类型系统与槽位扩展

### Task 1: 后端类型定义扩展

**Files:**
- Modify: `backend/src/modules/ai/voice-intent.types.ts:33-43` (AiVoiceDemandSlots)
- Modify: `backend/src/modules/ai/voice-intent.types.ts:96-117` (AiVoiceResolved)
- Modify: `backend/src/modules/ai/voice-intent.types.ts:162-178` (AiVoiceIntent)

- [ ] **Step 1: 扩展 AiVoiceDemandSlots 新增 7 个槽位**

在 `voice-intent.types.ts` 的 `AiVoiceDemandSlots` 接口（line 33）中，在现有 `usage` 字段后新增：

```typescript
// voice-intent.types.ts — AiVoiceDemandSlots 内部，line ~38 后追加

/** @deprecated 使用 usageScenario 替代 */
usage?: string;

/** 使用场景（替代 usage）："做饭"、"送礼"、"野餐" */
usageScenario?: string;
/** 促销意图 */
promotionIntent?: 'threshold-optimization' | 'best-deal';
/** 搭配意图 */
bundleIntent?: 'meal-kit' | 'complement';
/** 饮食偏好："素食"、"低卡"、"高蛋白" */
dietaryPreference?: string;
/** 新鲜度要求："当天"、"活的"、"冷冻也行" */
freshness?: string;
/** 产地偏好（用户需求侧）："本地"、"进口"、"山东" */
originPreference?: string;
/** 口味偏好："甜的"、"脆的"、"鲜美" */
flavorPreference?: string;
```

- [ ] **Step 2: 扩展 AiVoiceResolved 新增 resolved 字段**

在 `AiVoiceResolved` 接口（line 96）中追加：

```typescript
usageScenario?: string;
originPreference?: string;
dietaryPreference?: string;
promotionIntent?: 'threshold-optimization' | 'best-deal';
bundleIntent?: 'meal-kit' | 'complement';
```

- [ ] **Step 3: 扩展 AiVoiceIntent 新增 chatResponse**

在 `AiVoiceIntent` 接口（line 162）中追加：

```typescript
/** out-of-domain 引导式回复（含 suggestedActions） */
chatResponse?: {
  reply: string;
  suggestedActions: Array<{
    type: 'search' | 'navigate' | 'company' | 'recommend';
    label: string;
    resolved?: Record<string, any>;
  }>;
};
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误（或仅现有警告）

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/voice-intent.types.ts
git commit -m "feat(ai): extend voice intent slots with 7 semantic fields + chatResponse"
```

---

### Task 2: 前端类型定义同步

**Files:**
- Modify: `src/types/domain/Ai.ts:130-140` (AiVoiceDemandSlots)
- Modify: `src/types/domain/Ai.ts:192-213` (AiVoiceResolved)
- Modify: `src/types/domain/Ai.ts:247-278` (AiVoiceIntent)

- [ ] **Step 1: 前端 AiVoiceDemandSlots 同步新增 7 个槽位**

在 `src/types/domain/Ai.ts` 的 `AiVoiceDemandSlots` 类型（line ~133 附近 `usage` 字段）后新增：

```typescript
/** @deprecated 使用 usageScenario 替代 */
usage?: string;

/** 使用场景（替代 usage） */
usageScenario?: string;
/** 促销意图 */
promotionIntent?: 'threshold-optimization' | 'best-deal';
/** 搭配意图 */
bundleIntent?: 'meal-kit' | 'complement';
/** 饮食偏好 */
dietaryPreference?: string;
/** 新鲜度要求 */
freshness?: string;
/** 产地偏好（用户需求侧） */
originPreference?: string;
/** 口味偏好 */
flavorPreference?: string;
```

- [ ] **Step 2: 前端 AiVoiceResolved 同步新增 resolved 字段**

在 `AiVoiceResolved` 类型（line 192）中追加：

```typescript
usageScenario?: string;
originPreference?: string;
dietaryPreference?: string;
promotionIntent?: 'threshold-optimization' | 'best-deal';
bundleIntent?: 'meal-kit' | 'complement';
```

- [ ] **Step 3: 前端 AiVoiceIntent 新增 chatResponse**

在 `AiVoiceIntent` 类型（line 247）中追加：

```typescript
/** out-of-domain 引导式回复 */
chatResponse?: {
  reply: string;
  suggestedActions: AiSuggestedAction[];
};
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/types/domain/Ai.ts
git commit -m "feat(ai): sync frontend types with 7 semantic slots + chatResponse"
```

---

### Task 3: 语义槽位常量文件

**Files:**
- Create: `backend/src/modules/ai/semantic-slot.constants.ts`

- [ ] **Step 1: 创建常量文件**

```typescript
// backend/src/modules/ai/semantic-slot.constants.ts

/** 高价值槽位列表 — 质量检查时用于判断 Flash 结果是否贫瘠 */
export const HIGH_VALUE_SLOTS = [
  'usageScenario',
  'promotionIntent',
  'bundleIntent',
  'originPreference',
  'freshness',
  'dietaryPreference',
  'flavorPreference',
  'budget',
  'audience',
] as const;

/** Flash 分类+抽取 prompt（短、快、保守） */
export const FLASH_SEMANTIC_PROMPT = `你是爱买买App的语义理解器。将用户语音转录解析为结构化意图。
固定类型：navigate / search / company / transaction / recommend / chat
抽取对应槽位，未明确的字段留空。不要猜测不确定的内容。

输出 JSON：
{
  "intent": "search|recommend|navigate|transaction|company|chat",
  "confidence": 0.xx,
  "slots": {
    "query": "显式搜索词（无则null）",
    "categoryHint": "隐含品类（无则null）",
    "constraints": ["organic","fresh","low-sugar","seasonal","traceable","cold-chain","geo-certified","healthy"],
    "usageScenario": "使用场景",
    "dietaryPreference": "饮食偏好",
    "freshness": "新鲜度要求",
    "originPreference": "产地偏好",
    "flavorPreference": "口味偏好",
    "promotionIntent": "threshold-optimization|best-deal|null",
    "bundleIntent": "meal-kit|complement|null",
    "audience": "目标人群",
    "budget": null,
    "recommendThemes": ["hot","discount","tasty","seasonal","recent"]
  },
  "fallbackReason": "out-of-domain|too-vague|unsafe|null"
}`;

/** Plus 深度推断 prompt（补全隐含需求） */
export const PLUS_SEMANTIC_PROMPT = `你是爱买买App的语义理解器。将用户自然语言解析为结构化意图。
即使用户没说出具体商品名，也要尽力推断隐含需求。

例如：
- "今晚做饭买什么" → intent:"recommend", usageScenario:"晚餐做饭"
- "下雨天适合吃什么" → intent:"recommend", usageScenario:"雨天暖食"
- "帮我凑个满减" → intent:"recommend", promotionIntent:"threshold-optimization"
- "有没有本地特产" → intent:"search", categoryHint:"特产", originPreference:"本地"
- "找点新鲜海鲜" → intent:"search", categoryHint:"海鲜", constraints:["fresh"]

与农产品/电商/平台无关的问题，intent 设为 "chat"，fallbackReason 设为 "out-of-domain"。
表达太模糊无法判断任何意图时，fallbackReason 设为 "too-vague"。

固定类型：navigate / search / company / transaction / recommend / chat

输出 JSON：
{
  "intent": "search|recommend|navigate|transaction|company|chat",
  "confidence": 0.xx,
  "slots": {
    "query": "显式搜索词（无则null）",
    "categoryHint": "隐含品类（无则null）",
    "constraints": ["organic","fresh","low-sugar","seasonal","traceable","cold-chain","geo-certified","healthy"],
    "usageScenario": "使用场景",
    "dietaryPreference": "饮食偏好",
    "freshness": "新鲜度要求",
    "originPreference": "产地偏好",
    "flavorPreference": "口味偏好",
    "promotionIntent": "threshold-optimization|best-deal|null",
    "bundleIntent": "meal-kit|complement|null",
    "audience": "目标人群",
    "budget": null,
    "recommendThemes": ["hot","discount","tasty","seasonal","recent"]
  },
  "fallbackReason": "out-of-domain|too-vague|unsafe|null"
}`;

/** out-of-domain 引导式 bridge prompt */
export const OUT_OF_DOMAIN_BRIDGE_PROMPT = `你是爱买买App的AI助手，专注于农产品和食材推荐。
用户刚刚问了一个和平台无关的问题。

你的策略：
1. 先礼貌承认边界："我更擅长帮你挑食材和农产品"
2. 找到自然的桥接点，将话题引向平台商品
3. 给出 1-2 个具体的 suggestedActions
4. 语气亲切不生硬，像朋友聊天而非客服话术
5. 不要硬拉，先承认边界再柔性引导

输出 JSON：
{
  "reply": "自然语言回复",
  "suggestedActions": [
    { "type": "search|recommend", "label": "按钮显示文字", "resolved": { "query": "搜索词" } }
  ]
}`;

/** Flash 质量检查：判断结果是否足够好 */
export function isFlashResultGood(
  confidence: number,
  slots: Record<string, any>,
): boolean {
  if (confidence < 0.7) return false;

  const hasCategoryHint = !!slots?.categoryHint;
  const hasHighValueSlot = HIGH_VALUE_SLOTS.some((k) => {
    const v = slots?.[k];
    return v !== undefined && v !== null && v !== '';
  });
  const hasConstraints =
    Array.isArray(slots?.constraints) && slots.constraints.length >= 1;

  // categoryHint 单独存在不算好结果（避免宽泛兜底类目）
  if (hasCategoryHint && (hasHighValueSlot || hasConstraints)) return true;
  // 有高价值槽位，即使没有 categoryHint 也算好结果
  if (hasHighValueSlot) return true;
  // 有 constraints 也算好结果
  if (hasConstraints) return true;

  return false;
}
```

- [ ] **Step 2: 验证编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/ai/semantic-slot.constants.ts
git commit -m "feat(ai): add semantic slot constants, prompts, and quality checker"
```

---

## Chunk 2: Phase 1 — LLM 管道升级

### Task 4: ai.service.ts — Flash/Plus 双层 + fallbackReason 分流

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts:2713` (qwenIntentClassify)
- Modify: `backend/src/modules/ai/ai.service.ts:1617` (buildDemandSlots)
- Modify: `backend/src/modules/ai/ai.service.ts:1408` (handleChatClassification)
- Modify: `backend/src/modules/ai/ai.service.ts:545` (classifyIntent)

- [ ] **Step 1: 在 classifyIntent() 中加入语义槽位开关检查**

在 `classifyIntent()` 方法（line 545）中，找到调用 `qwenIntentClassify()` 的位置。在调用前加入环境变量检查：

```typescript
// ai.service.ts — classifyIntent() 内部，Qwen 分类调用前

const semanticSlotsEnabled =
  this.configService.get('AI_SEMANTIC_SLOTS_ENABLED') === 'true';
```

将此标志传递给 `qwenIntentClassify()` 调用（需要扩展方法签名为 `qwenIntentClassify(transcript: string, semanticSlotsEnabled: boolean)`）。

- [ ] **Step 1.5: 扩展 VoiceIntentClassification 返回类型**

在 `voice-intent.types.ts` 的 `VoiceIntentClassification` 接口（line ~151）中追加：

```typescript
/** 最终解析来源（非搜索降级层） */
pipeline?: 'rule' | 'fast' | 'flash' | 'plus';
/** Flash 是否升级到 Plus */
wasUpgraded?: boolean;
```

- [ ] **Step 2: 改造 qwenIntentClassify() 支持双层 prompt**

在 `qwenIntentClassify()` 方法（line 2713）中：

```typescript
// ai.service.ts — qwenIntentClassify() 改造

import {
  FLASH_SEMANTIC_PROMPT,
  PLUS_SEMANTIC_PROMPT,
  isFlashResultGood,
} from './semantic-slot.constants';

// 如果语义槽位开关开启，使用新 prompt
if (semanticSlotsEnabled) {
  // Step 1: Flash 分类+抽取
  const flashResult = await this.callQwenModel(
    this.configService.get('AI_INTENT_MODEL') || 'qwen-flash',
    FLASH_SEMANTIC_PROMPT,
    transcript,
  );

  const parsed = this.parseJsonResponse(flashResult);
  if (parsed && isFlashResultGood(parsed.confidence, parsed.slots)) {
    // 好结果，直接使用
    return {
      intent: parsed.intent,
      confidence: parsed.confidence,
      slots: parsed.slots,
      fallbackReason: parsed.fallbackReason || undefined,
      pipeline: 'flash',
    };
  }

  // Step 2: 差结果，升级 Plus（replacement 模式，从头重做）
  const plusResult = await this.callQwenModel(
    this.configService.get('AI_RECOMMEND_MODEL') || 'qwen-plus',
    PLUS_SEMANTIC_PROMPT,
    transcript,
  );

  const plusParsed = this.parseJsonResponse(plusResult);
  if (plusParsed) {
    return {
      intent: plusParsed.intent,
      confidence: plusParsed.confidence,
      slots: plusParsed.slots,
      fallbackReason: plusParsed.fallbackReason || undefined,
      pipeline: 'plus',
      wasUpgraded: true,
    };
  }
}

// 开关关闭或解析失败：走原有逻辑
```

注意：具体实现时需要适配 `callQwenModel()` 的实际签名（可能叫 `callQwen()` 或类似名称），以及 `parseJsonResponse()` 的实际方法名。请查看 `qwenIntentClassify()` 当前实现来对齐。

- [ ] **Step 3: 改造 buildDemandSlots() 输出 usageScenario**

在 `buildDemandSlots()` 方法（line 1617）中，找到写入 `usage` 的位置，改为同时写入 `usageScenario`：

```typescript
// buildDemandSlots() 内部

// 旧：usage: extractedUsage,
// 新：
usageScenario: slots?.usageScenario || extractedUsage,  // 优先用 LLM 抽取的
usage: extractedUsage,  // 保留旧字段向后兼容
```

同时将新槽位透传到输出：

```typescript
originPreference: slots?.originPreference,
dietaryPreference: slots?.dietaryPreference,
freshness: slots?.freshness,
flavorPreference: slots?.flavorPreference,
promotionIntent: slots?.promotionIntent,
bundleIntent: slots?.bundleIntent,
```

- [ ] **Step 4: 改造 handleChatClassification() 支持 fallbackReason 分流**

在 `handleChatClassification()` 方法（line 1408）中，根据 `fallbackReason` 注入不同处理：

```typescript
// handleChatClassification() 内部

import { OUT_OF_DOMAIN_BRIDGE_PROMPT } from './semantic-slot.constants';

const fallbackReason = classifyResult.fallbackReason;

if (fallbackReason === 'out-of-domain') {
  // 调用 LLM 生成引导式回复
  const bridgeResult = await this.callQwenModel(
    this.configService.get('AI_CHAT_MODEL') || 'qwen-plus',
    OUT_OF_DOMAIN_BRIDGE_PROMPT,
    transcript,
  );
  const bridgeParsed = this.parseJsonResponse(bridgeResult);
  if (bridgeParsed) {
    return {
      type: 'chat',
      transcript,
      feedback: bridgeParsed.reply,
      fallbackReason: 'out-of-domain',
      chatResponse: {
        reply: bridgeParsed.reply,
        suggestedActions: bridgeParsed.suggestedActions || [],
      },
    };
  }
}

if (fallbackReason === 'too-vague') {
  return {
    type: 'chat',
    transcript,
    feedback: '你想找什么类型的商品呢？可以告诉我品类、用途或口味偏好',
    fallbackReason: 'too-vague',
  };
}

if (fallbackReason === 'unsafe') {
  return {
    type: 'chat',
    transcript,
    feedback: '这个问题我不太方便回答。需要我帮你找点好吃的吗？',
    fallbackReason: 'unsafe',
  };
}

// 无 fallbackReason：走现有 chat 逻辑
```

- [ ] **Step 5: 验证编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/ai.service.ts
git commit -m "feat(ai): add Flash→Plus escalation pipeline + fallbackReason routing"
```

---

### Task 5: 前端适配新槽位

**Files:**
- Modify: `src/utils/navigateByIntent.ts:50` (resolveSearchIntent)
- Modify: `src/hooks/useVoiceRecording.ts:520` (processIntent)

- [ ] **Step 1: navigateByIntent.ts 适配新槽位**

在 `resolveSearchIntent()` （line 50）中，将 `usage` 读取改为 `usageScenario`：

```typescript
// navigateByIntent.ts — resolveSearchIntent() 内部

// 旧：const usage = intent.slots?.usage;
// 新：
const usageScenario = intent.slots?.usageScenario || intent.slots?.usage;
```

将新的 resolved 字段透传到搜索参数：

```typescript
// 构建搜索参数时加入新字段
const searchParams = {
  ...existingParams,
  usageScenario: intent.resolved?.usageScenario,
  originPreference: intent.resolved?.originPreference,
  dietaryPreference: intent.resolved?.dietaryPreference,
};
```

- [ ] **Step 2: useVoiceRecording.ts 处理 chatResponse 跳转**

在 `processIntent()` 或 `applyIntentResult()` 中，检测 `chatResponse`：

```typescript
// useVoiceRecording.ts — 处理意图结果时

if (intentResult.chatResponse) {
  // 有 chatResponse 时跳转 chat 页面展示富交互内容
  router.push({
    pathname: '/ai/chat',
    params: {
      initialMessage: intentResult.chatResponse.reply,
      suggestedActions: JSON.stringify(intentResult.chatResponse.suggestedActions),
    },
  });
  return;
}
```

注意：具体路由 API 取决于 expo-router 的用法，请查看现有的 `router.push` 调用来对齐参数格式。

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/utils/navigateByIntent.ts src/hooks/useVoiceRecording.ts
git commit -m "feat(ai): adapt frontend to new semantic slots + chatResponse routing"
```

---

### Task 6: 埋点日志

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts` — classifyIntent() 返回处

- [ ] **Step 1: 在意图处理完成后记录结构化日志**

在 `classifyIntent()` 最终返回前，添加日志：

```typescript
// ai.service.ts — classifyIntent() 返回前

this.logger.log({
  message: 'voice-intent-processed',
  userId: userId || undefined,
  transcript,
  pipeline: result.pipeline || 'rule',  // 'rule' | 'fast' | 'flash' | 'plus'
  wasUpgraded: result.wasUpgraded || false,
  intent: result.type || result.intent,
  confidence: result.confidence,
  slots: result.slots,
  fallbackReason: result.fallbackReason,
  latencyMs: Date.now() - startTime,
});
```

注意：`startTime` 需要在 `classifyIntent()` 入口处捕获 `const startTime = Date.now()`。`degradeLevel` 和 `resultCount` 在搜索执行阶段补充（不在分类阶段）。

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/ai/ai.service.ts
git commit -m "feat(ai): add structured logging for intent pipeline telemetry"
```

---

## Chunk 3: Phase 2 — Product Schema + AI 填充

### Task 7: Prisma Schema 迁移

**Files:**
- Modify: `backend/prisma/schema.prisma:1007-1008` (Product model)

- [ ] **Step 1: Product model 新增 5 个语义字段**

在 `backend/prisma/schema.prisma` 的 Product model（line 990）中，在 `aiKeywords` 字段（line 1008）后追加：

```prisma
  // 语义匹配字段（AI 辅助填充 + 人工可改）
  flavorTags      String[]           @default([])
  seasonalMonths  Int[]              @default([])
  usageScenarios  String[]           @default([])
  dietaryTags     String[]           @default([])
  originRegion    String?
```

- [ ] **Step 2: 生成并应用 migration**

Run: `cd backend && npx prisma migrate dev --name add_product_semantic_fields`
Expected: Migration created and applied successfully

- [ ] **Step 3: 验证 Prisma validate**

Run: `cd backend && npx prisma validate`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(product): add 5 semantic fields to Product schema"
```

---

### Task 8: AI 语义字段自动填充服务

**Files:**
- Create: `backend/src/modules/product/semantic-fill.service.ts`

- [ ] **Step 1: 创建填充服务**

```typescript
// backend/src/modules/product/semantic-fill.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class SemanticFillService {
  private readonly logger = new Logger(SemanticFillService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private aiService: AiService,
  ) {}

  /**
   * 对单个商品进行语义字段 AI 填充
   * 只更新 semanticMeta 来源为 'ai' 的字段，不覆盖 seller/ops 手动修改
   */
  async fillProduct(productId: string): Promise<void> {
    const enabled =
      this.configService.get('AI_PRODUCT_SEMANTIC_FIELDS_ENABLED') === 'true';
    if (!enabled) return;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (!product) return;

    // 读取现有 semanticMeta
    const attrs = (product.attributes as Record<string, any>) || {};
    const meta = (attrs.semanticMeta as Record<string, string>) || {};

    // 构建 AI 输入
    const input = [
      product.title,
      product.subtitle,
      product.description,
      product.category?.name,
    ]
      .filter(Boolean)
      .join(' | ');

    try {
      // 调用 Qwen-Flash 推断语义字段
      const result = await this.callQwenForSemanticFill(input);
      if (!result) return;

      // 构建更新数据：只更新来源为 ai 的字段
      const updateData: Record<string, any> = {};
      const newMeta = { ...meta };

      if (meta.flavorTags !== 'seller' && meta.flavorTags !== 'ops' && result.flavorTags?.length) {
        updateData.flavorTags = result.flavorTags;
        newMeta.flavorTags = 'ai';
      }
      if (meta.seasonalMonths !== 'seller' && meta.seasonalMonths !== 'ops' && result.seasonalMonths?.length) {
        // 校验 1-12
        const valid = result.seasonalMonths.filter((m: number) => m >= 1 && m <= 12);
        if (valid.length) {
          updateData.seasonalMonths = valid;
          newMeta.seasonalMonths = 'ai';
        }
      }
      if (meta.usageScenarios !== 'seller' && meta.usageScenarios !== 'ops' && result.usageScenarios?.length) {
        updateData.usageScenarios = result.usageScenarios;
        newMeta.usageScenarios = 'ai';
      }
      if (meta.dietaryTags !== 'seller' && meta.dietaryTags !== 'ops' && result.dietaryTags?.length) {
        updateData.dietaryTags = result.dietaryTags;
        newMeta.dietaryTags = 'ai';
      }
      if (meta.originRegion !== 'seller' && meta.originRegion !== 'ops' && result.originRegion) {
        updateData.originRegion = result.originRegion;
        newMeta.originRegion = 'ai';
      }

      if (Object.keys(updateData).length === 0) return;

      // 写入 semanticMeta 到 attributes JSON
      updateData.attributes = {
        ...attrs,
        semanticMeta: newMeta,
      };

      await this.prisma.product.update({
        where: { id: productId },
        data: updateData,
      });

      this.logger.log(`Semantic fill completed for product ${productId}`);
    } catch (err) {
      // 静默跳过，不阻塞业务
      this.logger.warn(`Semantic fill failed for product ${productId}: ${err.message}`);
    }
  }

  /**
   * 批量填充：筛选语义字段至少 3 个为空的商品
   */
  async batchFill(batchSize = 50): Promise<number> {
    // 查找需要填充的商品
    const products = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
      },
      select: {
        id: true,
        flavorTags: true,
        seasonalMonths: true,
        usageScenarios: true,
        dietaryTags: true,
        originRegion: true,
      },
      take: batchSize,
    });

    // 过滤：至少 3 个字段为空
    const needsFill = products.filter((p) => {
      let emptyCount = 0;
      if (!p.flavorTags?.length) emptyCount++;
      if (!p.seasonalMonths?.length) emptyCount++;
      if (!p.usageScenarios?.length) emptyCount++;
      if (!p.dietaryTags?.length) emptyCount++;
      if (!p.originRegion) emptyCount++;
      return emptyCount >= 3;
    });

    let filled = 0;
    for (const p of needsFill) {
      await this.fillProduct(p.id);
      filled++;
      // 控制频率：每个商品间隔 200ms
      await new Promise((r) => setTimeout(r, 200));
    }

    this.logger.log(`Batch fill completed: ${filled}/${needsFill.length} products`);
    return filled;
  }

  private async callQwenForSemanticFill(input: string): Promise<any> {
    // 复用现有的 Qwen 调用基础设施
    // 实现时对齐 ai.service.ts 中的 callQwenModel/callQwen 方法签名
    // prompt 指导 Qwen 从商品信息推断语义字段
    const systemPrompt = `你是商品语义标注器。根据商品信息推断以下字段。
只返回 JSON，不确定的字段留空数组或 null。

输出格式：
{
  "flavorTags": ["甜","脆"],
  "seasonalMonths": [6,7,8],
  "usageScenarios": ["做饭","送礼"],
  "dietaryTags": ["有机","低糖"],
  "originRegion": "山东青岛"
}`;

    const model = this.configService.get('AI_INTENT_MODEL') || 'qwen-flash';
    // 复用 AiService 已有的 Qwen 调用方法（具体方法名对齐 ai.service.ts 实现）
    const raw = await this.aiService.callQwenModel(model, systemPrompt, input);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
```

注意：`callQwenModel` 需要在 `AiService` 中标记为 `public`（如当前为 `private`，改为 `public`）。`ProductModule` 需要 import `AiModule`（或 forwardRef 避免循环依赖，因 `AiModule` 已 import `ProductModule`）。

- [ ] **Step 2: 注册到 ProductModule**

在 `backend/src/modules/product/product.module.ts` 中添加 `SemanticFillService` 到 providers 和 exports。

- [ ] **Step 3: 验证编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/product/semantic-fill.service.ts backend/src/modules/product/product.module.ts
git commit -m "feat(product): add semantic field AI auto-fill service"
```

---

### Task 9: 商品创建/更新后触发异步填充

**Files:**
- Modify: `backend/src/modules/seller/products/seller-products.service.ts:76` (create)
- Modify: `backend/src/modules/seller/products/seller-products.service.ts:163` (update)
- Modify: `backend/src/modules/seller/products/seller-products.dto.ts`

- [ ] **Step 1: DTO 新增语义字段**

在 `seller-products.dto.ts` 的 `CreateProductDto` 和 `UpdateProductDto` 中追加可选字段：

```typescript
// seller-products.dto.ts

@IsOptional()
@IsArray()
flavorTags?: string[];

@IsOptional()
@IsArray()
seasonalMonths?: number[];

@IsOptional()
@IsArray()
usageScenarios?: string[];

@IsOptional()
@IsArray()
dietaryTags?: string[];

@IsOptional()
@IsString()
originRegion?: string;
```

- [ ] **Step 2: create() 和 update() 中写入语义字段并触发填充**

在 `seller-products.service.ts` 的 `create()` 方法（line 94）的 `tx.product.create` data 中追加：

```typescript
// create() — tx.product.create data 中追加
flavorTags: dto.flavorTags ?? [],
seasonalMonths: dto.seasonalMonths ?? [],
usageScenarios: dto.usageScenarios ?? [],
dietaryTags: dto.dietaryTags ?? [],
originRegion: dto.originRegion,
```

在 `update()` 方法（line 172）的 `tx.product.update` data 中追加同样的字段。

在 create/update 事务完成后，触发异步填充：

```typescript
// create() 方法最后，return product 前

// 异步触发 AI 语义填充（不阻塞返回）
this.semanticFillService.fillProduct(product.id).catch((err) => {
  this.logger.warn(`Async semantic fill failed: ${err.message}`);
});

return product;
```

需要在 `SellerProductsService` constructor 中注入 `SemanticFillService`。

- [ ] **Step 3: 卖家手动修改时更新 semanticMeta 来源**

当 DTO 中传入了语义字段（卖家主动填写），标记来源为 `seller`：

```typescript
// create() 或 update() 中，写入 attributes 时

const semanticMeta: Record<string, string> = {};
if (dto.flavorTags) semanticMeta.flavorTags = 'seller';
if (dto.seasonalMonths) semanticMeta.seasonalMonths = 'seller';
if (dto.usageScenarios) semanticMeta.usageScenarios = 'seller';
if (dto.dietaryTags) semanticMeta.dietaryTags = 'seller';
if (dto.originRegion) semanticMeta.originRegion = 'seller';

if (Object.keys(semanticMeta).length > 0) {
  const existingAttrs = (product.attributes as Record<string, any>) || {};
  const existingMeta = existingAttrs.semanticMeta || {};
  data.attributes = {
    ...existingAttrs,
    semanticMeta: { ...existingMeta, ...semanticMeta },
  };
}
```

- [ ] **Step 4: 验证编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/seller/products/
git commit -m "feat(seller): add semantic fields to product DTO + trigger async fill"
```

---

## Chunk 4: Phase 2 — 搜索评分引擎 + 后台编辑

### Task 10: 语义评分模块

**Files:**
- Create: `backend/src/modules/product/semantic-score.ts`

- [ ] **Step 1: 创建独立评分模块**

```typescript
// backend/src/modules/product/semantic-score.ts

/**
 * 语义匹配评分 — 根据槽位与商品字段的交集计算加分
 * 只加分不扣分，空字段商品不被惩罚
 */

/** 评分权重常量（可调整） */
export const SEMANTIC_WEIGHTS = {
  categoryHint: 20,
  usageScenario: 20,
  originPreference: 15,
  constraintPerItem: 10,
  dietaryPreference: 10,
  seasonalMonth: 10,
  flavorPreference: 8,
} as const;

export interface SemanticSlots {
  categoryHint?: string;
  usageScenario?: string;
  originPreference?: string;
  constraints?: string[];
  dietaryPreference?: string;
  flavorPreference?: string;
  promotionIntent?: string;
}

export interface ProductSemanticFields {
  categoryName?: string;
  categoryPath?: string;
  usageScenarios: string[];
  originRegion?: string | null;
  dietaryTags: string[];
  flavorTags: string[];
  seasonalMonths: number[];
}

/**
 * 计算语义匹配分
 * @returns { score: number, matchedDimensions: number }
 */
export function computeSemanticScore(
  slots: SemanticSlots,
  product: ProductSemanticFields,
): { score: number; matchedDimensions: number } {
  let score = 0;
  let matchedDimensions = 0;

  // categoryHint → category.name/path
  if (slots.categoryHint && product.categoryName) {
    const hint = slots.categoryHint.toLowerCase();
    const name = product.categoryName.toLowerCase();
    const path = (product.categoryPath || '').toLowerCase();
    if (name.includes(hint) || path.includes(hint)) {
      score += SEMANTIC_WEIGHTS.categoryHint;
      matchedDimensions++;
    }
  }

  // usageScenario → usageScenarios[]
  if (slots.usageScenario && product.usageScenarios.length > 0) {
    const scenario = slots.usageScenario.toLowerCase();
    if (product.usageScenarios.some((s) => s.includes(scenario) || scenario.includes(s))) {
      score += SEMANTIC_WEIGHTS.usageScenario;
      matchedDimensions++;
    }
  }

  // originPreference → originRegion
  if (slots.originPreference && product.originRegion) {
    const pref = slots.originPreference.toLowerCase();
    const region = product.originRegion.toLowerCase();
    if (region.includes(pref) || pref.includes(region)) {
      score += SEMANTIC_WEIGHTS.originPreference;
      matchedDimensions++;
    }
  }

  // constraints → dietaryTags（交集，每命中一项 +10）
  if (slots.constraints?.length && product.dietaryTags.length > 0) {
    const hits = slots.constraints.filter((c) =>
      product.dietaryTags.some((t) => t.includes(c) || c.includes(t)),
    );
    if (hits.length > 0) {
      score += hits.length * SEMANTIC_WEIGHTS.constraintPerItem;
      matchedDimensions++;
    }
  }

  // dietaryPreference → dietaryTags
  if (slots.dietaryPreference && product.dietaryTags.length > 0) {
    const pref = slots.dietaryPreference.toLowerCase();
    if (product.dietaryTags.some((t) => t.includes(pref) || pref.includes(t))) {
      score += SEMANTIC_WEIGHTS.dietaryPreference;
      matchedDimensions++;
    }
  }

  // seasonalMonths → 当前月
  if (product.seasonalMonths.length > 0) {
    const currentMonth = new Date().getMonth() + 1;
    if (product.seasonalMonths.includes(currentMonth)) {
      score += SEMANTIC_WEIGHTS.seasonalMonth;
      matchedDimensions++;
    }
  }

  // flavorPreference → flavorTags
  if (slots.flavorPreference && product.flavorTags.length > 0) {
    const pref = slots.flavorPreference.toLowerCase();
    if (product.flavorTags.some((t) => t.includes(pref) || pref.includes(t))) {
      score += SEMANTIC_WEIGHTS.flavorPreference;
      matchedDimensions++;
    }
  }

  return { score, matchedDimensions };
}

/**
 * 判断搜索降级层级
 */
export function determineDegradeLevel(
  slots: SemanticSlots,
  matchedDimensions: number,
): 'A' | 'B' | 'C' {
  const hasCategoryHint = !!slots.categoryHint;
  const hasScenarioSlots = !!(
    slots.usageScenario ||
    slots.dietaryPreference ||
    slots.originPreference
  );
  const hasBudgetOrPromo = !!(slots.promotionIntent);

  // Level A: 多维匹配
  if (hasCategoryHint && matchedDimensions >= 1) return 'A';
  if (!hasCategoryHint && matchedDimensions >= 2) return 'A';

  // Level B: 宽泛搜索或推荐兜底
  if (hasCategoryHint) return 'B';
  if (hasScenarioSlots || hasBudgetOrPromo) return 'B';

  // Level C: Chat 兜底
  return 'C';
}
```

- [ ] **Step 2: 验证编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/product/semantic-score.ts
git commit -m "feat(product): add semantic scoring module with weights and degrade levels"
```

---

### Task 11: 集成语义评分到 product.service.ts

**Files:**
- Modify: `backend/src/modules/product/product.service.ts:594` (computeSearchScore)

- [ ] **Step 1: 在 computeSearchScore() 中叠加语义分**

在 `computeSearchScore()` 方法（line 594）中，在现有关键词评分后：

```typescript
// product.service.ts — computeSearchScore() 内部

import { computeSemanticScore, determineDegradeLevel } from './semantic-score';

const scoringEnabled =
  this.configService.get('AI_SEMANTIC_SCORING_ENABLED') === 'true';

if (scoringEnabled && slots) {
  const semanticFields: ProductSemanticFields = {
    categoryName: product.category?.name,
    categoryPath: product.category?.path,
    usageScenarios: product.usageScenarios || [],
    originRegion: product.originRegion,
    dietaryTags: product.dietaryTags || [],
    flavorTags: product.flavorTags || [],
    seasonalMonths: product.seasonalMonths || [],
  };

  const { score: semanticScore } = computeSemanticScore(slots, semanticFields);
  totalScore += semanticScore;
}
```

注意：需要确保 Prisma query 的 `include` 或 `select` 包含新的 5 个语义字段。检查 `findMany` 调用是否需要更新。

- [ ] **Step 2: 在搜索主流程中加入降级判断和日志**

在 `product.service.ts` 的搜索方法（调用 `computeSearchScore` 的位置）中，评分完成后：

```typescript
// product.service.ts — 搜索结果评分后

import { determineDegradeLevel, type SemanticSlots } from './semantic-score';

const { matchedDimensions } = computeSemanticScore(slots, semanticFields);
const degradeLevel = determineDegradeLevel(slots as SemanticSlots, matchedDimensions);

// Level C 时返回空结果 + degradeLevel 标记，由 ai.service.ts 的调用方检查
// ai.service.ts 收到 degradeLevel='C' 后交给 handleChatClassification() 兜底
if (degradeLevel === 'C' && results.length === 0) {
  return { products: [], degradeLevel: 'C', resultCount: 0 };
}

// 记录搜索阶段日志（补充 degradeLevel 和 resultCount）
this.logger.log({
  message: 'search-scored',
  degradeLevel,
  resultCount: results.length,
  matchedDimensions,
});
```

- [ ] **Step 3: 排序信号分（热度、折扣）**

在评分中追加动态计算的排序信号：

```typescript
// 折扣分
if (product.basePrice && product.skus?.[0]?.price) {
  const discountRate = (product.basePrice - product.skus[0].price) / product.basePrice;
  if (discountRate > 0) {
    totalScore += 10 + discountRate * 15;
  }
}

// 热度分：Phase 2 暂不实现 Redis 缓存，使用简单的 createdAt 新鲜度替代
// Redis 热度缓存 + 定时刷新将在 C 阶段实现（需要订单/浏览/收藏数据积累）
const daysSinceCreated = (Date.now() - new Date(product.createdAt).getTime()) / 86400000;
if (daysSinceCreated < 7) {
  totalScore += Math.round((7 - daysSinceCreated) / 7 * 10); // 最新商品最高 +10
}
```

- [ ] **Step 4: 验证编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/product/product.service.ts
git commit -m "feat(product): integrate semantic scoring into search pipeline"
```

---

### Task 12: 卖家后台语义字段编辑

**Files:**
- Modify: `seller/src/pages/products/edit.tsx`
- Modify: `seller/src/api/products.ts`（如存在）

- [ ] **Step 1: 商品编辑页新增"语义标签"折叠区域**

在商品编辑表单中，追加一个折叠面板（Collapse/Panel）：

```tsx
// seller/src/pages/products/edit.tsx — 表单内追加

<ProForm.Group title="语义标签（AI 搜索优化）" collapsible defaultCollapsed>
  <ProFormSelect
    name="flavorTags"
    label="口味标签"
    mode="tags"
    placeholder="如：甜、脆、鲜、香辣"
    fieldProps={{ tokenSeparators: [',', '，'] }}
  />
  <ProFormSelect
    name="seasonalMonths"
    label="应季月份"
    mode="multiple"
    options={Array.from({ length: 12 }, (_, i) => ({
      label: `${i + 1}月`,
      value: i + 1,
    }))}
  />
  <ProFormSelect
    name="usageScenarios"
    label="适用场景"
    mode="tags"
    placeholder="如：做饭、送礼、火锅、沙拉"
    fieldProps={{ tokenSeparators: [',', '，'] }}
  />
  <ProFormSelect
    name="dietaryTags"
    label="饮食属性"
    mode="tags"
    placeholder="如：有机、低糖、高蛋白、素食"
    fieldProps={{ tokenSeparators: [',', '，'] }}
  />
  <ProFormText
    name="originRegion"
    label="产地"
    placeholder="如：山东青岛"
  />
</ProForm.Group>
```

注意：具体组件 API 取决于 `@ant-design/pro-components` 的版本。请查看 `edit.tsx` 现有的表单结构来对齐。

- [ ] **Step 2: API 层同步**

确保 `seller/src/api/products.ts`（如存在）的 create/update 请求体包含新字段。

- [ ] **Step 3: 验证编译**

Run: `cd seller && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add seller/src/pages/products/edit.tsx seller/src/api/products.ts
git commit -m "feat(seller): add semantic tag editing section to product form"
```

---

### Task 13: 管理后台语义字段编辑

**Files:**
- Modify: `admin/src/pages/products/edit.tsx`
- Modify: 管理端商品 Controller（路径需实现时确认，可能为 `backend/src/modules/admin/products/` 下）

- [ ] **Step 1: 管理后台商品编辑页新增语义字段表单**

在 `admin/src/pages/products/edit.tsx` 表单中追加折叠区域（与 Task 12 相同的 5 个字段）：

```tsx
<ProForm.Group title="语义标签（AI 搜索优化）" collapsible defaultCollapsed>
  <ProFormSelect name="flavorTags" label="口味标签" mode="tags"
    placeholder="如：甜、脆、鲜、香辣" fieldProps={{ tokenSeparators: [',', '，'] }} />
  <ProFormSelect name="seasonalMonths" label="应季月份" mode="multiple"
    options={Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, value: i + 1 }))} />
  <ProFormSelect name="usageScenarios" label="适用场景" mode="tags"
    placeholder="如：做饭、送礼、火锅、沙拉" fieldProps={{ tokenSeparators: [',', '，'] }} />
  <ProFormSelect name="dietaryTags" label="饮食属性" mode="tags"
    placeholder="如：有机、低糖、高蛋白、素食" fieldProps={{ tokenSeparators: [',', '，'] }} />
  <ProFormText name="originRegion" label="产地" placeholder="如：山东青岛" />
  <Button onClick={async () => {
    await api.post(`/admin/products/${productId}/refill-semantic`);
    message.success('已触发 AI 重新生成');
    refresh();
  }}>重新 AI 生成</Button>
</ProForm.Group>
```

- [ ] **Step 2: 后端管理接口**

在管理端商品 Controller 中增加 POST 端点：

```typescript
@Post(':id/refill-semantic')
async refillSemantic(@Param('id') id: string) {
  // 清除 semanticMeta 所有来源标记，允许 AI 重新覆盖
  const product = await this.prisma.product.findUnique({ where: { id } });
  const attrs = (product.attributes as Record<string, any>) || {};
  await this.prisma.product.update({
    where: { id },
    data: { attributes: { ...attrs, semanticMeta: {} } },
  });
  // 触发 AI 填充
  await this.semanticFillService.fillProduct(id);
  return { success: true };
}
```

需要注入 `SemanticFillService`（通过 import ProductModule）。

- [ ] **Step 3: 验证编译**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/products/edit.tsx backend/src/modules/admin/
git commit -m "feat(admin): add semantic field editing + AI refill endpoint"
```

---

### Task 14: 环境变量配置

**Files:**
- Modify: `backend/.env.example`

- [ ] **Step 1: 添加 3 个功能开关到 .env.example**

```env
# 语义意图升级开关
AI_SEMANTIC_SLOTS_ENABLED=false
AI_PRODUCT_SEMANTIC_FIELDS_ENABLED=false
AI_SEMANTIC_SCORING_ENABLED=false
```

- [ ] **Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "feat(config): add 3 semantic feature flags to env example"
```

---

### Task 15: 文档同步

**Files:**
- Modify: `ai.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 ai.md**

在 `ai.md` 中追加以下章节：
- **语义槽位扩展**：列出 7 个新槽位名称、类型、用途
- **LLM 管道变化**：Flash→质量检查→条件升级 Plus 流程图
- **fallbackReason 分流**：out-of-domain / too-vague / unsafe 三种处理
- **Product 语义字段**：5 个新字段名称和 semanticMeta 来源追踪机制
- **搜索评分变化**：语义匹配权重表、三级降级规则
- **功能开关**：3 个 env 变量名称和用途

- [ ] **Step 2: 更新 CLAUDE.md 相关文档列表**

在 CLAUDE.md 的「相关文档」列表中添加：
```
- `docs/superpowers/specs/2026-03-15-semantic-intent-design.md` — 语义意图升级设计方案（槽位扩展、LLM 管道、数据模型、搜索评分、实施分期，**语义意图改造权威来源**）
```

- [ ] **Step 3: Commit**

```bash
git add ai.md CLAUDE.md
git commit -m "docs: update ai.md and CLAUDE.md with semantic intent upgrade references"
```
