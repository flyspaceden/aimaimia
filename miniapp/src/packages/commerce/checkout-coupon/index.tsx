import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatMoney, toggleCheckoutCoupon } from '@/components/commerce-utils';
import { CouponRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { useCheckoutSelectionStore } from '@/store/checkout-selection';
import type { CheckoutEligibleCoupon } from '@/types';
import './index.scss';

function discountLabel(coupon: CheckoutEligibleCoupon): string {
  if (coupon.discountType === 'FIXED') return `¥${formatMoney(coupon.discountValue)}`;
  return `${(100 - coupon.discountValue) / 10}折`;
}

export default function CheckoutCouponPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const selection = useCheckoutSelectionStore();
  const [selected, setSelected] = useState(selection.couponIds);
  const query = useQuery({
    queryKey: ['commerce', 'checkout-coupons', selection.couponRequest],
    queryFn: () => CouponRepo.getCheckoutEligible(selection.couponRequest!),
    enabled: hydrated && loggedIn && selection.ownerRevision === authRevision && Boolean(selection.couponRequest),
  });
  const sorted = useMemo(() => [...(query.data?.ok ? query.data.data : [])].sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.estimatedDiscount - left.estimatedDiscount), [query.data]);
  const coupons = query.data?.ok ? query.data.data : [];
  const total = Math.min(selection.couponRequest?.previewOrderAmount || 0, coupons.filter((coupon) => selected.includes(coupon.id)).reduce((sum, coupon) => sum + coupon.estimatedDiscount, 0));
  const choose = (coupon: CheckoutEligibleCoupon) => setSelected((current) => toggleCheckoutCoupon(current, coupon, coupons));
  const confirm = () => {
    if (selection.ownerRevision !== authRevision) {
      Taro.showToast({ title: '登录状态已变更，请返回结算页重试', icon: 'none' });
      return;
    }
    selection.selectCoupons(selected.filter((id) => coupons.some((coupon) => coupon.id === id && coupon.eligible)));
    void Taro.navigateBack();
  };
  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能选择平台红包' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/commerce/checkout-coupon/index')}` })} /></View>;
  if (selection.ownerRevision !== authRevision || !selection.couponRequest) return <View className='aim-page'><CatalogFeedback kind='empty' title='结算信息已失效' description='请返回结算页重新计算可用红包' actionLabel='返回结算页' onRetry={() => Taro.navigateBack()} /></View>;
  if (query.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!query.data?.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='红包加载失败' description={query.data && !query.data.ok ? query.data.error.displayMessage : '请稍后重试'} onRetry={() => query.refetch()} /></View>;
  return <View className='checkout-coupon-page'>
    <View className='checkout-coupon-content'>
      {!sorted.length ? <CatalogFeedback kind='empty' title='本单暂无可用红包' description='平台红包与消费积分是两套独立优惠，可返回继续使用消费积分。' /> : null}
      {sorted.map((coupon, index) => <View key={coupon.id}>{index > 0 && sorted[index - 1].eligible && !coupon.eligible ? <Text className='checkout-coupon-divider'>暂不可用</Text> : null}<View className={!coupon.eligible ? 'checkout-coupon-card aim-card checkout-coupon-card--disabled' : selected.includes(coupon.id) ? 'checkout-coupon-card aim-card checkout-coupon-card--active' : 'checkout-coupon-card aim-card'} onClick={() => choose(coupon)}><View className='checkout-coupon-card__amount'><Text>{discountLabel(coupon)}</Text><Text>{coupon.minOrderAmount > 0 ? `满¥${formatMoney(coupon.minOrderAmount)}可用` : '无门槛'}</Text></View><View className='checkout-coupon-card__copy'><Text>{coupon.campaignName}</Text><Text>{coupon.eligible ? `预估可减 ¥${formatMoney(coupon.estimatedDiscount)}` : coupon.ineligibleReason || '暂不可用'}</Text><Text>{coupon.stackable ? '同组可叠加，以结算结果为准' : '同组不可叠加'}</Text></View><View className='checkout-coupon-card__check'>{!coupon.eligible ? '×' : selected.includes(coupon.id) ? '✓' : ''}</View></View></View>)}
    </View>
    <View className='checkout-coupon-bar'><View><Text>已选 {selected.length} 张</Text><Text>预计优惠 ¥{formatMoney(total)}</Text></View><Button onClick={() => { setSelected([]); selection.selectCoupons([]); void Taro.navigateBack(); }}>不使用</Button><Button onClick={confirm}>确认选择</Button></View>
  </View>;
}
