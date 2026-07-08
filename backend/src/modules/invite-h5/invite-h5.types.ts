export type InviteCodeType = 'NORMAL_SHARE' | 'VIP_REFERRAL';
export type InviteCodeResolveStatus = InviteCodeType | 'INVALID' | 'CONFLICT';

export type InviteCodeResolveResult =
  | { status: 'NORMAL_SHARE'; code: string; inviterUserId: string }
  | { status: 'VIP_REFERRAL'; code: string; inviterUserId: string }
  | { status: 'INVALID'; code: string }
  | { status: 'CONFLICT'; code: string };

export type InviteBindingStatus =
  | 'BOUND'
  | 'ALREADY_BOUND_SAME'
  | 'ALREADY_BOUND_OTHER'
  | 'SELF_INVITE'
  | 'INVALID_CODE'
  | 'NOT_ELIGIBLE'
  | 'ERROR';
