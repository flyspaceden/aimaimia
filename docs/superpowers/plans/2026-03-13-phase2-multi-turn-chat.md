# Phase 2: Qwen-Plus 多轮对话 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将聊天页从单轮 `parseIntent() → feedback` 升级为 Qwen-Plus 多轮对话，输出 `reply + suggestedActions + followUpQuestions`，首页语音保持现有路由器不变。

**Architecture:** 聊天页内 Qwen-Plus 为唯一主脑，绕过 parseIntent()。后端新增 `chatWithContext()` 方法，组装 system prompt + 滑动窗口历史 + 当前消息，调用 Qwen-Plus，解析结构化 JSON 响应。suggestedActions 的 resolved 字段由后端复用已有解析器补全。前端新增 ActionCard 和 FollowUpChips 组件渲染新输出。

**Tech Stack:** NestJS + Prisma (backend), React Native + Expo (frontend), Qwen-Plus via OpenAI-compatible API (dashscope)

**Design Spec:** `ai.md` Phase 2 section (2.1-2.8)

---

## File Structure

### Backend (modify)
| File | Responsibility |
|------|---------------|
| `backend/src/modules/ai/ai.service.ts` | 新增 `chatWithContext()` 方法、`buildChatMessages()` 滑动窗口、`resolveSuggestedActions()` 补全 |
| `backend/src/modules/ai/ai.controller.ts` | `sendMessage` 端点不变，服务层内部切换链路 |
| `backend/src/modules/ai/voice-intent.types.ts` | 新增 `AiChatResponse` / `AiSuggestedAction` 类型 |

### Frontend (modify)
| File | Responsibility |
|------|---------------|
| `src/types/domain/Ai.ts` | 新增 `AiChatResponse` / `AiSuggestedAction` / `AiFollowUpQuestion` 类型，扩展 `AiChatMessage` |
| `src/repos/AiSessionRepo.ts` | 更新 `sendMessage` 返回类型处理、`toMessages()` 适配新格式 |
| `app/ai/chat.tsx` | `handleSend()` 适配新响应、渲染 suggestedActions 和 followUpQuestions |
| `src/components/ui/AiChatBubble.tsx` | 扩展支持 suggestedActions 卡片和 followUpQuestions 芯片 |
| `app/(tabs)/home.tsx` | chat 意图跳转聊天页时注入初始上下文 |

---

## Chunk 1: Backend — chatWithContext() 核心链路

### Task 1: 新增后端类型定义

**Files:**
- Modify: `backend/src/modules/ai/voice-intent.types.ts`

- [ ] **Step 1: 在 voice-intent.types.ts 末尾新增聊天响应类型**

```typescript
// ===== Phase 2: 多轮对话类型 =====

export interface AiSuggestedAction {
  type: 'search' | 'navigate' | 'company' | 'transaction' | 'recommend';
  label: string;
  resolved?: Record<string, any>;
}

export interface AiChatResponse {
  reply: string;
  suggestedActions: AiSuggestedAction[];
  followUpQuestions: string[];
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无新增编译错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/ai/voice-intent.types.ts
git commit -m "feat(ai): add AiChatResponse and AiSuggestedAction types for Phase 2"
```

---

