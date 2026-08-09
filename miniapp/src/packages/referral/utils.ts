import type { InviteKind, NormalShareRecord, VipReferralRecord } from './types';

export const INVITE_CODE_PATTERN = /^[A-Z0-9]{8}$/;

export function normalizeInviteCode(value?: string): string | null {
  const code = value?.trim().toUpperCase() || '';
  return INVITE_CODE_PATTERN.test(code) ? code : null;
}

/**
 * 链接里的 kind 只是尝试顺序提示，不是推荐码类型的权威来源。
 * 历史普通分享码以 S 开头，因此旧链接优先试普通码，但最终仍由后端校验。
 */
export function preferredInviteKind(rawKind: string | undefined, code: string): InviteKind {
  if (rawKind === 'normal' || rawKind === 'vip') return rawKind;
  return code.startsWith('S') ? 'normal' : 'vip';
}

export function buildMiniappInvitePath(code: string, kind: InviteKind): string {
  return `/packages/referral/landing/index?code=${encodeURIComponent(code)}&kind=${kind}`;
}

export function referralRecordName(record: {
  buyerNo?: string | null;
  nickname?: string | null;
  invitee?: { buyerNo?: string | null; profile?: { nickname?: string | null } | null } | null;
}): string {
  return record.nickname || record.invitee?.profile?.nickname || record.buyerNo || record.invitee?.buyerNo || '新用户';
}

export function formatReferralDate(value?: string): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '暂无时间';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const NORMAL_REWARD_STATUS_LABELS: Record<NormalShareRecord['rewardStatus'], string> = {
  PENDING: '已绑定',
  REGISTER_REWARDED: '注册奖励已发放',
  FIRST_ORDER_PENDING: '待完成首单',
  ISSUED: '首单奖励已发放',
  REVERSED: '奖励已冲正',
  VOIDED: '奖励已作废',
};

const NORMAL_RELATION_STATUS_LABELS: Record<NonNullable<NormalShareRecord['relationStatus']>, string> = {
  ACTIVE: '关系有效',
  SUPERSEDED_BY_VIP_TREE: '已转入 VIP 关系',
  INVALIDATED_BY_INVITEE_VIP_UPGRADE: '对方升级 VIP，普通关系已结束',
  ADMIN_VOIDED: '关系已作废',
};

export function normalReferralStatusLabel(record: NormalShareRecord): string {
  const reward = NORMAL_REWARD_STATUS_LABELS[record.rewardStatus] || '状态待确认';
  const relation = record.relationStatus ? NORMAL_RELATION_STATUS_LABELS[record.relationStatus] : '';
  return relation && relation !== '关系有效' ? `${reward} · ${relation}` : reward;
}

export function vipReferralStatusLabel(record: VipReferralRecord): string {
  return record.tier === 'VIP' ? '已成为 VIP' : '已绑定，待成为 VIP';
}
