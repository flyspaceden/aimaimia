export type InviteKind = 'normal' | 'vip';

export type ReferralMember = {
  tier: 'NORMAL' | 'VIP';
  referralCode: string | null;
  inviterUserId: string | null;
  directReferralStatus?: string | null;
  inviteeVipCount: number;
};

export type NormalShareProfile = {
  id: string;
  userId: string;
  code: string;
  status: 'ACTIVE' | 'DISABLED';
  disabledReason: string | null;
  shareUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type NormalShareStats = {
  totalInvitees: number;
  rewardedInvitees: number;
  pendingInvitees: number;
};

export type NormalShareRecord = {
  id: string;
  inviteeUserId: string;
  rewardStatus: 'PENDING' | 'REGISTER_REWARDED' | 'FIRST_ORDER_PENDING' | 'ISSUED' | 'REVERSED' | 'VOIDED';
  relationStatus?: 'ACTIVE' | 'SUPERSEDED_BY_VIP_TREE' | 'INVALIDATED_BY_INVITEE_VIP_UPGRADE' | 'ADMIN_VOIDED';
  boundAt: string;
  invitee?: { buyerNo: string | null; profile?: { nickname: string | null } | null };
};

export type VipReferralRecord = {
  id: string;
  buyerNo: string | null;
  nickname: string | null;
  tier: 'NORMAL' | 'VIP';
  boundAt: string;
  invitee?: { buyerNo: string | null; profile?: { nickname: string | null } | null } | null;
};

export type InviteBindingResult = {
  success?: boolean;
  inviterUserId?: string;
  id?: string;
  isIdempotent?: boolean;
};

export type ResolvedInviteBindingResult = InviteBindingResult & {
  resolvedType: InviteKind;
};
