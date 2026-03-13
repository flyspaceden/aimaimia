# 全局 AI 语音按钮设计方案

## 概述

将首页 AI 买买按钮的语音能力扩展到全局：每个页面右下角的 AI 浮动按钮都支持长按录音 → ASR → 意图识别 → 执行动作，而不只是点击跳转聊天页。

## 设计决策

| 决策 | 结论 | 原因 |
|------|------|------|
| 意图范围 | 全局路由，不感知页面上下文 | 用户心智模型统一，同一句话在任何页面行为一致 |
| 反馈展示 | 轻量底部浮层（导航类直接执行 + Toast） | 不打断用户当前页面操作 |
| 按钮交互 | 短按 = 进聊天页，长按 = 录音 | 与首页一致，复用微信语音交互范式 |
| 录音 UI | 悬浮卡片指示器，非全屏 | 不遮挡页面主体内容 |
| 首页 vs 全局反馈行为 | **首页保持自动跳转**，全局浮窗改为按钮确认后跳转 | 首页 AiOrb 有专属视觉反馈（feedback 文字 + 自动跳转是已有 UX），全局浮窗在任意页面弹出，用户可能并不想离开当前页，需要确认 |

## 架构方案：共享 hook + overlay 组件

从 `home.tsx` 提取录音逻辑和意图路由为可复用单元，`AiFloatingCompanion` 和 `home.tsx` 共用。

### 新建文件

#### 1. `src/hooks/useVoiceRecording.ts` — 录音生命周期 hook

封装完整录音流程：权限请求 → 录音 → ASR prepare race → 上传 → 意图解析 → 路由执行。

**内部依赖的 hooks**：`useToast()`（显示 navigate 意图的 toastText）、`useAuthStore()`（获取 isLoggedIn）、`useCartStore()`（获取 cartCount / selectedCartCount）、`useQueryClient()`（invalidate queries）、`useAiChatStore()`（持久化语音历史）。

> **注意**：hook 不包含 `useRouter()`——路由跳转由调用方决定（首页自动跳转 vs 全局按钮确认后跳转），hook 仅设状态。

**接口：**

```typescript
type UseVoiceRecordingOptions = {
  page: string; // 当前页面标识，传给 parseVoiceIntent（首页传 'home'，全局浮窗传 usePathname() 实际路径，用于后端分析埋点）
};

type UseVoiceRecordingReturn = {
  // 状态
  isRecording: boolean;
  isProcessing: boolean;
  userTranscript: string;              // ASR 识别到的用户原话
  feedbackText: string;                // AI 反馈文案
  feedbackVisible: boolean;
  actionLabel: string | null;          // 主按钮文字，如 "去搜索"
  actionRoute: string | null;          // 主按钮跳转路由
  actionParams: Record<string, string> | null; // 主按钮跳转参数
  clarifyIntent: AiVoiceIntent | null;
  continueChatContext: { initialTranscript: string; initialReply: string } | null;
  needsAuth: boolean;                  // 当前意图需要登录但用户未登录
  pendingIntent: AiVoiceIntent | null; // 登录后需恢复执行的原始意图（重新走 resolveIntent）

  // 操作
  startRecording: () => Promise<void>;  // 长按触发
  stopRecording: () => Promise<void>;   // 松手触发
  dismissFeedback: () => void;          // 关闭反馈
  selectClarify: (intent: AiVoiceIntent) => void; // 选择消歧候选
  retryAfterAuth: () => void;           // 登录成功后重新执行 pendingIntent
};
```

**内部流程（从 home.tsx 提取）：**

1. `startRecording()`：
   - 清理上一次录音对象
   - 请求麦克风权限
   - 设置 Audio 模式为录音
   - 创建 WAV 录音（16kHz 单声道）
   - 启动录音 + 并行调 `prepareVoiceIntent()`（非阻塞）
   - 设置 `isRecording = true`

