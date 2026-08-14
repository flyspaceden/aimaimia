import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { FulfillmentModeSwitch, PickupSelectionPanel } from '@/components/pickup-fulfillment';
import {
  buildPickupFulfillment,
  isPickupRecipientValid,
  pickupPointsAvailable,
  pickupSelectionsComplete,
  type PickupSelectionMap,
} from '@/components/pickup-utils';
import { AddressRepo, CheckoutRepo } from '@/repos';
import { miniProgramCashierFailureMessage, requestMiniProgramPayment } from '@/platform/payment';
import { ensureWechatMiniProgramSession } from '@/platform/auth';
import { queryClient } from '@/query/client';
import { captureAuthSession, useAuthStore } from '@/store/auth';
import { resolveAppErrorCode } from '@/types/result';
import { useCheckoutSelectionStore } from '@/store/checkout-selection';
import type { CheckoutStatusResult, FulfillmentInput, FulfillmentMode } from '@/types';
import { GroupBuyAuthGate } from '../_components/group-buy-shared';
import { MiniGroupBuyRepo } from '../repo';
import {
  createGroupBuyIdempotencyKey,
  formatGroupBuyMoney,
  isUserCancelledGroupBuyPayment,
  resolveGroupBuyEntryCode,
} from '../utils';
import './index.scss';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function confirmGroupBuyCheckout(sessionId: string): Promise<CheckoutStatusResult | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = attempt % 4 === 0
      ? await CheckoutRepo.activeQuery(sessionId)
      : await CheckoutRepo.getStatus(sessionId);
    if (result.ok && ['COMPLETED', 'EXPIRED', 'FAILED'].includes(result.data.status)) return result.data;
    await wait(1_500);
  }
  return null;
}

