import { Button, Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatMoney, isCartItemPurchasable, isCartItemSelected, selectedCartItems, selectedCartTotal } from '@/components/commerce-utils';
import { SeafoodImage } from '@/components/SeafoodImage';
import { useAppConfig } from '@/hooks/use-app-config';
import { CartRepo, CheckoutRepo, RecommendationRepo } from '@/repos';
import { queryClient } from '@/query/client';
import { useAuthStore } from '@/store/auth';
import { useCartSelectionStore } from '@/store/cart-selection';
import type { Cart, Result } from '@/types';
import {
  cartExpiryText,
  cartLowStockText,
  cartSelectedQuantity,
  getCartCheckboxState,
  selectableNormalCartItems,
} from './cart-utils';
import {
  CartQuantityCoordinator,
  patchCartQuantity,
} from './cart-quantity-coordinator';
import './index.scss';

type CartAction =
  | { kind: 'select'; skuId: string; selected: boolean }
  | { kind: 'remove'; skuId: string }
  | { kind: 'removePrize'; cartItemId: string }
  | { kind: 'clear' };

type BatchResult = {
  result: Result<Cart | void>;
  completed: number;
};

function executeCartAction(action: CartAction): Promise<Result<Cart | void>> {
  if (action.kind === 'select') return CartRepo.toggleSelected(action.skuId, action.selected);
  if (action.kind === 'remove') return CartRepo.removeItem(action.skuId);
  if (action.kind === 'removePrize') return CartRepo.removePrizeItem(action.cartItemId);
  return CartRepo.clear();
}

function unavailableText(reason?: string | null): string {
  const messages: Record<string, string> = {
    OUT_OF_STOCK: '商品暂时缺货', SKU_INACTIVE: '该规格已下架', PRODUCT_INACTIVE: '商品已下架',
    PRIZE_INACTIVE: '奖品已失效', SKU_MISSING: '规格不存在', PRODUCT_MISSING: '商品不存在',
  };
  return reason ? messages[reason] || '商品暂不可购买' : '';
}

