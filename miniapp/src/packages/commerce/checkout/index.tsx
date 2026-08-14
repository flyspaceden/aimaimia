import { Button, Image, Input, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { catalogCardStockText } from '@/components/catalog-utils';
import { clampDeduction, formatMoney, isUserCancelledPayment, newCheckoutIdempotencyKey, payableAfterDeduction, selectedCartItems } from '@/components/commerce-utils';
import { FulfillmentModeSwitch, PickupSelectionPanel } from '@/components/pickup-fulfillment';
import {
  buildPickupFulfillment,
  isPickupRecipientValid,
  pickupPointsAvailable,
  pickupSelectionsComplete,
  type PickupSelectionMap,
} from '@/components/pickup-utils';
import { useAppConfig } from '@/hooks/use-app-config';
import { AddressRepo, CartRepo, CheckoutRepo, CouponRepo, ProductRepo } from '@/repos';
import { miniProgramCashierFailureMessage, requestMiniProgramPayment } from '@/platform/payment';
import { ensureWechatMiniProgramSession } from '@/platform/auth';
import { queryClient } from '@/query/client';
import type { CartItem, CheckoutStatusResult, FulfillmentInput, FulfillmentMode } from '@/types';
import { captureAuthSession, useAuthStore } from '@/store/auth';
import { resolveAppErrorCode } from '@/types/result';
import { useCartSelectionStore } from '@/store/cart-selection';
import { useCheckoutSelectionStore } from '@/store/checkout-selection';
import './index.scss';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function confirmCheckout(sessionId: string): Promise<CheckoutStatusResult | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = attempt % 4 === 0
      ? await CheckoutRepo.activeQuery(sessionId)
      : await CheckoutRepo.getStatus(sessionId);
    if (result.ok && ['COMPLETED', 'EXPIRED', 'FAILED'].includes(result.data.status)) return result.data;
    await wait(1_500);
  }
  return null;
}

