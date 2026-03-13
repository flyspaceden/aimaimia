# 全局 AI 语音按钮 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首页 AI 语音录音能力扩展到全局浮动按钮，任何页面长按均可录音 → ASR → 意图识别 → 执行动作。

**Architecture:** 从 `home.tsx` 提取 ~430 行录音+意图路由逻辑为三个可复用单元：`resolveIntent()` 纯异步函数处理意图→路由映射，`useVoiceRecording` hook 封装录音生命周期+状态管理，`VoiceOverlay` 组件提供非首页的录音/反馈 UI。首页保留专属 AiOrb 视觉，全局浮窗使用 VoiceOverlay。

**Tech Stack:** React Native + Expo (expo-av) / react-native-gesture-handler / react-native-reanimated / expo-router / Zustand / @tanstack/react-query

**Spec:** `docs/superpowers/specs/2026-03-13-global-voice-button-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/utils/navigateByIntent.ts` | 意图→路由纯异步映射（IntentResult 类型 + resolveIntent 函数） |
| Create | `src/hooks/useVoiceRecording.ts` | 录音生命周期 hook（权限→录音→ASR→意图解析→状态分解） |
| Create | `src/components/overlay/VoiceOverlay.tsx` | 非首页语音 UI（录音指示器 + 处理中 + 反馈浮层） |
| Modify | `src/components/effects/AiFloatingCompanion.tsx` | 集成 hook + VoiceOverlay + AuthModal |
| Modify | `app/(tabs)/home.tsx` | 替换内联录音逻辑为 hook，保留首页专属 UI |

---

## Chunk 1: Intent Resolution Utility

### Task 1: Create `src/utils/navigateByIntent.ts`

从 `home.tsx` 提取意图路由逻辑为纯异步函数。不依赖任何 React hook 或 UI 状态。

**Files:**
- Create: `src/utils/navigateByIntent.ts`
- Reference: `app/(tabs)/home.tsx:274-699` (现有 navigateByIntent + resolve 函数)
- Reference: `src/types/domain/Ai.ts` (AiVoiceIntent 等类型)

**依赖说明：**
- `OrderRepo`（resolveTransactionRoute 中查询订单）
- `CompanyRepo`（resolveCompanyRoute 中查询企业）
- 纯函数，不依赖 React hooks

- [ ] **Step 1: Create the file with types and helpers**

```typescript
// src/utils/navigateByIntent.ts
import type {
  AiVoiceIntent,
  AiVoiceNavigateTarget,
} from '../types/domain/Ai';
import { OrderRepo } from '../repos/OrderRepo';
import { CompanyRepo } from '../repos/CompanyRepo';

// ── 导出类型 ──────────────────────────────────────────
export type IntentResult = {
  action: 'navigate' | 'feedback' | 'clarify';
  // navigate: 直接跳转
  route?: string;
  params?: Record<string, string>;
  toastText?: string;
  // feedback: 展示反馈浮层
  feedbackText?: string;
  actionLabel?: string;
  actionRoute?: string;
  actionParams?: Record<string, string>;
  // chat 特殊处理
  continueChatContext?: { initialTranscript: string; initialReply: string };
  // clarify: 消歧
  clarifyIntent?: AiVoiceIntent;
  // 登录保护
  needsAuth?: boolean;
};

export type ResolveIntentOptions = {
  isLoggedIn: boolean;
  cartCount: number;
  selectedCartCount: number;
};

// ── 内部辅助 ──────────────────────────────────────────

function normalizeCompanyLookupText(value: string): string {
  return value
    .toLowerCase()
    .replace(/["""'`]/g, '')
    .replace(/[，。！？,.!?\s]/g, '')
    .replace(/(?:官方|自营)/gu, '')
    .replace(/(?:店铺|农场|商家|公司|企业|旗舰店)$/u, '')
    .trim();
}

const PROTECTED_ROUTES: Set<string> = new Set(['settings', 'orders']);

