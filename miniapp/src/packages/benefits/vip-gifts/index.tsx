import { Button, Image, Swiper, SwiperItem, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isUserCancelledPayment } from '@/components/commerce-utils';
import { requestMiniProgramPayment } from '@/platform/payment';
import { ensureWechatMiniProgramSession } from '@/platform/auth';
import { AddressRepo, CheckoutRepo, UserRepo } from '@/repos';
import { MiniAfterSaleRepo } from '@/packages/after-sales/repo';
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
import type { VipCheckoutDraft, VipGiftItem, VipGiftOption } from '../types';
import {
  benefitsLoginUrl,
  clearVipCheckoutDraft,
  clearVipCheckoutSession,
  createOperationKey,
  formatMoney,
  hasActiveReferral,
  readVipCheckoutDraft,
  readVipCheckoutSession,
  resolveVipCheckoutAddressId,
  saveVipCheckoutDraft,
  saveVipCheckoutSession,
} from '../utils';
import './index.scss';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type RecoverableVipSession = CheckoutSession | MiniProgramResumeResult | PendingVipCheckout;

const VIP_BENEFITS = [
  ['↗', '专属奖励'],
  ['+', '邀请收益'],
  ['礼', '专属礼包'],
  ['客', '优先客服'],
  ['★', '消费奖励'],
] as const;

