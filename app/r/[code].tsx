import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useToast } from '../../src/components/feedback';
import { getReferralLandingNotice, REFERRAL_LANDING_TARGET } from '../../src/services/referralLanding';
import { useAuthStore } from '../../src/store';

// App Link 承接页：绑定逻辑由 app/_layout.tsx 的 Linking 监听统一处理。
// 本页只负责消除 /r/:code 的 not-found，并给用户一个 2 秒反馈后回首页。
export default function ReferralLinkLanding() {
  const router = useRouter();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    show(getReferralLandingNotice(isLoggedIn));
    router.replace(REFERRAL_LANDING_TARGET);
  }, [isLoggedIn, router, show]);

  return null;
}