function isProtectedRoute(target: string): boolean {
  return PROTECTED_ROUTES.has(target);
}
```

- [ ] **Step 2: Add resolveSearchIntent**

从 `home.tsx:486-537` 提取 search 意图处理。改为返回 IntentResult 而非直接路由。

```typescript
function resolveSearchIntent(intent: AiVoiceIntent): IntentResult {
  const resolved = intent.resolved;
  const resolvedQuery = resolved?.query ?? intent.search?.query ?? intent.slots?.query;
  const resolvedProductId = resolved?.matchedProductId ?? intent.search?.matchedProductId;
  const resolvedProductName = resolved?.matchedProductName ?? intent.search?.matchedProductName;
  const resolvedCategoryId = resolved?.matchedCategoryId ?? intent.search?.matchedCategoryId;
  const resolvedCategoryName = resolved?.matchedCategoryName ?? intent.search?.matchedCategoryName;
  const resolvedPreferRecommended = resolved?.preferRecommended ?? intent.search?.preferRecommended;
  const resolvedConstraints = resolved?.constraints ?? intent.search?.constraints;
  const resolvedThemes = resolved?.recommendThemes ?? intent.search?.recommendThemes;

  const hasSearchSignal = Boolean(
    resolvedQuery || resolvedProductId || resolvedCategoryId
    || resolvedPreferRecommended || resolvedConstraints?.length || resolvedThemes?.length,
  );

  if (!hasSearchSignal) {
    return {
      action: 'feedback',
      feedbackText: intent.feedback || '我还没确定你想找什么商品，换个更具体的说法试试。',
    };
  }

  return {
    action: 'feedback',
    feedbackText: intent.feedback,
    actionLabel: '去搜索',
    actionRoute: '/search',
    actionParams: {
      ...(resolvedQuery ? { q: resolvedQuery } : {}),
      source: 'voice',
      ...(intent.search?.action ? { action: intent.search.action } : {}),
      ...(resolvedProductId ? { productId: resolvedProductId } : {}),
      ...(resolvedProductName ? { productName: resolvedProductName } : {}),
      ...(resolvedCategoryId ? { categoryId: resolvedCategoryId } : {}),
      ...(resolvedCategoryName ? { categoryName: resolvedCategoryName } : {}),
      ...(resolvedPreferRecommended ? { preferRecommended: '1' } : {}),
      ...(resolvedConstraints?.length ? { constraints: resolvedConstraints.join(',') } : {}),
      ...(resolvedThemes?.length ? { recommendThemes: resolvedThemes.join(',') } : {}),
    },
  };
}
```

- [ ] **Step 3: Add resolveCompanyIntent (async)**

从 `home.tsx:339-433` 提取。保留企业名称匹配逻辑和 API 调用。

```typescript
async function resolveCompanyIntent(intent: AiVoiceIntent): Promise<IntentResult> {
  const mode = intent.resolved?.companyMode ?? intent.company?.mode ?? intent.slots?.companyMode ?? 'detail';
  const resolvedCompanyId = intent.resolved?.companyId;
  const resolvedCompanyName = intent.resolved?.companyName;
  const industryHint = intent.resolved?.companyIndustryHint ?? intent.company?.industryHint ?? intent.slots?.companyIndustryHint;
  const location = intent.resolved?.companyLocation ?? intent.company?.location ?? intent.slots?.companyLocation;
  const companyType = intent.resolved?.companyType ?? intent.company?.companyType ?? intent.slots?.companyType;
  const featureTags = intent.resolved?.companyFeatureTags ?? intent.company?.featureTags ?? intent.slots?.companyFeatureTags;
  const rawName = (resolvedCompanyName || intent.company?.name || intent.slots?.companyName || '').trim();

  const searchParams: Record<string, string> = {
    source: 'voice',
    ...(rawName ? { q: rawName } : {}),
    ...(industryHint ? { industryHint } : {}),
    ...(location ? { location } : {}),
    ...(companyType ? { companyType } : {}),
    ...(featureTags?.length ? { featureTags: featureTags.join(',') } : {}),
  };

  if (mode === 'list') {
    return {
      action: 'feedback',
      feedbackText: intent.feedback || '先带你看看有哪些农场和企业...',
      actionLabel: '查看企业',
      actionRoute: '/company/search',
      actionParams: searchParams,
    };
  }

  if (resolvedCompanyId) {
    return {
      action: 'feedback',
      feedbackText: intent.feedback || `正在为你打开"${resolvedCompanyName || rawName}"...`,
      actionLabel: '查看企业',
      actionRoute: '/company/[id]',
      actionParams: { id: resolvedCompanyId },
    };
  }

  if (!rawName || !normalizeCompanyLookupText(rawName)) {
    return {
      action: 'feedback',
      feedbackText: '先带你看看有哪些农场和企业...',
      actionLabel: '查看企业',
      actionRoute: '/company/search',
      actionParams: searchParams,
    };
  }

  if (/^(?:c-|cmp-|company-)/i.test(rawName)) {
    return {
      action: 'feedback',
      feedbackText: intent.feedback || `正在为你打开"${rawName}"...`,
      actionLabel: '查看企业',
      actionRoute: '/company/[id]',
      actionParams: { id: rawName },
    };
  }

  // 尝试通过 API 匹配企业名称
  const result = await CompanyRepo.list();
  if (!result.ok) {
    return {
      action: 'feedback',
      feedbackText: `先为你查找"${rawName}"相关企业...`,
      actionLabel: '查看企业',
      actionRoute: '/company/search',
      actionParams: searchParams,
    };
  }

  const normalizedTarget = normalizeCompanyLookupText(rawName);
  const exactMatch = result.data.find(
    (company) => normalizeCompanyLookupText(company.name) === normalizedTarget,
  );
  if (exactMatch) {
    return {
      action: 'feedback',
      feedbackText: intent.feedback || `正在为你打开"${exactMatch.name}"...`,
      actionLabel: '查看企业',
      actionRoute: '/company/[id]',
      actionParams: { id: exactMatch.id },
    };
  }

  return {
    action: 'feedback',
    feedbackText: mode === 'detail'
      ? `先为你查找"${rawName}"相关企业...`
      : (intent.feedback || `先为你查找"${rawName}"相关企业...`),
    actionLabel: '查看企业',
    actionRoute: '/company/search',
    actionParams: searchParams,
  };
}
```

- [ ] **Step 4: Add resolveTransactionIntent (async)**

从 `home.tsx:274-337` 提取。保留异步订单查询。

```typescript
async function resolveTransactionIntent(
  intent: AiVoiceIntent,
  options: ResolveIntentOptions,
): Promise<IntentResult> {
  const action = intent.resolved?.transactionAction ?? intent.transaction?.action ?? intent.slots?.transactionAction;

  // 登录保护
  if (!options.isLoggedIn) {
    const loginFeedback = action === 'track-order'
      ? '请先登录，再为你查询订单物流...'
      : '请先登录，再为你处理订单相关操作...';
    return {
      action: 'feedback',
      feedbackText: loginFeedback,
      needsAuth: true,
    };
  }

  switch (action) {
    case 'track-order': {
      // 查找可追踪订单
      const orderResult = await OrderRepo.list(undefined, { page: 1, pageSize: 20 });
      if (orderResult.ok) {
        const preferredStatuses = ['shipping', 'delivered', 'completed'] as const;
        for (const status of preferredStatuses) {
          const order = orderResult.data.items.find((item) => item.status === status);
          if (order) {
            return {
              action: 'feedback',
              feedbackText: intent.feedback,
              actionLabel: '查看订单',
              actionRoute: '/orders/track',
              actionParams: { orderId: order.id },
            };
          }
        }
      }
      return {
        action: 'feedback',
        feedbackText: '暂时没找到可追踪的订单，先带你去订单页看看...',
        actionLabel: '查看订单',
        actionRoute: '/orders',
        actionParams: {},
      };
    }
    case 'pay': {
      const pendingPayResult = await OrderRepo.list('pendingPay', { page: 1, pageSize: 1 });
      const hasPendingPay = pendingPayResult.ok && pendingPayResult.data.items.length > 0;
      return {
        action: 'feedback',
        feedbackText: hasPendingPay ? intent.feedback : '暂时没有待付款订单，先带你去订单页看看...',
        actionLabel: '查看订单',
        actionRoute: '/orders',
        actionParams: hasPendingPay ? { status: 'pendingPay' } : {},
      };
    }
    case 'refund':
    case 'return':
    case 'exchange':
    case 'after-sale': {
      const latestIssueResult = await OrderRepo.getLatestIssue();
      if (latestIssueResult.ok && latestIssueResult.data?.id) {
        return {
          action: 'feedback',
          feedbackText: intent.feedback,
          actionLabel: '查看售后',
          actionRoute: '/orders/after-sale/[id]',
          actionParams: { id: latestIssueResult.data.id },
        };
      }
      const afterSaleResult = await OrderRepo.list('afterSale', { page: 1, pageSize: 1 });
      const afterSaleOrderId = afterSaleResult.ok ? afterSaleResult.data.items[0]?.id : null;
      if (afterSaleOrderId) {
        return {
          action: 'feedback',
          feedbackText: '先带你去相关订单看看售后进度...',
          actionLabel: '查看订单',
          actionRoute: '/orders/[id]',
          actionParams: { id: afterSaleOrderId },
        };
      }
      return {
        action: 'feedback',
        feedbackText: '先带你去售后订单页看看...',
        actionLabel: '查看订单',
        actionRoute: '/orders',
        actionParams: { status: 'afterSale' },
      };
    }
    default:
      return {
        action: 'feedback',
        feedbackText: intent.feedback || '正在打开订单列表...',
        actionLabel: '查看订单',
        actionRoute: '/orders',
        actionParams: {},
      };
  }
}
```

- [ ] **Step 5: Add resolveNavigateIntent and resolveRecommendIntent**

```typescript
function resolveNavigateIntent(
  intent: AiVoiceIntent,
  options: ResolveIntentOptions,
): IntentResult {
  let feedback = intent.feedback;
  let route: string | null = null;
  const navigateTarget = intent.resolved?.navigateTarget ?? intent.slots?.targetPage;

  switch (navigateTarget) {
    case 'home':
      route = '/(tabs)/home'; break;
    case 'discover':
      route = '/(tabs)/museum'; break;
    case 'me':
      route = '/(tabs)/me'; break;
    case 'settings':
      route = '/settings'; break;
    case 'cart':
      route = '/cart'; break;
    case 'checkout':
      if (options.cartCount === 0) {
        feedback = '购物车还是空的，先去挑点商品吧...';
        route = '/cart';
      } else if (options.selectedCartCount === 0) {
        feedback = '你还没勾选要结算的商品，先去购物车确认一下...';
        route = '/cart';
      } else {
        route = '/checkout';
      }
      break;
    case 'orders':
      route = '/orders'; break;
    case 'search':
      route = '/search'; break;
    case 'ai-chat':
      route = '/ai/chat'; break;
    default:
      feedback = intent.feedback || '我来帮你打开对应页面。';
      route = null;
      break;
  }

  // 登录保护
  if (route && navigateTarget && isProtectedRoute(navigateTarget) && !options.isLoggedIn) {
    feedback = navigateTarget === 'settings'
      ? '请先登录，再为你打开设置...'
      : '请先登录，再为你打开订单页面...';
    return {
      action: 'navigate',
      feedbackText: feedback,
      route: route,
      toastText: feedback,
      needsAuth: true,
    };
  }

  if (!route) {
    return { action: 'feedback', feedbackText: feedback };
  }

  return {
    action: 'navigate',
    route,
    toastText: feedback,
  };
}

