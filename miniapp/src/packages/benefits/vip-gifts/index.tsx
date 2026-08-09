import { Button, Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isUserCancelledPayment } from '@/components/commerce-utils';
import { requestMiniProgramPayment } from '@/platform/payment';
import { ensureWechatMiniProgramSession } from '@/platform/auth';
import { AddressRepo, CheckoutRepo } from '@/repos';
import { queryClient } from '@/query/client';
import { useAuthStore } from '@/store/auth';
import { useCheckoutSelectionStore } from '@/store/checkout-selection';
import type {
  CheckoutSession,
  CheckoutStatusResult,
  MiniProgramResumeResult,
  PendingVipCheckout,
} from '@/types';
import { BenefitsFeedback } from '../BenefitsFeedback';
import { BenefitsRepo } from '../repos';
import type { VipCheckoutDraft, VipGiftOption } from '../types';
import {
  benefitsLoginUrl,
  clearVipCheckoutDraft,
  clearVipCheckoutSession,
  createOperationKey,
  formatMoney,
  readVipCheckoutDraft,
  readVipCheckoutSession,
  saveVipCheckoutDraft,
  saveVipCheckoutSession,
} from '../utils';
import './index.scss';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type RecoverableVipSession = CheckoutSession | MiniProgramResumeResult | PendingVipCheckout;

function hasPaymentParams(
  session: RecoverableVipSession,
): session is CheckoutSession | MiniProgramResumeResult {
  return 'paymentParams' in session;
}

async function waitForVipOrder(sessionId: string): Promise<CheckoutStatusResult | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = attempt % 4 === 0 ? await CheckoutRepo.activeQuery(sessionId) : await CheckoutRepo.getStatus(sessionId);
    if (result.ok && ['COMPLETED', 'EXPIRED', 'FAILED'].includes(result.data.status)) return result.data;
    await wait(1_500);
  }
  return null;
}