export default function CheckoutPage() {
  const router = useRouter();
  const buyNowProductId = typeof router.params.buyNowProductId === 'string' ? router.params.buyNowProductId : '';
  const buyNowSkuId = typeof router.params.buyNowSkuId === 'string' ? router.params.buyNowSkuId : '';
  const parsedBuyNowQuantity = typeof router.params.buyNowQuantity === 'string' ? Number(router.params.buyNowQuantity) : NaN;
  const buyNowQuantity = Number.isSafeInteger(parsedBuyNowQuantity) && parsedBuyNowQuantity > 0 ? parsedBuyNowQuantity : 0;
  const isBuyNow = Boolean(buyNowProductId || buyNowSkuId || buyNowQuantity);
  const checkoutReturnUrl = isBuyNow
    ? `/packages/commerce/checkout/index?buyNowProductId=${encodeURIComponent(buyNowProductId)}&buyNowSkuId=${encodeURIComponent(buyNowSkuId)}&buyNowQuantity=${buyNowQuantity}`
    : '/packages/commerce/checkout/index';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const hasWechatSession = useAuthStore((state) => state.loginMethod === 'wechat-miniapp');
  const authRevision = useAuthStore((state) => state.revision);
  const checkoutSelection = useCheckoutSelectionStore();
  const prizeSelections = useCartSelectionStore((state) => state.prizeSelections);
  const clearCartSelections = useCartSelectionStore((state) => state.clear);
  const { lowStockDisplayThreshold } = useAppConfig();
  const [addressId, setAddressId] = useState('');
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('DELIVERY');
  const [pickupRecipientName, setPickupRecipientName] = useState('');
  const [pickupRecipientPhone, setPickupRecipientPhone] = useState('');
  const [pickupSelections, setPickupSelections] = useState<PickupSelectionMap>({});
  const [couponIds, setCouponIds] = useState<string[]>([]);
  const [deductionInput, setDeductionInput] = useState('');
  const [buyerNote, setBuyerNote] = useState('');
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const idempotencyKey = useRef(newCheckoutIdempotencyKey());

  const cartQuery = useQuery({ queryKey: ['commerce', 'cart'], queryFn: CartRepo.get, enabled: hydrated && loggedIn && !isBuyNow, staleTime: 5_000 });
  const directProductQuery = useQuery({ queryKey: ['catalog', 'product', buyNowProductId], queryFn: () => ProductRepo.getById(buyNowProductId), enabled: hydrated && loggedIn && isBuyNow && Boolean(buyNowProductId), staleTime: 5 * 60_000 });
  const addressQuery = useQuery({ queryKey: ['account', 'addresses'], queryFn: AddressRepo.list, enabled: hydrated && loggedIn, staleTime: 30_000 });
  useDidShow(() => { void addressQuery.refetch(); });
  const cart = cartQuery.data?.ok ? cartQuery.data.data : undefined;
  const directProduct = directProductQuery.data?.ok ? directProductQuery.data.data : undefined;
  const directItem = useMemo<CartItem | undefined>(() => {
    if (!isBuyNow || !directProduct || !buyNowSkuId || !buyNowQuantity) return undefined;
    const sku = directProduct.skus.find((item) => item.id === buyNowSkuId);
    if (!sku) return undefined;
    const availableStock = directProduct.type === 'BUNDLE' ? directProduct.bundleAvailableStock ?? sku.stock : sku.stock;
    const maxPerOrder = sku.maxPerOrder ?? directProduct.maxPerOrder ?? Number.MAX_SAFE_INTEGER;
    if (availableStock <= 0 || buyNowQuantity > availableStock || buyNowQuantity > maxPerOrder) return undefined;
    return {
      id: `buy-now:${sku.id}`,
      skuId: sku.id,
      quantity: buyNowQuantity,
      productType: directProduct.type,
      product: {
        id: directProduct.id,
        title: directProduct.title,
        type: directProduct.type,
        image: directProduct.image || null,
        price: sku.price,
        categoryId: directProduct.categoryId,
        companyId: directProduct.companyId,
        originalPrice: directProduct.strikePrice ?? null,
        stock: availableStock,
        maxPerOrder,
      },
      sku: { stock: availableStock, maxPerOrder },
      isSelected: true,
      selectable: true,
    };
  }, [buyNowQuantity, buyNowSkuId, directProduct, isBuyNow]);
  const items = useMemo(
    () => isBuyNow ? (directItem ? [directItem] : []) : selectedCartItems(cart?.items ?? [], prizeSelections),
    [cart, directItem, isBuyNow, prizeSelections],
  );
  const companyIds = useMemo(
    () => [...new Set(items.map((item) => item.product.companyId).filter((id): id is string => Boolean(id)))],
    [items],
  );
  const addresses = useMemo(() => addressQuery.data?.ok ? addressQuery.data.data : [], [addressQuery.data]);
  const pickupPointsQuery = useQuery({
    queryKey: ['commerce', 'pickup-points', companyIds],
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

  useEffect(() => {
    if (addresses.length && (!addressId || !addresses.some((address) => address.id === addressId))) {
      setAddressId((addresses.find((address) => address.isDefault) || addresses[0]).id);
    } else if (!addresses.length && addressId) {
      setAddressId('');
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
        const currentPoint = group?.points.find((point) => point.id === current[companyId]);
        const pointId = currentPoint?.id || group?.points[0]?.id;
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
        : '部分商家暂无自提点，已切换为送货上门',
      icon: 'none',
    });
  }, [fulfillmentMode, pickupAvailable, pickupPointsQuery.data, pickupPointsQuery.isLoading]);

  useEffect(() => {
    if (checkoutSelection.ownerRevision !== authRevision) return;
    if (checkoutSelection.addressId && addresses.some((address) => address.id === checkoutSelection.addressId)) {
      setAddressId(checkoutSelection.addressId);
    }
    setCouponIds(checkoutSelection.couponIds);
  }, [addresses, authRevision, checkoutSelection.addressId, checkoutSelection.couponIds, checkoutSelection.ownerRevision]);

  const pickupReady = isPickupRecipientValid(pickupRecipientName, pickupRecipientPhone)
    && pickupSelectionsComplete(pickupGroups, pickupSelections, companyIds);
  const fulfillmentReady = fulfillmentMode === 'DELIVERY' ? Boolean(addressId) : pickupReady;
  const fulfillment = useMemo<FulfillmentInput>(() => fulfillmentMode === 'DELIVERY'
    ? { mode: 'DELIVERY', addressId }
    : buildPickupFulfillment(pickupRecipientName, pickupRecipientPhone, pickupSelections, companyIds),
  [addressId, companyIds, fulfillmentMode, pickupRecipientName, pickupRecipientPhone, pickupSelections]);
  const previewInput = useMemo(() => ({
    items: items.map((item) => ({ skuId: item.skuId, quantity: item.quantity, ...(!isBuyNow ? { cartItemId: item.id } : {}) })),
    checkoutSource: isBuyNow ? 'BUY_NOW' as const : 'CART' as const,
    ...(fulfillmentMode === 'DELIVERY' && addressId ? { addressId } : {}),
    fulfillment,
    ...(couponIds.length ? { couponInstanceIds: couponIds } : {}),
  }), [addressId, couponIds, fulfillment, fulfillmentMode, isBuyNow, items]);
  const previewQuery = useQuery({
    queryKey: ['commerce', 'checkout-preview', previewInput],
    queryFn: () => CheckoutRepo.preview(previewInput),
    enabled: items.length > 0 && fulfillmentReady,
    staleTime: 0,
  });
  const preview = previewQuery.data?.ok ? previewQuery.data.data : undefined;
  const eligibleQuery = useQuery({
    queryKey: ['commerce', 'checkout-coupons', preview?.summary.totalGoodsAmount, items.map((item) => item.skuId).join(',')],
    queryFn: () => CouponRepo.getCheckoutEligible({
      previewOrderAmount: preview!.summary.totalGoodsAmount,
      categoryIds: [...new Set(items.map((item) => item.product.categoryId).filter((id): id is string => Boolean(id)))],
      companyIds: [...new Set(items.map((item) => item.product.companyId).filter((id): id is string => Boolean(id)))],
    }),
    enabled: Boolean(preview),
    staleTime: 30_000,
  });
  const coupons = eligibleQuery.data?.ok ? eligibleQuery.data.data : [];
  const deduction = clampDeduction(deductionInput, preview);
  const payable = preview ? payableAfterDeduction(preview, deduction) : 0;

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!preview || !fulfillmentReady) throw new Error('MISSING_CHECKOUT_INPUT');
      const authGuard = captureAuthSession();
      const session = await CheckoutRepo.create({
        items: previewInput.items,
        checkoutSource: previewInput.checkoutSource,
        ...(fulfillmentMode === 'DELIVERY' ? { addressId } : {}),
        fulfillment,
        expectedTotal: payable,
        couponInstanceIds: couponIds.length ? couponIds : undefined,
        deductionAmount: deduction || undefined,
        idempotencyKey: idempotencyKey.current,
        buyerNote: buyerNote.trim() || undefined,
      });
      if (!session.ok) return session;
      if (!useAuthStore.getState().isCurrentSessionGeneration(authGuard)) {
        return { ok: true as const, data: { session: session.data, status: null, cancelled: false, sessionChanged: true } };
      }
      if (session.data.excludedItems?.length) {
        const removedNames = session.data.excludedItems
          .map((item) => item.isPrize ? '失效奖品' : '失效商品')
          .join('、');
        const modal = await Taro.showModal({
          title: '结算内容有变化',
          content: `${removedNames}已不再参与本次结算，当前应付 ¥${formatMoney(session.data.expectedTotal)}。是否按新内容继续微信支付？`,
          confirmText: '继续支付',
          cancelText: '暂不支付',
          confirmColor: '#2E7D32',
        });
        if (!modal.confirm) {
          return { ok: true as const, data: { session: session.data, status: null, cancelled: true, excludedDeclined: true, sessionChanged: false } };
        }
      }
      if (!useAuthStore.getState().isCurrentSessionGeneration(authGuard)) {
        return { ok: true as const, data: { session: session.data, status: null, cancelled: false, sessionChanged: true } };
      }
      let cancelled = false;
      let paymentError: string | undefined;
      try {
        await requestMiniProgramPayment(session.data.paymentParams);
      } catch (error) {
        cancelled = isUserCancelledPayment(error);
        if (!cancelled) paymentError = miniProgramCashierFailureMessage(error);
      }
      if (!useAuthStore.getState().isCurrentSessionGeneration(authGuard)) {
        return { ok: true as const, data: { session: session.data, status: null, cancelled, sessionChanged: true } };
      }
      const status = await confirmCheckout(session.data.sessionId);
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
        if (errorCode === 'PENDING_CHECKOUT_EXISTS') {
          Taro.showToast({ title: '已有待支付订单，请先处理', icon: 'none' });
          await Taro.redirectTo({ url: '/packages/commerce/checkout-pending/index' });
          return;
        }
        Taro.showToast({ title: result.error.displayMessage || '订单提交失败', icon: 'none' });
        return;
      }
      if (result.data.sessionChanged) {
        Taro.showToast({ title: '登录状态已变更，请切回原账户核对支付结果', icon: 'none', duration: 2800 });
        await Taro.switchTab({ url: '/pages/me/index' });
        return;
      }
      const { session, status, cancelled } = result.data;
      const paymentError = 'paymentError' in result.data ? result.data.paymentError : undefined;
      if (status?.status === 'COMPLETED') {
        checkoutSelection.clear();
        clearCartSelections();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] }),
          queryClient.invalidateQueries({ queryKey: ['orders'] }),
        ]);
        const orderIds = encodeURIComponent(status.orderIds.join(','));
        await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${orderIds}&amount=${session.expectedTotal}` });
        return;
      }
      if (status?.status === 'FAILED' || status?.status === 'EXPIRED') {
        idempotencyKey.current = newCheckoutIdempotencyKey();
        Taro.showToast({ title: status.status === 'EXPIRED' ? '支付已超时，请重新结算' : '支付未成功', icon: 'none' });
        return;
      }
      Taro.showToast({ title: cancelled ? '已取消支付，可稍后继续' : paymentError || '支付结果确认中', icon: 'none', duration: 2200 });
      await Taro.redirectTo({ url: `/packages/commerce/checkout-pending/index?sessionId=${encodeURIComponent(session.sessionId)}` });
    },
    onError: (error) => {
      const missing = error instanceof Error && error.message === 'MISSING_CHECKOUT_INPUT';
      Taro.showToast({ title: missing ? fulfillmentMode === 'PICKUP' ? '请完整填写自提信息' : '请选择地址并等待价格计算' : '网络开小差了，请重试', icon: 'none' });
    },
  });

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能选择配送或自提并提交订单' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(checkoutReturnUrl)}` })} /></View>;
  if ((!isBuyNow && cartQuery.isLoading) || (isBuyNow && directProductQuery.isLoading) || (fulfillmentMode === 'DELIVERY' && addressQuery.isLoading)) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if ((!isBuyNow && !cartQuery.data?.ok) || (isBuyNow && !directProductQuery.data?.ok) || (fulfillmentMode === 'DELIVERY' && !addressQuery.data?.ok)) return <View className='aim-page'><CatalogFeedback kind='error' title='结算信息加载失败' description={isBuyNow ? '商品或规格已变更，请返回商品详情重新确认' : '请返回购物车后重试'} onRetry={() => { if (isBuyNow) void directProductQuery.refetch(); else void cartQuery.refetch(); void addressQuery.refetch(); }} /></View>;
  if (!items.length) return <View className='aim-page'><CatalogFeedback kind='empty' title='暂无可结算商品' description={isBuyNow ? '商品库存、限购数量或规格已变更，请返回重新选择' : '请返回购物车重新选择'} onRetry={() => isBuyNow ? Taro.navigateBack() : Taro.redirectTo({ url: '/packages/commerce/cart/index' })} /></View>;

  const openAddressSelection = () => {
    checkoutSelection.begin({ ownerRevision: authRevision, addressId, couponIds });
    void Taro.navigateTo({ url: '/packages/commerce/checkout-address/index' });
  };
  const openCouponSelection = () => {
    if (!preview) return;
    checkoutSelection.begin({
      ownerRevision: authRevision,
      addressId,
      couponIds,
      couponRequest: {
        previewOrderAmount: preview.summary.totalGoodsAmount,
        categoryIds: [...new Set(items.map((item) => item.product.categoryId).filter((id): id is string => Boolean(id)))],
        companyIds: [...new Set(items.map((item) => item.product.companyId).filter((id): id is string => Boolean(id)))],
      },
    });
    void Taro.navigateTo({ url: '/packages/commerce/checkout-coupon/index' });
  };

  return (
    <View className='checkout-page'>
      <FulfillmentModeSwitch
        mode={fulfillmentMode}
        onChange={(mode) => {
          setFulfillmentMode(mode);
          setPolicyAccepted(false);
        }}
        pickupAvailable={pickupAvailable}
      />
      {pickupPointsQuery.data?.ok === false ? <CatalogFeedback kind='error' title='自提点加载失败' description={pickupPointsQuery.data.error.displayMessage || '当前暂时不能选择到店自提'} onRetry={() => pickupPointsQuery.refetch()} /> : null}
      {fulfillmentMode === 'DELIVERY' ? <View className='checkout-address aim-card'>
        <View className='checkout-address__accent' />
        <View className='checkout-section-heading'><Text>收货地址</Text><Text onClick={openAddressSelection}>{addresses.length ? '切换 ›' : '新增 ›'}</Text></View>
        {!addresses.length ? <View className='checkout-address__empty' onClick={openAddressSelection}><Text>＋ 添加收货地址</Text><Text>完成后返回继续结算</Text></View> : (() => { const address = addresses.find((item) => item.id === addressId) || addresses[0]; return <View className='checkout-address-selected' onClick={openAddressSelection}><View><Text className='checkout-address-option__name'>{address.receiverName}　{address.phone}</Text><Text className='checkout-address-option__detail'>{address.regionText || `${address.province}${address.city}${address.district}`} {address.detail}</Text></View><Text>›</Text></View>; })()}
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

      {previewQuery.isLoading ? <CatalogFeedback kind='loading' /> : null}
      {previewQuery.data && !previewQuery.data.ok ? <CatalogFeedback kind='error' title='价格校验失败' description={previewQuery.data.error.displayMessage || '请稍后重试'} onRetry={() => previewQuery.refetch()} /> : null}
      {preview ? <>
        {preview.excludedItems?.length ? <View className='checkout-options aim-card'><View className='checkout-section-heading'><Text>结算内容已调整</Text><Text>{preview.excludedItems.length} 项</Text></View><Text className='checkout-muted'>以下失效或不可售内容不会进入订单：{preview.excludedItems.map((item) => item.isPrize ? '奖品' : '商品').join('、')}。支付前还会再次核对库存和价格。</Text></View> : null}
        <View className='checkout-groups'>
          {preview.groups.map((group) => <View className='checkout-group aim-card' key={group.companyId}><View className='checkout-section-heading'><Text>{group.companyName}</Text><Text>{group.items.length} 件</Text></View>{group.items.map((item) => {
            const source = items.find((candidate) => candidate.skuId === item.skuId);
            const bundleItems = source?.bundleItems ?? source?.product.bundleItems ?? [];
            const stockText = source ? catalogCardStockText(source.product.stock, lowStockDisplayThreshold) : undefined;
            return <View className='checkout-item' key={item.skuId}><Image className='checkout-item__image' src={item.image} mode='aspectFill' /><View className='checkout-item__copy'><Text className='checkout-item__title'>{item.title}</Text><Text className='checkout-item__quantity'>×{item.quantity}</Text>{stockText ? <Text className={stockText === '已售完' ? 'checkout-item__stock checkout-item__stock--out' : 'checkout-item__stock'}>{stockText}</Text> : null}{bundleItems.length ? <View className='checkout-item__bundle'>{bundleItems.map((bundleItem) => <Text key={`${bundleItem.skuId}-${bundleItem.productTitle}`}>{bundleItem.productTitle}{bundleItem.skuTitle ? ` · ${bundleItem.skuTitle}` : ''} ×{bundleItem.totalQuantity ?? bundleItem.quantityPerBundle ?? 1}</Text>)}</View> : null}</View><Text className='checkout-item__price'>¥{formatMoney(item.unitPrice * item.quantity)}</Text></View>;
          })}<View className='checkout-group__summary'><Text>商品 ¥{formatMoney(group.goodsAmount)}</Text><Text>{fulfillmentMode === 'PICKUP' ? '自提免运费' : group.shippingFee ? `运费 ¥${formatMoney(group.shippingFee)}` : '包邮'}</Text></View></View>)}
        </View>

        <View className='checkout-options aim-card'>
          <View className='checkout-section-heading checkout-section-heading--clickable' onClick={openCouponSelection}><Text>平台红包</Text><Text>{couponIds.length ? `已选 ${couponIds.length} 张 ›` : '选择红包 ›'}</Text></View>
          {eligibleQuery.isLoading ? <Text className='checkout-muted'>正在计算可用红包...</Text> : null}
          {coupons.length ? <Text className='checkout-muted'>{couponIds.length ? `已选红包预计优惠 ¥${formatMoney(coupons.filter((coupon) => couponIds.includes(coupon.id)).reduce((sum, coupon) => sum + coupon.estimatedDiscount, 0))}` : `${coupons.filter((coupon) => coupon.eligible).length} 张可用，可与消费积分叠加`}</Text> : !eligibleQuery.isLoading ? <Text className='checkout-muted'>本单暂无可用红包</Text> : null}
        </View>

        <View className='checkout-options aim-card'>
          <View className='checkout-section-heading'><Text>消费积分抵扣</Text><Text>余额 ¥{formatMoney(preview.pointsBalance)}</Text></View>
          <Text className='checkout-muted'>本单最多抵扣 ¥{formatMoney(preview.maxDeductible)}，VIP 礼包不可抵扣。</Text>
          <View className='checkout-deduction'><Text>¥</Text><Input type='digit' value={deductionInput} placeholder='0.00' onInput={(event) => setDeductionInput(event.detail.value)} /><Text onClick={() => setDeductionInput(formatMoney(preview.maxDeductible))}>抵扣最大</Text></View>
        </View>

        <View className='checkout-options aim-card'>
          <Text className='checkout-option-label'>订单备注</Text><Textarea className='checkout-note' maxlength={200} value={buyerNote} placeholder='可填写给商家的备注（选填）' onInput={(event) => setBuyerNote(event.detail.value)} />
        </View>

        <View className='checkout-price aim-card'>
          <View><Text>商品金额</Text><Text>¥{formatMoney(preview.summary.totalGoodsAmount)}</Text></View>
          <View><Text>运费</Text><View className='checkout-price__shipping'><Text>{fulfillmentMode === 'PICKUP' ? '自提免运费' : preview.summary.totalShippingFee ? `¥${formatMoney(preview.summary.totalShippingFee)}` : '包邮'}</Text>{fulfillmentMode === 'DELIVERY' && preview.summary.totalShippingFee > 0 && typeof preview.summary.amountToFreeShipping === 'number' && preview.summary.amountToFreeShipping > 0 ? <Text>再买 ¥{formatMoney(preview.summary.amountToFreeShipping)} 可免运费</Text> : null}</View></View>
          {preview.summary.vipDiscount > 0 ? <View><Text>VIP 优惠</Text><Text className='checkout-price__minus'>-¥{formatMoney(preview.summary.vipDiscount)}</Text></View> : null}
          {preview.summary.totalDiscount > 0 ? <View><Text>红包优惠</Text><Text className='checkout-price__minus'>-¥{formatMoney(preview.summary.totalDiscount)}</Text></View> : null}
          {deduction > 0 ? <View><Text>消费积分</Text><Text className='checkout-price__minus'>-¥{formatMoney(deduction)}</Text></View> : null}
          <View className='checkout-price__total'><Text>合计</Text><Text>¥{formatMoney(payable)}</Text></View>
        </View>
        <View className='checkout-policy' onClick={() => setPolicyAccepted((value) => !value)}><View className={policyAccepted ? 'checkout-radio checkout-radio--active' : 'checkout-radio'}>{policyAccepted ? '✓' : ''}</View><Text>{fulfillmentMode === 'PICKUP' ? '我已核对商品、自提点和自提人信息，并知晓商品备好后需凭一次性取货码核销。' : '我已核对商品、地址，并知晓商品售后与退款规则'}</Text></View>
      </> : null}

      <View className='checkout-bar'>
        <View><Text>微信支付</Text><Text>¥{preview ? formatMoney(payable) : '--'}</Text></View>
        <Button className='checkout-bar__button' loading={submitMutation.isPending} disabled={!preview || !fulfillmentReady || !policyAccepted || submitMutation.isPending} onClick={async () => { if (!await ensureWechatMiniProgramSession(checkoutReturnUrl)) return; submitMutation.mutate(); }}>{submitMutation.isPending ? '支付确认中...' : hasWechatSession ? '提交订单' : '使用微信身份继续支付'}</Button>
      </View>
    </View>
  );
}
