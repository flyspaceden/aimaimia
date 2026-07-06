import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useToast } from '../../src/components/feedback';
import { useAuthStore } from '../../src/store';

export default function NormalShareLinkLanding() {
  const router = useRouter();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    show({
      message: isLoggedIn ? '正在绑定普通分享关系' : '登录后自动绑定普通分享关系',
      type: 'info',
    });
    router.replace('/me/referral');
  }, [isLoggedIn, router, show]);

  return null;
}