export default function VipGiftsPage() {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const userId = useAuthStore((state) => state.userId || '');
  const authRevision = useAuthStore((state) => state.revision);
  const checkoutSelection = useCheckoutSelectionStore();
  const [packageId, setPackageId] = useState(typeof router.params.packageId === 'string' ? router.params.packageId : '');
  const [giftId, setGiftId] = useState(typeof router.params.giftOptionId === 'string' ? router.params.giftOptionId : '');
  const [addressId, setAddressId] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [pendingSession, setPendingSession] = useState<RecoverableVipSession>();
  const [paymentNotice, setPaymentNotice] = useState('');
  const [checkoutDraft, setCheckoutDraft] = useState<VipCheckoutDraft>();
  const [recoveringVip, setRecoveringVip] = useState(false);
  const checkoutKey = useRef('');
  const giftQuery = useQuery({ queryKey: ['benefits', 'vip-gifts'], queryFn: BenefitsRepo.getVipGiftOptions });
  const memberQuery = useQuery({ queryKey: ['benefits', 'member', authRevision, userId], queryFn: BenefitsRepo.getMember, enabled: hydrated && loggedIn && Boolean(userId) });
  const addressQuery = useQuery({ queryKey: ['account', 'addresses', authRevision, userId], queryFn: AddressRepo.list, enabled: hydrated && loggedIn && Boolean(userId) });
  const packages = useMemo(() => giftQuery.data?.ok ? [...giftQuery.data.data.packages].sort((a, b) => a.sortOrder - b.sortOrder) : [], [giftQuery.data]);
  const selectedPackage = packages.find((item) => item.id === packageId) || packages[0];
  const selectedGift = selectedPackage?.giftOptions.find((item) => item.id === giftId)
    || selectedPackage?.giftOptions.find((item) => item.available);
  const addresses = useMemo(() => addressQuery.data?.ok ? addressQuery.data.data : [], [addressQuery.data]);
  const member = memberQuery.data?.ok ? memberQuery.data.data : undefined;

  useEffect(() => { if (!packageId && packages[0]) setPackageId(packages[0].id); }, [packageId, packages]);
  useEffect(() => { if (selectedPackage && (!giftId || !selectedPackage.giftOptions.some((item) => item.id === giftId && item.available))) setGiftId(selectedPackage.giftOptions.find((item) => item.available)?.id || ''); }, [giftId, selectedPackage]);
  useEffect(() => { if (!addressId && addresses.length) setAddressId((addresses.find((item) => item.isDefault) || addresses[0]).id); }, [addressId, addresses]);
  useEffect(() => {
    if (checkoutSelection.ownerRevision !== authRevision) return;
    if (checkoutSelection.addressId && addresses.some((address) => address.id === checkoutSelection.addressId)) {
      setAddressId(checkoutSelection.addressId);
    }
  }, [addresses, authRevision, checkoutSelection.addressId, checkoutSelection.ownerRevision]);
  useDidShow(() => { if (useAuthStore.getState().accessToken) void addressQuery.refetch(); });
  useEffect(() => {
    let cancelled = false;
    const revisionAtStart = authRevision;
    const ownsCurrentGeneration = () => {
      const current = useAuthStore.getState();
      return !cancelled && current.revision === revisionAtStart && current.userId === userId;
    };

    // 登录、退出或切换账号时，先清掉上一代账号的全部结算态。
    setAddressId('');
    setAgreed(false);
    setPendingSession(undefined);
    setPaymentNotice('');
    setCheckoutDraft(undefined);
    setRecoveringVip(false);
    checkoutKey.current = '';

    if (!hydrated || !loggedIn || !userId) return () => { cancelled = true; };

    const storedSession = readVipCheckoutSession(userId);
    const draft = readVipCheckoutDraft(userId);
    if (storedSession) {
      setPendingSession(storedSession);
      setPaymentNotice('检测到一笔未确认的 VIP 礼包订单，正在与服务端核对。');
    } else if (draft) {
      checkoutKey.current = draft.idempotencyKey;
      setCheckoutDraft(draft);
      setPackageId(draft.packageId);
      setGiftId(draft.giftOptionId);
      setAddressId(draft.addressId);
      setPaymentNotice('上次创建结果未确认，正在从服务端恢复。');
    }

    setRecoveringVip(true);
    void CheckoutRepo.getPendingVip().then((result) => {
      if (!ownsCurrentGeneration() || !result.ok) return;
      if (result.data) {
        clearVipCheckoutDraft();
        clearVipCheckoutSession();
        checkoutKey.current = '';
        setCheckoutDraft(undefined);
        setPendingSession(result.data);
        setPaymentNotice('已从服务端恢复未完成的 VIP 礼包订单，请查询状态或继续微信支付。');
      } else if (storedSession) {
        clearVipCheckoutSession();
        setPendingSession(undefined);
        if (draft) {
          checkoutKey.current = draft.idempotencyKey;
          setCheckoutDraft(draft);
          setPackageId(draft.packageId);
          setGiftId(draft.giftOptionId);
          setAddressId(draft.addressId);
        }
        setPaymentNotice(draft ? '未发现服务端未完成订单，可使用原请求标识继续。' : '');
      }
    }).finally(() => {
      if (ownsCurrentGeneration()) setRecoveringVip(false);
    });

    return () => { cancelled = true; };
  }, [authRevision, hydrated, loggedIn, userId]);

  const finishStatus = async (status: CheckoutStatusResult | null, session: RecoverableVipSession) => {
    if (status?.status === 'COMPLETED') {
      checkoutSelection.clear();
      clearVipCheckoutDraft();
      clearVipCheckoutSession();
      setCheckoutDraft(undefined);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['benefits', 'member'] }), queryClient.invalidateQueries({ queryKey: ['orders'] })]);
      await Taro.redirectTo({ url: `/packages/orders/payment-success/index?orderIds=${encodeURIComponent(status.orderIds.join(','))}&amount=${status.expectedTotal}` });
      return;
    }
    if (status?.status === 'EXPIRED' || status?.status === 'FAILED') {
      clearVipCheckoutDraft();
      clearVipCheckoutSession();
      setCheckoutDraft(undefined);
      setPendingSession(undefined);
      setPaymentNotice(status.status === 'EXPIRED' ? '支付窗口已结束，请重新提交礼包订单。' : '这笔礼包订单未支付成功，请重试。');
      return;
    }
    setPendingSession(session);
    setPaymentNotice('支付结果正在由服务端确认，请不要重复下单，可继续查询。');
  };

  const purchaseMutation = useMutation({
    mutationFn: async ({
      sessionToContinue,
      revisionAtStart,
      userIdAtStart,
    }: {
      sessionToContinue?: RecoverableVipSession;
      revisionAtStart: number;
      userIdAtStart: string;
    }) => {
      const ownsCurrentGeneration = () => {
        const current = useAuthStore.getState();
        return current.revision === revisionAtStart && current.userId === userIdAtStart;
      };
      let session = sessionToContinue;
      if (!session) {
        if (!userIdAtStart || !ownsCurrentGeneration()) throw new Error('MISSING_USER');
        let draft = checkoutDraft;
        if (!draft) {
          if (!selectedPackage || !selectedGift || !addressId) throw new Error('MISSING_SELECTION');
          checkoutKey.current ||= createOperationKey('mini-vip');
          draft = { userId, idempotencyKey: checkoutKey.current, packageId: selectedPackage.id, giftOptionId: selectedGift.id, addressId, expectedTotal: selectedPackage.price, createdAt: new Date().toISOString() };
          saveVipCheckoutDraft(draft);
          setCheckoutDraft(draft);
        }
        const created = await CheckoutRepo.createVip({ packageId: draft.packageId, giftOptionId: draft.giftOptionId, addressId: draft.addressId, expectedTotal: draft.expectedTotal, idempotencyKey: draft.idempotencyKey });
        if (!created.ok) {
          if (created.error.code === 'PENDING_CHECKOUT_EXISTS') {
            const recovered = await CheckoutRepo.getPendingVip();
            if (recovered.ok && recovered.data) {
              return { kind: 'recovered' as const, session: recovered.data };
            }
            return {
              kind: 'error' as const,
              message: recovered.ok ? '存在其他场景的未完成 VIP 订单，暂时无法在小程序续付' : recovered.error.displayMessage || '未完成订单查询失败',
              retryable: true,
            };
          }
          return { kind: 'error' as const, message: created.error.displayMessage || '礼包订单创建失败', retryable: created.error.retryable === true };
        }
        if (!ownsCurrentGeneration()) return { kind: 'stale' as const };
        session = created.data;
        clearVipCheckoutDraft();
        setCheckoutDraft(undefined);
        saveVipCheckoutSession(userIdAtStart, created.data);
        checkoutKey.current = '';
        setPendingSession(session);
      }
      if (!hasPaymentParams(session)) {
        const resumed = await CheckoutRepo.resume(session.sessionId);
        if (!resumed.ok) return { kind: 'error' as const, message: resumed.error.displayMessage || '暂时无法继续支付', retryable: resumed.error.retryable === true };
        if (!ownsCurrentGeneration()) return { kind: 'stale' as const };
        session = resumed.data;
        setPendingSession(session);
      }
      if (!ownsCurrentGeneration()) return { kind: 'stale' as const };
      try {
        await requestMiniProgramPayment(session.paymentParams);
      } catch (error) {
        if (!isUserCancelledPayment(error)) throw error;
      }
      const status = await waitForVipOrder(session.sessionId);
      return { kind: 'status' as const, session, status };
    },
    onSuccess: async (result, variables) => {
      const current = useAuthStore.getState();
      if (current.revision !== variables.revisionAtStart || current.userId !== variables.userIdAtStart || result.kind === 'stale') return;
      if (result.kind === 'recovered') {
        clearVipCheckoutDraft();
        clearVipCheckoutSession();
        checkoutKey.current = '';
        setCheckoutDraft(undefined);
        setPendingSession(result.session);
        setPaymentNotice('已找回服务端中的未完成 VIP 礼包订单，请确认后继续微信支付。');
        return;
      }
      if (result.kind === 'error') {
        if (!result.retryable) { clearVipCheckoutDraft(); setCheckoutDraft(undefined); checkoutKey.current = ''; }
        Taro.showToast({ title: result.message, icon: 'none' });
        return;
      }
      await finishStatus(result.status, result.session);
    },
    onError: (_error, variables) => {
      const current = useAuthStore.getState();
      if (current.revision === variables.revisionAtStart && current.userId === variables.userIdAtStart) {
        setPaymentNotice('网络异常，请先查询当前订单状态，不要重复下单。');
      }
    },
  });

  useEffect(() => {
    purchaseMutation.reset();
    // reset 只清除上一账号的 mutation UI 态；请求结果仍由 revision/userId guard 丢弃。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRevision, userId]);

  const queryStatus = async () => {
    if (!pendingSession) return;
    const revisionAtStart = authRevision;
    const userIdAtStart = userId;
    const result = await CheckoutRepo.activeQuery(pendingSession.sessionId);
    const current = useAuthStore.getState();
    if (current.revision !== revisionAtStart || current.userId !== userIdAtStart) return;
    if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '查询失败', icon: 'none' }); return; }
    await finishStatus(result.data, pendingSession);
  };

  const giftReturn = `/packages/benefits/vip-gifts/index${selectedPackage ? `?packageId=${encodeURIComponent(selectedPackage.id)}${selectedGift ? `&giftOptionId=${encodeURIComponent(selectedGift.id)}` : ''}` : ''}`;
  const openAddressSelection = () => {
    if (checkoutDraft && !pendingSession) {
      Taro.showToast({ title: '请先重试上次未确认的创建请求', icon: 'none' });
      return;
    }
    checkoutSelection.begin({ ownerRevision: authRevision, addressId, couponIds: [] });
    void Taro.navigateTo({ url: '/packages/commerce/checkout-address/index' });
  };
  const startPurchase = async (sessionToContinue?: RecoverableVipSession) => {
    if (!await ensureWechatMiniProgramSession(giftReturn)) return;
    purchaseMutation.mutate({ ...(sessionToContinue ? { sessionToContinue } : {}), revisionAtStart: authRevision, userIdAtStart: userId });
  };
  if (giftQuery.isLoading || !hydrated) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='loading' /></View>;
  if (!giftQuery.data?.ok) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='error' description={giftQuery.data && !giftQuery.data.ok ? giftQuery.data.error.displayMessage : '礼包数据加载失败'} onAction={() => giftQuery.refetch()} /></View>;
  if (!packages.length) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='empty' title='暂无可购买礼包' description='平台尚未发布 VIP 档位' /></View>;
  if (loggedIn && memberQuery.isLoading) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='loading' /></View>;
  if (loggedIn && !memberQuery.data?.ok) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='error' title='会员资格校验失败' description={memberQuery.data && !memberQuery.data.ok ? memberQuery.data.error.displayMessage : undefined} onAction={() => memberQuery.refetch()} /></View>;

  return <View className='aim-page benefits-page benefits-page--gold'>
    <View className='benefits-hero benefits-hero--gold'><View className='benefits-hero__orbit' /><Text className='benefits-hero__eyebrow'>VIP GIFT COLLECTION</Text><Text className='benefits-hero__title'>{member?.tier === 'VIP' ? 'VIP 会员专属空间' : '选档位，再选一份专属礼包'}</Text><Text className='benefits-hero__description'>{member?.tier === 'VIP' ? '以下为当前礼包内容，可展示给好友；当前账号不会重复购买。' : '多商品赠品组合、库存和价格均与 App 共用同一服务端数据。'}</Text></View>
    {member?.tier === 'VIP' ? <View className='benefits-payment-state'>您已是 VIP 会员 · 当前为礼包浏览模式，可前往推荐中心分享给好友开通。</View> : null}
    <View className='benefits-section-head'><Text>会员档位</Text><Text>价格由服务端最终校验</Text></View>
    <ScrollView className='vip-package-scroll' scrollX enhanced showScrollbar={false}><View className='vip-package-row'>{packages.map((item) => <View key={item.id} className={selectedPackage?.id === item.id ? 'vip-package vip-package--active' : 'vip-package'} onClick={() => { if (checkoutDraft && !pendingSession) { Taro.showToast({ title: '请先重试上次未确认的创建请求', icon: 'none' }); return; } setPackageId(item.id); setGiftId(item.giftOptions.find((gift) => gift.available)?.id || ''); }}><Text>¥{formatMoney(item.price)}</Text><Text>{item.giftOptions.filter((gift) => gift.available).length} 个可选礼包</Text></View>)}</View></ScrollView>
    <View className='benefits-section-head'><Text>选择赠品</Text><Text>每笔 VIP 订单选一个组合</Text></View>
    <View className='vip-gift-list'>{selectedPackage?.giftOptions.map((gift: VipGiftOption) => {
      const image = gift.coverMode === 'CUSTOM' && gift.coverUrl ? gift.coverUrl : gift.items.find((item) => item.productImage)?.productImage;
      return <View key={gift.id} className={`vip-gift${gift.id === selectedGift?.id ? ' vip-gift--active' : ''}${!gift.available ? ' vip-gift--disabled' : ''}`} onClick={() => { if (checkoutDraft && !pendingSession) { Taro.showToast({ title: '请先重试上次未确认的创建请求', icon: 'none' }); return; } if (gift.available) setGiftId(gift.id); }}>
        {image ? <Image className='vip-gift__image' src={image} mode='aspectFill' /> : <View className='vip-gift__placeholder'>礼</View>}
        <View className='vip-gift__body'><Text className='vip-gift__title'>{gift.title}{gift.badge ? ` · ${gift.badge}` : ''}</Text>{gift.subtitle ? <Text className='vip-gift__subtitle'>{gift.subtitle}</Text> : null}<Text className='vip-gift__items'>{gift.items.map((item) => `${item.productTitle} ${item.skuTitle} ×${item.quantity}`).join(' / ')}</Text><Text className='vip-gift__value'>{gift.available ? `礼品价值 ¥${formatMoney(gift.totalPrice)}` : '当前库存不可用'}</Text></View>
      </View>;
    })}</View>
    {!loggedIn ? <View className='benefits-card aim-card'><Text className='benefits-card__title'>登录后继续购买</Text><Text className='benefits-card__description'>已选档位和礼包会随回跳地址保留。</Text><Button className='benefits-primary benefits-primary--gold' onClick={() => Taro.redirectTo({ url: benefitsLoginUrl(giftReturn) })}>去登录</Button></View> : null}
    {loggedIn && member?.tier === 'VIP' ? <Button className='benefits-primary benefits-primary--gold' onClick={() => Taro.navigateTo({ url: '/packages/referral/center/index' })}>分享给好友开通</Button> : null}
    {loggedIn && member?.tier !== 'VIP' ? <>
      <View className='benefits-section-head'><Text>收货地址</Text><Text onClick={openAddressSelection}>{addresses.length ? '礼包免运费 · 切换 ›' : '新增 ›'}</Text></View>
      {!addressQuery.data?.ok ? <BenefitsFeedback kind={addressQuery.isLoading ? 'loading' : 'error'} description={addressQuery.data && !addressQuery.data.ok ? addressQuery.data.error.displayMessage : '收货地址加载失败'} onAction={() => addressQuery.refetch()} /> : addresses.length ? (() => { const address = addresses.find((item) => item.id === addressId) || addresses[0]; return <View className='benefits-address-list'><View className='benefits-address benefits-address--active' onClick={openAddressSelection}><Text className='benefits-address__name'>{address.receiverName}</Text><Text className='benefits-address__phone'>{address.phone}</Text><Text className='benefits-address__detail'>{address.regionText || `${address.province}${address.city}${address.district}`} {address.detail}</Text></View></View>; })() : <View className='benefits-card aim-card'><Text className='benefits-card__title'>还没有收货地址</Text><Button className='benefits-secondary' onClick={openAddressSelection}>新增收货地址</Button></View>}
      <View className='benefits-agreement' onClick={() => setAgreed((value) => !value)}><View className={agreed ? 'benefits-agreement__box benefits-agreement__box--active' : 'benefits-agreement__box'}>{agreed ? '✓' : ''}</View><Text>我已确认礼包档位、赠品和收货地址，并阅读同意会员服务协议、用户协议与隐私政策。</Text></View>
      <View className='benefits-legal-links'><Text onClick={() => Taro.navigateTo({ url: '/packages/benefits/member-agreement/index' })}>《会员服务协议》</Text><Text onClick={() => Taro.navigateTo({ url: '/packages/account/account-legal/index?document=terms' })}>《用户协议》</Text><Text onClick={() => Taro.navigateTo({ url: '/packages/account/account-legal/index?document=privacy' })}>《隐私政策》</Text></View>
      {paymentNotice ? <View className='benefits-payment-state'>{paymentNotice}</View> : null}
      {pendingSession ? <><Button className='benefits-secondary' disabled={purchaseMutation.isPending || recoveringVip} onClick={queryStatus}>查询当前礼包订单</Button><Button className='benefits-primary benefits-primary--gold' loading={purchaseMutation.isPending || recoveringVip} disabled={purchaseMutation.isPending || recoveringVip} onClick={() => { void startPurchase(pendingSession); }}>{recoveringVip ? '正在恢复...' : '继续微信支付'}</Button></> : <Button className='benefits-primary benefits-primary--gold' loading={purchaseMutation.isPending || recoveringVip} disabled={recoveringVip || (!checkoutDraft && (!selectedGift || !addressId)) || !agreed || purchaseMutation.isPending} onClick={() => { void startPurchase(); }}>{recoveringVip ? '正在检查未完成订单...' : purchaseMutation.isPending ? '正在确认...' : `微信支付 ¥${formatMoney(checkoutDraft?.expectedTotal ?? selectedPackage?.price ?? 0)}`}</Button>}
    </> : null}
    <Text className='benefits-note'>客户端不指定成交价或账户标识；实际应付、支付身份与订单生成均由服务端校验。</Text>
  </View>;
}
