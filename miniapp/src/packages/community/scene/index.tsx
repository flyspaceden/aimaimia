import { View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { MiniProgramCodeRepo } from '@/platform/miniProgramCode';

export default function MiniProgramScenePage() {
  const router = useRouter();
  const rawScene = typeof router.params.scene === 'string' ? router.params.scene : '';
  const scene = (() => { try { return decodeURIComponent(rawScene); } catch { return ''; } })();
  const navigated = useRef(false);
  const [navigationError, setNavigationError] = useState(false);
  const query = useQuery({ queryKey: ['mini-program', 'scene', scene], queryFn: () => MiniProgramCodeRepo.resolve(scene), enabled: Boolean(scene), retry: false });
  useEffect(() => {
    if (navigated.current || !query.data?.ok) return;
    navigated.current = true;
    setNavigationError(false);
    void Taro.redirectTo({ url: query.data.data.path }).catch(() => {
      navigated.current = false;
      setNavigationError(true);
    });
  }, [query.data]);
  if (!scene) return <View className='aim-page'><CatalogFeedback kind='error' title='小程序码无效' description='请让好友重新生成后再扫码' /></View>;
  if (navigationError) return <View className='aim-page'><CatalogFeedback kind='error' title='页面打开失败' description='请重试，或让好友重新分享' onRetry={() => { setNavigationError(false); navigated.current = false; void query.refetch(); }} /></View>;
  if (query.isLoading || query.data?.ok) return <View className='aim-page'><CatalogFeedback kind='loading' title='正在打开分享内容' /></View>;
  return <View className='aim-page'><CatalogFeedback kind='error' title='小程序码无效或已过期' description={query.data?.error.displayMessage || '请让好友重新分享'} onRetry={() => query.refetch()} /></View>;
}
