type ReferralInviterLike = {
  userId?: string | null;
  nickname?: string | null;
  maskedPhone?: string | null;
};

type ReferralRelationLike = {
  inviterUserId?: string | null;
  inviter?: ReferralInviterLike | null;
};

function nonEmpty(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

export function hasBoundReferralInviter(member?: ReferralRelationLike | null) {
  return Boolean(nonEmpty(member?.inviterUserId) || nonEmpty(member?.inviter?.userId) || member?.inviter);
}

export function getReferralInviterLabel(member?: ReferralRelationLike | null) {
  if (!hasBoundReferralInviter(member)) return null;
  return nonEmpty(member?.inviter?.nickname) || nonEmpty(member?.inviter?.maskedPhone) || '已绑定用户';
}