export default function GroupBuyCheckoutPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const checkoutSelection = useCheckoutSelectionStore();
  const activityId = typeof router.params.activityId === 'string' ? router.params.activityId : '';
  const shareCode = resolveGroupBuyEntryCode({
    shareCode: typeof router.params.shareCode === 'string' ? router.params.shareCode : undefined,
    code: typeof router.params.code === 'string' ? router.params.code : undefined,
    scene: typeof router.params.scene === 'string' ? router.params.scene : undefined,
  });
  const returnUrl = `/packages/group-buy/checkout/index?activityId=${encodeURIComponent(activityId)}${shareCode ? `&shareCode=${encodeURIComponent(shareCode)}` : ''}`;
  const [addressId, setAddressId] = useState('');
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('DELIVERY');
  const [pickupRecipientName, setPickupRecipientName] = useState('');
  const [pickupRecipientPhone, setPickupRecipientPhone] = useState('');
  const [pickupSelections, setPickupSelections] = useState<PickupSelectionMap>({});
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const idempotencyKey = useRef(createGroupBuyIdempotencyKey());
  const activityQuery = useQuery({ queryKey: ['group-buy', 'activity', activityId], queryFn: () => MiniGroupBuyRepo.getActivity(activityId), enabled: Boolean(activityId), staleTime: 0 });
  const landingQuery = useQuery({ queryKey: ['group-buy', 'landing', shareCode], queryFn: () => MiniGroupBuyRepo.getLanding(shareCode!), enabled: Boolean(shareCode), staleTime: 0 });
  const addressesQuery = useQuery({ queryKey: ['account', 'addresses'], queryFn: AddressRepo.list, enabled: hydrated && loggedIn, staleTime: 30_000 });
  const currentQuery = useQuery({ queryKey: ['group-buy', 'current'], queryFn: MiniGroupBuyRepo.getCurrent, enabled: hydrated && loggedIn, staleTime: 0 });
  const activity = activityQuery.data?.ok ? activityQuery.data.data : undefined;
  const landing = landingQuery.data?.ok ? landingQuery.data.data : undefined;
  const addresses = useMemo(() => addressesQuery.data?.ok ? addressesQuery.data.data : [], [addressesQuery.data]);
  const occupiesSlot = currentQuery.data?.ok ? currentQuery.data.data.occupiesSlot : false;
  const companyIds = useMemo(
    () => activity?.companyId ? [activity.companyId] : [],
    [activity?.companyId],
  );
  const pickupPointsQuery = useQuery({
    queryKey: ['group-buy', 'pickup-points', activity?.companyId],
    queryFn: () => CheckoutRepo.listPickupPoints(companyIds),
    enabled: hydrated && loggedIn && companyIds.length > 0,
    staleTime: 30_000,
  });
  const pickupGroups = useMemo(
    () => pickupPointsQuery.data?.ok ? pickupPointsQuery.data.data : [],
    [pickupPointsQuery.data],
  );
  const pickupAvailable = pickupPointsQuery.data?.ok === true
    && pickupPointsAvailable(pickupGroups, companyIds);

  useDidShow(() => {
    if (!useAuthStore.getState().accessToken) return;
    void addressesQuery.refetch();
    void currentQuery.refetch();
  });

  useEffect(() => {
    if (!addresses.length) { if (addressId) setAddressId(''); return; }
    if (!addressId || !addresses.some((address) => address.id === addressId)) {
      setAddressId((addresses.find((address) => address.isDefault) || addresses[0]).id);
    }
  }, [addressId, addresses]);

  useEffect(() => {
    if (fulfillmentMode !== 'PICKUP') return;
    const selectedAddress = addresses.find((address) => address.id === addressId) || addresses[0];
    if (!pickupRecipientName && selectedAddress?.receiverName) setPickupRecipientName(selectedAddress.receiverName);
    if (!pickupRecipientPhone && selectedAddress?.phone) setPickupRecipientPhone(selectedAddress.phone.replace(/\D/g, ''));
  }, [addressId, addresses, fulfillmentMode, pickupRecipientName, pickupRecipientPhone]);

  useEffect(() => {
    if (fulfillmentMode !== 'PICKUP' || !pickupPointsQuery.data?.ok) return;
    setPickupSelections((current) => {
      const next: PickupSelectionMap = {};
      for (const companyId of companyIds) {
        const group = pickupGroups.find((item) => item.companyId === companyId);
        const selected = group?.points.find((point) => point.id === current[companyId]);
        const pointId = selected?.id || group?.points[0]?.id;
        if (pointId) next[companyId] = pointId;
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [companyIds, fulfillmentMode, pickupGroups, pickupPointsQuery.data]);

  useEffect(() => {
    if (fulfillmentMode !== 'PICKUP' || pickupPointsQuery.isLoading || pickupAvailable) return;
    setFulfillmentMode('DELIVERY');
    setPolicyAccepted(false);
    Taro.showToast({
      title: pickupPointsQuery.data?.ok === false
        ? '自提服务暂不可用，已切换为送货上门'
        : '该商品暂无自提点，已切换为送货上门',
      icon: 'none',
    });
  }, [fulfillmentMode, pickupAvailable, pickupPointsQuery.data, pickupPointsQuery.isLoading]);

  useEffect(() => {
    if (checkoutSelection.ownerRevision !== authRevision) return;
    if (checkoutSelection.addressId && addresses.some((address) => address.id === checkoutSelection.addressId)) {
      setAddressId(checkoutSelection.addressId);
    }
  }, [addresses, authRevision, checkoutSelection.addressId, checkoutSelection.ownerRevision]);

  const pickupReady = isPickupRecipientValid(pickupRecipientName, pickupRecipientPhone)
    && pickupSelectionsComplete(pickupGroups, pickupSelections, companyIds);
  const fulfillmentReady = fulfillmentMode === 'DELIVERY' ? Boolean(addressId) : pickupReady;
  const fulfillment = useMemo<FulfillmentInput>(() => fulfillmentMode === 'DELIVERY'
    ? { mode: 'DELIVERY', addressId }
    : buildPickupFulfillment(pickupRecipientName, pickupRecipientPhone, pickupSelections, companyIds),
  [addressId, companyIds, fulfillmentMode, pickupRecipientName, pickupRecipientPhone, pickupSelections]);
  const previewQuery = useQuery({
    queryKey: ['group-buy', 'checkout-preview', activityId, fulfillment, shareCode],
    queryFn: () => MiniGroupBuyRepo.previewCheckout({ activityId, ...(fulfillmentMode === 'DELIVERY' ? { addressId } : {}), fulfillment, shareCode: shareCode || undefined, expectedTotal: activity!.price }),
    enabled: Boolean(loggedIn && activity && fulfillmentReady && !occupiesSlot && (!shareCode || landing?.valid)),
    staleTime: 0,
  });
  const preview = previewQuery.data?.ok ? previewQuery.data.data : undefined;

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!activity || !fulfillmentReady || !preview) throw new Error('MISSING_CHECKOUT_INPUT');
      const authGuard = captureAuthSession();
      const session = await MiniGroupBuyRepo.createMiniProgramCheckout({
        activityId: activity.id,
        ...(fulfillmentMode === 'DELIVERY' ? { addressId } : {}),
        fulfillment,
        shareCode: shareCode || undefined,
        expectedTotal: preview.expectedTotal,
        idempotencyKey: idempotencyKey.current,
      });
      if (!session.ok) return session;
      let cancelled = false;
      let paymentError: string | undefined;
      try {
        await requestMiniProgramPayment(session.data.paymentParams);
      } catch (error) {
        cancelled = isUserCancelledGroupBuyPayment(error);
        if (!cancelled) paymentError = miniProgramCashierFailureMessage(error);
      }
      if (!useAuthStore.getState().isCurrentSessionGeneration(authGuard)) {
        return { ok: true as const, data: { session: session.data, status: null, cancelled, sessionChanged: true } };
      }
      const status = await confirmGroupBuyCheckout(session.data.sessionId);
      return { ok: true as const, data: { session: session.data, status, cancelled, paymentError, sessionChanged: false } };
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        const errorCode = resolveAppErrorCode(result.error);
        if (errorCode === 'PICKUP_POINT_UNAVAILABLE') {
          setPickupSelections({});
          setPolicyAccepted(false);
          const refreshed = await pickupPointsQuery.refetch();
          const remainsAvailable = refreshed.data?.ok === true
            && pickupPointsAvailable(refreshed.data.data, companyIds);
          if (!remainsAvailable) setFulfillmentMode('DELIVERY');
          Taro.showToast({
            title: remainsAvailable ? '自提点状态已变化，请重新选择' : '自提点已不可用，已切换为送货上门',
            icon: 'none',
          });
          return;
        }
        if (errorCode === 'PENDING_GROUP_BUY_CHECKOUT_EXISTS' || errorCode === 'PENDING_CHECKOUT_EXISTS') {
          Taro.showToast({ title: '已有待支付团购，请先处理', icon: 'none' });
          await Taro.redirectTo({ url: '/packages/group-buy/checkout-pending/index' });
          return;
        }
        Taro.showToast({ title: result.error.displayMessage || '团购提交失败', icon: 'none' });
        return;
      }
      if (result.data.sessionChanged) {
        Taro.showToast({ title: '登录状态已变更，请在订单中心确认结果', icon: 'none', duration: 2600 });
        await Taro.switchTab({ url: '/pages/me/index' });
        return;
      }
      const { session, status, cancelled } = result.data;
      const paymentError = 'paymentError' in result.data ? result.data.paymentError : undefined;
      if (status?.status === 'COMPLETED') {
        checkoutSelection.clear();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['group-buy', 'current'] }),
          queryClient.invalidateQueries({ queryKey: ['group-buy', 'rebate'] }),
          queryClient.invalidateQueries({ queryKey: ['orders'] }),
        ]);
        await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${encodeURIComponent(status.orderIds.join(','))}&amount=${session.expectedTotal}` });
        return;
      }
      if (status?.status === 'EXPIRED' || status?.status === 'FAILED') {
        idempotencyKey.current = createGroupBuyIdempotencyKey();
        Taro.showToast({ title: status.status === 'EXPIRED' ? '支付已超时，请重新结算' : '支付未成功，请重试', icon: 'none' });
        void previewQuery.refetch();
        return;
      }
      Taro.showToast({ title: cancelled ? '已取消支付，可稍后继续' : paymentError || '支付结果确认中', icon: 'none', duration: 2200 });
      await Taro.redirectTo({ url: `/packages/group-buy/checkout-pending/index?sessionId=${encodeURIComponent(session.sessionId)}` });
    },
    onError: (error) => {
      const missing = error instanceof Error && error.message === 'MISSING_CHECKOUT_INPUT';
      Taro.showToast({ title: missing ? fulfillmentMode === 'PICKUP' ? '请完整填写自提信息' : '请选择地址并等待价格计算' : '网络结果不确定，请稍后查看待支付订单', icon: 'none' });
    },
  });

  const openAddressSelection = () => {
    checkoutSelection.begin({ ownerRevision: authRevision, addressId, couponIds: [] });
    void Taro.navigateTo({ url: '/packages/commerce/checkout-address/index' });
  };

  if (!hydrated) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <GroupBuyAuthGate returnUrl={returnUrl} description='登录后才能选择配送或自提并完成微信支付' />;
  if (activityQuery.isLoading || (fulfillmentMode === 'DELIVERY' && addressesQuery.isLoading) || currentQuery.isLoading || (shareCode && landingQuery.isLoading)) return <View className='group-buy-page'><CatalogFeedback kind='loading' /></View>;
  if (!activityQuery.data?.ok || !activity) return <View className='group-buy-page'><CatalogFeedback kind='error' title='团购商品加载失败' description={activityQuery.data && !activityQuery.data.ok ? activityQuery.data.error.displayMessage : '请返回重试'} onRetry={() => activityQuery.refetch()} /></View>;
  if ((fulfillmentMode === 'DELIVERY' && !addressesQuery.data?.ok) || !currentQuery.data?.ok) return <View className='group-buy-page'><CatalogFeedback kind='error' title='结算信息加载失败' description={!addressesQuery.data?.ok && addressesQuery.data ? addressesQuery.data.error.displayMessage : currentQuery.data && !currentQuery.data.ok ? currentQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => { void addressesQuery.refetch(); void currentQuery.refetch(); }} /></View>;
  if (shareCode && (!landingQuery.data?.ok || !landing?.valid || landing.activity?.id !== activity.id)) return <View className='group-buy-page'><CatalogFeedback kind='error' title='团购推荐码不可用' description={landingQuery.data?.ok ? landing?.reason || '推荐码与当前商品不匹配' : landingQuery.data && !landingQuery.data.ok ? landingQuery.data.error.displayMessage : '请返回重试'} onRetry={() => Taro.redirectTo({ url: '/packages/group-buy/activity-list/index' })} /></View>;
  if (occupiesSlot) return <View className='group-buy-page'><CatalogFeedback kind='empty' title='当前已有团购资格' description='同一时间只能保留一个团购资格，请先处理当前团购后再购买' actionLabel='查看当前团购' onRetry={() => Taro.redirectTo({ url: '/packages/group-buy/current/index' })} /></View>;

  return <View className='group-buy-page group-buy-checkout'>
    <View className='group-buy-card aim-card'><View className='group-buy-checkout__product'>{activity.product.imageUrl ? <Image className='group-buy-checkout__image' src={activity.product.imageUrl} mode='aspectFill' /> : <View className='group-buy-checkout__placeholder'>团</View>}<View className='group-buy-checkout__copy'><Text className='group-buy-checkout__title'>{activity.title}</Text><Text className='group-buy-checkout__summary'>{activity.itemSummary || activity.product.title}</Text><Text className='group-buy-checkout__price'>¥{formatGroupBuyMoney(activity.price)}</Text></View></View></View>

    <FulfillmentModeSwitch
      mode={fulfillmentMode}
      onChange={(mode) => {
        setFulfillmentMode(mode);
        setPolicyAccepted(false);
      }}
      pickupAvailable={pickupAvailable}
    />
    {pickupPointsQuery.data?.ok === false ? <CatalogFeedback kind='error' title='自提点加载失败' description={pickupPointsQuery.data.error.displayMessage || '当前暂时不能选择到店自提'} onRetry={() => pickupPointsQuery.refetch()} /> : null}
    {fulfillmentMode === 'DELIVERY' ? <View className='group-buy-card aim-card'>
      <View className='group-buy-card__heading'><Text>收货地址</Text><Text onClick={openAddressSelection}>{addresses.length ? '切换 ›' : '新增 ›'}</Text></View>
      {!addresses.length ? <CatalogFeedback kind='empty' title='暂无收货地址' description='请先添加地址后再付款' actionLabel='添加地址' onRetry={openAddressSelection} /> : (() => { const address = addresses.find((item) => item.id === addressId) || addresses[0]; return <View className='group-buy-address-list'><View className='group-buy-address group-buy-address--active' onClick={openAddressSelection}><View className='group-buy-address__radio'>✓</View><View className='group-buy-address__copy'><Text className='group-buy-address__name'>{address.receiverName}　{address.phone}</Text><Text className='group-buy-address__line'>{address.regionText || `${address.province}${address.city}${address.district}`} {address.detail}</Text></View><Text>›</Text></View></View>; })()}
    </View> : <PickupSelectionPanel
      groups={pickupGroups}
      selections={pickupSelections}
      recipientName={pickupRecipientName}
      recipientPhone={pickupRecipientPhone}
      onRecipientNameChange={setPickupRecipientName}
      onRecipientPhoneChange={setPickupRecipientPhone}
      onSelect={(companyId, pickupPointId) => setPickupSelections((current) => ({ ...current, [companyId]: pickupPointId }))}
      loading={pickupPointsQuery.isLoading}
      error={pickupPointsQuery.data && !pickupPointsQuery.data.ok ? pickupPointsQuery.data.error.displayMessage : undefined}
      onRetry={() => { void pickupPointsQuery.refetch(); }}
    />}

    <View className='group-buy-card aim-card'><View className='group-buy-card__heading'><Text>支付方式</Text><Text>小程序专用</Text></View><View className='group-buy-cash-only'><Text className='group-buy-cash-only__mark'>微</Text><View className='group-buy-cash-only__copy'><Text>微信支付</Text><Text>小程序内仅支持微信支付，无需选择其他渠道</Text></View></View></View>

    {previewQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
    {previewQuery.data && !previewQuery.data.ok ? <CatalogFeedback kind='error' title='价格计算失败' description={previewQuery.data.error.displayMessage || '请稍后重试'} onRetry={() => previewQuery.refetch()} /> : null}
    {preview ? <View className='group-buy-card aim-card'><View className='group-buy-card__heading'><Text>金额明细</Text><Text>实时计算</Text></View><View className='group-buy-price-lines'><View className='group-buy-price-line'><Text>商品金额</Text><Text>¥{formatGroupBuyMoney(preview.goodsAmount)}</Text></View><View className='group-buy-price-line'><Text>运费</Text><Text>{fulfillmentMode === 'PICKUP' ? '自提免运费' : preview.shippingFee ? `¥${formatGroupBuyMoney(preview.shippingFee)}` : '包邮'}</Text></View><View className='group-buy-price-line'><Text>红包 / 积分 / 返还抵扣</Text><Text>不支持</Text></View><View className='group-buy-price-line group-buy-price-line--total'><Text>应付金额</Text><Text>¥{formatGroupBuyMoney(preview.expectedTotal)}</Text></View></View><Text className='group-buy-notice'>{fulfillmentMode === 'PICKUP' ? '取货码核销后订单才确认收货，团购资格和返还释放规则保持不变。' : '团购为现金购买，不使用优惠券、消费积分、团购返还余额或其他折扣。'}</Text></View> : null}

    <View className='group-buy-policy' onClick={() => setPolicyAccepted((value) => !value)}><View className={policyAccepted ? 'group-buy-policy__check group-buy-policy__check--active' : 'group-buy-policy__check'}>{policyAccepted ? '✓' : ''}</View><Text>我已核对商品、{fulfillmentMode === 'PICKUP' ? '自提点和自提人信息' : '收货地址'}与金额，并知晓团购商品不支持取消、退款、退货或换货，仅收货后 24 小时质量问题补发。</Text></View>
    <View className='group-buy-checkout__bar'><View className='group-buy-checkout__bar-copy'><Text>{fulfillmentMode === 'PICKUP' ? '微信支付 · 到店自提' : '微信现金支付'}</Text><Text>{preview ? `¥${formatGroupBuyMoney(preview.expectedTotal)}` : '金额计算中'}</Text></View><Button className='group-buy-checkout__submit' loading={submitMutation.isPending} disabled={!preview || !fulfillmentReady || !policyAccepted || submitMutation.isPending} onClick={async () => { if (!await ensureWechatMiniProgramSession(returnUrl)) return; submitMutation.mutate(); }}>{submitMutation.isPending ? '支付确认中...' : '确认付款'}</Button></View>
  </View>;
}