2. `stopRecording()`：
   - 停止录音、获取 URI
   - 恢复 Audio 播放模式
   - Race prepare promise with adaptive timeout
   - 调 `parseVoiceIntent(uri, prepareId, { page })`
   - 从 `AiVoiceIntent.transcript` 提取 `userTranscript`（ASR 原话，在调 resolveIntent 之前保存）
   - 调 `await resolveIntent(intent, { isLoggedIn, cartCount, selectedCartCount })` 获取 IntentResult
   - 分解 IntentResult 到各独立状态字段（**路由职责划分——hook 不自动跳转，全部由调用方决定**）：
     - `navigate` → 设 toastText（通过 `useToast()` 显示）。hook 将 `route`/`params` 暴露到返回值的 `actionRoute`/`actionParams`，由调用方决定何时执行 `router.push()`。
     - `feedback` → 设 feedbackVisible / feedbackText / actionLabel / actionRoute / actionParams / continueChatContext。
     - `clarify` → 设 clarifyIntent。
   - **调用方行为差异**（产品决策，非实现细节）：
     - **首页（home.tsx）**：`navigate` / `feedback` 意图均**自动跳转**（短暂展示 feedback 文字后执行 `router.push()`），保持现有首页 AiOrb 的交互体验不变。
     - **全局（AiFloatingCompanion）**：`navigate` 意图自动跳转 + Toast；`feedback` 意图展示浮层，**用户点击操作按钮后才跳转**（用户可能不想离开当前页面）。
   - 若 IntentResult.needsAuth === true → 设 `needsAuth = true`，`pendingIntent = intent`（存原始 `AiVoiceIntent`，非 `IntentResult`），不执行跳转
   - 调 `queryClient.invalidateQueries({ queryKey: ['ai-recent-conversations-home'] })` 和 `['ai-sessions']`

3. `dismissFeedback()`：重置所有反馈状态
4. `selectClarify(intent)`：对消歧候选重新走 resolveIntent
5. `retryAfterAuth()`：从 `pendingIntent`（原始 `AiVoiceIntent`）重新调 `resolveIntent()`（此时 `isLoggedIn = true`），执行结果。重置 `needsAuth` 和 `pendingIntent`。

**生命周期管理：**
- hook 内部使用 `useEffect` 返回 cleanup 函数：组件卸载时（如页面切换导致 AiFloatingCompanion 返回 null）自动停止并释放正在进行的录音（`recording.stopAndUnloadAsync()`）、恢复 Audio 模式、通过 `mountedRef = false` 标记忽略未完成的 `prepareVoiceIntent` promise 结果并清空对应 ref（当前 repo/API 层无 AbortSignal 支持，不做真正取消；若未来需要真正取消网络请求，需先给 `AiSessionRepo.prepareVoiceIntent` 增加 AbortSignal 参数）。
- `stopRecording()` 必须 guard `isRecording === false` 的情况（no-op），防止手势 edge case 导致的重复调用。

**错误处理：**
- `parseVoiceIntent` 或 `resolveIntent` 失败时（网络错误/超时），将错误信息设入 `feedbackText`（如 "语音识别失败，请重试"），`feedbackVisible = true`，无操作按钮。3 秒后自动 `dismissFeedback()`。
- 与 home.tsx 现有错误处理逻辑一致。

**语音历史持久化：**
- `stopRecording()` 成功完成后，调用 `saveVoiceToStore()`（从 home.tsx 提取到 hook 内部）将语音交互记录持久化到 `useAiChatStore`，供 AI 聊天历史展示。

#### 2. `src/utils/navigateByIntent.ts` — 意图路由纯函数

从 home.tsx 的 `navigateByIntent` 提取，去掉 UI 状态依赖，变为异步函数（company 意图需查询企业 ID、transaction 需构造参数）。导出 `IntentResult` 类型和 `resolveIntent` 函数，供 `useVoiceRecording` hook 和 home.tsx 使用。

**接口：**

```typescript
type IntentResult = {
  action: 'navigate' | 'feedback' | 'clarify';
  // navigate: 直接跳转
  route?: string;
  params?: Record<string, string>;
  toastText?: string;
  // feedback: 展示反馈浮层
  feedbackText?: string;
  actionLabel?: string;     // 主按钮文字，如 "去搜索"
  actionRoute?: string;     // 主按钮跳转路由
  actionParams?: Record<string, string>;
  // chat 特殊处理
  continueChatContext?: { initialTranscript: string; initialReply: string };
  // clarify: 消歧
  clarifyIntent?: AiVoiceIntent;
  // 登录保护
  needsAuth?: boolean;      // 该意图需要登录但用户未登录
};

async function resolveIntent(
  intent: AiVoiceIntent,
  options: { isLoggedIn: boolean; cartCount: number; selectedCartCount: number },
): Promise<IntentResult>;
```

> **为什么是 async**：company 意图可能需要通过企业名称查 companyId（API 调用），transaction 意图需要解析订单状态参数。纯路由映射的意图（navigate、search）内部同步返回，但签名统一为 async 以兼容所有意图类型。

**意图处理规则：**

