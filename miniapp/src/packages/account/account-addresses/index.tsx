import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountFeedback } from '@/components/account-feedback';
import { formatAddressLine } from '@/components/account-utils';
import { AddressRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import './index.scss';

export default function AccountAddressesPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const addressesQuery = useQuery({ queryKey: ['account', 'addresses'], queryFn: AddressRepo.list, enabled: loggedIn, staleTime: 30_000 });
  const addresses = addressesQuery.data?.ok ? addressesQuery.data.data : [];
  useDidShow(() => { if (useAuthStore.getState().accessToken) void addressesQuery.refetch(); });
  const defaultMutation = useMutation({
    mutationFn: (addressId: string) => AddressRepo.setDefault(addressId),
    onSuccess: (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '设置失败', icon: 'none' }); return; }
      queryClient.setQueryData(['account', 'addresses'], {
        ok: true,
        data: addresses.map((address) => ({ ...address, isDefault: address.id === result.data.id })),
      });
      Taro.showToast({ title: '已设为默认地址', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const removeMutation = useMutation({
    mutationFn: (addressId: string) => AddressRepo.remove(addressId),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '删除失败', icon: 'none' }); return; }
      await queryClient.invalidateQueries({ queryKey: ['account', 'addresses'] });
      Taro.showToast({ title: '地址已删除', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const confirmRemove = async (addressId: string) => {
    if (removeMutation.isPending) return;
    const result = await Taro.showModal({
      title: '删除收货地址',
      content: '删除后无法恢复，确定继续吗？',
      confirmText: '删除',
      confirmColor: '#C62828',
    });
    if (result.confirm) removeMutation.mutate(addressId);
  };

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><AccountFeedback kind='empty' title='请先登录' description='登录后才能管理收货地址' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/account/account-addresses/index')}` })} /></View>;

  return <View className='aim-page account-addresses-page'>
    <View className='account-addresses-intro'><View><Text className='account-addresses-intro__title'>收货地址</Text><Text className='account-addresses-intro__meta'>{addresses.length ? `已保存 ${addresses.length} 个地址` : '为下单提前准备收货信息'}</Text></View><View className='account-addresses-intro__mark'>定</View></View>
    {addressesQuery.isLoading ? <AccountFeedback kind='loading' /> : null}
    {addressesQuery.data && !addressesQuery.data.ok ? <AccountFeedback kind='error' title='地址加载失败' description={addressesQuery.data.error.displayMessage || '请稍后重试'} onAction={() => addressesQuery.refetch()} /> : null}
    {!addressesQuery.isLoading && addressesQuery.data?.ok && addresses.length === 0 ? <AccountFeedback kind='empty' title='暂无收货地址' description='添加一个地址，下单时可以直接选择' actionLabel='添加地址' onAction={() => Taro.navigateTo({ url: '/packages/account/account-address-form/index' })} /> : null}
    <View className='account-address-list'>{addresses.map((address) => <View className={address.isDefault ? 'account-address-card aim-card account-address-card--default' : 'account-address-card aim-card'} key={address.id}>
      {address.isDefault ? <View className='account-address-card__rail' /> : null}
      <View className='account-address-card__top' onClick={() => Taro.navigateTo({ url: `/packages/account/account-address-form/index?id=${encodeURIComponent(address.id)}` })}>
        <View className='account-address-card__copy'><View className='account-address-card__name-row'><Text className='account-address-card__name'>{address.receiverName}</Text><Text className='account-address-card__phone'>{address.phone}</Text>{address.isDefault ? <Text className='account-address-card__badge'>默认</Text> : null}</View><Text className='account-address-card__line'>{formatAddressLine(address)}</Text></View><Text className='account-address-card__arrow'>›</Text>
      </View>
      <View className='account-address-card__actions'>{address.isDefault ? <Text className='account-address-card__default-copy'>默认收货地址</Text> : <Button className='account-address-card__default-button' loading={defaultMutation.isPending && defaultMutation.variables === address.id} disabled={defaultMutation.isPending || removeMutation.isPending} onClick={() => defaultMutation.mutate(address.id)}>设为默认</Button>}<View className='account-address-card__action-group'><Text className='account-address-card__delete' onClick={() => { void confirmRemove(address.id); }}>删除</Text><Text className='account-address-card__edit' onClick={() => Taro.navigateTo({ url: `/packages/account/account-address-form/index?id=${encodeURIComponent(address.id)}` })}>编辑</Text></View></View>
    </View>)}</View>
    {addresses.length ? <Button className='account-addresses-add' onClick={() => Taro.navigateTo({ url: '/packages/account/account-address-form/index' })}>+  新增收货地址</Button> : null}
  </View>;
}
