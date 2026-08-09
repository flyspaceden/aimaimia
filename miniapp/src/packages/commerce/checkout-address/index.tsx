import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatAddressLine } from '@/components/account-utils';
import { AddressRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { useCheckoutSelectionStore } from '@/store/checkout-selection';
import './index.scss';

export default function CheckoutAddressPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const selection = useCheckoutSelectionStore();
  const query = useQuery({ queryKey: ['account', 'addresses'], queryFn: AddressRepo.list, enabled: hydrated && loggedIn, staleTime: 30_000 });
  const addresses = query.data?.ok ? query.data.data : [];
  useDidShow(() => { if (useAuthStore.getState().accessToken) void query.refetch(); });
  const select = (id: string) => {
    if (selection.ownerRevision !== authRevision) {
      Taro.showToast({ title: '登录状态已变更，请返回结算页重试', icon: 'none' });
      return;
    }
    selection.selectAddress(id);
    void Taro.navigateBack();
  };
  if (!hydrated || query.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能选择收货地址' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/commerce/checkout-address/index')}` })} /></View>;
  if (!query.data?.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='地址加载失败' description={query.data && !query.data.ok ? query.data.error.displayMessage : '请稍后重试'} onRetry={() => query.refetch()} /></View>;
  return <View className='aim-page checkout-address-page'>
    {!addresses.length ? <CatalogFeedback kind='empty' title='暂无收货地址' description='请先添加一个收货地址' actionLabel='添加地址' onRetry={() => Taro.navigateTo({ url: '/packages/account/account-address-form/index' })} /> : null}
    <View className='checkout-address-choice-list'>{addresses.map((address) => <View className={selection.addressId === address.id ? 'checkout-address-choice aim-card checkout-address-choice--active' : 'checkout-address-choice aim-card'} key={address.id} onClick={() => select(address.id)}>{address.isDefault ? <View className='checkout-address-choice__rail' /> : null}<View className='checkout-address-choice__copy'><View><Text>{address.receiverName}</Text><Text>{address.phone}</Text>{address.isDefault ? <Text>默认</Text> : null}</View><Text>{formatAddressLine(address)}</Text></View><View className='checkout-address-choice__check'>{selection.addressId === address.id ? '✓' : '›'}</View></View>)}</View>
    {addresses.length ? <Button className='checkout-address-add' onClick={() => Taro.navigateTo({ url: '/packages/account/account-address-form/index' })}>＋ 新增地址</Button> : null}
  </View>;
}