function resolveRecommendIntent(intent: AiVoiceIntent): IntentResult {
  const recommend = intent.recommend;
  const resolved = intent.resolved;
  return {
    action: 'feedback',
    feedbackText: intent.feedback || '正在为你打开 AI 推荐...',
    actionLabel: '查看推荐',
    actionRoute: '/ai/recommend',
    actionParams: {
      ...(resolved?.query ?? recommend?.query ? { q: resolved?.query ?? recommend?.query ?? '' } : {}),
      source: 'voice',
      ...(resolved?.matchedCategoryId ?? recommend?.matchedCategoryId
        ? { categoryId: resolved?.matchedCategoryId ?? recommend?.matchedCategoryId ?? '' } : {}),
      ...(resolved?.matchedCategoryName ?? recommend?.matchedCategoryName
        ? { categoryName: resolved?.matchedCategoryName ?? recommend?.matchedCategoryName ?? '' } : {}),
      ...((resolved?.preferRecommended ?? recommend?.preferRecommended) ? { preferRecommended: '1' } : {}),
      ...(resolved?.constraints?.length
        ? { constraints: resolved.constraints.join(',') }
        : recommend?.constraints?.length
          ? { constraints: recommend.constraints.join(',') }
          : {}),
      ...(resolved?.budget
        ? { maxPrice: String(resolved.budget) }
        : recommend?.budget
          ? { maxPrice: String(recommend.budget) }
          : {}),
      ...(resolved?.recommendThemes?.length
        ? { recommendThemes: resolved.recommendThemes.join(',') }
        : recommend?.recommendThemes?.length
          ? { recommendThemes: recommend.recommendThemes.join(',') }
          : {}),
    },
  };
}
```

- [ ] **Step 6: Add main resolveIntent function**

```typescript
// ── 主函数 ──────────────────────────────────────────
export async function resolveIntent(
  intent: AiVoiceIntent,
  options: ResolveIntentOptions,
): Promise<IntentResult> {
  const intentType = intent.intent ?? intent.type;

  switch (intentType) {
    case 'search':
      return resolveSearchIntent(intent);

    case 'company':
      return resolveCompanyIntent(intent);

    case 'navigate':
      return resolveNavigateIntent(intent, options);

    case 'transaction':
      return resolveTransactionIntent(intent, options);

    case 'recommend':
      return resolveRecommendIntent(intent);

    case 'clarify':
      return {
        action: 'clarify',
        feedbackText: intent.feedback || '我还不太确定你的意思。',
        clarifyIntent: intent,
      };

    case 'chat':
    default:
      return {
        action: 'feedback',
        feedbackText: intent.feedback || '我在呢，有什么可以帮你？',
        continueChatContext: {
          initialTranscript: intent.transcript,
          initialReply: intent.feedback || '我在呢，有什么可以帮你？',
        },
      };
  }
}
```

- [ ] **Step 7: Verify TypeScript compilation**

Run: `cd /Users/jamesheden/Desktop/农脉\ -\ AI赋能农业电商平台 && npx tsc --noEmit --pretty 2>&1 | head -30`

检查 `src/utils/navigateByIntent.ts` 无类型错误。如果 `OrderRepo.list` 或 `CompanyRepo.list` 的签名与调用不匹配，需要调整参数传递（对照 `src/repos/OrderRepo.ts` 和 `src/repos/CompanyRepo.ts` 的实际签名）。

- [ ] **Step 8: Commit**

```bash
git add src/utils/navigateByIntent.ts
git commit -m "feat: extract resolveIntent utility from home.tsx

Pure async function mapping AiVoiceIntent → IntentResult.
Extracted from home.tsx navigateByIntent + resolveCompanyRoute +
resolveTransactionRoute + resolveRecommendRoute."
```

---

## Chunk 2: Voice Recording Hook

### Task 2: Create `src/hooks/useVoiceRecording.ts`

封装完整录音生命周期。从 `home.tsx` 提取 `handleLongPress`（981-1058）和 `handleOrbPressOut`（897-978）逻辑。

**Files:**
- Create: `src/hooks/useVoiceRecording.ts`
- Reference: `app/(tabs)/home.tsx:897-1058` (录音逻辑)
- Reference: `app/(tabs)/home.tsx:225-259` (saveVoiceToStore, queueProtectedVoiceIntent)
- Reference: `src/repos/AiAssistantRepo.ts` (parseVoiceIntent, prepareVoiceIntent)

**关键设计决策（来自 spec）：**
- hook 不包含 `useRouter()`——路由跳转由调用方决定
- `navigate` 意图：hook 通过 `useToast()` 显示 toastText，设 `actionRoute`/`actionParams`
- `feedback` 意图：hook 仅设状态，调用方渲染按钮并处理点击跳转
- `pendingIntent` 存原始 `AiVoiceIntent`，`retryAfterAuth()` 重新走 `resolveIntent`
- 生命周期：`mountedRef` 标记忽略卸载后的异步结果
- `stopRecording()` guard `isRecording === false`

- [ ] **Step 1: Create the hook file with types and setup**

```typescript
// src/hooks/useVoiceRecording.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';
import { useQueryClient } from '@tanstack/react-query';
import { useAiChatStore } from '../store/useAiChatStore';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import { useToast } from '../components/feedback/Toast';
import { AiAssistantRepo } from '../repos/AiAssistantRepo';
import { resolveIntent, IntentResult } from '../utils/navigateByIntent';
import type { AiVoiceIntent } from '../types/domain/Ai';
import { USE_MOCK } from '../repos/http/config';

export type UseVoiceRecordingOptions = {
  /** 当前页面标识，传给 parseVoiceIntent（首页传 'home'，全局浮窗传实际路径） */
  page: string;
};

