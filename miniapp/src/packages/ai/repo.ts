import type { Result } from '@/types/result';
import {
  prepareVoiceIntent,
  uploadVoiceIntent,
  type VoiceRecording,
} from '@/platform/voice';
import { AI_INTENT_TYPES, type AiVoiceIntent } from './types';

function invalidContract(): Result<AiVoiceIntent> {
  return {
    ok: false,
    error: {
      code: 'INVALID_AI_CONTRACT',
      message: 'voice intent response does not match the miniapp contract',
      displayMessage: '没有听清楚，请换一种说法再试一次',
      retryable: true,
    },
  };
}

export function isAiVoiceIntent(value: unknown): value is AiVoiceIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (!AI_INTENT_TYPES.includes(candidate.type as AiVoiceIntent['type'])) return false;
  if (typeof candidate.transcript !== 'string' || typeof candidate.feedback !== 'string') return false;
  if (candidate.confidence !== undefined
    && (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence))) return false;
  if (candidate.resolved !== undefined && !isResolved(candidate.resolved)) return false;
  if (candidate.search !== undefined && !isSearch(candidate.search)) return false;
  if (candidate.company !== undefined && !isCompany(candidate.company)) return false;
  if (candidate.transaction !== undefined && !isTransaction(candidate.transaction)) return false;
  if (candidate.recommend !== undefined && !isRecommend(candidate.recommend)) return false;
  if (candidate.chatResponse !== undefined && !isChatResponse(candidate.chatResponse)) return false;
  if (candidate.type === 'clarify') {
    const clarify = candidate.clarify as { candidates?: unknown } | undefined;
    if (!clarify || !Array.isArray(clarify.candidates)
      || clarify.candidates.length === 0
      || clarify.candidates.length > 8
      || !clarify.candidates.every(isClarifyCandidate)) return false;
  } else if (candidate.clarify !== undefined) {
    return false;
  }
  return true;
}

const stringOrUndefined = (value: unknown) => value === undefined || typeof value === 'string';
const booleanOrUndefined = (value: unknown) => value === undefined || typeof value === 'boolean';
const finiteNumberOrUndefined = (value: unknown) => value === undefined
  || (typeof value === 'number' && Number.isFinite(value));
const stringArrayOrUndefined = (value: unknown) => value === undefined
  || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
const recommendThemesOrUndefined = (value: unknown) => value === undefined
  || (Array.isArray(value) && value.every((item) => ['hot', 'discount', 'tasty', 'seasonal', 'recent'].includes(String(item))));

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isResolved(value: unknown): boolean {
  const item = record(value);
  if (!item) return false;
  return [
    item.query, item.navigateTarget, item.companyId, item.companyName, item.companyMode,
    item.companyIndustryHint, item.companyLocation, item.companyType,
    item.matchedProductId, item.matchedProductName, item.matchedCategoryId,
    item.matchedCategoryName, item.transactionAction, item.transactionStatus,
    item.usageScenario, item.promotionIntent, item.bundleIntent,
    item.originPreference, item.dietaryPreference, item.flavorPreference,
    item.categoryHint,
  ].every(stringOrUndefined)
    && stringArrayOrUndefined(item.companyFeatureTags)
    && stringArrayOrUndefined(item.constraints)
    && finiteNumberOrUndefined(item.budget)
    && booleanOrUndefined(item.preferRecommended)
    && recommendThemesOrUndefined(item.recommendThemes);
}

function isSearch(value: unknown): boolean {
  const item = record(value);
  return Boolean(item && typeof item.query === 'string'
    && stringOrUndefined(item.action)
    && stringOrUndefined(item.matchedProductId)
    && stringOrUndefined(item.matchedProductName)
    && stringOrUndefined(item.matchedCategoryId)
    && stringOrUndefined(item.matchedCategoryName)
    && booleanOrUndefined(item.preferRecommended)
    && stringArrayOrUndefined(item.constraints)
    && finiteNumberOrUndefined(item.maxPrice)
    && recommendThemesOrUndefined(item.recommendThemes)
    && (item.slots === undefined || isDemandSlots(item.slots)));
}

function isCompany(value: unknown): boolean {
  const item = record(value);
  return Boolean(item && ['list', 'detail', 'search'].includes(String(item.mode))
    && stringOrUndefined(item.name)
    && stringOrUndefined(item.industryHint)
    && stringOrUndefined(item.location)
    && stringOrUndefined(item.companyType)
    && stringArrayOrUndefined(item.featureTags));
}

function isTransaction(value: unknown): boolean {
  const item = record(value);
  return Boolean(item && typeof item.action === 'string' && stringOrUndefined(item.status));
}

function isRecommend(value: unknown): boolean {
  const item = record(value);
  return Boolean(item && stringOrUndefined(item.query)
    && stringOrUndefined(item.matchedCategoryId)
    && stringOrUndefined(item.matchedCategoryName)
    && booleanOrUndefined(item.preferRecommended)
    && stringArrayOrUndefined(item.constraints)
    && finiteNumberOrUndefined(item.budget)
    && recommendThemesOrUndefined(item.recommendThemes)
    && (item.slots === undefined || isDemandSlots(item.slots)));
}

function isDemandSlots(value: unknown): boolean {
  const item = record(value);
  if (!item) return false;
  return [
    item.query, item.categoryHint, item.usageScenario, item.promotionIntent,
    item.bundleIntent, item.dietaryPreference, item.freshness,
    item.originPreference, item.flavorPreference, item.audience,
  ].every(stringOrUndefined)
    && stringArrayOrUndefined(item.constraints)
    && finiteNumberOrUndefined(item.budget)
    && booleanOrUndefined(item.preferRecommended)
    && recommendThemesOrUndefined(item.recommendThemes);
}

function isClarifyCandidate(value: unknown): boolean {
  const item = record(value);
  if (!item || typeof item.id !== 'string' || typeof item.label !== 'string'
    || typeof item.feedback !== 'string'
    || !AI_INTENT_TYPES.includes(item.type as AiVoiceIntent['type'])
    || item.type === 'clarify') return false;
  return (item.resolved === undefined || isResolved(item.resolved))
    && (item.search === undefined || isSearch(item.search))
    && (item.company === undefined || isCompany(item.company))
    && (item.transaction === undefined || isTransaction(item.transaction))
    && (item.recommend === undefined || isRecommend(item.recommend));
}

function isChatResponse(value: unknown): boolean {
  const item = record(value);
  if (!item || typeof item.reply !== 'string' || !Array.isArray(item.suggestedActions)) return false;
  return item.suggestedActions.every((action) => {
    const candidate = record(action);
    return Boolean(candidate
      && ['search', 'navigate', 'company', 'recommend'].includes(String(candidate.type))
      && typeof candidate.label === 'string'
      && (candidate.resolved === undefined || record(candidate.resolved)));
  });
}

export const AiVoiceRepo = {
  prepare: () => prepareVoiceIntent(),
  recognize: async (
    recording: VoiceRecording,
    options?: { prepareId?: string; sessionId?: string; page?: string },
  ): Promise<Result<AiVoiceIntent>> => {
    const result = await uploadVoiceIntent(recording, options);
    if (!result.ok) return result;
    return isAiVoiceIntent(result.data) ? { ok: true, data: result.data } : invalidContract();
  },
};
