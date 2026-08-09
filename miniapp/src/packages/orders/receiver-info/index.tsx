import { Button, Input, Picker, ScrollView, Text, Textarea, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { addressToDraft, validateAddressDraft, type AddressDraft } from '@/components/account-utils';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { AddressRepo, OrderRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { Address, Order, Result } from '@/types';
import './index.scss';

const emptyDraft: AddressDraft = { receiverName: '', phone: '', regionCode: '', regionText: '', regionValues: [], detail: '' };

function orderAddressDraft(order: Order): AddressDraft {
  const snapshot = order.addressSnapshot;
  if (snapshot) {
    const regionValues = snapshot.regionText?.split('/').filter(Boolean)
      || [snapshot.province, snapshot.city, snapshot.district].filter((value): value is string => Boolean(value));
    return {
      receiverName: snapshot.recipientName || snapshot.receiverName || '',
      phone: snapshot.phone || '',
      regionCode: snapshot.regionCode || '',
      regionText: snapshot.regionText || regionValues.join('/'),
      regionValues,
      detail: snapshot.detail || '',
    };
  }
  if (order.address) {
    return { ...emptyDraft, receiverName: order.address.recipientName, phone: order.address.recipientPhone, detail: order.address.fullAddress };
  }
  return emptyDraft;
}

export default function ReceiverInfoPage() {
  const router = useRouter();
  const orderId = typeof router.params.id === 'string' ? router.params.id : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AddressDraft>(emptyDraft);
  const initialized = useRef(false);
  const orderQuery = useQuery({ queryKey: ['order', orderId], queryFn: () => OrderRepo.getById(orderId), enabled: hydrated && loggedIn && Boolean(orderId) });
  const addressesQuery = useQuery({ queryKey: ['account', 'addresses'], queryFn: AddressRepo.list, enabled: hydrated && loggedIn, staleTime: 30_000 });
  const order = orderQuery.data?.ok ? orderQuery.data.data : undefined;
  const addresses = addressesQuery.data?.ok ? addressesQuery.data.data : [];
  useEffect(() => { if (!order || initialized.current) return; initialized.current = true; setDraft(orderAddressDraft(order)); }, [order]);

  const saveMutation = useMutation({
    mutationFn: () => OrderRepo.updateReceiverInfo(orderId, {
      recipientName: draft.receiverName.trim(),
      phone: draft.phone.trim(),
      regionCode: draft.regionCode,
      regionText: draft.regionText,
      detail: draft.detail.trim(),
    }),
    onSuccess: async (result: Result<Order>) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '修改失败', icon: 'none' }); return; }
      queryClient.setQueryData(['order', orderId], result);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      Taro.showToast({ title: '收货信息已更新', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 420);
    },
    onError: () => Taro.showToast({ title: '网络开小差了', icon: 'none' }),
  });
  const save = () => {
    if (!order || order.status !== 'PAID' || !order.receiverInfoEditable) { Taro.showToast({ title: '订单已不可修收货信息', icon: 'none' }); return; }
    const error = validateAddressDraft(draft);
    if (error) { Taro.showToast({ title: error, icon: 'none' }); return; }
    if (!saveMutation.isPending) saveMutation.mutate();
  };
  const chooseAddress = (address: Address) => setDraft(addressToDraft(address));

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能修改订单收货信息' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(`/packages/orders/receiver-info/index?id=${orderId}`)}` })} /></View>;
  if (!orderId) return <View className='aim-page'><CatalogFeedback kind='error' title='订单参数缺失' description='请从订单详情重新进入' /></View>;
  if (orderQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!order) return <View className='aim-page'><CatalogFeedback kind='error' title='订单加载失败' description={orderQuery.data && !orderQuery.data.ok ? orderQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => orderQuery.refetch()} /></View>;
  if (order.status !== 'PAID' || !order.receiverInfoEditable) return <View className='aim-page'><CatalogFeedback kind='error' title='已无法修收货信息' description='只有已付款且尚未发货的订单可修改' /></View>;

  return <View className='receiver-info-page'>
    <ScrollView className='receiver-info-scroll' scrollY enhanced>
      <View className='receiver-info-content'>
        <View className='receiver-info-notice'><View className='receiver-info-notice__mark'>定</View><View><Text className='receiver-info-notice__title'>只修改这笔订单</Text><Text className='receiver-info-notice__copy'>保存后不会同步修改地址簿；商家发货后将自动关闭入口。</Text></View></View>
        {addresses.length ? <View className='receiver-address-book'><View className='receiver-address-book__head'><Text>从地址簿快速填入</Text><Text>{addresses.length} 个地址</Text></View><ScrollView scrollX enhanced showScrollbar={false}><View className='receiver-address-book__list'>{addresses.map((address) => <View className='receiver-address-choice' key={address.id} onClick={() => chooseAddress(address)}><Text className='receiver-address-choice__name'>{address.receiverName} · {address.phone}</Text><Text className='receiver-address-choice__line'>{address.regionText?.replace(/\//g, ' ') || `${address.province}${address.city}${address.district}`} {address.detail}</Text>{address.isDefault ? <Text className='receiver-address-choice__badge'>默认</Text> : null}</View>)}</View></ScrollView></View> : null}
        <View className='receiver-info-form aim-card'>
          <View className='receiver-field'><Text className='receiver-field__label'>收货人</Text><Input className='receiver-field__input' value={draft.receiverName} maxlength={50} placeholder='请输入收货人姓名' onInput={(event) => setDraft((value) => ({ ...value, receiverName: event.detail.value }))} /></View>
          <View className='receiver-field'><Text className='receiver-field__label'>手机号</Text><Input className='receiver-field__input' type='number' value={draft.phone} maxlength={11} placeholder='请输入 11 位手机号' onInput={(event) => setDraft((value) => ({ ...value, phone: event.detail.value.replace(/\D/g, '').slice(0, 11) }))} /></View>
          <View className='receiver-field'><Text className='receiver-field__label'>所在地区</Text><Picker mode='region' level='region' value={draft.regionValues} onChange={(event) => { const values = event.detail.value; const codes = event.detail.code; setDraft((value) => ({ ...value, regionValues: values, regionText: values.join('/'), regionCode: codes[codes.length - 1] || '' })); }}><View className={draft.regionText ? 'receiver-field__picker' : 'receiver-field__picker receiver-field__picker--empty'}><Text>{draft.regionText ? draft.regionText.replace(/\//g, ' ') : '请选择省/市/区'}</Text><Text>›</Text></View></Picker>{draft.regionText && !draft.regionCode ? <Text className='receiver-field__warning'>该历史地址缺少行政区划代码，请重新选择省市区。</Text> : null}</View>
          <View className='receiver-field'><Text className='receiver-field__label'>详细地址</Text><Textarea className='receiver-field__textarea' value={draft.detail} maxlength={200} placeholder='街道、门牌号、小区、楼栋室等' onInput={(event) => setDraft((value) => ({ ...value, detail: event.detail.value }))} /><Text className='receiver-field__count'>{draft.detail.length}/200</Text></View>
          <Button className='receiver-save' loading={saveMutation.isPending} disabled={saveMutation.isPending} onClick={save}>{saveMutation.isPending ? '保存中...' : '保存当前订单的收货信息'}</Button>
        </View>
      </View>
    </ScrollView>
  </View>;
}