export type UseVoiceRecordingReturn = {
  // 状态
  isRecording: boolean;
  isProcessing: boolean;
  userTranscript: string;
  feedbackText: string;
  feedbackVisible: boolean;
  actionLabel: string | null;
  actionRoute: string | null;
  actionParams: Record<string, string> | null;
  clarifyIntent: AiVoiceIntent | null;
  continueChatContext: { initialTranscript: string; initialReply: string } | null;
  needsAuth: boolean;
  pendingIntent: AiVoiceIntent | null;
  // 操作
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  dismissFeedback: () => void;
  selectClarify: (candidateId: string) => Promise<void>;
  retryAfterAuth: () => void;
};
```

- [ ] **Step 2: Implement the hook body — state, refs, helpers**

```typescript
export function useVoiceRecording(
  options: UseVoiceRecordingOptions,
): UseVoiceRecordingReturn {
  const { page } = options;
  const { show: showToast } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const cartCount = useCartStore((s) => s.items.length);
  const selectedCartCount = useCartStore((s) => s.selectedCount());

  // ── 状态 ──
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [actionRoute, setActionRoute] = useState<string | null>(null);
  const [actionParams, setActionParams] = useState<Record<string, string> | null>(null);
  const [clarifyIntent, setClarifyIntent] = useState<AiVoiceIntent | null>(null);
  const [continueChatContext, setContinueChatContext] = useState<{
    initialTranscript: string; initialReply: string;
  } | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<AiVoiceIntent | null>(null);

  // ── Refs ──
  const mountedRef = useRef(true);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartedAtRef = useRef(0);
  const preparePromiseRef = useRef<Promise<string | null> | null>(null);
  const preparedIdRef = useRef<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 生命周期清理 ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 停止录音
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      // 恢复音频模式
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      // 忽略未完成的 prepare 结果
      preparePromiseRef.current = null;
      preparedIdRef.current = null;
      // 清理定时器
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);
```

- [ ] **Step 3: Add saveVoiceToStore and applyIntentResult helpers**

```typescript
  // ── 语音历史持久化 ──
  const saveVoiceToStore = useCallback((transcript: string, feedback: string) => {
    const store = useAiChatStore.getState();
    store.createSession();
    const now = new Date().toISOString();
    store.addMessage({
      id: `voice-user-${Date.now()}`,
      role: 'user',
      content: transcript,
      createdAt: now,
    });
    if (feedback) {
      store.addMessage({
        id: `voice-ai-${Date.now()}`,
        role: 'assistant',
        content: feedback,
        createdAt: now,
      });
    }
  }, []);

  // ── 将 IntentResult 分解到各状态字段 ──
  const applyIntentResult = useCallback((
    result: IntentResult,
    intent: AiVoiceIntent,
  ) => {
    if (!mountedRef.current) return;

    // 持久化语音历史
    saveVoiceToStore(intent.transcript, result.feedbackText || intent.feedback || '');

    setIsProcessing(false);

    if (result.needsAuth) {
      setNeedsAuth(true);
      setPendingIntent(intent);
      setFeedbackText(result.feedbackText || '请先登录...');
      setFeedbackVisible(true);
      return;
    }

    switch (result.action) {
      case 'navigate':
        // hook 仅展示 Toast + 设 actionRoute，调用方决定是否/何时跳转
        if (result.toastText) {
          showToast({ message: result.toastText, type: 'success', duration: 2000 });
        }
        setActionRoute(result.route || null);
        setActionParams(result.params || null);
        // navigate 不设 feedbackVisible（由调用方自行处理）
        break;

      case 'feedback':
        setFeedbackText(result.feedbackText || '');
        setFeedbackVisible(true);
        setActionLabel(result.actionLabel || null);
        setActionRoute(result.actionRoute || null);
        setActionParams(result.actionParams || null);
        if (result.continueChatContext) {
          setContinueChatContext(result.continueChatContext);
        }
        break;

      case 'clarify':
        setFeedbackText(result.feedbackText || '');
        setFeedbackVisible(true);
        setClarifyIntent(result.clarifyIntent || null);
        break;
    }
  }, [saveVoiceToStore, showToast]);
```

- [ ] **Step 4: Implement startRecording**

从 `home.tsx:981-1058` 提取。

```typescript
  // ── 开始录音 ──
  const startRecording = useCallback(async () => {
    // 重置上一轮状态
    dismissFeedbackInternal();

    try {
      // 清理上一次未释放的录音对象
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch (_) {}
        recordingRef.current = null;
      }

      // 请求麦克风权限
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要麦克风权限', '请在设置中允许麦克风访问');
        return;
      }

      // 设置音频模式为录音
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // 创建 WAV 录音（16kHz 单声道）
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        isMeteringEnabled: false,
        android: {
          extension: '.wav',
          outputFormat: 0,
          audioEncoder: 0,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: { mimeType: 'audio/wav', bitsPerSecond: 256000 },
      });
      await recording.startAsync();

      recordingRef.current = recording;
      recordingStartedAtRef.current = Date.now();

      // 并行 ASR 预建连（非阻塞）
      preparePromiseRef.current = AiAssistantRepo.prepareVoiceIntent()
        .then((result) => {
          if (!result.ok) {
            console.warn('ASR 预建连失败:', result.error?.message || 'unknown');
            return null;
          }
          preparedIdRef.current = result.data.prepareId;
          if (__DEV__) console.log(`[VoicePerf] prepared_asr_ready=${result.data.prepareId}`);
          return result.data.prepareId;
        })
        .catch((error: any) => {
          console.warn('ASR 预建连异常:', error?.message || error);
          return null;
        });

      if (mountedRef.current) setIsRecording(true);
    } catch (error: any) {
      console.error('录音启动失败:', error?.message || error);
      if (mountedRef.current) {
        setIsRecording(false);
      }
      recordingStartedAtRef.current = 0;
      preparePromiseRef.current = null;
      preparedIdRef.current = null;
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch (_) {}
    }
  }, []); // dismissFeedbackInternal 在下面定义，用 ref 模式避免循环依赖
```

> **注意**: `dismissFeedbackInternal` 在 Step 5 中定义。`startRecording` 的 `useCallback` 依赖项会在组装时调整。

- [ ] **Step 5: Implement stopRecording**

从 `home.tsx:897-978` 提取。

```typescript
  // ── 停止录音 ──
  const stopRecording = useCallback(async () => {
    // Guard: 防止未录音时调用（手势 edge case）
    if (!isRecording) return;

    setIsRecording(false);
    setIsProcessing(true);
    setFeedbackText('正在识别语音...');
    // 注意：此处不设 feedbackVisible=true
    // VoiceOverlay 的处理中状态依赖 isProcessing && !feedbackVisible
    // feedbackVisible 仅在 applyIntentResult（feedback/clarify/needsAuth 意图）或 error handler 中设置

    try {
      const recording = recordingRef.current;
      if (!recording) {
        if (mountedRef.current) {
          setFeedbackText('录音失败，请重试');
          feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 1500);
        }
        return;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      // 恢复音频播放模式
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      if (!uri) {
        preparePromiseRef.current = null;
        preparedIdRef.current = null;
        if (mountedRef.current) {
          setFeedbackText('录音失败，请重试');
          feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 1500);
        }
        return;
      }

      // 等待 ASR prepare (adaptive timeout)
      const recordingDurationMs = recordingStartedAtRef.current
        ? Math.max(0, Date.now() - recordingStartedAtRef.current)
        : 0;
      const prepareId = preparedIdRef.current
        || await Promise.race<string | null>([
          preparePromiseRef.current ?? Promise.resolve(null),
          new Promise<string | null>((resolve) => setTimeout(
            () => resolve(null),
            recordingDurationMs >= 2500 ? 2600 : recordingDurationMs >= 1200 ? 1800 : 800,
          )),
        ]);

      recordingStartedAtRef.current = 0;
      preparePromiseRef.current = null;
      preparedIdRef.current = null;

      // 解析语音意图
      const result = await AiAssistantRepo.parseVoiceIntent(uri, prepareId || undefined, { page });
      if (!mountedRef.current) return;

      if (result.ok) {
        // Query invalidation
        if (!USE_MOCK && isLoggedIn) {
          void Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: ['ai-recent-conversations-home'] }),
            queryClient.invalidateQueries({ queryKey: ['ai-sessions'] }),
          ]);
        }

        const intent = result.data;
        setUserTranscript(intent.transcript);

        // 解析意图 → IntentResult
        const intentResult = await resolveIntent(intent, {
          isLoggedIn,
          cartCount,
          selectedCartCount,
        });
        if (!mountedRef.current) return;

        applyIntentResult(intentResult, intent);
      } else {
        console.error('语音识别失败:', JSON.stringify(result.error));
        setIsProcessing(false);
        setFeedbackText(`识别失败: ${result.error?.message || '未知错误'}`);
        setFeedbackVisible(true);
        feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 3000);
      }
    } catch (error: any) {
      console.error('语音识别异常:', error?.message || error);
      if (mountedRef.current) {
        setIsProcessing(false);
        setFeedbackText(`识别异常: ${error?.message || '请重试'}`);
        setFeedbackVisible(true);
        feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 1500);
      }
    }
  }, [isRecording, page, isLoggedIn, cartCount, selectedCartCount, queryClient, applyIntentResult]);