| 意图类型 | action | 行为 |
|---------|--------|------|
| `navigate` | `'navigate'` | 直接跳转 + Toast |
| `search` | `'feedback'` | 浮层：AI 回复 + "去搜索" 按钮 |
| `company` | `'feedback'` | 浮层：AI 回复 + "查看企业" 按钮 |
| `recommend` | `'feedback'` | 浮层：AI 回复 + "查看推荐" 按钮 |
| `transaction` | `'feedback'` | 浮层：AI 回复 + "查看订单" 按钮 |
| `chat` | `'feedback'` | 浮层：AI 回复 + "继续对话" 按钮（跳聊天页带初始上下文） |
| `clarify` | `'clarify'` | 浮层：消歧候选芯片 |

**登录保护**：protected routes（settings、orders、payment、checkout）在未登录时返回 `{ ...originalResult, needsAuth: true }`。调用方（hook）将结果存入 `pendingIntent`，设 `needsAuth = true`。

- **首页（home.tsx）**：弹出现有 AuthModal（本地 `authModalOpen` state），登录成功后 `onSuccess` 回调中调 `retryAfterAuth()` 恢复执行原意图。
- **全局（AiFloatingCompanion）**：在组件内新增本地 `authModalOpen` state + 渲染 `<AuthModal open={authModalOpen} onClose={...} onSuccess={retryAfterAuth} />`，与 home.tsx 同模式。当 hook 返回 `needsAuth === true` 时，设 `authModalOpen = true`。

**Toast 实现**：`navigate` 意图的 toastText 使用项目已有的 `useToast()` hook（`src/components/feedback/Toast.tsx`）展示，2 秒后自动消失。

#### 3. `src/components/overlay/VoiceOverlay.tsx` — 录音指示器 + 反馈浮层

非首页专用的语音 UI 组件，由 `AiFloatingCompanion` 渲染。

**Props：**

```typescript
type VoiceOverlayProps = {
  isRecording: boolean;
  isProcessing: boolean;
  feedbackVisible: boolean;
  feedbackText: string;
  userTranscript?: string;
  actionLabel?: string;           // 主按钮文字
  onActionPress?: () => void;     // 主按钮点击
  onContinueChat?: () => void;    // "继续对话" 点击
  onDismiss?: () => void;         // 关闭浮层
  clarifyIntent?: AiVoiceIntent | null;
  onClarifySelect?: (intent: AiVoiceIntent) => void;
  anchorBottom: number;           // 按钮底部位置，用于定位悬浮卡片
};
```

**三种视觉状态：**

**状态 1 — 录音中（isRecording = true）：**
- 悬浮卡片从按钮上方弹出（FadeInUp 动画）
- 内容：🎤 图标 + "正在听..." + 波形动画条 + "松开结束" 提示
- 外圈脉冲光晕（1.5s 循环）
- 不遮挡页面主体，仅占右下角小区域

**状态 1.5 — 处理中（isProcessing = true，isRecording = false）：**
- 悬浮卡片保持显示（从录音状态过渡，不闪烁）
- 内容：🎤 图标 + "识别中..." + 三点跳动动画（替代波形）
- 对应首页 AiOrb 的 `thinking` 状态
- 处理完成后自动过渡到反馈浮层或消失（navigate 意图）

**状态 2 — 反馈浮层（feedbackVisible = true）：**
- 底部半透明渐变覆盖层（从底部向上渐隐）
- 内容：
  - 用户原话（小字灰色，前缀圆点）
  - AI 回复卡片（绿色边框 + 农管家头像 + 回复文字）
  - 按钮区域：
    - `navigate` 意图：不显示浮层，仅 Toast
    - `search/company/recommend/transaction`：主按钮（绿色实心）+ "继续对话" 次按钮
    - `chat`：仅 "继续对话" 按钮
    - `clarify`：消歧候选芯片列表
- 点击关闭/开始新录音时浮层消失
- 页面跳转后自动关闭

**动画：**
- 录音卡片：`FadeInUp.duration(200)` / `FadeOutDown.duration(150)`
- 反馈浮层：`SlideInUp.duration(300)` / `FadeOut.duration(200)`
- 使用 react-native-reanimated

### 修改文件

#### 4. `src/components/effects/AiFloatingCompanion.tsx`

**当前行为：**
- tap → 展开/收起菜单
- longPress → 跳转 `/ai/chat`
- pan → 拖动 dock/undock

**改为（仅使用 Gesture Handler API，不依赖 Pressable）：**
- tap → 展开/收起菜单（不变）
- `LongPress.onStart` → 调 `startRecording()`（长按阈值达到后开始录音）
- `LongPress.onEnd` → 调 `stopRecording()`（手指抬起后停止录音）
- pan → 拖动 dock/undock（不变）
- 菜单项点击 → 跳转 `/ai/chat?prompt=xxx`（不变）

