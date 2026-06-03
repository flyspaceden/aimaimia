export const REFERRAL_LANDING_TARGET = '/(tabs)/home';
export const REFERRAL_LANDING_NOTICE_DURATION_MS = 2000;

type ReferralLandingNotice = {
  message: string;
  type: 'success';
  duration: number;
};

export function getReferralLandingNotice(isLoggedIn: boolean): ReferralLandingNotice {
  return {
    message: isLoggedIn ? '推荐码已绑定' : '推荐码已记录',
    type: 'success',
    duration: REFERRAL_LANDING_NOTICE_DURATION_MS,
  };
}
