import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { MemberFeedback } from '../MemberFeedback';
import { MemberCouponRepo } from '../repos';
import { formatCouponDiscount, formatMoney } from '../utils';
import type { CouponCenterView, CouponInstanceStatus, MyCoupon } from '../types';
import '../member.scss';

type MainTab = 'mine' | 'center';
const MINE_FILTERS: Array<{ key: 'all' | CouponInstanceStatus; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'AVAILABLE', label: '可用' },
  { key: 'RESERVED', label: '锁定' },
  { key: 'USED', label: '已使用' },
  { key: 'EXPIRED', label: '已过期' },
];
const CENTER_FILTERS: Array<{ key: CouponCenterView; label: string }> = [
  { key: 'claimable', label: '可领取' },
  { key: 'claimed', label: '已领取' },
  { key: 'active', label: '进行中' },
];
const STATUS_COPY: Record<CouponInstanceStatus, string> = {
  AVAILABLE: '可用', RESERVED: '锁定中', USED: '已使用', EXPIRED: '已过期', REVOKED: '已撤回',
};

function CouponCard({ item }: { item: MyCoupon }) {
  const inactive = item.status !== 'AVAILABLE';
  return <View className={inactive ? 'coupon-card coupon-card--inactive' : 'coupon-card'}>
    <View className='coupon-card__value'><Text>{formatCouponDiscount(item.discountType, item.discountValue)}</Text><Text>{item.minOrderAmount > 0 ? `满${formatMoney(item.minOrderAmount)}可用` : '无门槛'}</Text></View>
    <View className='coupon-card__body'><View className='coupon-card__head'><Text>{item.campaignName}</Text><Text>{STATUS_COPY[item.status]}</Text></View><Text className='coupon-card__rule'>{item.discountType === 'PERCENT' && item.maxDiscountAmount !== null ? `最高减${formatMoney(item.maxDiscountAmount)} · ` : ''}有效期至 {new Date(item.expiresAt).toLocaleDateString('zh-CN')}</Text>{item.status === 'USED' && item.usedAmount !== null ? <Text className='coupon-card__used'>实际抵扣 {formatMoney(item.usedAmount)}</Text> : null}</View>
  </View>;
}

export default function CouponsPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const client = useQueryClient();
  const [mainTab, setMainTab] = useState<MainTab>('mine');
  const [mineFilter, setMineFilter] = useState<'all' | CouponInstanceStatus>('all');
  const [centerFilter, setCenterFilter] = useState<CouponCenterView>('claimable');
  const mineQuery = useQuery({
    queryKey: ['member', 'coupons', 'mine', mineFilter],
    queryFn: () => MemberCouponRepo.getMine(mineFilter === 'all' ? undefined : mineFilter),
    enabled: hydrated && loggedIn && mainTab === 'mine',
  });
  const centerQuery = useQuery({
    queryKey: ['member', 'coupons', 'center', centerFilter],
    queryFn: () => MemberCouponRepo.getCenter(centerFilter),
    enabled: hydrated && loggedIn && mainTab === 'center',
  });
  const claimMutation = useMutation({
    mutationFn: MemberCouponRepo.claim,
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '领取失败', icon: 'none' }); return; }
      Taro.showToast({ title: '领取成功', icon: 'success' });
      await client.invalidateQueries({ queryKey: ['member', 'coupons'] });
    },
  });

  if (!hydrated) return <View className='aim-page member-page'><MemberFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page member-page'><MemberFeedback kind='login' actionLabel='去登录' onAction={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/member/coupons/index')}` })} /></View>;
  const mineResult = mineQuery.data;
  const centerResult = centerQuery.data;
  const loading = mainTab === 'mine' ? mineQuery.isLoading : centerQuery.isLoading;
  const failed = mainTab === 'mine' ? mineResult && !mineResult.ok : centerResult && !centerResult.ok;

  return <View className='aim-page member-page coupons-page'>
    <View className='coupon-heading'><Text>平台优惠券</Text><Text>优惠券只用于订单抵扣，不属于钱包余额或数字资产</Text></View>
    <View className='member-main-tabs aim-card'><View className={mainTab === 'mine' ? 'member-main-tab member-main-tab--active' : 'member-main-tab'} onClick={() => setMainTab('mine')}>我的优惠券</View><View className={mainTab === 'center' ? 'member-main-tab member-main-tab--active' : 'member-main-tab'} onClick={() => setMainTab('center')}>领券中心</View></View>
    <View className='coupon-sub-tabs'>{(mainTab === 'mine' ? MINE_FILTERS : CENTER_FILTERS).map((item) => {
      const active = mainTab === 'mine' ? mineFilter === item.key : centerFilter === item.key;
      return <View className={active ? 'coupon-sub-tab coupon-sub-tab--active' : 'coupon-sub-tab'} key={item.key} onClick={() => mainTab === 'mine' ? setMineFilter(item.key as 'all' | CouponInstanceStatus) : setCenterFilter(item.key as CouponCenterView)}>{item.label}</View>;
    })}</View>
    {loading ? <MemberFeedback kind='loading' /> : failed ? <MemberFeedback kind='error' description={mainTab === 'mine' && mineResult && !mineResult.ok ? mineResult.error.displayMessage : centerResult && !centerResult.ok ? centerResult.error.displayMessage : undefined} onAction={() => mainTab === 'mine' ? mineQuery.refetch() : centerQuery.refetch()} /> : mainTab === 'mine' ? (
      mineResult?.ok && mineResult.data.length ? <View className='coupon-list'>{mineResult.data.map((item) => <CouponCard item={item} key={item.id} />)}</View> : <MemberFeedback kind='empty' title='暂无优惠券' description='可前往领券中心查看当前服务端可领取活动' actionLabel='去领券中心' onAction={() => setMainTab('center')} />
    ) : centerResult?.ok && centerResult.data.length ? <View className='coupon-list'>{centerResult.data.map((item) => <View className='coupon-center-card aim-card' key={item.id}><View className='coupon-center-card__top'><View><Text className='coupon-center-card__name'>{item.name}</Text><Text className='coupon-center-card__description'>{item.description || '平台优惠券活动'}</Text></View><View className='coupon-center-card__discount'><Text>{formatCouponDiscount(item.discountType, item.discountValue)}</Text><Text>{item.minOrderAmount > 0 ? `满${formatMoney(item.minOrderAmount)}` : '无门槛'}</Text></View></View><View className='coupon-center-card__footer'><Text>{item.claimedSummary.total > 0 ? `已领 ${item.claimedSummary.total} 张 · 可用 ${item.claimedSummary.available} 张` : `剩余 ${item.remainingQuota} 张`}</Text><Button className={item.canClaim ? 'coupon-claim-button' : 'coupon-claim-button coupon-claim-button--disabled'} disabled={!item.canClaim || claimMutation.isPending} loading={claimMutation.isPending && claimMutation.variables === item.id} onClick={() => claimMutation.mutate(item.id)}>{item.statusLabel}</Button></View></View>)}</View> : <MemberFeedback kind='empty' title='暂无活动' description='当前服务端筛选下没有优惠券活动' />}
  </View>;
}