```

- [ ] **Step 6: Implement dismissFeedback, selectClarify, retryAfterAuth**

```typescript
  // ── dismissFeedback ──
  const dismissFeedbackInternal = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedbackText('');
    setFeedbackVisible(false);
    setActionLabel(null);
    setActionRoute(null);
    setActionParams(null);
    setClarifyIntent(null);
    setContinueChatContext(null);
    setUserTranscript('');
    setIsProcessing(false);
  };

  const dismissFeedback = useCallback(() => {
    dismissFeedbackInternal();
  }, []);

  // ── selectClarify ──
  // 注意：spec 中签名为 (intent: AiVoiceIntent) => void，但 plan 改为 (candidateId: string)
  // 原因：VoiceOverlay 只需传 candidate.id，hook 内部从 clarifyIntent 中查找并重建 AiVoiceIntent
  // 实现时同步更新 spec 对应签名
  const selectClarify = useCallback(async (candidateId: string) => {
    const candidate = clarifyIntent?.clarify?.candidates.find((item) => item.id === candidateId);
    if (!candidate || !clarifyIntent) return;

    setClarifyIntent(null);
    setIsProcessing(true);

    const nextIntent: AiVoiceIntent = {
      type: candidate.type,
      intent: candidate.intent ?? candidate.type,
      confidence: candidate.confidence,
      transcript: clarifyIntent.transcript,
      param: candidate.param,
      feedback: candidate.feedback,
      slots: candidate.slots,
      resolved: candidate.resolved,
      fallbackReason: candidate.fallbackReason,
      search: candidate.search,
      company: candidate.company,
      transaction: candidate.transaction,
      recommend: candidate.recommend,
    };

    const result = await resolveIntent(nextIntent, {
      isLoggedIn,
      cartCount,
      selectedCartCount,
    });
    if (mountedRef.current) {
      applyIntentResult(result, nextIntent);
    }
  }, [clarifyIntent, isLoggedIn, cartCount, selectedCartCount, applyIntentResult]);

  // ── retryAfterAuth ──
  // 返回 void（非 Promise），内部 catch 错误，调用方无需 await
  const retryAfterAuth = useCallback(() => {
    const intent = pendingIntent;
    setNeedsAuth(false);
    setPendingIntent(null);
    if (!intent) return;

    setIsProcessing(true);
    resolveIntent(intent, {
      isLoggedIn: true, // 登录成功后 isLoggedIn 为 true
      cartCount,
      selectedCartCount,
    })
      .then((result) => {
        if (mountedRef.current) {
          applyIntentResult(result, intent);
        }
      })
      .catch((error: any) => {
        console.error('retryAfterAuth 失败:', error?.message || error);
        if (mountedRef.current) {
          setIsProcessing(false);
          setFeedbackText('重试失败，请再试一次');
          setFeedbackVisible(true);
          feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 2000);
        }
      });
  }, [pendingIntent, cartCount, selectedCartCount, applyIntentResult]);

  return {
    isRecording,
    isProcessing,
    userTranscript,
    feedbackText,
    feedbackVisible,
    actionLabel,
    actionRoute,
    actionParams,
    clarifyIntent,
    continueChatContext,
    needsAuth,
    pendingIntent,
    startRecording,
    stopRecording,
    dismissFeedback,
    selectClarify,
    retryAfterAuth,
  };
}
```

- [ ] **Step 7: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`

常见问题及修复：
- `useCartStore.selectedCount()` 签名不匹配 → 检查 `src/store/useCartStore.ts` 实际方法名
- `Audio.Recording` 构造函数参数变化 → 对照 `expo-av` 版本
- `USE_MOCK` 导入路径 → 确认 `src/repos/http/config.ts` 导出

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useVoiceRecording.ts
git commit -m "feat: create useVoiceRecording hook

Extracts recording lifecycle from home.tsx into reusable hook:
permission → record → ASR prepare race → parse → resolveIntent → state.
Hook does not call useRouter — navigation is caller's responsibility."
```

---

## Chunk 3: VoiceOverlay Component

### Task 3: Create `src/components/overlay/VoiceOverlay.tsx`

非首页专用的语音 UI 组件，三种视觉状态：录音中、处理中、反馈浮层。

**Files:**
- Create: `src/components/overlay/VoiceOverlay.tsx`
- Reference: `docs/superpowers/specs/2026-03-13-global-voice-button-design.md` (视觉状态描述)
- Reference: visual companion mockup (voice-overlay-states.html)

**设计规范：**
- 使用 `src/theme/` 设计令牌（colors.ai.start, colors.surface 等）
- 动画使用 react-native-reanimated（FadeInUp, SlideInUp 等）
- 不遮挡页面主体，仅占右下角区域（录音卡片）或底部（反馈浮层）

- [ ] **Step 1: Create VoiceOverlay with types and recording state**

```typescript
// src/components/overlay/VoiceOverlay.tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  SlideInUp,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import type { AiVoiceIntent } from '../../types/domain/Ai';

type VoiceOverlayProps = {
  isRecording: boolean;
  isProcessing: boolean;
  feedbackVisible: boolean;
  feedbackText: string;
  userTranscript?: string;
  actionLabel?: string | null;
  onActionPress?: () => void;
  onContinueChat?: () => void;
  onDismiss?: () => void;
  clarifyIntent?: AiVoiceIntent | null;
  onClarifySelect?: (candidateId: string) => void;
  anchorBottom: number;
};

