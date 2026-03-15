export const VALID_NAVIGATE_TARGETS = [
  'home',
  'discover',
  'me',
  'settings',
  'cart',
  'checkout',
  'orders',
  'search',
  'ai-chat',
] as const;

export type AiVoiceNavigateTarget = typeof VALID_NAVIGATE_TARGETS[number];

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

export interface AiVoiceDemandSlots {
  query?: string;
  categoryHint?: string;
  constraints?: string[];
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
  audience?: string;
  budget?: number;
  preferRecommended?: boolean;
  recommendThemes?: AiRecommendTheme[];
  sortIntent?: AiVoiceSortIntent;
}

export interface AiVoiceSearchParams {
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
}

export interface AiVoiceTransactionParams {
  action: AiVoiceTransactionAction;
  status?: AiVoiceTransactionStatus;
}

export interface AiVoiceRecommendParams {
  query?: string;
  matchedCategoryId?: string;
  matchedCategoryName?: string;
  preferRecommended?: boolean;
  constraints?: string[];
  budget?: number;
  recommendThemes?: AiRecommendTheme[];
  slots?: AiVoiceDemandSlots;
}

export interface AiVoiceCompanyParams {
  mode: AiVoiceCompanyMode;
  name?: string;
  industryHint?: string;
  location?: string;
  companyType?: AiVoiceCompanyType;
  featureTags?: string[];
}

export interface AiVoiceIntentSlots extends AiVoiceDemandSlots {
  targetPage?: AiVoiceNavigateTarget;
  companyMode?: AiVoiceCompanyMode;
  companyName?: string;
  companyIndustryHint?: string;
  companyLocation?: string;
  companyType?: AiVoiceCompanyType;
  companyFeatureTags?: string[];
  transactionAction?: AiVoiceTransactionAction;
  transactionStatus?: AiVoiceTransactionStatus;
}

export interface AiVoiceResolved {
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
}

export interface AiVoiceClarifyCandidate {
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
}

export interface AiVoiceClarifyParams {
  candidates: AiVoiceClarifyCandidate[];
}

export interface AiVoiceTiming {
  asr_ms?: number;
  asr_connect_ms?: number;
  asr_wait_final_ms?: number;
  classify_ms?: number;
  clarify_ms?: number;
  entity_resolve_ms?: number;
  handler_ms?: number;
  total_ms?: number;
}

export type VoiceIntentClassificationType =
  | 'navigate'
  | 'search'
  | 'company'
  | 'transaction'
  | 'recommend'
  | 'chat';

export type VoiceIntentClassificationSource = 'rule' | 'model' | 'fallback';

/** 返回给前端执行层的最终语音意图 */
export interface AiVoiceIntent {
  type: AiVoiceIntentType;
  intent?: AiVoiceIntentType;
  confidence?: number;
  transcript: string;
  param?: string;
  feedback: string;
  slots?: AiVoiceIntentSlots;
  resolved?: AiVoiceResolved;
  fallbackReason?: string;
  search?: AiVoiceSearchParams;
  company?: AiVoiceCompanyParams;
  transaction?: AiVoiceTransactionParams;
  recommend?: AiVoiceRecommendParams;
  clarify?: AiVoiceClarifyParams;
  timing?: AiVoiceTiming;
  /** out-of-domain 引导式回复（含 suggestedActions） */
  chatResponse?: {
    reply: string;
    suggestedActions: Array<{
      type: 'search' | 'navigate' | 'company' | 'recommend';
      label: string;
      resolved?: Record<string, any>;
    }>;
  };
}

/** 一级分类器输出：先分任务类型，再交给具体 handler 处理 */
export interface VoiceIntentClassification {
  intent: VoiceIntentClassificationType;
  confidence: number;
  source: VoiceIntentClassificationSource;
  params: Record<string, unknown>;
  /** 最终解析来源（非搜索降级层） */
  pipeline?: 'rule' | 'fast' | 'flash' | 'plus';
  /** Flash 是否升级到 Plus */
  wasUpgraded?: boolean;
  /** 语义分流原因：out-of-domain / too-vague / unsafe */
  fallbackReason?: string;
}

// ===== Phase 2: 多轮对话类型 =====

export interface AiSuggestedAction {
  type: 'search' | 'navigate' | 'company' | 'recommend';
  label: string;
  resolved?: Record<string, any>;
}

export interface AiChatResponse {
  reply: string;
  suggestedActions: AiSuggestedAction[];
  followUpQuestions: string[];
}
