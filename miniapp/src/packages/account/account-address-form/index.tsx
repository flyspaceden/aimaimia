import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import { addressDraftToInput, addressToDraft, validateAddressDraft, type AddressDraft } from '@/components/account-utils';
import { AddressRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { selectCreatedCheckoutAddressIfActive } from '@/store/checkout-selection';
import type { Address, Result } from '@/types';
import './index.scss';

export default function AccountAddressFormPage() {
  const router = useRouter();
  const id = typeof router.params.id === 'string' ? router.params.id : '';
  const fromCheckout = router.params.fromCheckout === '1';
  const returnParams = [
    id ? `id=${encodeURIComponent(id)}` : '',
    fromCheckout ? 'fromCheckout=1' : '',
  ].filter(Boolean).join('&');
  const returnPath = `/packages/account/account-address-form/index${returnParams ? `?${returnParams}` : ''}`;
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const addressesQuery = useQuery({ queryKey: ['account', 'addresses'], queryFn: AddressRepo.list, enabled: loggedIn && Boolean(id), staleTime: 30_000 });
  const existing = addressesQuery.data?.ok ? addressesQuery.data.data.find((address) => address.id === id) : undefined;
  const [draft, setDraft] = useState<AddressDraft>(() => addressToDraft());
  const initialized = useRef(false);

  useEffect(() => {
    void Taro.setNavigationBarTitle({ title: id ? '编辑地址' : '新增地址' });
  }, [id]);

  useEffect(() => {
    if (!id || !existing || initialized.current) return;
    initialized.current = true;
    setDraft(addressToDraft(existing));
  }, [id, existing]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = addressDraftToInput(draft);
      return id ? AddressRepo.update(id, input) : AddressRepo.create(input);
    },
    onSuccess: (result: Result<Address>) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '保存失败', icon: 'none' }); return; }
      const cached = queryClient.getQueryData<Result<Address[]>>(['account', 'addresses']);
      if (cached?.ok) {
        const next = id
          ? cached.data.map((address) => address.id === result.data.id ? result.data : address)
          : [...cached.data, result.data];
        queryClient.setQueryData(['account', 'addresses'], { ok: true, data: next });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['account', 'addresses'] });
      }
      if (!id && fromCheckout) {
        const currentAuth = useAuthStore.getState();
        selectCreatedCheckoutAddressIfActive({
          fromCheckout,
          addressId: result.data.id,
          accessToken: currentAuth.accessToken,
          authRevision: currentAuth.revision,
        });
      }
      Taro.showToast({ title: id ? '地址已更新' : '地址已添加', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 420);
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const save = () => {
    const error = validateAddressDraft(draft);
    if (error) { Taro.showToast({ title: error, icon: 'none' }); return; }
    if (saveMutation.isPending) return;
    saveMutation.mutate();
  };

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><AccountFeedback kind='empty' title='请先登录' description='登录后才能保存收货地址' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnPath)}` })} /></View>;
  if (id && addressesQuery.isLoading) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (id && (!addressesQuery.data || !addressesQuery.data.ok || !existing)) return <View className='aim-page'><AccountFeedback kind='error' title='地址加载失败' description={addressesQuery.data && !addressesQuery.data.ok ? addressesQuery.data.error.displayMessage : '该地址可能已不存在'} onAction={() => addressesQuery.refetch()} /></View>;

  return <View className='aim-page account-address-form-page'>
    <View className='account-address-form-intro'><Text className='account-address-form-intro__eyebrow'>{id ? '修改收货信息' : '添加新地址'}</Text><Text className='account-address-form-intro__title'>{id ? '确认最新的收货信息' : '让好物准确送达'}</Text><Text className='account-address-form-intro__description'>省市区使用微信标准行政区划，保存后会与 App 同步。</Text></View>
    <View className='account-address-form aim-card'>
      <View className='account-address-field'><Text className='account-address-field__label'>收货人</Text><Input className='account-address-field__input' maxlength={50} value={draft.receiverName} placeholder='请输入收货人姓名' onInput={(event) => setDraft((value) => ({ ...value, receiverName: event.detail.value }))} /></View>
      <View className='account-address-field'><Text className='account-address-field__label'>手机号</Text><Input className='account-address-field__input' type='number' maxlength={11} value={draft.phone} placeholder='请输入 11 位手机号' onInput={(event) => setDraft((value) => ({ ...value, phone: event.detail.value.replace(/\D/g, '').slice(0, 11) }))} /></View>
      <View className='account-address-field'><Text className='account-address-field__label'>所在地区</Text><Picker mode='region' level='region' value={draft.regionValues} onChange={(event) => {
        const values = event.detail.value;
        const codes = event.detail.code;
        setDraft((current) => ({ ...current, regionValues: values, regionText: values.join('/'), regionCode: codes[codes.length - 1] || '' }));
      }}
      ><View className={draft.regionText ? 'account-address-field__picker' : 'account-address-field__picker account-address-field__picker--empty'}><Text>{draft.regionText ? draft.regionText.replace(/\//g, ' ') : '请选择省/市/区'}</Text><Text className='account-address-field__arrow'>›</Text></View></Picker>{id && draft.regionText && !draft.regionCode ? <Text className='account-address-field__warning'>该历史地址缺少行政区划代码，请重新选择一次省市区。</Text> : null}</View>
      <View className='account-address-field'><Text className='account-address-field__label'>详细地址</Text><Textarea className='account-address-field__textarea' maxlength={200} value={draft.detail} placeholder='街道、门牌号、小区、楼栋室等' autoHeight={false} onInput={(event) => setDraft((value) => ({ ...value, detail: event.detail.value }))} /><Text className='account-address-field__count'>{draft.detail.length}/200</Text></View>
      <Button className='account-address-save' loading={saveMutation.isPending} disabled={saveMutation.isPending} onClick={save}>{saveMutation.isPending ? '保存中...' : '保存收货地址'}</Button>
    </View>
  </View>;
}
