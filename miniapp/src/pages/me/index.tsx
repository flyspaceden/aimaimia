import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { SeafoodImage, type SeafoodImageName } from '@/components/SeafoodImage';
import { FunctionalIcon } from '@/components/functional-icon';
import { CheckoutRepo, OrderRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { BenefitsRepo } from '@/packages/benefits/repos';
import { getDeviceFingerprint } from '@/packages/benefits/utils';
import { CommunityRepo } from '@/packages/community/repo';
import { MemberWalletRepo } from '@/packages/member/repos';
import { MessageRepo } from '@/packages/messages/repo';
import './index.scss';

type Entry = { label: string; image: SeafoodImageName; url: string };

const orderEntries: Array<Entry & { countKey: 'PAID' | 'SHIPPED' | 'DELIVERED' | 'afterSale' | 'RECEIVED' }> = [
  { label: '待履约', image: 'icon-order-lobster', url: '/packages/orders/order-list/index?status=PAID', countKey: 'PAID' },
  { label: '已发货', image: 'icon-order-fish', url: '/packages/orders/order-list/index?status=SHIPPED', countKey: 'SHIPPED' },
  { label: '待收货', image: 'icon-order-crab', url: '/packages/orders/order-list/index?status=DELIVERED', countKey: 'DELIVERED' },
  { label: '换货/售后', image: 'icon-order-scallop', url: '/packages/after-sales/after-sale-list/index', countKey: 'afterSale' },
  { label: '已完成', image: 'icon-order-puffer', url: '/packages/orders/order-list/index?status=RECEIVED', countKey: 'RECEIVED' },
];

const baseTools: Entry[] = [
  { label: '设置', image: 'icon-tool-shrimp', url: '/packages/settings/index/index' },
  { label: '地址', image: 'icon-tool-abalone', url: '/packages/account/account-addresses/index' },
  { label: '关注', image: 'icon-tool-squid', url: '/packages/community/following/index' },
  { label: '消息', image: 'icon-tool-octopus', url: '/packages/messages/inbox/index' },
  { label: '我的福利', image: 'icon-tool-conch', url: '/packages/member/coupons/index' },
  { label: '排队红包', image: 'icon-tool-starfish', url: '/packages/benefits/queue-reward/index' },
  { label: '数字资产', image: 'icon-order-puffer', url: '/packages/member/digital-assets/index' },
  { label: '我的发票', image: 'icon-tool-seacucumber', url: '/packages/invoices/invoice-list/index' },
  { label: '联系客服', image: 'icon-tool-support-crab', url: '/packages/customer-service/session-list/index' },
];

export default function MePage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const fingerprint = useMemo(getDeviceFingerprint, []);
  const [now, setNow] = useState(Date.now());
  const [vipEducationOpen, setVipEducationOpen] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const countsQuery = useQuery({
    queryKey: ['me', 'order-counts', authRevision],
    queryFn: OrderRepo.getStatusCounts,
    enabled: hydrated && loggedIn,
    refetchInterval: 60_000,
  });
  const pendingQuery = useQuery({
    queryKey: ['commerce', 'pending-checkout', authRevision],
    queryFn: CheckoutRepo.getPending,
    enabled: hydrated && loggedIn,
    refetchInterval: 30_000,
  });
  const walletQuery = useQuery({
    queryKey: ['member', 'wallet', authRevision],
    queryFn: MemberWalletRepo.getWallet,
    enabled: hydrated && loggedIn,
    staleTime: 30_000,
  });
  const memberQuery = useQuery({
    queryKey: ['benefits', 'member', authRevision],
    queryFn: BenefitsRepo.getMember,
    enabled: hydrated && loggedIn,
    staleTime: 60_000,
  });
  const unreadQuery = useQuery({
    queryKey: ['messages', 'unread-count', authRevision],
    queryFn: MessageRepo.getUnreadCount,
    enabled: hydrated && loggedIn,
  });
  const captainQuery = useQuery({
    queryKey: ['community', 'captain-me', authRevision],
    queryFn: CommunityRepo.captainMe,
    enabled: hydrated && loggedIn,
    staleTime: 60_000,
  });
  const lotteryQuery = useQuery({
    queryKey: ['benefits', 'lottery', 'today', loggedIn, authRevision],
    queryFn: () => BenefitsRepo.getLotteryToday(loggedIn, fingerprint),
    enabled: hydrated,
    staleTime: 30_000,
  });

  const orderCounts = countsQuery.data?.ok ? countsQuery.data.data : undefined;
  const pending = pendingQuery.data?.ok ? pendingQuery.data.data : null;
  const member = memberQuery.data?.ok ? memberQuery.data.data : undefined;
  const walletBalance = walletQuery.data?.ok ? walletQuery.data.data.balance : undefined;
  const unreadCount = unreadQuery.data?.ok ? unreadQuery.data.data : 0;
  const captain = captainQuery.data?.ok ? captainQuery.data.data : undefined;
  const walletFailed = loggedIn && (walletQuery.isError || walletQuery.data?.ok === false);
  const memberFailed = loggedIn && (memberQuery.isError || memberQuery.data?.ok === false);
  const captainFailed = loggedIn && (captainQuery.isError || captainQuery.data?.ok === false);
  const captainReady = !loggedIn || captainQuery.data?.ok === true;
  const lottery = lotteryQuery.data?.ok ? lotteryQuery.data.data : undefined;
  const lotterySummary = lottery
    ? lottery.hasDrawn
      ? '今日已参与 · 明天再来'
      : `今天还有 ${lottery.remainingDraws} 次机会`
    : '进入抽奖页查看今日机会';
  const pendingCountdown = pending ? (() => {
    const seconds = Math.max(0, Math.ceil((Date.parse(pending.expiresAt) - now) / 1_000));
    return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '已超时';
  })() : '';
  const directReferralPercentText = typeof member?.directReferralPercent === 'number'
    ? `${Number.isInteger(member.directReferralPercent * 100) ? (member.directReferralPercent * 100).toFixed(0) : (member.directReferralPercent * 100).toFixed(2)}%`
    : '';

  const tools = useMemo<Entry[]>(() => [
    { label: '推荐中心', image: 'icon-tool-seahorse', url: '/packages/referral/center/index' },
    { label: '耕耘值', image: 'icon-tool-starfish', url: '/packages/benefits/growth/index' },
    ...(captainReady ? [{
      label: captain?.isCaptain ? '团长经营' : '社区服务',
      image: 'icon-order-fish' as SeafoodImageName,
      url: captain?.isCaptain ? '/packages/community/captain-center/index' : '/packages/community/captain-application/index',
    }] : []),
    ...baseTools,
  ], [captain?.isCaptain, captainReady]);

  const openWallet = () => {
    if (loggedIn && walletFailed) {
      void walletQuery.refetch();
      void Taro.showToast({ title: '正在重新加载钱包', icon: 'none' });
      return;
    }
    void requireLogin({ url: '/packages/member/wallet/index' });
  };
  const openVip = () => {
    if (loggedIn && memberFailed) {
      void memberQuery.refetch();
      void Taro.showToast({ title: '正在重新加载会员状态', icon: 'none' });
      return;
    }
    if (loggedIn && !memberQuery.data) {
      void Taro.showToast({ title: '会员状态加载中', icon: 'none' });
      return;
    }
    if (member?.tier === 'VIP') {
      void requireLogin({ url: '/packages/benefits/vip-center/index' });
      return;
    }
    setVipEducationOpen(true);
  };

  const refresh = () => {
    void lotteryQuery.refetch();
    if (!useAuthStore.getState().accessToken) return;
    void Promise.all([
      countsQuery.refetch(),
      pendingQuery.refetch(),
      walletQuery.refetch(),
      memberQuery.refetch(),
      unreadQuery.refetch(),
      captainQuery.refetch(),
    ]);
  };
  useDidShow(refresh);

  const openLogin = (returnUrl = '/pages/me/index') => Taro.navigateTo({
    url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}`,
  });
  const requireLogin = async (entry: Pick<Entry, 'url'>) => {
    if (loggedIn) {
      await Taro.navigateTo({ url: entry.url });
      return;
    }
    const modal = await Taro.showModal({
      title: '请先登录',
      content: '登录后即可使用全部功能',
      confirmText: '去登录',
      confirmColor: '#2E7D32',
    });
    if (modal.confirm) await openLogin(entry.url);
  };

  return (
    <View className='aim-page me-page'>
      <View className='me-section-head'>
        <View><Text>活动中心</Text><Text>团购好物与每日惊喜</Text></View>
      </View>

      <View className='me-activity-card aim-card' onClick={() => Taro.navigateTo({ url: '/packages/group-buy/activity-list/index' })}>
        <View className='me-activity-card__character'><SeafoodImage name='home-lobster' /></View>
        <View className='me-activity-card__copy'><Text>限时拼团</Text><Text>精选团购</Text><Text>指定商品 · 团购活动</Text></View>
        <Text className='me-activity-card__action'>去拼团</Text>
      </View>

      <View className='me-lottery-card' onClick={() => Taro.navigateTo({ url: '/packages/benefits/lottery/index' })}>
        <View className='me-lottery-card__glow' />
        <View className='me-lottery-card__copy'><Text>每日惊喜</Text><Text>幸运抽奖</Text><Text>{lotterySummary}</Text></View>
        <View className='me-lottery-card__character'>
          <SeafoodImage name='icon-order-crab' />
          {lottery && !lottery.hasDrawn && lottery.remainingDraws > 0 ? <Text className='me-lottery-card__badge'>{lottery.remainingDraws}</Text> : null}
        </View>
        <Text className='me-lottery-card__arrow'>›</Text>
      </View>

      <View className='me-section-head me-section-head--orders'>
        <Text>我的订单</Text>
        <Text onClick={() => { void requireLogin({ url: '/packages/orders/order-list/index' }); }}>全部订单 &gt;</Text>
      </View>
      <View className={pending ? 'me-order-grid me-order-grid--pending aim-card' : 'me-order-grid aim-card'}>
        {pending ? (
          <View className='me-order-entry' onClick={() => { void requireLogin({ url: `/packages/commerce/checkout-pending/index?sessionId=${encodeURIComponent(pending.sessionId)}` }); }}>
            <View className='me-order-entry__pending'>待</View>
            <Text>未完成支付</Text>
            <Text className='me-order-entry__pending-meta'>{pendingCountdown}</Text>
          </View>
        ) : null}
        {orderEntries.map((entry) => {
          const count = orderCounts?.[entry.countKey] || 0;
          return (
            <View className='me-order-entry' key={entry.label} onClick={() => { void requireLogin(entry); }}>
              <View className='me-order-entry__icon'>
                <SeafoodImage name={entry.image} />
                {count > 0 ? <Text className='me-order-entry__badge'>{count > 99 ? '99+' : count}</Text> : null}
              </View>
              <Text>{entry.label}</Text>
            </View>
          );
        })}
      </View>

      <View className='me-finance-card me-finance-card--wallet' onClick={openWallet}>
        <SeafoodImage className='me-finance-card__shell me-finance-card__shell--wallet' name='me-shell-ivory' />
        <FunctionalIcon name='wallet' className='me-finance-card__mark' />
        <Text className='me-finance-card__title'>我的财库</Text>
        <Text className='me-finance-card__amount'>{!loggedIn ? '登录后查看' : walletFailed ? '余额加载失败' : walletBalance === undefined ? '加载中…' : `¥${Number(walletBalance).toFixed(2)}`}</Text>
        <Text className='me-finance-card__action'>{walletFailed ? '点击重试' : '去提现'}</Text>
      </View>

      <View className='me-finance-card me-finance-card--vip' onClick={openVip}>
        <SeafoodImage className='me-finance-card__shell me-finance-card__shell--vip' name='me-shell-mint' />
        <View className='me-finance-card__vip-top'>
          <View><FunctionalIcon name='crown' className='me-finance-card__mark' /><Text className='me-finance-card__title'>VIP</Text></View>
          <View><Text>· 普通商品会员价</Text><Text>· 更多奖励</Text><Text>· 减免运费权益</Text></View>
        </View>
        <Text className='me-finance-card__action'>{memberFailed ? '状态加载失败 · 点击重试' : loggedIn && !memberQuery.data ? '状态加载中' : member?.tier === 'VIP' ? '查看权益' : '开通会员'}</Text>
      </View>

      <View className='me-tools aim-card'>
        <Text className='me-tools__title'>常用工具</Text>
        {captainFailed ? <View className='me-tools__status' onClick={() => { void captainQuery.refetch(); }}><Text>团长状态加载失败</Text><Text>重新加载 ›</Text></View> : null}
        <View className='me-tools__grid'>
          {tools.map((entry) => (
            <View className='me-tool' key={entry.label} onClick={() => { void requireLogin(entry); }}>
              <View className='me-tool__icon'>
                <SeafoodImage name={entry.image} />
                {entry.label === '消息' && unreadCount > 0 ? <Text className='me-tool__badge'>{unreadCount > 99 ? '99+' : unreadCount}</Text> : null}
              </View>
              <Text>{entry.label}</Text>
            </View>
          ))}
        </View>
      </View>
      {vipEducationOpen ? <View className='me-vip-modal' onClick={() => setVipEducationOpen(false)}>
        <View className='me-vip-modal__card' onClick={(event) => event.stopPropagation()}>
          <View className='me-vip-modal__crown'><FunctionalIcon name='crown' /></View>
          <Text className='me-vip-modal__title'>VIP 会员权益</Text>
          <View className='me-vip-modal__perks'>
            <Text>✓ 普通商品会员价</Text>
            <Text>✓ 更低包邮门槛</Text>
            <Text>✓ 消费积分抵扣更多</Text>
            <Text>✓ 推荐 VIP 奖励{directReferralPercentText ? ` · 直推 ${directReferralPercentText}` : ''}</Text>
          </View>
          <View className='me-vip-modal__button' onClick={() => { setVipEducationOpen(false); void requireLogin({ url: '/packages/benefits/vip-gifts/index' }); }}><Text>购买 VIP 礼包</Text></View>
          <Text className='me-vip-modal__close' onClick={() => setVipEducationOpen(false)}>暂不购买</Text>
        </View>
      </View> : null}
    </View>
  );
}