### Task 2: 新增 chatWithContext() 方法

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts`

**依赖:** Task 1

- [ ] **Step 1: 在 ai.service.ts 顶部常量区新增聊天模型配置（约 line 43 之后）**

```typescript
private readonly QWEN_CHAT_MODEL = process.env.AI_CHAT_MODEL || 'qwen-plus';
private readonly CHAT_MAX_ROUNDS = 8;           // 最多保留最近 8 轮（16 条消息）
private readonly CHAT_MAX_INPUT_TOKENS = 7000;   // 输入 token 预算（粗估）
```

- [ ] **Step 2: 在 ai.service.ts 新增 system prompt 常量（紧跟上面的常量）**

```typescript
private readonly CHAT_SYSTEM_PROMPT = `你是"爱买买 AI 助手"，一个农业电商平台的智能客服。

## 角色
- 帮助用户了解平台商品、企业、农产品知识
- 回答农业电商相关问题
- 当用户表达购物意图时，建议相关操作（不自动执行）

## 回答边界
- 只回答与农业、食品、电商、平台功能相关的问题
- 对超出范围的问题（如医疗、法律、政治），礼貌告知无法回答
- 不编造商品信息、不承诺价格、不代替用户做支付决策

## 安全规则
- 绝不输出用户隐私信息
- 绝不伪造订单、交易状态
- 所有建议动作由用户确认后才执行

## 输出格式
你必须以 JSON 格式回复，结构如下：
{
  "reply": "你的自然语言回答",
  "suggestedActions": [
    {
      "type": "search|navigate|company|transaction|recommend",
      "label": "按钮显示文字",
      "resolved": { "query": "搜索词", ... }
    }
  ],
  "followUpQuestions": ["追问建议1", "追问建议2"]
}

规则：
- reply 字段必须有值
- suggestedActions 最多 2 个，只在用户有明确购物/浏览意图时才给
- followUpQuestions 最多 3 个，用于引导对话继续
- 如果没有建议动作或追问，对应数组为空 []
- type 白名单：search / navigate / company / transaction / recommend
- navigate 的 resolved 必须包含 target 字段，值为：home / cart / checkout / orders / settings / discover / me
- search 的 resolved 必须包含 query 字段，可选 constraints 数组
- company 的 resolved 必须包含 name 字段
- recommend 的 resolved 可包含 query / budget / constraints`;
```

**实现要求补充**：
- prompt 可以要求模型输出 JSON，但后端必须始终容忍非 JSON 返回
- 一旦 `parseChatResponse()` 解析失败，必须降级为：
  - `reply = 原始文本`
  - `suggestedActions = []`
  - `followUpQuestions = []`
- 解析失败不能让整轮对话报错，也不能中断消息落库

- [ ] **Step 3: 新增 `buildChatMessages()` 滑动窗口方法**

在 `mapUtterance()` 方法之前（约 line 2969 前）新增：

```typescript
/**
 * 构建多轮对话的 messages 数组（system + 历史 + 当前用户消息）
 * 双重控制：轮次上限 + token 预算
 */
private buildChatMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentMessage: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: this.CHAT_SYSTEM_PROMPT },
  ];

  // 粗估 token：中文 1 字 ≈ 1.5 token
  const estimateTokens = (text: string) => Math.ceil(text.length * 1.5);

  const systemTokens = estimateTokens(this.CHAT_SYSTEM_PROMPT);
  const currentTokens = estimateTokens(currentMessage);
  let budgetRemaining = this.CHAT_MAX_INPUT_TOKENS - systemTokens - currentTokens;

  // 从最新的历史开始向前取，直到超出预算或轮次上限
  // 一轮 = user + assistant，所以最多取 CHAT_MAX_ROUNDS * 2 条
  const maxMessages = this.CHAT_MAX_ROUNDS * 2;
  const recentHistory = history.slice(-maxMessages);

  const selectedHistory: typeof recentHistory = [];
  for (let i = recentHistory.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(recentHistory[i].content);
    if (budgetRemaining - tokens < 0) break;
    budgetRemaining -= tokens;
    selectedHistory.unshift(recentHistory[i]);
  }

  messages.push(...selectedHistory);
  messages.push({ role: 'user', content: currentMessage });

  return messages;
}
```

- [ ] **Step 4: 新增 `parseChatResponse()` JSON 解析 + fallback 方法**

紧跟 `buildChatMessages()` 之后：

```typescript
/**
 * 解析 Qwen-Plus 的聊天响应 JSON，带 fallback
 */
