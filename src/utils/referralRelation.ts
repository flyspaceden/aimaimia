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
  directReferralInviter?: ReferralInviterLike | null;
};

export type MeReferralToolEntry = {
  label: '我的推荐码' | '推荐关系';
  icon: 'qrcode' | 'account-heart-outline';
  route: '/me/referral';
};

function nonEmpty(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

export function hasBoundReferralInviter(member?: ReferralRelationLike | null) {
  return Boolean(
    nonEmpty(member?.inviterUserId) ||
      nonEmpty(member?.inviter?.userId) ||
      nonEmpty(member?.inviter?.id) ||
      member?.inviter ||
      nonEmpty(member?.directReferralInviter?.userId) ||
      nonEmpty(member?.directReferralInviter?.id) ||
      member?.directReferralInviter,
  );
}

export function getReferralInviterLabel(member?: ReferralRelationLike | null) {
  if (!hasBoundReferralInviter(member)) return null;
  return (
    nonEmpty(member?.inviter?.nickname) ||
    nonEmpty(member?.inviter?.maskedPhone) ||
    nonEmpty(member?.directReferralInviter?.nickname) ||
    nonEmpty(member?.directReferralInviter?.buyerNo) ||
    '已绑定用户'
  );
}

export function buildMeReferralToolEntry(member?: ReferralRelationLike | null): MeReferralToolEntry {
  const hasVipReferralCode = member?.tier === 'VIP' && Boolean(nonEmpty(member.referralCode));
  return {
    label: hasVipReferralCode ? '我的推荐码' : '推荐关系',
    icon: hasVipReferralCode ? 'qrcode' : 'account-heart-outline',
    route: '/me/referral',
  };
}