function giftImages(gift: VipGiftOption | undefined): string[] {
  if (!gift) return [];
  const values = [
    gift.coverMode === 'CUSTOM' ? gift.coverUrl : null,
    ...gift.items.map((item) => item.productImage),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

function VipGiftCover({ gift }: { gift: VipGiftOption }) {
  const images = giftImages(gift);
  if (!images.length) return <View className='vip-space-cover vip-space-cover--empty'>礼</View>;
  const display = gift.coverMode === 'CUSTOM' && gift.coverUrl ? [gift.coverUrl] : images.slice(0, 4);
  return <View
    className={`vip-space-cover vip-space-cover--${gift.coverMode.toLowerCase()} vip-space-cover--count-${display.length}`}
    onClick={(event) => {
      event.stopPropagation();
      void Taro.previewImage({ urls: images, current: images[0] });
    }}
  >
    {display.map((url, index) => <View className='vip-space-cover__cell' key={`${url}-${index}`}><Image src={url} mode='aspectFill' /></View>)}
    {images.length > 4 ? <View className='vip-space-cover__more'>+{images.length - 4}</View> : null}
    <View className='vip-space-cover__count'>图 {images.length}</View>
  </View>;
}

function VipGiftDetailItem({ item, gift }: { item: VipGiftItem; gift: VipGiftOption }) {
  return <View className='vip-space-detail__item'>
    {item.productImage ? <Image
      className='vip-space-detail__thumb'
      src={item.productImage}
      mode='aspectFill'
      onClick={() => {
        const images = giftImages(gift);
        void Taro.previewImage({ urls: images, current: item.productImage || images[0] });
      }}
    /> : <View className='vip-space-detail__thumb vip-space-detail__thumb--empty'>礼</View>}
    <View className='vip-space-detail__copy'><Text>{item.productTitle}</Text>{item.skuTitle ? <Text>{item.skuTitle}</Text> : null}</View>
    <Text className='vip-space-detail__qty'>x{item.quantity}</Text>
  </View>;
}

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
  const [visibleGiftIndex, setVisibleGiftIndex] = useState(0);
  const [checkoutMode, setCheckoutMode] = useState(false);
  const [addressId, setAddressId] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [returnPolicyAccepted, setReturnPolicyAccepted] = useState(false);
  const [buyerNote, setBuyerNote] = useState('');
  const [pendingSession, setPendingSession] = useState<RecoverableVipSession>();
  const [paymentNotice, setPaymentNotice] = useState('');
  const [checkoutDraft, setCheckoutDraft] = useState<VipCheckoutDraft>();
  const [recoveringVip, setRecoveringVip] = useState(false);
  const checkoutKey = useRef('');
  const giftQuery = useQuery({ queryKey: ['benefits', 'vip-gifts'], queryFn: BenefitsRepo.getVipGiftOptions });
  const memberQuery = useQuery({ queryKey: ['benefits', 'member', authRevision, userId], queryFn: BenefitsRepo.getMember, enabled: hydrated && loggedIn && Boolean(userId) });
  const profileQuery = useQuery({ queryKey: ['account', 'profile', authRevision, userId], queryFn: UserRepo.profile, enabled: hydrated && loggedIn && Boolean(userId) });
  const returnPolicyQuery = useQuery({ queryKey: ['after-sales', 'return-policy'], queryFn: MiniAfterSaleRepo.getReturnPolicy, enabled: hydrated && loggedIn });
  const addressQuery = useQuery({ queryKey: ['account', 'addresses', authRevision, userId], queryFn: AddressRepo.list, enabled: hydrated && loggedIn && Boolean(userId) });
  const packages = useMemo(() => giftQuery.data?.ok ? giftQuery.data.data.packages : [], [giftQuery.data]);
  const selectedPackage = packages.find((item) => item.id === packageId) || packages[0];
  const selectedGift = selectedPackage?.giftOptions.find((item) => item.id === giftId && item.available);
  const visibleGift = selectedPackage?.giftOptions[visibleGiftIndex] || selectedPackage?.giftOptions[0];
  const addresses = useMemo(() => addressQuery.data?.ok ? addressQuery.data.data : [], [addressQuery.data]);
  const effectiveAddressId = resolveVipCheckoutAddressId(addresses, addressId);
  const member = memberQuery.data?.ok ? memberQuery.data.data : undefined;
  const profile = profileQuery.data?.ok ? profileQuery.data.data : undefined;
  const returnPolicyReady = profile?.hasAgreedReturnPolicy === true || returnPolicyAccepted;

  useEffect(() => { if (!packageId && packages[0]) setPackageId(packages[0].id); }, [packageId, packages]);
  useEffect(() => {
    if (!selectedPackage) return;
    const nextIndex = giftId ? selectedPackage.giftOptions.findIndex((item) => item.id === giftId) : 0;
    if (giftId && (nextIndex < 0 || !selectedPackage.giftOptions[nextIndex]?.available)) setGiftId('');
    setVisibleGiftIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [giftId, selectedPackage]);
  useEffect(() => { if (!addressId && addresses.length) setAddressId((addresses.find((item) => item.isDefault) || addresses[0]).id); }, [addressId, addresses]);
  useEffect(() => {
    if (checkoutSelection.ownerRevision !== authRevision) return;
    if (checkoutSelection.addressId && addresses.some((address) => address.id === checkoutSelection.addressId)) {
      setAddressId(checkoutSelection.addressId);
    }
  }, [addresses, authRevision, checkoutSelection.addressId, checkoutSelection.ownerRevision]);
  useDidShow(() => { if (useAuthStore.getState().accessToken) void Promise.all([addressQuery.refetch(), profileQuery.refetch()]); });
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
    setReturnPolicyAccepted(false);
    setBuyerNote('');
    setCheckoutMode(false);
    setPendingSession(undefined);
    setPaymentNotice('');
    setCheckoutDraft(undefined);
    setRecoveringVip(false);
    checkoutKey.current = '';

    if (!hydrated || !loggedIn || !userId) return () => { cancelled = true; };

    const storedSession = readVipCheckoutSession(userId);
    const draft = readVipCheckoutDraft(userId);
    if (storedSession) {
      setCheckoutMode(true);
      setPendingSession(storedSession);
      setPaymentNotice('检测到一笔未确认的 VIP 礼包订单，正在核对支付状态。');
    } else if (draft) {
      setCheckoutMode(true);
      checkoutKey.current = draft.idempotencyKey;
      setCheckoutDraft(draft);
      setPackageId(draft.packageId);
      setGiftId(draft.giftOptionId);
      setAddressId(draft.addressId);
      setBuyerNote(draft.buyerNote || '');
      setPaymentNotice('上次操作尚未确认，正在恢复。');
    }

    setRecoveringVip(true);
    void CheckoutRepo.getPendingVip().then((result) => {
      if (!ownsCurrentGeneration() || !result.ok) return;
      if (result.data) {
        setCheckoutMode(true);
        clearVipCheckoutDraft();
        clearVipCheckoutSession();
        checkoutKey.current = '';
        setCheckoutDraft(undefined);
        setPendingSession(result.data);
        setPaymentNotice('已找回未完成的 VIP 礼包订单，请查询状态或继续微信支付。');
      } else if (storedSession) {
        clearVipCheckoutSession();
        setPendingSession(undefined);
        if (draft) {
          checkoutKey.current = draft.idempotencyKey;
          setCheckoutDraft(draft);
          setPackageId(draft.packageId);
          setGiftId(draft.giftOptionId);
          setAddressId(draft.addressId);
          setBuyerNote(draft.buyerNote || '');
        }
        setPaymentNotice(draft ? '未发现待支付订单，可以继续提交上次选择。' : '');
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
    setPaymentNotice('支付结果确认中，请不要重复下单，可继续查询。');
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
          if (!selectedPackage || !selectedGift || !effectiveAddressId) throw new Error('MISSING_SELECTION');
          checkoutKey.current ||= createOperationKey('mini-vip');
          draft = { userId, idempotencyKey: checkoutKey.current, packageId: selectedPackage.id, giftOptionId: selectedGift.id, addressId: effectiveAddressId, expectedTotal: selectedPackage.price, ...(buyerNote.trim() ? { buyerNote: buyerNote.trim() } : {}), createdAt: new Date().toISOString() };
          saveVipCheckoutDraft(draft);
          setCheckoutDraft(draft);
        }
        const created = await CheckoutRepo.createVip({ packageId: draft.packageId, giftOptionId: draft.giftOptionId, addressId: draft.addressId, expectedTotal: draft.expectedTotal, idempotencyKey: draft.idempotencyKey, ...(draft.buyerNote ? { buyerNote: draft.buyerNote } : {}) });
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
        setPaymentNotice('已找回未完成的 VIP 礼包订单，请确认后继续微信支付。');
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
    checkoutSelection.begin({ ownerRevision: authRevision, addressId: effectiveAddressId, couponIds: [] });
    void Taro.navigateTo({ url: '/packages/commerce/checkout-address/index' });
  };
  const startPurchase = async (sessionToContinue?: RecoverableVipSession) => {
    if (!await ensureWechatMiniProgramSession(giftReturn)) return;
    if (!sessionToContinue) {
      if (!agreed) { Taro.showToast({ title: '请先阅读并同意会员服务协议', icon: 'none' }); return; }
      if (!returnPolicyReady) { Taro.showToast({ title: '请先阅读并确认退换货规则', icon: 'none' }); return; }
      if (!effectiveAddressId) { Taro.showToast({ title: '请先选择礼包收货地址', icon: 'none' }); return; }
      if (profile?.hasAgreedReturnPolicy !== true) {
        const result = await MiniAfterSaleRepo.agreePolicy();
        if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '退换货规则确认失败', icon: 'none' }); return; }
        await profileQuery.refetch();
      }
    }
    purchaseMutation.mutate({ ...(sessionToContinue ? { sessionToContinue } : {}), revisionAtStart: authRevision, userIdAtStart: userId });
  };
  const openCheckout = () => {
    if (member?.tier === 'VIP') {
      void Taro.navigateTo({ url: '/packages/referral/center/index' });
      return;
    }
    if (!selectedGift) {
      Taro.showToast({ title: '请先选择一份专属礼包', icon: 'none' });
      return;
    }
    if (!loggedIn) {
      void Taro.redirectTo({ url: benefitsLoginUrl(giftReturn) });
      return;
    }
    setCheckoutMode(true);
    void Taro.setNavigationBarTitle({ title: 'VIP 礼包结算' });
  };
  if (giftQuery.isLoading || !hydrated) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='loading' /></View>;
  if (!giftQuery.data?.ok) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='error' description={giftQuery.data && !giftQuery.data.ok ? giftQuery.data.error.displayMessage : '礼包数据加载失败'} onAction={() => giftQuery.refetch()} /></View>;
  if (!packages.length) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='empty' title='暂无可购买礼包' description='平台尚未发布 VIP 档位' /></View>;
  if (loggedIn && memberQuery.isLoading) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='loading' /></View>;
  if (loggedIn && !memberQuery.data?.ok) return <View className='aim-page benefits-page benefits-page--gold'><BenefitsFeedback kind='error' title='会员资格校验失败' description={memberQuery.data && !memberQuery.data.ok ? memberQuery.data.error.displayMessage : undefined} onAction={() => memberQuery.refetch()} /></View>;

  if (checkoutMode && member?.tier !== 'VIP') {
    const address = addresses.find((item) => item.id === effectiveAddressId);
    return <View className='vip-checkout-page'>
      <View className='vip-checkout-back' onClick={() => { if (!pendingSession && !checkoutDraft) { setCheckoutMode(false); void Taro.setNavigationBarTitle({ title: '选择 VIP 礼包' }); } }}>‹ 返回礼包选择</View>
      <View className='vip-checkout-summary'>
        <Text className='vip-checkout-summary__eyebrow'>VIP 礼包结算</Text>
        <Text className='vip-checkout-summary__title'>{selectedGift?.title || '专属礼包'}</Text>
        <Text className='vip-checkout-summary__price'>¥{formatMoney(checkoutDraft?.expectedTotal ?? selectedPackage?.price ?? 0)}</Text>
      </View>
      <View className='vip-checkout-section-head'><Text>收货地址</Text><Text onClick={openAddressSelection}>{addresses.length ? '切换 ›' : '新增 ›'}</Text></View>
      {!addressQuery.data?.ok ? <BenefitsFeedback kind={addressQuery.isLoading ? 'loading' : 'error'} description={addressQuery.data && !addressQuery.data.ok ? addressQuery.data.error.displayMessage : '收货地址加载失败'} onAction={() => addressQuery.refetch()} /> : address ? <View className='benefits-address benefits-address--active' onClick={openAddressSelection}><Text className='benefits-address__name'>{address.receiverName}</Text><Text className='benefits-address__phone'>{address.phone}</Text><Text className='benefits-address__detail'>{address.regionText || `${address.province}${address.city}${address.district}`} {address.detail}</Text></View> : <View className='vip-checkout-card'><Text>还没有收货地址</Text><Button className='benefits-secondary' onClick={openAddressSelection}>新增收货地址</Button></View>}
      <View className='vip-checkout-section-head'><Text>买家留言</Text><Text>{buyerNote.length}/200</Text></View>
      <View className='vip-checkout-card'><Textarea className='vip-checkout-note' value={buyerNote} maxlength={200} placeholder='例如：尽快发货 / 不要冰品' onInput={(event) => setBuyerNote(event.detail.value.slice(0, 200))} /></View>
      <View className='benefits-agreement' onClick={() => setAgreed((value) => !value)}><View className={agreed ? 'benefits-agreement__box benefits-agreement__box--active' : 'benefits-agreement__box'}>{agreed ? '✓' : ''}</View><Text>我已阅读并同意</Text><Text className='vip-checkout-link' onClick={(event) => { event.stopPropagation(); void Taro.navigateTo({ url: '/packages/benefits/member-agreement/index' }); }}>《会员服务协议》</Text></View>
      {profile?.hasAgreedReturnPolicy !== true ? <View className='benefits-agreement' onClick={() => setReturnPolicyAccepted((value) => !value)}><View className={returnPolicyAccepted ? 'benefits-agreement__box benefits-agreement__box--active' : 'benefits-agreement__box'}>{returnPolicyAccepted ? '✓' : ''}</View><Text>我已阅读并确认</Text><Text className='vip-checkout-link' onClick={(event) => { event.stopPropagation(); const policy = returnPolicyQuery.data?.ok ? returnPolicyQuery.data.data : undefined; void Taro.showModal({ title: policy?.title || '退换货规则', content: policy?.content.join('\n') || '礼包中的实物赠品按页面展示的售后资格与费用规则处理。', showCancel: false, confirmText: '知道了' }); }}>《退换货规则》</Text></View> : null}
      <View className='benefits-legal-links'><Text onClick={() => Taro.navigateTo({ url: '/packages/account/account-legal/index?document=terms' })}>《用户协议》</Text><Text onClick={() => Taro.navigateTo({ url: '/packages/account/account-legal/index?document=privacy' })}>《隐私政策》</Text></View>
      {paymentNotice ? <View className='benefits-payment-state'>{paymentNotice}</View> : null}
      {pendingSession ? <><Button className='benefits-secondary' disabled={purchaseMutation.isPending || recoveringVip} onClick={queryStatus}>查询当前礼包订单</Button><Button className='benefits-primary benefits-primary--gold' loading={purchaseMutation.isPending || recoveringVip} disabled={purchaseMutation.isPending || recoveringVip} onClick={() => { void startPurchase(pendingSession); }}>{recoveringVip ? '正在恢复...' : '继续微信支付'}</Button></> : <Button className='benefits-primary benefits-primary--gold' loading={purchaseMutation.isPending || recoveringVip} disabled={recoveringVip || (!checkoutDraft && (!selectedGift || !effectiveAddressId)) || !agreed || !returnPolicyReady || purchaseMutation.isPending} onClick={() => { void startPurchase(); }}>{recoveringVip ? '正在检查未完成订单...' : purchaseMutation.isPending ? '正在确认...' : `微信支付 ¥${formatMoney(checkoutDraft?.expectedTotal ?? selectedPackage?.price ?? 0)}`}</Button>}
    </View>;
  }

  const swiperSideMargin = `${Math.max(24, Math.round(Taro.getWindowInfo().windowWidth * 0.09))}px`;
  const ctaEnabled = member?.tier === 'VIP' || Boolean(selectedGift);
  return <View className='vip-space-page'>
    <View className='vip-space-glow vip-space-glow--top' /><View className='vip-space-glow vip-space-glow--bottom' />
    <View className='vip-space-particles'>{Array.from({ length: 14 }, (_, index) => <View key={index} />)}</View>
    <View className='vip-space-title'><Text>✦</Text><Text>VIP 会员专属空间</Text><Text>✦</Text></View>
    <Text className='vip-space-subtitle'>所有礼遇，仅为 VIP 准备</Text>
    {member?.tier === 'VIP' ? <View className='vip-space-member-tip'>您已是 VIP 会员 · 以下礼包可展示给好友</View> : null}
    <View className='vip-space-packages'>{packages.map((item, index) => <View key={item.id} className={selectedPackage?.id === item.id ? 'vip-space-package vip-space-package--active' : 'vip-space-package'} onClick={() => { if (checkoutDraft && !pendingSession) { Taro.showToast({ title: '请先处理上次未完成的礼包订单', icon: 'none' }); return; } setPackageId(item.id); setGiftId(''); setVisibleGiftIndex(0); }}><Text>¥{Number.isInteger(item.price) ? item.price.toFixed(0) : item.price.toFixed(2)}</Text><Text>VIP 礼包</Text><Text>{item.giftOptions.length} 款可选</Text></View>)}</View>
    {member?.tier !== 'VIP' && (!loggedIn || (member && !hasActiveReferral(member))) ? <View className='vip-space-referral'><View /><Text>扫描好友邀请码，绑定专属推荐人</Text></View> : null}
    <Swiper className='vip-space-swiper' current={visibleGiftIndex} previousMargin={swiperSideMargin} nextMargin={swiperSideMargin} onChange={(event) => setVisibleGiftIndex(event.detail.current)}>
      {selectedPackage?.giftOptions.map((gift) => <SwiperItem key={gift.id}><View className={`vip-space-gift${gift.id === selectedGift?.id ? ' vip-space-gift--selected' : ''}${!gift.available ? ' vip-space-gift--disabled' : ''}`} onClick={() => { if (gift.available) setGiftId(gift.id); }}><VipGiftCover gift={gift} /><View className='vip-space-gift__body'><Text className='vip-space-gift__title'>{gift.title}</Text>{gift.subtitle ? <Text className='vip-space-gift__subtitle'>{gift.subtitle}</Text> : null}{gift.badge ? <Text className='vip-space-gift__badge'>{gift.badge}</Text> : null}</View>{!gift.available ? <View className='vip-space-gift__sold-out'>已售完</View> : null}</View></SwiperItem>)}
    </Swiper>
    {selectedPackage?.giftOptions.length ? <View className='vip-space-indicator'>{selectedPackage.giftOptions.map((gift, index) => <View className={index === visibleGiftIndex ? 'vip-space-indicator__dot vip-space-indicator__dot--active' : 'vip-space-indicator__dot'} key={gift.id} />)}<Text>{visibleGiftIndex + 1} / {selectedPackage.giftOptions.length}</Text></View> : null}
    {visibleGift ? <View className='vip-space-detail'><View className='vip-space-detail__head'><View><Text>礼包清单</Text><Text>{visibleGift.title}</Text></View><Text>共 {visibleGift.items.reduce((total, item) => total + item.quantity, 0)} 件</Text></View><View className='vip-space-detail__list'>{visibleGift.items.map((item, index) => <VipGiftDetailItem item={item} gift={visibleGift} key={`${item.skuId}-${index}`} />)}</View></View> : null}
    <View className='vip-space-benefits'>{VIP_BENEFITS.map(([mark, label]) => <View key={label}><Text>{mark}</Text><Text>{label}</Text></View>)}</View>
    <View className='vip-space-bottom'><View><Text>{member?.tier === 'VIP' ? 'VIP 礼包' : '开通 VIP'}</Text><Text>¥{Number.isInteger(selectedPackage?.price || 0) ? (selectedPackage?.price || 0).toFixed(0) : (selectedPackage?.price || 0).toFixed(2)}</Text></View><Button disabled={!ctaEnabled} onClick={openCheckout}>{member?.tier === 'VIP' ? '分享给好友开通' : '立即开通'}</Button><Text>{member?.tier === 'VIP' ? '好友支付即开通 VIP · 您可获得推荐奖励' : '支付即开通 VIP'}</Text>{member?.tier !== 'VIP' ? <Text>开通前请阅读并同意<Text onClick={() => Taro.navigateTo({ url: '/packages/benefits/member-agreement/index' })}>《会员服务协议》</Text></Text> : null}</View>
  </View>;
}
