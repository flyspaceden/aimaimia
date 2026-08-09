export const AI_INTENT_TYPES = [
  'search',
  'company',
  'chat',
  'navigate',
  'transaction',
  'recommend',
  'clarify',
] as const;

export type AiIntentType = typeof AI_INTENT_TYPES[number];
export type AiNavigateTarget =
  | 'home'
  | 'discover'
  | 'me'
  | 'settings'
  | 'cart'
  | 'checkout'
  | 'orders'
  | 'search'
  | 'ai-chat';
export type AiTransactionAction =
  | 'transaction'
  | 'view-order'
  | 'track-order'
  | 'pay'
  | 'refund'
  | 'return'
  | 'exchange'
  | 'after-sale';
export type AiTransactionStatus = 'pendingPay' | 'pendingShip' | 'shipping' | 'afterSale';
export type AiRecommendTheme = 'hot' | 'discount' | 'tasty' | 'seasonal' | 'recent';
export type AiPromotionIntent = 'threshold-optimization' | 'best-deal';
export type AiBundleIntent = 'meal-kit' | 'complement';

export type AiDemandSlots = {
  query?: string;
  categoryHint?: string;
  constraints?: string[];
  usageScenario?: string;
  promotionIntent?: AiPromotionIntent;
  bundleIntent?: AiBundleIntent;
  dietaryPreference?: string;
  freshness?: string;
  originPreference?: string;
  flavorPreference?: string;
  audience?: string;
  budget?: number;
  preferRecommended?: boolean;
  recommendThemes?: AiRecommendTheme[];
};

export type AiResolved = {
  query?: string;
  navigateTarget?: AiNavigateTarget;
  companyId?: string;
  companyName?: string;
  companyMode?: 'list' | 'detail' | 'search';
  companyIndustryHint?: string;
  companyLocation?: string;
  companyType?: string;
  companyFeatureTags?: string[];
  matchedProductId?: string;
  matchedProductName?: string;
  matchedCategoryId?: string;
  matchedCategoryName?: string;
  transactionAction?: AiTransactionAction;
  transactionStatus?: AiTransactionStatus;
  constraints?: string[];
  budget?: number;
  preferRecommended?: boolean;
  recommendThemes?: AiRecommendTheme[];
  usageScenario?: string;
  promotionIntent?: AiPromotionIntent;
  bundleIntent?: AiBundleIntent;
  originPreference?: string;
  dietaryPreference?: string;
  flavorPreference?: string;
  categoryHint?: string;
};

export type AiSearchParams = {
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
  slots?: AiDemandSlots;
};

export type AiCompanyParams = {
  mode: 'list' | 'detail' | 'search';
  name?: string;
  industryHint?: string;
  location?: string;
  companyType?: string;
  featureTags?: string[];
};

export type AiTransactionParams = {
  action: AiTransactionAction;
  status?: AiTransactionStatus;
};

export type AiRecommendParams = {
  query?: string;
  matchedCategoryId?: string;
  matchedCategoryName?: string;
  preferRecommended?: boolean;
  constraints?: string[];
  budget?: number;
  recommendThemes?: AiRecommendTheme[];
  slots?: AiDemandSlots;
};

export type AiClarifyCandidate = {
  id: string;
  label: string;
  type: Exclude<AiIntentType, 'clarify'>;
  intent?: Exclude<AiIntentType, 'clarify'>;
  feedback: string;
  resolved?: AiResolved;
  search?: AiSearchParams;
  company?: AiCompanyParams;
  transaction?: AiTransactionParams;
  recommend?: AiRecommendParams;
};

export type AiVoiceIntent = {
  type: AiIntentType;
  intent?: AiIntentType;
  confidence?: number;
  transcript: string;
  feedback: string;
  resolved?: AiResolved;
  search?: AiSearchParams;
  company?: AiCompanyParams;
  transaction?: AiTransactionParams;
  recommend?: AiRecommendParams;
  clarify?: { candidates: AiClarifyCandidate[] };
  fallbackReason?: string;
  chatResponse?: {
    reply: string;
    suggestedActions: Array<{
      type: 'search' | 'navigate' | 'company' | 'recommend';
      label: string;
      resolved?: Record<string, unknown>;
    }>;
  };
};

export type AiPageAction = {
  label: string;
  url?: string;
  mode?: 'navigate' | 'switchTab';
  requiresAuth?: boolean;
  note?: string;
};
