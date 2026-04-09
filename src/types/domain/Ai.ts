/**
 * 域模型：AI 智能创作（配乐/标签）
 *
 * 用途：
 * - 发布页：AI 智能配乐、AI 自动打标/推荐标签
 *
 * 后端接入建议：
 * - 由后端提供推荐结果（见 `说明文档/后端接口清单.md#44-ai-智能创作助手配乐打标`）
 */
export type AiMusicTrack = {
  id: string;
  title: string;
  mood: string;
  bpm: number;
  duration: string;
  cover: string;
};

export type AiTagSuggestion = {
  label: string;
  reason?: string;
};

export type AiChatRole = 'user' | 'assistant' | 'system';

export type AiChatMessage = {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: string;
};

export type AiShortcut = {
  id: string;
  title: string;
  prompt: string;
};

/** AI 对话历史摘要项 */
export type AiChatHistoryItem = {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
};

export type AiActionExecutionRecord = {
  id: string;
  type: string;
  payload?: Record<string, any>;
  success: boolean;
  error?: string | null;
};

export type AiIntentResultRecord = {
  id: string;
  intent: string;
  slots?: Record<string, any> | null;
  confidence?: number | null;
  candidates?: any;
  modelInfo?: Record<string, any> | null;
  actions: AiActionExecutionRecord[];
};

export type AiSessionUtterance = {
  id: string;
  transcript: string;
  audioUrl?: string | null;
  createdAt: string;
  intentResults: AiIntentResultRecord[];
};

export type AiSessionSummary = {
  id: string;
  page: string;
  createdAt: string;
  lastMessage: string;
  lastMessageAt?: string | null;
};

export type AiRecentConversationItem = {
  id: string;
  sessionId: string;
  page: string;
  question: string;
  answer?: string;
  createdAt: string;
};

export type AiSessionDetail = {
  id: string;
  page: string;
  context?: Record<string, any> | null;
  createdAt: string;
  utterances: AiSessionUtterance[];
};

/** AI 语音跳转目标（前端只对白名单页面做路由） */
export type AiVoiceNavigateTarget =
  | 'home'
  | 'discover'
  | 'me'
  | 'settings'
  | 'cart'
  | 'checkout'
  | 'orders'
  | 'search'
  | 'ai-chat';

/** AI 语音意图解析结果 */
export type AiVoiceTransactionAction =
  | 'transaction'
  | 'view-order'
  | 'track-order'
  | 'pay'
  | 'refund'
  | 'return'
  | 'exchange'
  | 'after-sale';

export type AiRecommendTheme = 'hot' | 'discount' | 'tasty' | 'seasonal' | 'recent';
export type AiVoiceCompanyMode = 'list' | 'detail' | 'search';
export type AiVoiceSortIntent = 'default' | 'recommended' | 'hot' | 'discount' | 'tasty' | 'seasonal' | 'recent';
export type AiVoiceCompanyType = 'farm' | 'company' | 'cooperative' | 'base' | 'factory' | 'store';

export type AiVoiceIntentType = 'search' | 'company' | 'chat' | 'navigate' | 'transaction' | 'recommend' | 'clarify';
export type AiVoiceTransactionStatus = 'pendingPay' | 'pendingShip' | 'shipping' | 'afterSale';

export type AiVoiceDemandSlots = {
  query?: string;
  categoryHint?: string;
  constraints?: string[];
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
  audience?: string;
  budget?: number;
  preferRecommended?: boolean;
  recommendThemes?: AiRecommendTheme[];
  sortIntent?: AiVoiceSortIntent;
};

export type AiVoiceSearchParams = {
  query: string;
  action?: 'add-to-cart';
  matchedProductId?: string;
  matchedProductName?: string;
  matchedCategoryId?: string;
  matchedCategoryName?: string;
  preferRecommended?: boolean;
  constraints?: string[];
  maxPrice?: number;
  recommendThemes?: AiRecommendTheme[];
  slots?: AiVoiceDemandSlots;
};

export type AiVoiceTransactionParams = {
  action: AiVoiceTransactionAction;
  status?: AiVoiceTransactionStatus;
};

export type AiVoiceRecommendParams = {
  query?: string;
  matchedCategoryId?: string;
  matchedCategoryName?: string;
  preferRecommended?: boolean;
  constraints?: string[];
  budget?: number;
  recommendThemes?: AiRecommendTheme[];
  slots?: AiVoiceDemandSlots;
};

export type AiVoiceCompanyParams = {
  mode: AiVoiceCompanyMode;
  name?: string;
  industryHint?: string;
  location?: string;
  companyType?: AiVoiceCompanyType;
  featureTags?: string[];
};

