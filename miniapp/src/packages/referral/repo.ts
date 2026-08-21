import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';
import type {
  InviteBindingResult,
  InviteKind,
  NormalShareProfile,
  NormalShareRecord,
  NormalShareStats,
  ReferralMember,
  VipReferralRecord,
  ResolvedInviteBindingResult,
} from './types';

function withResolvedType(
  result: Result<InviteBindingResult>,
  resolvedType: InviteKind,
): Result<ResolvedInviteBindingResult> {
  return result.ok
    ? { ok: true, data: { ...result.data, resolvedType } }
    : result;
}

function errorText(result: Result<InviteBindingResult>): string {
  if (result.ok) return '';
  return `${result.error.displayMessage || ''}${result.error.message || ''}`;
}

function isInvalidForKind(result: Result<InviteBindingResult>, kind: InviteKind): boolean {
  if (result.ok || result.error.retryable) return false;
  const message = errorText(result);
  return kind === 'normal'
    ? message.includes('普通分享码无效')
    : message.includes('推荐码无效');
}

async function bindByKind(kind: InviteKind, code: string): Promise<Result<InviteBindingResult>> {
  return kind === 'normal'
    ? ApiClient.post<InviteBindingResult>('/normal-share/bind', { code, source: 'MINI_PROGRAM' })
    : ApiClient.post<InviteBindingResult>('/bonus/referral', { code });
}

export const ReferralRepo = {
  getMember: (): Promise<Result<ReferralMember>> => ApiClient.get<ReferralMember>('/bonus/member'),
  getNormalProfile: (): Promise<Result<NormalShareProfile>> => ApiClient.get<NormalShareProfile>('/normal-share/me'),
  getNormalStats: (): Promise<Result<NormalShareStats>> => ApiClient.get<NormalShareStats>('/normal-share/stats'),
  getNormalRecords: (): Promise<Result<NormalShareRecord[]>> => ApiClient.get<NormalShareRecord[]>('/normal-share/records'),
  getVipRecords: (): Promise<Result<VipReferralRecord[]>> => ApiClient.get<VipReferralRecord[]>('/bonus/referral/records'),
  bind: bindByKind,
  bindAuto: async (
    code: string,
    preferredKind: InviteKind,
  ): Promise<Result<ResolvedInviteBindingResult>> => {
    const first = await bindByKind(preferredKind, code);
    if (first.ok || !isInvalidForKind(first, preferredKind)) {
      return withResolvedType(first, preferredKind);
    }
    const fallbackKind: InviteKind = preferredKind === 'normal' ? 'vip' : 'normal';
    return withResolvedType(await bindByKind(fallbackKind, code), fallbackKind);
  },
};