**新增：**
- 引入 `useVoiceRecording({ page: usePathname() })` hook（传入实际页面路径用于后端分析埋点，意图路由仍是全局统一的）
- 在 Companion 内部渲染 `<VoiceOverlay />` 组件
- 录音中自动展开按钮（如果处于 docked 状态）
- 录音中禁用 pan 手势（防止误触）
- 反馈浮层中按钮点击后调 `router.push()` 并 `dismissFeedback()`

**手势处理调整：**
- 当前：`Gesture.Exclusive(longPress, Gesture.Race(pan, tap))`
- 改为：`Gesture.LongPress` 的 `onStart`（长按阈值达到后触发）调 `startRecording()`，`onEnd`（手指抬起时触发）调 `stopRecording()`。与现有 pan/tap 保持 Exclusive 关系。

> **注意 1**：不能用 `onBegin`，因为 `onBegin` 在手指触碰屏幕时立即触发（长按阈值之前），会导致短按也触发录音。`onStart` 在长按持续时间达到 `minDuration` 阈值后才触发，符合预期行为。

> **注意 2**：不能用 `onFinalize`，因为 `onFinalize` 在手势到达任何终态时都会触发——包括长按阈值未达到时手势 FAILED 的情况。此时 `onStart` 从未调用，录音从未开始，但 `stopRecording()` 会被错误调用。`onEnd` 仅在手势曾处于 ACTIVE 状态（即 `onStart` 已触发）后才会触发，语义正确。

> **注意 3**：`Gesture.Exclusive(longPress, ...)` 确保长按激活期间 tap 手势不会被识别。长按 `onEnd` 触发后手势重置，后续快速再触碰会重新进入手势竞争，但这是一个新的独立手势周期，不会产生误触。无需额外的 `suppressShortPressUntilRef` 机制（home.tsx 需要它是因为使用了 Pressable 而非 Gesture Handler）。

#### 5. `app/(tabs)/home.tsx`

**删除（~430 行）：**
- `handleLongPress` 中的录音逻辑（权限、Audio.Recording 创建、prepare race）→ 改为调 `startRecording()`
- `handleOrbPressOut` 中的停止/上传/解析逻辑 → 改为调 `stopRecording()`
- `navigateByIntent` 函数整体 → 改为调 `resolveIntent()` + 本地 UI 处理
- 相关 refs：`recordingRef`、`recordingStartedAtRef`、`prepareVoiceIntentPromiseRef`、`preparedVoiceIntentIdRef`

**保留（首页特有）：**
- AiOrb 视觉状态控制（idle/listening/thinking/responding）
- Paired mode 布局（AiOrb + 抽奖按钮并排）
- 首页专属反馈区域（feedbackText 显示、clarify 芯片、"继续对话" 按钮）
- 首页不使用 `VoiceOverlay`，因为有自己的专属 UI

**home.tsx 使用 hook 的方式：**

```typescript
const {
  isRecording, isProcessing, userTranscript, feedbackText,
  actionLabel, actionRoute, actionParams,
  clarifyIntent, continueChatContext, needsAuth, pendingIntent,
  startRecording, stopRecording, dismissFeedback, selectClarify, retryAfterAuth,
} = useVoiceRecording({ page: 'home' });

// AiOrb 状态映射
const orbState = isRecording ? 'listening' : isProcessing ? 'thinking' : 'idle';

// 首页行为：navigate 和 feedback 均自动跳转（保持现有 UX）
useEffect(() => {
  if (!actionRoute) return;
  // 短暂展示 feedbackText 后自动跳转
  const timer = setTimeout(() => {
    router.push({ pathname: actionRoute, params: actionParams ?? {} });
    dismissFeedback();
  }, feedbackText ? 1500 : 0); // 有反馈文字时延迟 1.5 秒
  return () => clearTimeout(timer);
}, [actionRoute]);

// clarify 通过 clarifyIntent 状态驱动首页芯片 UI
// needsAuth → 弹出 AuthModal，登录成功后调 retryAfterAuth()
```

## 不在本次范围

- 聊天页语音输入（ASR → 文字 → Qwen-Plus）— 独立功能，不在本 spec
- 页面上下文感知意图（如订单页说"退货"自动关联当前订单）— 未来增强
- 录音中断处理（来电/切后台）— 依赖 expo-av 自动处理，暂不额外处理