private parseChatResponse(raw: string): AiChatResponse {
  try {
    // 去除可能的 markdown 代码块包裹
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    return {
      reply: typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : raw.trim(),
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions
            .filter((a: any) =>
              a && typeof a.type === 'string' &&
              ['search', 'navigate', 'company', 'transaction', 'recommend'].includes(a.type) &&
              typeof a.label === 'string',
            )
            .slice(0, 2)
        : [],
      followUpQuestions: Array.isArray(parsed.followUpQuestions)
        ? parsed.followUpQuestions
            .filter((q: any) => typeof q === 'string' && q.trim())
            .slice(0, 3)
        : [],
    };
  } catch {
    // Qwen 返回非法 JSON，整个输出当作纯 reply
    return {
      reply: raw.trim(),
      suggestedActions: [],
      followUpQuestions: [],
    };
  }
}
```

- [ ] **Step 5: 新增 `resolveSuggestedActions()` 方法，复用已有解析器链补全 resolved 字段**

紧跟 `parseChatResponse()` 之后。

**重要**：不手写 `contains` 匹配，直接复用已有的 `productService.resolveSearchEntity()`（分类候选映射 + qwen-flash 匹配）和 `resolveCompanyTargetName()`（企业候选过滤 + 同音纠偏）。Company 枚举值为 `ACTIVE`（非 `APPROVED`）。

```typescript
/**
 * 对 suggestedActions 中的 resolved 字段进行补全
 * 复用已有的搜索实体解析链和企业同音纠偏链
 */
private async resolveSuggestedActions(
  actions: AiSuggestedAction[],
): Promise<AiSuggestedAction[]> {
  const resolved: AiSuggestedAction[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'search': {
          // 复用 productService.resolveSearchEntity()（分类候选映射 + qwen-flash）
          const query = action.resolved?.query || action.label;
          const searchEntity = await this.productService.resolveSearchEntity(query);
          resolved.push({
            ...action,
            resolved: {
              ...action.resolved,
              query: searchEntity.normalizedKeyword || query,
              ...(searchEntity.matchedCategoryId
                ? { matchedCategoryId: searchEntity.matchedCategoryId, matchedCategoryName: searchEntity.matchedCategoryName }
                : {}),
            },
          });
          break;
        }
        case 'company': {
          // 复用 resolveCompanyTargetName()（候选过滤 + 同音纠偏链）
          const name = action.resolved?.name || action.label;
          const companyResult = await this.resolveCompanyTargetName(name, {
            companyName: name,
          });
          resolved.push({
            ...action,
            resolved: {
              ...action.resolved,
              name,
              ...(companyResult.companyId
                ? { companyId: companyResult.companyId, companyName: companyResult.companyName }
                : {}),
            },
          });
          break;
        }
        default:
          resolved.push(action);
      }
    } catch {
      resolved.push(action);
    }
  }

  return resolved;
}
```

- [ ] **Step 6: 新增核心 `chatWithContext()` 方法**

紧跟 `resolveSuggestedActions()` 之后。

**重要**：此方法只接收"历史消息"，不读取当前 utterance（由 `sendMessage()` 负责在调用本方法之前读取历史、之后创建 utterance）。避免当前消息被重复注入。

```typescript
/**
 * Phase 2 核心：多轮对话，Qwen-Plus 为主脑
 * 绕过 parseIntent()，直接走 Qwen-Plus 多轮对话
 *
 * 注意：history 参数只包含"已有历史"，不含当前用户消息
 * 当前用户消息通过 transcript 参数单独传入，避免重复注入
 */
