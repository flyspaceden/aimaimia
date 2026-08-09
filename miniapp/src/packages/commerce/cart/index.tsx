import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatMoney, isCartItemPurchasable, selectedCartItems, selectedCartTotal } from '@/components/commerce-utils';
import { CartRepo } from '@/repos';
import { queryClient } from '@/query/client';
import { useAuthStore } from '@/store/auth';
import type { Cart, Result } from '@/types';
import './index.scss';

type CartAction =
  | { kind: 'quantity'; skuId: string; quantity: number }
  | { kind: 'select'; skuId: string; selected: boolean }
  | { kind: 'remove'; skuId: string }
  | { kind: 'removePrize'; cartItemId: string }
  | { kind: 'clear' };

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
  const cartQuery = useQuery({
    queryKey: ['commerce', 'cart'],
    queryFn: CartRepo.get,
    enabled: hydrated && loggedIn,
    staleTime: 10_000,
  });
  useDidShow(() => { if (useAuthStore.getState().accessToken) void cartQuery.refetch(); });

  const cart = cartQuery.data?.ok ? cartQuery.data.data : undefined;
  const selected = useMemo(() => selectedCartItems(cart?.items ?? []), [cart]);
  const total = useMemo(() => selectedCartTotal(cart?.items ?? []), [cart]);
  const selectedNonPrizeTotal = cart?.selectedTotal ?? total;

  const actionMutation = useMutation({
    mutationFn: async (action: CartAction): Promise<Result<Cart | void>> => {
      if (action.kind === 'quantity') return CartRepo.updateQuantity(action.skuId, action.quantity);
      if (action.kind === 'select') return CartRepo.toggleSelected(action.skuId, action.selected);
      if (action.kind === 'remove') return CartRepo.removeItem(action.skuId);
      if (action.kind === 'removePrize') return CartRepo.removePrizeItem(action.cartItemId);
      return CartRepo.clear();
    },
    onSuccess: async (result, action) => {
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '购物车更新失败', icon: 'none' });
        return;
      }
      queryClient.setQueryData(['commerce', 'cart'], result);
      await queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });

  const remove = async (isPrize: boolean | undefined, id: string, skuId: string) => {
    const modal = await Taro.showModal({ title: '移除商品', content: isPrize ? '移除后本次购物车将不再保留该奖品；仍在有效期内的已解锁奖品可回到奖品记录。确定继续吗？' : '确定从购物车移除这件商品吗？', confirmColor: '#A04B42' });
    if (modal.confirm) actionMutation.mutate(isPrize ? { kind: 'removePrize', cartItemId: id } : { kind: 'remove', skuId });
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return (
    <View className='aim-page cart-auth'>
      <View className='cart-auth__orb'>购</View><Text className='cart-auth__title'>登录后查看购物车</Text>
      <Text className='cart-auth__copy'>App 与小程序共用同一购物车，登录后即可继续结算。</Text>
      <Button className='aim-button-primary cart-auth__button' onClick={() => Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/commerce/cart/index')}` })}>去登录</Button>
    </View>
  );
  if (cartQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!cartQuery.data || !cartQuery.data.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='购物车加载失败' description={cartQuery.data && !cartQuery.data.ok ? cartQuery.data.error.displayMessage : '请稍后重试'} onRetry={() => cartQuery.refetch()} /></View>;
  if (!cart?.items.length) return (
    <View className='aim-page cart-empty'>
      <View className='cart-empty__basket'>叶</View><Text className='cart-empty__title'>购物车还是空的</Text>
      <Text className='cart-empty__copy'>去挑选来自真实产地的新鲜好物吧。</Text>
      <Button className='aim-button-primary cart-empty__button' onClick={() => Taro.switchTab({ url: '/pages/products/index' })}>去逛商品</Button>
    </View>
  );

  return (
    <View className='cart-page'>
      <View className='cart-heading'><View><Text className='cart-heading__eyebrow'>本次选择</Text><Text className='cart-heading__title'>购物车</Text></View><Text className='cart-heading__clear' onClick={async () => { const modal = await Taro.showModal({ title: '清空购物车', content: '普通商品和已解锁奖品会被移除；仍未解锁的锁定赠品会保留。', confirmColor: '#A04B42' }); if (modal.confirm) actionMutation.mutate({ kind: 'clear' }); }}>清空</Text></View>
      <View className='cart-list'>
        {cart.items.map((item) => {
          const locked = Boolean(item.isPrize && item.isLocked && (!item.threshold || selectedNonPrizeTotal < item.threshold));
          const unavailable = !locked && !isCartItemPurchasable(item, selectedNonPrizeTotal);
          const checked = Boolean(item.isSelected && !locked && !unavailable);
          const max = Math.max(1, Math.min(item.product.stock || Number.MAX_SAFE_INTEGER, item.product.maxPerOrder || item.sku?.maxPerOrder || Number.MAX_SAFE_INTEGER));
          return (
            <View className={unavailable ? 'cart-row aim-card cart-row--unavailable' : 'cart-row aim-card'} key={item.id}>
              <View className={checked ? 'cart-check cart-check--active' : locked || unavailable || item.isPrize ? 'cart-check cart-check--disabled' : 'cart-check'} onClick={() => { if (!locked && !unavailable && !item.isPrize) actionMutation.mutate({ kind: 'select', skuId: item.skuId, selected: !checked }); }}>{checked ? '✓' : ''}</View>
              <Image className='cart-row__image' src={item.product.image || ''} mode='aspectFill' />
              <View className='cart-row__body'>
                <View className='cart-row__title-line'><Text className='cart-row__title'>{item.product.title}</Text>{item.isPrize ? <Text className='cart-row__prize'>奖品</Text> : null}{(item.product.type || item.productType) === 'BUNDLE' ? <Text className='cart-row__bundle'>组合</Text> : null}</View>
                {locked ? <Text className='cart-row__warning'>再选 ¥{formatMoney(Math.max(0, Number(item.threshold || 0) - selectedNonPrizeTotal))} 解锁赠品</Text> : null}
                {unavailable ? <Text className='cart-row__warning'>{unavailableText(item.unavailableReason || (item.stockStatus === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : null))}</Text> : null}
                <View className='cart-row__footer'>
                  <Text className='cart-row__price'>¥{formatMoney(item.product.price)}</Text>
                  {!item.isPrize ? <View className='cart-quantity'><Text className={item.quantity <= 1 ? 'cart-quantity__button cart-quantity__button--disabled' : 'cart-quantity__button'} onClick={() => { if (item.quantity > 1) actionMutation.mutate({ kind: 'quantity', skuId: item.skuId, quantity: item.quantity - 1 }); }}>−</Text><Text className='cart-quantity__value'>{item.quantity}</Text><Text className={item.quantity >= max ? 'cart-quantity__button cart-quantity__button--disabled' : 'cart-quantity__button'} onClick={() => { if (item.quantity < max) actionMutation.mutate({ kind: 'quantity', skuId: item.skuId, quantity: item.quantity + 1 }); }}>+</Text></View> : <Text className='cart-row__quantity'>×{item.quantity}</Text>}
                </View>
                <Text className='cart-row__remove' onClick={() => remove(item.isPrize, item.id, item.skuId)}>移除</Text>
              </View>
            </View>
          );
        })}
      </View>
      <View className='cart-bar'>
        <View><Text className='cart-bar__label'>已选 {selected.length} 项</Text><Text className='cart-bar__price'>¥{formatMoney(total)}</Text></View>
        <Button className={selected.length ? 'cart-bar__button' : 'cart-bar__button cart-bar__button--disabled'} disabled={!selected.length} onClick={() => Taro.navigateTo({ url: '/packages/commerce/checkout/index' })}>去结算</Button>
      </View>
    </View>
  );
}
