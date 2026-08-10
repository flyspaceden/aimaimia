import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { SeafoodImage } from '@/components/SeafoodImage';
import { useAuthStore } from '@/store/auth';

export function InvoiceAuthGate({ returnUrl, children }: { returnUrl: string; children: React.ReactNode }) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page invoice-auth'><View className='invoice-auth__illustration'><SeafoodImage name='icon-tool-conch' /></View><Text className='invoice-auth__title'>登录后管理发票</Text><Text className='invoice-auth__copy'>发票和抬头信息与爱买买 App 共用。</Text><Button className='aim-button-primary invoice-auth__button' onClick={() => Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` })}>微信登录</Button></View>;
  return <>{children}</>;
}