async chatWithContext(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  transcript: string,
): Promise<AiChatResponse> {
  // 1. 构建滑动窗口 messages
  const messages = this.buildChatMessages(history, transcript);

  // 2. 调用 Qwen-Plus
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return { reply: 'AI 服务暂未配置，请联系管理员。', suggestedActions: [], followUpQuestions: [] };
  }

  let rawContent: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s 超时

    const response = await fetch(this.QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.QWEN_CHAT_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[AiChat] Qwen API error: ${response.status}`);
      return { reply: '抱歉，AI 助手暂时繁忙，请稍后再试。', suggestedActions: [], followUpQuestions: [] };
    }

    const data = await response.json();
    rawContent = data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('[AiChat] Qwen API call failed:', error);
    return { reply: '网络异常，请稍后再试。', suggestedActions: [], followUpQuestions: [] };
  }

  // 3. 解析响应
  const chatResponse = this.parseChatResponse(rawContent);

  // 4. 补全 suggestedActions 的 resolved 字段
  if (chatResponse.suggestedActions.length > 0) {
    chatResponse.suggestedActions = await this.resolveSuggestedActions(chatResponse.suggestedActions);
  }

  return chatResponse;
}
```

- [ ] **Step 7: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无编译错误

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/ai/ai.service.ts
git commit -m "feat(ai): add chatWithContext() with sliding window and suggestedActions"
```

---

### Task 3: 切换 sendMessage() 到 chatWithContext()

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts` (sendMessage 方法, ~line 2930)

**依赖:** Task 2

- [ ] **Step 1: 修改 sendMessage() 方法，切换到 chatWithContext()**

将当前 `sendMessage()` 方法（约 line 2930-2966）替换为。

**关键修复**：
1. 先读历史、调模型，**再**创建 utterance，避免当前消息被重复注入
2. 落库时 `chatResponse.reply` / `suggestedActions` / `followUpQuestions` 作为独立结构化字段
3. `chatWithContext()` 只接收历史消息 + 当前 transcript，不读 DB

```typescript
async sendMessage(
  sessionId: string,
  userId: string,
  dto: { transcript: string; audioUrl?: string },
) {
  // 1. 验证会话归属
  const session = await this.prisma.aiSession.findUnique({
    where: { id: sessionId },
    include: {
      utterances: {
        orderBy: { createdAt: 'asc' },
        include: {
          intentResults: {
            include: { actionExecutions: true },
          },
        },
      },
    },
  });
  if (!session) throw new NotFoundException('会话不存在');
  if (session.userId !== userId) throw new NotFoundException('会话不存在');

  // 2. 从已有 utterances 提取历史（不含当前消息）
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const utterance of session.utterances) {
    history.push({ role: 'user', content: utterance.transcript });
    const assistantContent = utterance.intentResults
      ?.flatMap((ir: any) => ir.actionExecutions || [])
      .map((ae: any) => {
        const payload = ae.actionPayload as any;
        return payload?.chatResponse?.reply || payload?.message;
      })
      .find((c: any) => typeof c === 'string' && c.trim().length > 0);
    if (assistantContent) {
      history.push({ role: 'assistant', content: assistantContent });
    }
  }

  // 3. 调用 Qwen-Plus 多轮对话（先调模型，再落库）
  const chatResponse = await this.chatWithContext(history, dto.transcript);

  // 4. 创建 utterance + 结构化落库
  const utterance = await this.prisma.aiUtterance.create({
    data: {
      sessionId,
      transcript: dto.transcript,
      audioUrl: dto.audioUrl,
    },
  });

  await this.prisma.aiIntentResult.create({
    data: {
      utteranceId: utterance.id,
      intent: 'chat',
      slots: {},
      confidence: 1.0,
      modelInfo: {
        model: this.QWEN_CHAT_MODEL,
        phase: 'phase2-multi-turn',
        replySource: 'qwen-plus',
        hasSuggestedActions: chatResponse.suggestedActions.length > 0,
        hasFollowUpQuestions: chatResponse.followUpQuestions.length > 0,
      },
      actionExecutions: {
        create: {
          actionType: 'SHOW_CHOICES',
          actionPayload: {
            // 结构化落库：reply / suggestedActions / followUpQuestions 各自独立
            chatResponse: {
              reply: chatResponse.reply,
              suggestedActions: chatResponse.suggestedActions,
              followUpQuestions: chatResponse.followUpQuestions,
            },
            // 保留 message 字段兼容旧前端读取逻辑
            message: chatResponse.reply,
          },
          success: true,
        },
      },
    },
  });

  // 5. 返回完整 utterance
  const fullUtterance = await this.prisma.aiUtterance.findUnique({
    where: { id: utterance.id },
    include: {
      intentResults: {
        include: { actionExecutions: true },
      },
    },
  });

  return this.mapUtterance(fullUtterance!);
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 无编译错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/ai/ai.service.ts
git commit -m "feat(ai): switch sendMessage() to chatWithContext() multi-turn pipeline"
```

---

## Chunk 2: Frontend — 类型、Repo、聊天页适配

### Task 4: 前端类型更新

**Files:**
- Modify: `src/types/domain/Ai.ts`

- [ ] **Step 1: 在 Ai.ts 中新增聊天响应类型**

在文件末尾（现有类型定义之后）新增：

```typescript
// ===== Phase 2: 多轮对话类型 =====

export type AiSuggestedAction = {
  type: 'search' | 'navigate' | 'company' | 'transaction' | 'recommend';
  label: string;
  resolved?: Record<string, any>;
};

export type AiChatResponse = {
  reply: string;
  suggestedActions: AiSuggestedAction[];
  followUpQuestions: string[];
};

// 扩展 AiChatMessage，支持附带 suggestedActions 和 followUpQuestions
export type AiChatMessageExtended = AiChatMessage & {
  suggestedActions?: AiSuggestedAction[];
  followUpQuestions?: string[];
};
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit` (从项目根目录)
Expected: 无编译错误

- [ ] **Step 3: Commit**

```bash
git add src/types/domain/Ai.ts
git commit -m "feat(ai): add frontend types for Phase 2 chat response"
```

---

### Task 5: 更新 AiSessionRepo 适配新响应格式

**Files:**
- Modify: `src/repos/AiSessionRepo.ts`

**依赖:** Task 4

- [ ] **Step 1: 更新 `mapSessionMessages()` 以提取 chatResponse 字段**

修改 `mapSessionMessages` 函数（约 line 34-51），使其能从 `actionPayload.chatResponse` 中提取 suggestedActions 和 followUpQuestions：

```typescript
const mapSessionMessages = (session: AiSessionDetail): AiChatMessageExtended[] => {
  return session.utterances.flatMap((utterance) => {
    const messages: AiChatMessageExtended[] = [
      {
        ...buildUserMessage(utterance.id, utterance.createdAt, utterance.transcript),
      },
    ];

    // 从 actionPayload 中提取回复内容和 Phase 2 结构化字段
    let assistantContent: string | undefined;
    let suggestedActions: AiSuggestedAction[] | undefined;
    let followUpQuestions: string[] | undefined;

    for (const ir of utterance.intentResults || []) {
      for (const action of ir.actions || []) {
        const payload = action.payload as any;
        if (payload?.chatResponse) {
          // Phase 2 格式
          assistantContent = payload.chatResponse.reply;
          suggestedActions = payload.chatResponse.suggestedActions;
          followUpQuestions = payload.chatResponse.followUpQuestions;
        } else if (payload?.message && !assistantContent) {
          // Phase 1 兼容格式
          assistantContent = payload.message;
        }
      }
    }

    if (assistantContent) {
      messages.push({
        ...buildAssistantMessage(utterance.id, utterance.createdAt, assistantContent),
        suggestedActions,
        followUpQuestions,
      });
    }

    return messages;
  });
};
```

- [ ] **Step 2: 更新导入，添加 `AiChatMessageExtended` 和 `AiSuggestedAction`**

在文件顶部导入区更新：

```typescript
import { AiChatMessage, AiChatMessageExtended, AiSuggestedAction, AiSessionDetail, AiSessionSummary, AiSessionUtterance } from '../types';
```

- [ ] **Step 3: 更新 `toMessages` 返回类型签名**

```typescript
toMessages: (session: AiSessionDetail): AiChatMessageExtended[] => mapSessionMessages(session),
```

- [ ] **Step 4: Commit**

```bash
git add src/repos/AiSessionRepo.ts
git commit -m "feat(ai): update AiSessionRepo to extract chatResponse with suggestedActions"
```

---

### Task 6: 扩展 AiChatBubble 支持 suggestedActions 和 followUpQuestions

**Files:**
- Modify: `src/components/ui/AiChatBubble.tsx`

**依赖:** Task 4

- [ ] **Step 1: 更新 Props 接口和导入**

更新组件 Props 使用 `AiChatMessageExtended`：

```typescript
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AiChatMessageExtended, AiSuggestedAction } from '../../types';
import { useTheme } from '../../theme';
import { AiCardGlow } from './AiCardGlow';
import { AiOrb } from '../effects/AiOrb';
import { AiTypingEffect } from '../effects/AiTypingEffect';

type Props = {
  message: AiChatMessageExtended;
  isNew?: boolean;
  onTypingComplete?: () => void;
  onFollowUpPress?: (question: string) => void;
};
```

- [ ] **Step 2: 在 AI 消息气泡下方新增 suggestedActions 渲染**

在 AI 消息气泡的 `AiCardGlow` 闭合标签之后、`</Animated.View>` 之前，插入：

```typescript
      {/* suggestedActions 卡片 */}
      {message.suggestedActions && message.suggestedActions.length > 0 && (
        <View style={styles.actionsContainer}>
          {message.suggestedActions.map((action, index) => (
            <Pressable
              key={`action-${index}`}
              onPress={() => handleActionPress(action)}
              style={({ pressed }) => [
                styles.actionCard,
                {
                  backgroundColor: pressed ? colors.ai.soft : colors.bgSecondary,
                  borderColor: colors.ai.start,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={actionIconMap[action.type] || 'arrow-right'}
                size={16}
                color={colors.ai.start}
              />
              <Text style={[typography.caption, { color: colors.ai.start, marginLeft: 6, flex: 1 }]}>
                {action.label}
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={14} color={colors.ai.start} />
            </Pressable>
          ))}
        </View>
      )}

      {/* followUpQuestions 芯片 */}
      {message.followUpQuestions && message.followUpQuestions.length > 0 && (
        <View style={styles.followUpContainer}>
          {message.followUpQuestions.map((question, index) => (
            <Pressable
              key={`followup-${index}`}
              onPress={() => onFollowUpPress?.(question)}
              style={[styles.followUpChip, { borderColor: colors.border }]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                {question}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
```

- [ ] **Step 3: 新增 action 图标映射和导航处理函数（组件内部）**

```typescript
const actionIconMap: Record<string, string> = {
  search: 'magnify',
  navigate: 'compass-outline',
  company: 'store-outline',
  transaction: 'receipt',
  recommend: 'star-outline',
};

const handleActionPress = (action: AiSuggestedAction) => {
  const r = action.resolved || {};
  switch (action.type) {
    case 'search':
      router.push({ pathname: '/search', params: { q: r.query || action.label } });
      break;
    case 'navigate':
      if (r.target === 'cart') router.push('/(tabs)/cart');
      else if (r.target === 'orders') router.push('/orders');
      else if (r.target === 'discover') router.push('/(tabs)/discover');
      else if (r.target === 'me') router.push('/(tabs)/me');
      else if (r.target === 'home') router.push('/(tabs)/home');
      else router.push('/(tabs)/home');
      break;
    case 'company':
      if (r.companyId) router.push({ pathname: '/company/[id]', params: { id: r.companyId } });
      else router.push({ pathname: '/search', params: { q: r.name || action.label } });
      break;
    case 'recommend':
      router.push({
        pathname: '/ai/recommend',
        params: {
          q: r.query,
          maxPrice: r.budget?.toString(),
          constraints: r.constraints?.join(','),
        },
      });
      break;
    default:
      break;
  }
};
```

- [ ] **Step 4: 新增 StyleSheet 样式**

```typescript
actionsContainer: {
  marginTop: 8,
  marginLeft: 40,
  gap: 6,
},
actionCard: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderRadius: 10,
  borderWidth: 1,
},
followUpContainer: {
  marginTop: 8,
  marginLeft: 40,
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 6,
},
followUpChip: {
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 16,
  borderWidth: 1,
},
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/AiChatBubble.tsx
git commit -m "feat(ai): add suggestedActions cards and followUpQuestions chips to chat bubble"
```

---

### Task 7: 更新 chat.tsx 适配新响应格式

**Files:**
- Modify: `app/ai/chat.tsx`

**依赖:** Task 5, Task 6

- [ ] **Step 1: 更新类型导入**

在 chat.tsx 顶部导入区（约 line 27），将 `AiChatMessage` 替换为：

```typescript
import { AuthSession, AiChatMessage, AiChatMessageExtended } from '../../src/types';
```

- [ ] **Step 2: 更新 remoteMessages state 类型**

将 `remoteMessages` 的类型改为 `AiChatMessageExtended[]`：

```typescript
const [remoteMessages, setRemoteMessages] = useState<AiChatMessageExtended[]>([]);
```

- [ ] **Step 3: 更新 handleSend() 中的真实 API 响应处理**

修改 `handleSend()` 函数中真实 API 调用部分（约 line 279-300），将 `nextMessages` 提取改为：

```typescript
    // Real API call
    const result = await AiSessionRepo.sendMessage(resolvedRemoteSessionId!, value);
    setSending(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发送失败', type: 'error' });
      setRemoteMessages((prev) => prev.filter((message) => message.id !== userMessage.id));
      return;
    }

    const nextMessages = AiSessionRepo.toMessages({
      id: resolvedRemoteSessionId!,
      page: 'assistant',
      createdAt: new Date().toISOString(),
      utterances: [result.data],
    });
    const assistantMessage = nextMessages.find((message) => message.role === 'assistant');
    if (assistantMessage) {
      setRemoteMessages((prev) => [...prev, assistantMessage]);
      setNewestMessageId(assistantMessage.id);
    }
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
```

（这段代码逻辑不变，因为 `toMessages()` 已在 Task 5 中更新为返回 `AiChatMessageExtended[]`，自动携带 suggestedActions 和 followUpQuestions）

- [ ] **Step 4: 更新消息列表渲染，传递 onFollowUpPress 回调**

修改 `AiChatBubble` 的渲染（约 line 399-404）：

```typescript
          {displayMessages.map((message) => (
            <AiChatBubble
              key={message.id}
              message={message}
              isNew={message.id === newestMessageId && message.role === 'assistant'}
              onTypingComplete={handleTypingComplete}
              onFollowUpPress={(question) => handleSend(question)}
            />
          ))}
```

- [ ] **Step 5: 更新 displayMessages 的类型**

找到 `displayMessages` 的 useMemo（如果有），或找到 `currentMessages` 的使用处，确保类型为 `AiChatMessageExtended[]`。

- [ ] **Step 6: Commit**

```bash
git add app/ai/chat.tsx
git commit -m "feat(ai): update chat page to display suggestedActions and followUpQuestions"
```

---

## Chunk 3: 首页衔接 + 验证

### Task 8: 首页 → 聊天页初始上下文注入

**Files:**
- Modify: `app/(tabs)/home.tsx` (navigateByIntent 中 case 'chat' 分支, ~line 680)
- Modify: `app/ai/chat.tsx` (处理从首页带过来的初始上下文)

- [ ] **Step 1: 修改首页 chat 意图处理，增加"继续对话"按钮跳转**

在 `home.tsx` 的 `case 'chat':` 分支（约 line 680-689）修改为：

```typescript
      case 'chat':
      default:
        // 在首页展示 AI 回复，不自动跳转聊天页
        persistVoiceFeedback(intent.feedback || '我在呢，有什么可以帮你？');
        setFeedbackText(intent.feedback || '我在呢，有什么可以帮你？');

        setPendingChatContext({
          initialTranscript: intent.transcript,
          initialReply: intent.feedback || '我在呢，有什么可以帮你？',
        });
        setShowContinueChat(true);
        setIsProcessing(false);
        break;
```

**交互原则**：
- 首页 `chat` 意图先展示回复
- 不做“2 秒自动跳转”
- 由用户点击“继续对话”按钮后，再跳转到聊天页并注入初始上下文

- [ ] **Step 2: 在 chat.tsx 中处理 initialTranscript / initialReply 参数**

在 `useLocalSearchParams` 中添加新参数（约 line 37）：

```typescript
  const { prompt, sessionId: paramSessionId, initialTranscript, initialReply } = useLocalSearchParams<{
    prompt?: string;
    sessionId?: string;
    initialTranscript?: string;
    initialReply?: string;
  }>();
```

- [ ] **Step 3: 在 chat.tsx 中新增 useEffect 注入初始上下文**

在 `promptHandledRef` 的 useEffect 之后新增：

```typescript
  const initialContextHandledRef = useRef(false);

  useEffect(() => {
    if (!initialTranscript || !initialReply || initialContextHandledRef.current) return;
    initialContextHandledRef.current = true;

    // 将首页的语音对话注入为聊天页的第一轮消息
    const userMsg: AiChatMessageExtended = {
      id: `init-user-${Date.now()}`,
      role: 'user',
      content: String(initialTranscript),
      createdAt: new Date().toISOString(),
    };
    const assistantMsg: AiChatMessageExtended = {
      id: `init-assistant-${Date.now()}`,
      role: 'assistant',
      content: String(initialReply),
      createdAt: new Date().toISOString(),
    };

    if (USE_MOCK) {
      addMessage(userMsg);
      addMessage(assistantMsg);
    } else {
      setRemoteMessages((prev) => [...prev, userMsg, assistantMsg]);
    }
  }, [initialTranscript, initialReply]);
```

- [ ] **Step 4: Commit**

```bash
git add app/ai/chat.tsx app/\(tabs\)/home.tsx
git commit -m "feat(ai): inject initial context when navigating from home to chat page"
```

---

### Task 9: 全链路验证

- [ ] **Step 1: 后端 TypeScript 编译验证**

Run: `cd backend && npx tsc --noEmit`
Expected: 无编译错误

- [ ] **Step 2: Prisma schema 验证**

Run: `cd backend && npx prisma validate`
Expected: 无错误（本次未修改 schema）

- [ ] **Step 3: 前端 TypeScript 编译验证**

Run: `npx tsc --noEmit`
Expected: 无编译错误

- [ ] **Step 4: 检查类型一致性**

确认以下类型在前后端一致：
- `AiSuggestedAction.type` 白名单：`search | navigate | company | transaction | recommend`
- `AiChatResponse` 结构：`{ reply, suggestedActions[], followUpQuestions[] }`
- `actionPayload.chatResponse` 格式前后端匹配

- [ ] **Step 5: 更新 ai.md 进度状态**

将 Phase 2 中已完成的任务标记为 ✅：
- `chatWithContext()` 方法
- `sendMessage()` 切换
- 前端 suggestedActions 卡片渲染
- 前端 followUpQuestions 快捷按钮
- 首页 → 聊天页初始上下文注入

- [ ] **Step 6: Final commit**

```bash
git add ai.md
git commit -m "docs(ai): update Phase 2 progress status after multi-turn chat implementation"
```