export function VoiceOverlay({
  isRecording,
  isProcessing,
  feedbackVisible,
  feedbackText,
  userTranscript,
  actionLabel,
  onActionPress,
  onContinueChat,
  onDismiss,
  clarifyIntent,
  onClarifySelect,
  anchorBottom,
}: VoiceOverlayProps) {
  const { colors, radius, spacing, typography, shadow } = useTheme();

  // ── 状态 1：录音中 ──
  if (isRecording) {
    return (
      <Animated.View
        entering={FadeInUp.duration(200)}
        exiting={FadeOutDown.duration(150)}
        style={[
          styles.recordingCard,
          shadow.md,
          {
            bottom: anchorBottom + 8,
            backgroundColor: colors.surface,
            borderColor: colors.ai.start,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.recordingHeader}>
          <View style={[styles.micIcon, { backgroundColor: colors.ai.start }]}>
            <Text style={{ fontSize: 14 }}>🎤</Text>
          </View>
          <Text style={[typography.bodySm, { color: colors.ai.start, fontWeight: '600' }]}>
            正在听...
          </Text>
        </View>
        {/* 波形动画条 */}
        <View style={styles.waveformRow}>
          {[8, 14, 20, 12, 16, 10, 18].map((h, i) => (
            <View
              key={i}
              style={[styles.waveBar, { height: h, backgroundColor: colors.ai.start }]}
            />
          ))}
        </View>
        <Text style={[typography.caption, { color: colors.text.tertiary, textAlign: 'center', marginTop: 4 }]}>
          松开结束
        </Text>
      </Animated.View>
    );
  }

  // ── 状态 1.5：处理中 ──
  if (isProcessing && !feedbackVisible) {
    return (
      <Animated.View
        entering={FadeIn.duration(150)}
        exiting={FadeOut.duration(150)}
        style={[
          styles.recordingCard,
          shadow.md,
          {
            bottom: anchorBottom + 8,
            backgroundColor: colors.surface,
            borderColor: colors.ai.start,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.recordingHeader}>
          <View style={[styles.micIcon, { backgroundColor: colors.ai.start }]}>
            <Text style={{ fontSize: 14 }}>🎤</Text>
          </View>
          <Text style={[typography.bodySm, { color: colors.ai.start, fontWeight: '600' }]}>
            识别中...
          </Text>
        </View>
        {/* 三点跳动 */}
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: colors.ai.start }]}
            />
          ))}
        </View>
      </Animated.View>
    );
  }

  // ── 状态 2：反馈浮层 ──
  if (!feedbackVisible) return null;

  const hasClarify = clarifyIntent?.clarify?.candidates && clarifyIntent.clarify.candidates.length > 0;
  const hasContinueChat = !!onContinueChat;

  return (
    <Animated.View
      entering={SlideInUp.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.feedbackContainer}
    >
      {/* 半透明遮罩 */}
      <Pressable style={styles.feedbackBackdrop} onPress={onDismiss} />

      <View style={[styles.feedbackContent, { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }]}>
        {/* 用户原话 */}
        {userTranscript ? (
          <View style={styles.transcriptRow}>
            <View style={[styles.transcriptDot, { backgroundColor: colors.ai.start }]} />
            <Text style={[typography.caption, { color: colors.text.tertiary, flex: 1 }]}>
              "{userTranscript}"
            </Text>
          </View>
        ) : null}

        {/* AI 回复卡片 */}
        <View style={[styles.aiReplyCard, { borderColor: `${colors.ai.start}40`, backgroundColor: `${colors.ai.start}08` }]}>
          <View style={styles.aiReplyHeader}>
            <View style={[styles.aiAvatar, { backgroundColor: colors.ai.start }]}>
              <Text style={{ fontSize: 10 }}>🌿</Text>
            </View>
            <Text style={[typography.caption, { color: colors.ai.start, fontWeight: '600' }]}>
              AI 农管家
            </Text>
          </View>
          <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 20 }]}>
            {feedbackText}
          </Text>
        </View>

        {/* 按钮区域 */}
        <View style={styles.buttonRow}>
          {hasClarify ? (
            // 消歧候选芯片
            <View style={styles.clarifyChips}>
              {clarifyIntent!.clarify!.candidates.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  onPress={() => onClarifySelect?.(candidate.id)}
                  style={[styles.clarifyChip, { borderColor: colors.ai.start, borderRadius: radius.full }]}
                >
                  <Text style={[typography.caption, { color: colors.ai.start }]}>
                    {candidate.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              {actionLabel && onActionPress ? (
                <Pressable
                  onPress={onActionPress}
                  style={[styles.primaryButton, { backgroundColor: colors.ai.start, borderRadius: radius.full }]}
                >
                  <Text style={[typography.bodySm, { color: '#fff', fontWeight: '500' }]}>
                    {actionLabel}
                  </Text>
                </Pressable>
              ) : null}
              {hasContinueChat ? (
                <Pressable
                  onPress={onContinueChat}
                  style={[styles.secondaryButton, { borderColor: `${colors.ai.start}40`, borderRadius: radius.full }]}
                >
                  <Text style={[typography.caption, { color: colors.ai.start }]}>
                    继续对话
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {/* 关闭 */}
        <Pressable onPress={onDismiss} style={styles.dismissArea}>
          <Text style={[typography.caption, { color: colors.text.tertiary }]}>点击关闭</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // ── 录音卡片 ──
  recordingCard: {
    position: 'absolute',
    right: 16,
    minWidth: 160,
    padding: 14,
    borderWidth: 1,
  },
  recordingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  micIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 22,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // ── 反馈浮层 ──
  feedbackContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    justifyContent: 'flex-end',
  },
  feedbackBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  feedbackContent: {
    padding: 20,
    paddingBottom: 32,
  },
  transcriptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  transcriptDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  aiReplyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  aiReplyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  aiAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  clarifyChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  clarifyChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  dismissArea: {
    alignItems: 'center',
    paddingTop: 12,
  },
});
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/components/overlay/VoiceOverlay.tsx
git commit -m "feat: create VoiceOverlay component

Three visual states: recording indicator, processing dots,
and feedback overlay with action buttons / clarify chips."
```

---

## Chunk 4: Integration — AiFloatingCompanion

### Task 4: Modify `src/components/effects/AiFloatingCompanion.tsx`

集成 `useVoiceRecording` hook + `VoiceOverlay` 组件。改造 LongPress 手势为录音触发。

**Files:**
- Modify: `src/components/effects/AiFloatingCompanion.tsx`
- Reference: `src/hooks/useVoiceRecording.ts` (hook)
- Reference: `src/components/overlay/VoiceOverlay.tsx` (overlay)
- Reference: `src/components/overlay/AuthModal.tsx` (auth modal)

**改动概要：**
1. 新增 imports：useVoiceRecording, VoiceOverlay, AuthModal, usePathname (已有), useRouter (已有)
2. 调用 `useVoiceRecording({ page: pathname })`
3. LongPress.onStart → startRecording, LongPress.onEnd → stopRecording
4. 渲染 VoiceOverlay 在 menu 和 orb 之间
5. 本地 `authModalOpen` state + AuthModal 渲染
6. feedback 操作按钮点击 → router.push + dismissFeedback

- [ ] **Step 1: Add imports and hook integration**

在文件顶部新增 imports，在组件中调用 hook。

```typescript
// 新增 imports（在现有 imports 之后）
import { useVoiceRecording } from '../../hooks/useVoiceRecording';
import { VoiceOverlay } from '../overlay/VoiceOverlay';
import { AuthModal } from '../overlay/AuthModal';
```

在组件内部（`const router = useRouter();` 之后）新增：

```typescript
  // ── 语音录音 ──
  const voice = useVoiceRecording({ page: pathname });
  const [authModalOpen, setAuthModalOpen] = useState(false);
```

- [ ] **Step 2: Modify LongPress gesture handler**

**现有代码** (`AiFloatingCompanion.tsx:154-159`)：
```typescript
const handleLongPress = useCallback(() => {
  hideMenu();
  dock();
  router.push('/ai/chat');
}, [hideMenu, dock, router]);
```

**替换为：**
```typescript
  // 长按开始录音
  const handleLongPressStart = useCallback(() => {
    hideMenu();
    // 如果处于 docked 状态，自动展开
    if (isDocked) {
      expand();
    }
    void voice.startRecording();
  }, [hideMenu, isDocked, expand, voice]);

  // 长按结束停止录音
  const handleLongPressEnd = useCallback(() => {
    void voice.stopRecording();
  }, [voice]);
```

**修改手势 composed** (`AiFloatingCompanion.tsx:192-216`)：

```typescript
  const composed = useMemo(() => {
    const longPress = Gesture.LongPress()
      .minDuration(400)
      .onStart(() => {
        runOnJS(handleLongPressStart)();
      })
      .onEnd(() => {
        runOnJS(handleLongPressEnd)();
      });

    const pan = Gesture.Pan()
      .activeOffsetX(15)
      .failOffsetY([-20, 20])
      .enabled(!voice.isRecording) // 录音中禁用拖拽
      .onChange((e) => {
        const newTx = EXPANDED_TX + Math.max(0, e.translationX);
        orbTranslateX.value = newTx;
      })
      .onEnd((e) => {
        runOnJS(handlePanEnd)(e.translationX);
      });

    const tap = Gesture.Tap().onEnd(() => {
      runOnJS(handleTap)();
    });

    return Gesture.Exclusive(longPress, Gesture.Race(pan, tap));
  }, [handleTap, handleLongPressStart, handleLongPressEnd, handlePanEnd, orbTranslateX, voice.isRecording]);
```

- [ ] **Step 3: Add feedback action handlers and AuthModal logic**

在组件内部新增：

```typescript
  // ── 反馈浮层操作按钮点击 ──
  const handleVoiceActionPress = useCallback(() => {
    if (voice.actionRoute) {
      router.push({ pathname: voice.actionRoute as any, params: voice.actionParams || {} });
    }
    voice.dismissFeedback();
    dock();
  }, [voice, router, dock]);

  // ── 继续对话 ──
  const handleVoiceContinueChat = useCallback(() => {
    if (voice.continueChatContext) {
      router.push({
        pathname: '/ai/chat',
        params: {
          initialTranscript: voice.continueChatContext.initialTranscript,
          initialReply: voice.continueChatContext.initialReply,
        },
      });
    } else {
      router.push('/ai/chat');
    }
    voice.dismissFeedback();
    dock();
  }, [voice, router, dock]);

  // ── navigate 意图自动跳转 ──
  useEffect(() => {
    if (voice.actionRoute && !voice.feedbackVisible && !voice.needsAuth) {
      // navigate 类意图：Toast 已由 hook 显示，这里执行跳转
      router.push({ pathname: voice.actionRoute as any, params: voice.actionParams || {} });
      voice.dismissFeedback();
      dock();
    }
  }, [voice.actionRoute, voice.feedbackVisible, voice.needsAuth, voice.actionParams, voice.dismissFeedback, router, dock]);

  // ── 登录保护 ──
  useEffect(() => {
    if (voice.needsAuth) {
      // 延迟弹出 AuthModal，让用户看到反馈文字
      const timer = setTimeout(() => setAuthModalOpen(true), 400);
      return () => clearTimeout(timer);
    }
  }, [voice.needsAuth]);

  const handleAuthSuccess = useCallback((session: any) => {
    setAuthModalOpen(false);
    // 更新登录状态（AuthModal onSuccess 返回 session）
    useAuthStore.getState().setLoggedIn(session);
    // 刷新登录相关缓存
    void queryClient.invalidateQueries();
    // 重新解析意图
    voice.retryAfterAuth();
  }, [voice, queryClient]);
```

> **注意**: 需要确保组件已导入 `useAuthStore` 和 `useQueryClient`。在 imports 中添加：
> ```typescript
> import { useQueryClient } from '@tanstack/react-query';
> import { useAuthStore } from '../../store/useAuthStore';
> ```
> 在组件内部添加 `const queryClient = useQueryClient();`

- [ ] **Step 4: Add VoiceOverlay and AuthModal to JSX**

在 `return (` 的 JSX 中，在 `{/* 上下文菜单 */}` 块之后、`{/* 停靠辉光指示器 */}` 块之前，新增：

```tsx
      {/* 语音录音 UI */}
      <VoiceOverlay
        isRecording={voice.isRecording}
        isProcessing={voice.isProcessing}
        feedbackVisible={voice.feedbackVisible}
        feedbackText={voice.feedbackText}
        userTranscript={voice.userTranscript}
        actionLabel={voice.actionLabel}
        onActionPress={handleVoiceActionPress}
        onContinueChat={voice.continueChatContext ? handleVoiceContinueChat : undefined}
        onDismiss={voice.dismissFeedback}
        clarifyIntent={voice.clarifyIntent}
        onClarifySelect={voice.selectClarify}
        anchorBottom={56}  {/* orb 高度(48) + 间距(8)。注意：此值相对于 VoiceOverlay 的父容器（AiFloatingCompanion wrapper）定位。如果 wrapper 不是全屏，需要调整为实际 orb 底部 offset。实现时验证录音卡片确实出现在 orb 正上方。 */}
      />

      {/* 登录弹窗 */}
      <AuthModal
        open={authModalOpen}
        onClose={() => { setAuthModalOpen(false); voice.dismissFeedback(); }}
        onSuccess={handleAuthSuccess}
      />
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`

重点检查：
- `voice.xxx` 属性是否与 hook 返回类型匹配
- `router.push` 的 pathname 类型（可能需要 `as any`）
- `AuthModal` props 与实际组件匹配

- [ ] **Step 6: Commit**

```bash
git add src/components/effects/AiFloatingCompanion.tsx
git commit -m "feat: integrate voice recording into AiFloatingCompanion

LongPress.onStart → startRecording, onEnd → stopRecording.
Renders VoiceOverlay for recording/feedback UI.
Adds AuthModal for login-protected voice intents."
```

---

## Chunk 5: Integration — home.tsx Refactor

### Task 5: Modify `app/(tabs)/home.tsx`

用 `useVoiceRecording` hook 替换 ~430 行内联录音逻辑。保留首页专属 UI（AiOrb 状态映射、feedbackText 显示、clarify 芯片、"继续对话"按钮）。

**Files:**
- Modify: `app/(tabs)/home.tsx`
- Reference: `src/hooks/useVoiceRecording.ts` (hook)
- Reference: `src/utils/navigateByIntent.ts` (resolveIntent)

**改动概要：**
1. 删除：录音相关 refs（180-186）、状态（120,124,170-178 部分）、handleLongPress（981-1058）、handleOrbPressOut（897-978）、navigateByIntent（469-699）、resolveTransactionRoute（274-337）、resolveCompanyRoute（339-433）、resolveRecommendRoute（435-466）、saveVoiceToStore（225-245）、queueProtectedVoiceIntent（251-259）、isProtectedVoiceRoute（247-249）、normalizeCompanyLookupText（102-109）、findTrackableOrderId（261-272）、录音动画 refs+useEffect（755-811）
2. 新增：`useVoiceRecording({ page: 'home' })` 调用
3. 保留：AiOrb 状态映射、首页 UI（feedbackText 区域、clarify 芯片、"继续对话"按钮）
4. 首页行为：navigate/feedback 意图均自动跳转（`useEffect` 监听 `actionRoute`）

**策略：** 由于改动涉及 ~430 行删除和 ~50 行新增，逐步替换而非一次性重写。

- [ ] **Step 1: Add hook import and call**

在 `home.tsx` 顶部新增 import：

```typescript
import { useVoiceRecording } from '../../src/hooks/useVoiceRecording';
```

在组件内部（state 声明区域）新增：

```typescript
const voice = useVoiceRecording({ page: 'home' });
```

- [ ] **Step 2: Delete extracted functions and refs**

**删除以下内容（按行号从大到小删，避免行号偏移）：**

1. **录音动画** (755-811)：`recordHaloScale`, `recordHaloOpacity`, `recordRippleScale`, `recordRippleOpacity` 共享值、useEffect、useAnimatedStyle → 保留，因为首页 AiOrb 需要这些动画。但将 `isRecording` 改为 `voice.isRecording`。

2. **handleLongPress** (981-1058)：整个函数 → 替换为：
```typescript
const handleLongPress = useCallback(async () => {
  suppressShortPressUntilRef.current = Date.now() + 1500;
  void voice.startRecording();
}, [voice]);
```

3. **handleOrbPressOut** (897-978)：整个函数 → 替换为：
```typescript
const handleOrbPressOut = useCallback(async () => {
  void voice.stopRecording();
}, [voice]);
```

4. **navigateByIntent** (469-699)：整个函数 → 删除

5. **resolveTransactionRoute** (274-337)：整个函数 → 删除

6. **resolveCompanyRoute** (339-433)：整个函数 → 删除

7. **resolveRecommendRoute** (435-466)：整个函数 → 删除

8. **saveVoiceToStore** (225-245)：整个函数 → 删除

9. **isProtectedVoiceRoute** (247-249)：整个函数 → 删除

10. **queueProtectedVoiceIntent** (251-259)：整个函数 → 删除

11. **findTrackableOrderId** (261-272)：整个函数 → 删除

12. **normalizeCompanyLookupText** (102-109)：整个函数 → 删除

13. **录音相关 refs** (180-186)：`recordingRef`, `prepareVoiceIntentPromiseRef`, `preparedVoiceIntentIdRef`, `recordingStartedAtRef`, `suppressShortPressUntilRef` → 删除（保留 `suppressShortPressUntilRef` 因为首页 Pressable 仍需要它，以及 `pendingProtectedIntentRef`）

14. **状态变量**：`isRecording` (120), `isProcessing` (124) → 删除（改用 `voice.isRecording`, `voice.isProcessing`）。`feedbackText` (170), `clarifyIntent` (171) → 删除（改用 `voice.feedbackText`, `voice.clarifyIntent`）。`showContinueChat`, `pendingChatContext` → **删除**，改为从 `voice.continueChatContext !== null` 派生。

> **重要**: `handleShortPress` 中引用的 `isRecording`/`isProcessing` 必须替换为 `voice.isRecording`/`voice.isProcessing`。例如：
> ```typescript
> // 原代码
> if (isRecording || isProcessing) return;
> // 替换为
> if (voice.isRecording || voice.isProcessing) return;
> ```

15. **feedbackTimer ref** (172)：删除

16. **feedbackTimer cleanup useEffect** (748-752)：删除

17. **handleClarifyCandidatePress** (701-722)：改为调用 `voice.selectClarify(candidateId)`

18. **handleVoiceAuthSuccess** (724-745)：替换为：
```typescript
const handleVoiceAuthSuccess = useCallback((session: any) => {
  setAuthModalOpen(false);
  useAuthStore.getState().setLoggedIn(session);
  void queryClient.invalidateQueries();
  voice.retryAfterAuth();
}, [voice, queryClient]);
```

- [ ] **Step 3: Add auto-navigate useEffect for home page**

首页行为：navigate 和 feedback 意图均自动跳转。

```typescript
// 首页自动跳转行为
useEffect(() => {
  if (!voice.actionRoute) return;
  if (voice.needsAuth) return;

  // 有反馈文字时延迟 1.5 秒后跳转，否则立即跳转
  const delay = voice.feedbackText ? 1500 : 0;
  const timer = setTimeout(() => {
    router.push({ pathname: voice.actionRoute as any, params: voice.actionParams || {} });
    voice.dismissFeedback();
  }, delay);
  return () => clearTimeout(timer);
}, [voice.actionRoute, voice.needsAuth, voice.feedbackText, voice.actionParams, voice.dismissFeedback, router]);

// needsAuth → 弹出 AuthModal
useEffect(() => {
  if (voice.needsAuth) {
    const timer = setTimeout(() => setAuthModalOpen(true), 400);
    return () => clearTimeout(timer);
  }
}, [voice.needsAuth]);
```

- [ ] **Step 4: Update AiOrb state mapping and recording animations**

```typescript
// AiOrb 状态映射（使用 hook 状态）
const orbState = voice.isRecording ? 'listening' : voice.isProcessing ? 'thinking' : 'idle';
```

录音动画 useEffect 中，将 `isRecording` 依赖改为 `voice.isRecording`：

```typescript
useEffect(() => {
  if (voice.isRecording) {
    // ... 录音中动画（不变）
  } else {
    // ... idle 动画（不变）
  }
}, [voice.isRecording, recordHaloScale, recordHaloOpacity, recordRippleScale, recordRippleOpacity]);
```

- [ ] **Step 5: Update JSX references**

将 JSX 中所有 `feedbackText` 引用改为 `voice.feedbackText`，`clarifyIntent` 改为 `voice.clarifyIntent`，`isRecording` 改为 `voice.isRecording` 等。

首页 clarify 芯片的 `onPress` 改为 `voice.selectClarify(candidateId)`。

"继续对话" 按钮的条件改为 `voice.continueChatContext !== null`。点击时：
```typescript
router.push({
  pathname: '/ai/chat',
  params: {
    initialTranscript: voice.continueChatContext!.initialTranscript,
    initialReply: voice.continueChatContext!.initialReply,
  },
});
voice.dismissFeedback();
```

删除所有对 `showContinueChat` 和 `pendingChatContext` 本地 state 的引用，统一使用 `voice.continueChatContext`。

JSX 中原有条件 `{showContinueChat && pendingChatContext && !clarifyIntent && (...)}` 替换为：
```tsx
{voice.continueChatContext && !voice.clarifyIntent && (
  // "继续对话" 按钮
)}
```

- [ ] **Step 6: Clean up unused imports**

删除不再需要的 imports：
- `OrderRepo`（如果只在已删除的 resolveTransactionRoute 中使用）
- `CompanyRepo`（同上）
- `Audio` from expo-av（如果只在已删除的录音逻辑中使用）
- 其他不再引用的函数/类型

- [ ] **Step 7: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -50`

这是最容易出错的步骤。常见问题：
- 删除过多/过少导致引用断裂
- `voice.xxx` 属性名不匹配
- `suppressShortPressUntilRef` 仍被 `handleShortPress` 引用但被误删
- `pendingProtectedIntentRef` 仍被 `handleVoiceAuthSuccess` 引用但被误删
- JSX 中的旧变量名未全部替换

逐个修复直到编译通过。

- [ ] **Step 8: Commit**

```bash
git add app/(tabs)/home.tsx
git commit -m "refactor: replace inline recording logic with useVoiceRecording hook

Removes ~430 lines of recording/intent-routing logic from home.tsx.
Uses shared hook for recording lifecycle, resolveIntent for routing.
Home page keeps auto-navigate behavior and AiOrb visual state."
```

---

## Chunk 6: Verification & Documentation

### Task 6: End-to-End Verification

- [ ] **Step 1: Full TypeScript compilation check**

```bash
npx tsc --noEmit --pretty
```

确保零错误。

- [ ] **Step 2: Visual verification checklist**

在模拟器/真机上手动测试：

**首页：**
- [ ] 长按 AiOrb → 录音指示器动画正常
- [ ] 松开 → 识别中状态 → feedbackText 显示
- [ ] search 意图 → 短暂显示反馈 → 自动跳转搜索页
- [ ] navigate 意图 → Toast + 自动跳转
- [ ] clarify 意图 → 候选芯片显示，点击后正确路由
- [ ] chat 意图 → "继续对话"按钮显示，点击跳转聊天页
- [ ] 未登录时 settings/orders → AuthModal 弹出 → 登录后自动恢复

**非首页（如商品详情页、发现页）：**
- [ ] AI 浮窗显示（非首页 tab）
- [ ] 短按 → 菜单展开（行为不变）
- [ ] 长按 400ms → 录音卡片从按钮上方弹出
- [ ] 松开 → "识别中..." → 反馈浮层
- [ ] search 意图 → 反馈浮层 + "去搜索" 按钮 → 点击跳转
- [ ] navigate 意图 → Toast + 自动跳转
- [ ] "继续对话" 按钮 → 跳转聊天页
- [ ] 点击关闭/遮罩 → 浮层消失
- [ ] 拖拽手势在非录音时正常，录音中禁用

- [ ] **Step 3: Update ai.md progress**

在 `ai.md` 中更新全局语音按钮功能的进度状态。

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs: update ai.md with global voice button progress"
```