export type AiVoiceIntentSlots = AiVoiceDemandSlots & {
  targetPage?: AiVoiceNavigateTarget;
  companyMode?: AiVoiceCompanyMode;
  companyName?: string;
  companyIndustryHint?: string;
  companyLocation?: string;
  companyType?: AiVoiceCompanyType;
  companyFeatureTags?: string[];
  transactionAction?: AiVoiceTransactionAction;
  transactionStatus?: AiVoiceTransactionStatus;
};

export type AiVoiceResolved = {
  query?: string;
  navigateTarget?: AiVoiceNavigateTarget;
  companyId?: string;
  companyName?: string;
  companyMode?: AiVoiceCompanyMode;
  companyIndustryHint?: string;
  companyLocation?: string;
  companyType?: AiVoiceCompanyType;
  companyFeatureTags?: string[];
  matchedProductId?: string;
  matchedProductName?: string;
  matchedCategoryId?: string;
  matchedCategoryName?: string;
  transactionAction?: AiVoiceTransactionAction;
  transactionStatus?: AiVoiceTransactionStatus;
  constraints?: string[];
  budget?: number;
  preferRecommended?: boolean;
  recommendThemes?: AiRecommendTheme[];
  sortIntent?: AiVoiceSortIntent;
  usageScenario?: string;
  originPreference?: string;
  dietaryPreference?: string;
  promotionIntent?: 'threshold-optimization' | 'best-deal';
  bundleIntent?: 'meal-kit' | 'complement';
  flavorPreference?: string;
  categoryHint?: string;
};

export type AiVoiceClarifyCandidate = {
  id: string;
  label: string;
  type: Exclude<AiVoiceIntentType, 'clarify'>;
  intent?: Exclude<AiVoiceIntentType, 'clarify'>;
  confidence?: number;
  param?: string;
  feedback: string;
  slots?: AiVoiceIntentSlots;
  resolved?: AiVoiceResolved;
  fallbackReason?: string;
  search?: AiVoiceSearchParams;
  company?: AiVoiceCompanyParams;
  transaction?: AiVoiceTransactionParams;
  recommend?: AiVoiceRecommendParams;
};

export type AiVoiceClarifyParams = {
  candidates: AiVoiceClarifyCandidate[];
};

export type AiVoiceTiming = {
  asr_ms?: number;
  asr_connect_ms?: number;
  asr_wait_final_ms?: number;
  classify_ms?: number;
  clarify_ms?: number;
  entity_resolve_ms?: number;
  handler_ms?: number;
  total_ms?: number;
  flash_ms?: number;
  plus_ms?: number;
  fast_route_hit?: boolean;
  model_route?: 'rule' | 'fast' | 'flash' | 'plus' | 'fallback';
  upgraded?: boolean;
};

export type AiVoiceIntent = {
  /** 意图类型 */
  type: AiVoiceIntentType;
  /** 统一协议意图类型（与 type 并存，兼容旧代码） */
  intent?: AiVoiceIntentType;
  /** 一级分类/最终执行置信度 */
  confidence?: number;
  /** 识别到的文本 */
  transcript: string;
  /** 导航参数（搜索关键词 / 公司名 / 聊天prompt / navigate target / transaction action） */
  param?: string;
  /** 给用户的反馈文案 */
  feedback: string;
  /** 统一结构化 slots */
  slots?: AiVoiceIntentSlots;
  /** 统一结构化 resolved 实体 */
  resolved?: AiVoiceResolved;
  /** 低置信/降级原因 */
  fallbackReason?: string;
  /** search 意图的结构化参数 */
  search?: AiVoiceSearchParams;
  /** company 意图的结构化参数 */
  company?: AiVoiceCompanyParams;
  /** transaction 意图的结构化参数 */
  transaction?: AiVoiceTransactionParams;
  /** recommend 意图的结构化参数 */
  recommend?: AiVoiceRecommendParams;
  /** clarify 意图的候选项 */
  clarify?: AiVoiceClarifyParams;
  /** out-of-domain 引导式回复 */
  chatResponse?: {
    reply: string;
    suggestedActions: AiSuggestedAction[];
  };
  /** 语音链路耗时埋点（后端返回） */
  timing?: AiVoiceTiming;
};

// ===== Phase 2: 多轮对话类型 =====

/** AI 建议操作（由 Qwen-Plus 多轮对话生成） */
export type AiSuggestedAction = {
  type: 'search' | 'navigate' | 'company' | 'recommend';
  label: string;
  resolved?: Record<string, any>;
};

/** AI 聊天响应（包含回复文本、建议操作、追问建议） */
export type AiChatResponse = {
  reply: string;
  suggestedActions: AiSuggestedAction[];
  followUpQuestions: string[];
};

/** 扩展 AiChatMessage，支持附带 suggestedActions 和 followUpQuestions */
export type AiChatMessageExtended = AiChatMessage & {
  suggestedActions?: AiSuggestedAction[];
  followUpQuestions?: string[];
};