export default function CartPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const userId = useAuthStore((state) => state.userId || '');
  const prizeSelections = useCartSelectionStore((state) => state.prizeSelections);
  const beginCartSelection = useCartSelectionStore((state) => state.begin);
  const selectPrize = useCartSelectionStore((state) => state.selectPrize);
  const selectPrizes = useCartSelectionStore((state) => state.selectPrizes);
  const forgetPrize = useCartSelectionStore((state) => state.forgetPrize);
  const cartQuery = useQuery({
    queryKey: ['commerce', 'cart'],
    queryFn: CartRepo.get,
    enabled: hydrated && loggedIn,
    staleTime: 10_000,
  });
  const pendingQuery = useQuery({
    queryKey: ['commerce', 'pending-checkout'],
    queryFn: CheckoutRepo.getPending,
    enabled: hydrated && loggedIn,
    refetchInterval: 30_000,
  });
  const recommendationQuery = useQuery({
    queryKey: ['commerce', 'cart-recommendations'],
    queryFn: RecommendationRepo.listForMe,
    enabled: hydrated && loggedIn,
    staleTime: 60_000,
  });
  const { lowStockDisplayThreshold: lowStockThreshold } = useAppConfig();
  const [pendingQuantityIds, setPendingQuantityIds] = useState<Set<string>>(() => new Set());
  const structuralWriteRef = useRef(false);
  const quantityCoordinatorRef = useRef<CartQuantityCoordinator | null>(null);
  if (!quantityCoordinatorRef.current) {
    quantityCoordinatorRef.current = new CartQuantityCoordinator(
      CartRepo.updateQuantity,
      {
        onOptimistic: (cartItemId, quantity) => {
          queryClient.setQueryData<Result<Cart>>(
            ['commerce', 'cart'],
            (previous) => patchCartQuantity(previous, cartItemId, quantity),
          );
        },
        onAcknowledged: (ack) => {
          queryClient.setQueryData<Result<Cart>>(
            ['commerce', 'cart'],
            (previous) => patchCartQuantity(previous, ack.cartItemId, ack.quantity),
          );
        },
        onRollback: (cartItemId, quantity) => {
          queryClient.setQueryData<Result<Cart>>(
            ['commerce', 'cart'],
            (previous) => patchCartQuantity(previous, cartItemId, quantity),
          );
        },
        onFailure: (_cartItemId, result) => {
          if (!result.ok) {
            Taro.showToast({
              title: result.error.displayMessage || '购物车更新失败',
              icon: 'none',
            });
          }
        },
        onPendingChange: (cartItemId, pending) => {
          setPendingQuantityIds((current) => {
            const next = new Set(current);
            if (pending) next.add(cartItemId);
            else next.delete(cartItemId);
            return next;
          });
        },
        // Only a query started after every row queue is idle may replace the
        // full cart. A new tap cancels this reconciliation before patching.
        onIdle: () => {
          void queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
        },
      },
    );
  }
  const quantityCoordinator = quantityCoordinatorRef.current;
  useDidShow(() => {
    if (!useAuthStore.getState().accessToken) return;
    if (!quantityCoordinator.isPending() && !structuralWriteRef.current) {
      void cartQuery.refetch();
    }
    void pendingQuery.refetch();
  });
  useEffect(() => {
    if (userId) beginCartSelection(userId);
  }, [beginCartSelection, userId]);
  useEffect(() => () => quantityCoordinator.dispose(), [quantityCoordinator]);

  const [now, setNow] = useState(Date.now());
  const hasExpiringPrize = Boolean(cartQuery.data?.ok && cartQuery.data.data.items.some((item) => Boolean(item.expiresAt)));
  useEffect(() => {
    if (!hasExpiringPrize) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [hasExpiringPrize]);

  const cart = cartQuery.data?.ok ? cartQuery.data.data : undefined;
  const selected = useMemo(() => selectedCartItems(cart?.items ?? [], prizeSelections), [cart, prizeSelections]);
  const total = useMemo(() => selectedCartTotal(cart?.items ?? [], prizeSelections), [cart, prizeSelections]);
  const selectedNonPrizeTotal = cart?.selectedTotal ?? total;
  const selectedQuantity = useMemo(() => cartSelectedQuantity(cart?.items ?? [], prizeSelections), [cart, prizeSelections]);
  const selectableNormalItems = useMemo(
    () => selectableNormalCartItems(cart?.items ?? [], selectedNonPrizeTotal),
    [cart, selectedNonPrizeTotal],
  );
  const displaySelectableItems = useMemo(
    () => (cart?.items ?? []).filter((item) => !item.isLocked && isCartItemPurchasable(item, selectedNonPrizeTotal)),
    [cart, selectedNonPrizeTotal],
  );
  const displaySelectedQuantity = useMemo(
    () => selected.reduce((count, item) => count + item.quantity, 0),
    [selected],
  );
  const selectableQuantity = useMemo(
    () => displaySelectableItems.reduce((count, item) => count + item.quantity, 0),
    [displaySelectableItems],
  );
  const allSelected = displaySelectableItems.length > 0
    && displaySelectableItems.every((item) => (
      item.isPrize && item.threshold ? true : isCartItemSelected(item, prizeSelections)
    ));
  const pending = pendingQuery.data?.ok ? pendingQuery.data.data : null;
  const recommendations = recommendationQuery.data?.ok
    ? recommendationQuery.data.data.filter((item) => !/[（(]奖品[）)]/.test(item.product.title)).slice(0, 6)
    : [];

  const actionMutation = useMutation({
    mutationFn: executeCartAction,
    onSuccess: async (result) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '购物车更新失败', icon: 'none' });
        return;
      }
      queryClient.setQueryData(['commerce', 'cart'], result);
      await queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });

  const batchMutation = useMutation({
    mutationFn: async (actions: CartAction[]): Promise<BatchResult> => {
      let completed = 0;
      let latest: Result<Cart | void> | undefined;
      for (const action of actions) {
        const result = await executeCartAction(action);
        if (!result.ok) return { result, completed };
        latest = result;
        completed += 1;
      }
      return { result: latest || { ok: true, data: undefined }, completed };
    },
    onSuccess: async ({ result, completed }, actions) => {
      if (!result.ok) {
        await queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
        Taro.showToast({
          title: completed ? `已完成 ${completed} 项，其余未完成` : result.error.displayMessage || '购物车更新失败',
          icon: 'none',
        });
        return;
      }
      queryClient.setQueryData(['commerce', 'cart'], result);
      await queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
      Taro.showToast({ title: actions[0]?.kind === 'select' ? '已更新全选' : `已删除 ${completed} 项`, icon: 'none' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const structuralMutating = actionMutation.isPending || batchMutation.isPending;
  const cartMutating = structuralMutating || pendingQuantityIds.size > 0;

  const hasActiveCartWrite = () => (
    structuralWriteRef.current || quantityCoordinator.isPending()
  );

  const startCartAction = (action: CartAction) => {
    if (hasActiveCartWrite()) return;
    structuralWriteRef.current = true;
    actionMutation.mutate(action, {
      onSettled: () => { structuralWriteRef.current = false; },
    });
  };

  const startCartBatch = (actions: CartAction[]) => {
    if (hasActiveCartWrite()) return;
    structuralWriteRef.current = true;
    batchMutation.mutate(actions, {
      onSettled: () => { structuralWriteRef.current = false; },
    });
  };

  const changeQuantity = (
    cartItemId: string,
    renderedQuantity: number,
    max: number,
    delta: number,
  ) => {
    if (structuralWriteRef.current) return;
    // cancelQueries prevents a GET that started before this tap from painting
    // an older whole-cart snapshot over the optimistic row value.
    void queryClient.cancelQueries({ queryKey: ['commerce', 'cart'] });
    quantityCoordinator.enqueueDelta(
      cartItemId,
      renderedQuantity,
      1,
      max,
      delta,
    );
  };

  const remove = async (isPrize: boolean | undefined, id: string, skuId: string) => {
    if (hasActiveCartWrite()) return;
    const modal = await Taro.showModal({ title: '移除商品', content: isPrize ? '移除后本次购物车将不再保留该奖品；仍在有效期内的已解锁奖品可回到奖品记录。确定继续吗？' : '确定从购物车移除这件商品吗？', confirmColor: '#A04B42' });
    if (modal.confirm && !hasActiveCartWrite()) {
      if (isPrize) forgetPrize(id);
      startCartAction(isPrize ? { kind: 'removePrize', cartItemId: id } : { kind: 'remove', skuId });
    }
  };

  const toggleSelectAll = () => {
    if (!displaySelectableItems.length || hasActiveCartWrite()) return;
    const nextSelected = !allSelected;
    const localPrizeIds = displaySelectableItems
      .filter((item) => item.isPrize && !item.threshold)
      .map((item) => item.id);
    if (localPrizeIds.length) selectPrizes(localPrizeIds, nextSelected);
    if (!selectableNormalItems.length) return;
    startCartBatch(selectableNormalItems.map((item) => ({
      kind: 'select' as const,
      skuId: item.skuId,
      selected: nextSelected,
    })));
  };

  const removeSelected = async () => {
    if (!selected.length || hasActiveCartWrite()) return;
    const removable = selected.filter((item) => !item.isLocked);
    if (!removable.length) return;
    const modal = await Taro.showModal({
      title: '删除选中商品',
      content: `确定删除已选的 ${removable.length} 项商品吗？奖品将按其当前有效状态处理。`,
      confirmText: '删除',
      confirmColor: '#A04B42',
    });
    if (!modal.confirm || hasActiveCartWrite()) return;
    startCartBatch(removable.map((item) => item.isPrize
      ? { kind: 'removePrize' as const, cartItemId: item.id }
      : { kind: 'remove' as const, skuId: item.skuId }));
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return (
    <View className='aim-page cart-auth'>
      <View className='cart-auth__orb'><SeafoodImage name='icon-order-puffer' /></View><Text className='cart-auth__title'>登录后查看购物车</Text>
      <Text className='cart-auth__copy'>登录后即可查看已加入的商品并继续结算。</Text>
      <Button className='aim-button-primary cart-auth__button' onClick={() => Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/commerce/cart/index')}` })}>去登录</Button>
    </View>
  );
  if (cartQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!cartQuery.data || !cartQuery.data.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='购物车加载失败' description={cartQuery.data && !cartQuery.data.ok ? cartQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => cartQuery.refetch()} /></View>;
  if (!cart?.items.length) return (
    <View className='aim-page cart-empty'>
      <View className='cart-empty__basket'><SeafoodImage name='icon-tool-abalone' /></View><Text className='cart-empty__title'>购物车还是空的</Text>
      <Text className='cart-empty__copy'>去挑选来自真实产地的新鲜好物吧。</Text>
      <Button className='aim-button-primary cart-empty__button' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>去逛商品</Button>
    </View>
  );

  return (
    <View className='cart-page'>
      <View className='cart-heading'><View><Text className='cart-heading__eyebrow'>本次选择</Text><Text className='cart-heading__title'>购物车</Text></View><Text className='cart-heading__clear' onClick={async () => { if (hasActiveCartWrite()) return; const modal = await Taro.showModal({ title: '清空购物车', content: '普通商品和已解锁奖品会被移除；仍未解锁的锁定赠品会保留。', confirmColor: '#A04B42' }); if (modal.confirm && !hasActiveCartWrite()) startCartAction({ kind: 'clear' }); }}>清空</Text></View>
      {pending ? (
        <View className='cart-pending aim-card' hoverClass='cart-pending--pressed' onClick={() => Taro.navigateTo({ url: `/packages/commerce/checkout-pending/index?sessionId=${encodeURIComponent(pending.sessionId)}` })}>
          <View className='cart-pending__mark'>待</View>
          <View className='cart-pending__copy'><Text className='cart-pending__title'>有一笔支付尚未完成</Text><Text className='cart-pending__meta'>{pending.preview.firstItemTitle} · ¥{formatMoney(pending.expectedTotal)}</Text></View>
          <Text className='cart-pending__action'>继续支付 ›</Text>
        </View>
      ) : null}
      <View className='cart-select-bar aim-card'>
        <View className={allSelected ? 'cart-check cart-check--active cart-check--header' : 'cart-check cart-check--header'} onClick={toggleSelectAll}>{allSelected ? '✓' : ''}</View>
        <Text className='cart-select-bar__all' onClick={toggleSelectAll}>全选</Text>
        <Text className='cart-select-bar__count'>已选 {displaySelectedQuantity}/{selectableQuantity || 0}</Text>
        {selected.length ? <Text className='cart-select-bar__delete' onClick={() => { void removeSelected(); }}>删除选中</Text> : null}
      </View>
      <View className='cart-list'>
        {cart.items.map((item) => {
          const checkbox = getCartCheckboxState(
            item,
            selectedNonPrizeTotal,
            item.isPrize ? isCartItemSelected(item, prizeSelections) : undefined,
          );
          const { locked, unavailable, checked } = checkbox;
          const selectionCanChange = !checkbox.disabled;
          const max = Math.max(1, Math.min(item.product.stock || Number.MAX_SAFE_INTEGER, item.product.maxPerOrder || item.sku?.maxPerOrder || Number.MAX_SAFE_INTEGER));
          const stockText = cartLowStockText(item, lowStockThreshold);
          const expiryText = cartExpiryText(item.expiresAt, now);
          const bundleItems = item.bundleItems ?? item.product.bundleItems ?? [];
          return (
            <View className={unavailable ? 'cart-row aim-card cart-row--unavailable' : 'cart-row aim-card'} key={item.id}>
              <View
                className={checked ? 'cart-check cart-check--active' : !selectionCanChange ? 'cart-check cart-check--disabled' : 'cart-check'}
                onClick={() => {
                  if (hasActiveCartWrite() || !selectionCanChange) return;
                  if (item.isPrize) selectPrize(item.id, !checked);
                  else startCartAction({ kind: 'select', skuId: item.skuId, selected: !checked });
                }}
              >{checked ? '✓' : ''}</View>
              <Image className='cart-row__image' src={item.product.image || ''} mode='aspectFill' />
              <View className='cart-row__body'>
                <View className='cart-row__title-line'><Text className='cart-row__title'>{item.product.title}</Text>{item.isPrize ? <Text className='cart-row__prize'>奖品</Text> : null}{(item.product.type || item.productType) === 'BUNDLE' ? <Text className='cart-row__bundle'>组合</Text> : null}</View>
                {locked ? <Text className='cart-row__warning'>再选 ¥{formatMoney(Math.max(0, Number(item.threshold || 0) - selectedNonPrizeTotal))} 解锁赠品</Text> : null}
                {unavailable ? <Text className='cart-row__warning'>{unavailableText(item.unavailableReason || (item.stockStatus === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : null))}</Text> : null}
                {stockText ? <Text className='cart-row__stock'>{stockText}</Text> : null}
                {bundleItems.length ? <View className='cart-row__bundle-list'><Text className='cart-row__bundle-label'>组合内容</Text>{bundleItems.map((bundleItem) => <Text className='cart-row__bundle-item' key={`${bundleItem.skuId}-${bundleItem.productTitle}`}>{bundleItem.productTitle}{bundleItem.skuTitle ? ` · ${bundleItem.skuTitle}` : ''} ×{bundleItem.totalQuantity ?? bundleItem.quantityPerBundle ?? 1}</Text>)}</View> : null}
                {expiryText ? <Text className={expiryText === '已过期' ? 'cart-row__expiry cart-row__expiry--expired' : 'cart-row__expiry'}>{expiryText}</Text> : null}
                <View className='cart-row__footer'>
                  <View className='cart-row__price-line'><Text className='cart-row__price'>¥{formatMoney(item.product.price)}</Text>{item.isPrize && item.product.originalPrice != null && item.product.originalPrice > item.product.price ? <Text className='cart-row__original-price'>¥{formatMoney(item.product.originalPrice)}</Text> : null}</View>
                  {!item.isPrize ? <View className='cart-quantity'><Text className={item.quantity <= 1 || structuralMutating ? 'cart-quantity__button cart-quantity__button--disabled' : 'cart-quantity__button'} onClick={() => changeQuantity(item.id, item.quantity, max, -1)}>−</Text><Text className='cart-quantity__value'>{item.quantity}</Text><Text className={item.quantity >= max || structuralMutating ? 'cart-quantity__button cart-quantity__button--disabled' : 'cart-quantity__button'} onClick={() => changeQuantity(item.id, item.quantity, max, 1)}>+</Text></View> : <Text className='cart-row__quantity'>×{item.quantity}</Text>}
                </View>
                <Text className='cart-row__remove' onClick={() => remove(item.isPrize, item.id, item.skuId)}>移除</Text>
              </View>
            </View>
          );
        })}
      </View>
      {recommendations.length ? <View className='cart-recommend'>
        <View className='cart-recommend__heading'><View className='cart-recommend__ai'>AI</View><View><Text>猜你还想买</Text><Text>结合你的偏好为你挑选</Text></View></View>
        <ScrollView className='cart-recommend__scroll' scrollX enhanced showScrollbar={false}>
          <View className='cart-recommend__track'>{recommendations.map((recommendation) => <View
            className='cart-recommend-card aim-card'
            key={recommendation.id}
            onClick={() => Taro.navigateTo({ url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(recommendation.product.id)}` })}
          >
            <Image src={recommendation.product.image} mode='aspectFill' />
            <Text className='cart-recommend-card__title'>{recommendation.product.title}</Text>
            <Text className='cart-recommend-card__reason'>{recommendation.reason}</Text>
            <View><Text className='cart-recommend-card__price'>¥{formatMoney(recommendation.product.price)}</Text><Text className='cart-recommend-card__arrow'>›</Text></View>
          </View>)}</View>
        </ScrollView>
      </View> : null}
      <View className='cart-bar'>
        <View><Text className='cart-bar__label'>已选 {selectedQuantity} 件商品</Text><Text className='cart-bar__price'>¥{formatMoney(total)}</Text></View>
        <Button className={selected.length && !cartMutating ? 'cart-bar__button' : 'cart-bar__button cart-bar__button--disabled'} disabled={!selected.length || cartMutating} onClick={() => { if (!hasActiveCartWrite()) Taro.navigateTo({ url: '/packages/commerce/checkout/index' }); }}>去结算</Button>
      </View>
    </View>
  );
}
