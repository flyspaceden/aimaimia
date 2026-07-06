type ReferralInviterLike = {
  userId?: string | null;
  id?: string | null;
  nickname?: string | null;
  maskedPhone?: string | null;
  buyerNo?: string | null;
};

type ReferralRelationLike = {
  tier?: string | null;
  referralCode?: string | null;
  inviterUserId?: string | null;
  inviter?: ReferralInviterLike | null;
  directReferralStatus?: string | null;
  directReferralInviter?: ReferralInviterLike | null;
};

export type MeReferralToolEntry = {
  label: '推荐中心';
  icon: 'qrcode' | 'account-heart-outline';
  route: '/me/referral';
};

function nonEmpty(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function isInactiveRelationStatus(status?: string | null) {
  return status === 'INVALIDATED_BY_INVITEE_VIP_UPGRADE' || status === 'ADMIN_VOIDED';
}

function hasInviterObject(inviter?: ReferralInviterLike | null) {
  return Boolean(
    nonEmpty(inviter?.userId) ||
      nonEmpty(inviter?.id) ||
      nonEmpty(inviter?.nickname) ||
      nonEmpty(inviter?.maskedPhone) ||
      nonEmpty(inviter?.buyerNo),
  );
}

export function hasBoundReferralInviter(member?: ReferralRelationLike | null) {
  if (isInactiveRelationStatus(member?.directReferralStatus)) return false;
  return Boolean(
    hasInviterObject(member?.directReferralInviter) ||
      hasInviterObject(member?.inviter) ||
      nonEmpty(member?.inviterUserId),
  );
}

export function getReferralInviterLabel(member?: ReferralRelationLike | null) {
  if (!hasBoundReferralInviter(member)) return null;
  return (
    nonEmpty(member?.directReferralInviter?.nickname) ||
    nonEmpty(member?.directReferralInviter?.buyerNo) ||
    nonEmpty(member?.inviter?.nickname) ||
    nonEmpty(member?.inviter?.maskedPhone) ||
    '已绑定用户'
  );
}

export function buildMeReferralToolEntry(member?: ReferralRelationLike | null): MeReferralToolEntry {
  const hasVipReferralCode = member?.tier === 'VIP' && Boolean(nonEmpty(member.referralCode));
  return {
    label: '推荐中心',
    icon: hasVipReferralCode ? 'qrcode' : 'account-heart-outline',
    route: '/me/referral',
  };
}
