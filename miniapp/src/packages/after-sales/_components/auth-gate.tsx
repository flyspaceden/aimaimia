import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';

export function AfterSaleAuthGate({ returnUrl, children }: { returnUrl: string; children: React.ReactNode }) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page after-sale-auth'><Text className='after-sale-auth__mark'>护</Text><Text className='after-sale-auth__title'>登录后处理售后</Text><Text className='after-sale-auth__copy'>登录后可查看售后进度并继续处理。</Text><Button className='aim-button-primary after-sale-auth__button' onClick={() => Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })}>微信登录</Button></View>;
  return <>{children}</>;
}
