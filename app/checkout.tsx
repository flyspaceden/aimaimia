import React, { useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../src/components/layout';
import { AuthModal } from '../src/components/overlay';
import { EmptyState, useToast } from '../src/components/feedback';
import { AiDivider } from '../src/components/ui/AiDivider';
import { GiftCoverImage } from '../src/components/cards';
import { OrderItemRow } from '../src/components/cards/OrderItemRow';
import { Countdown } from '../src/components/ui/Countdown';
import { paymentMethods } from '../src/constants';
import type { CoverMode } from '../src/types/domain/Bonus';
import type { PendingCheckout } from '../src/types/domain/Checkout';
import { AddressRepo, OrderRepo, UserRepo } from '../src/repos';
import { AppConfigRepo } from '../src/repos/AppConfigRepo';
import { payWithAlipay } from '../src/utils/alipay';
import { payWithWechat } from '../src/utils/wechat-pay';
import { getStockText } from '../src/utils/stockDisplay';
import { AfterSaleRepo } from '../src/repos/AfterSaleRepo';
import { useAuthStore, useCartStore, useCheckoutStore } from '../src/store';
import { useMeasuredBottomBar } from '../src/hooks/useMeasuredBottomBar';
import { compactActionTextProps, priceTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../src/theme';
import { AuthSession, PaymentMethod } from '../src/types';
import type { VipPackageSelection } from '../src/store/useCheckoutStore';

const normalizeMoneyInput = (value: string) => {
  const cleaned = value.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  const integerPart = parts[0] ?? '';
  const decimalPart = parts.length > 1 ? parts.slice(1).join('').slice(0, 2) : undefined;
  return decimalPart === undefined ? integerPart : `${integerPart}.${decimalPart}`;
};

const parseMoneyInput = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoneyInput = (value: number) => (value > 0 ? value.toFixed(2) : '');

export default function CheckoutScreen() {
  const { colors, radius, shadow, spacing, typography, gradients, isDark } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactSubmitBar = isCompact || isLargeText;
  const barBottomPad = useBottomInset(spacing.sm);
  const { bottomPadding: scrollBottomPad, onBarLayout: handleBottomBarLayout } =
    useMeasuredBottomBar(compactSubmitBar ? 150 : 112, spacing.lg);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);
  // 从 checkout store 读取子页面选择结果（地址、红包、VIP 套餐）
  const storeAddressId = useCheckoutStore((s) => s.selectedAddressId);
  const storeCouponIds = useCheckoutStore((s) => s.selectedCouponIds);
  const storeCouponDiscount = useCheckoutStore((s) => s.couponDiscount);
  const vipPackageSelection = useCheckoutStore((s) => s.vipPackageSelection);
  const clearVipPackageSelection = useCheckoutStore((s) => s.clearVipPackageSelection);
  const resetCheckoutStore = useCheckoutStore((s) => s.reset);
  // VIP 模式：从 vipPackageSelection 判断
  const isVipMode = !!vipPackageSelection;
  const allItems = useCartStore((state) => state.items);
  const selectedIds = useCartStore((state) => state.selectedIds);
  const clearCheckedItems = useCartStore((state) => state.clearCheckedItems);
  const syncFromServer = useCartStore((state) => state.syncFromServer);
  // N08修复：使用 cartKey 匹配选中项（支持同商品不同 SKU）
  const selectedItems = useMemo(
    () => {
      const selectedRaw = allItems.filter((item) => {
        const key = item.skuId ? `${item.productId}:${item.skuId}` : item.productId;
        return selectedIds.has(key) && !item.unavailableReason;
      });
      const selectedNonPrizeTotal = selectedRaw
        .filter((item) => !item.isPrize)
        .reduce((sum, item) => sum + item.price * item.quantity, 0);

      return allItems.filter((item) => {
        if (item.unavailableReason) return false;
        const key = item.skuId ? `${item.productId}:${item.skuId}` : item.productId;
        const selected = selectedIds.has(key);
        const isThresholdGift = item.isPrize === true && !!item.threshold;
        const dynamicLocked = item.isLocked === true && (!item.threshold || selectedNonPrizeTotal < item.threshold);
        if (dynamicLocked) return false;
        if (isThresholdGift) return selectedNonPrizeTotal >= (item.threshold ?? 0);
        return selected;
      });
    },
    [allItems, selectedIds]
  );
  const [refreshing, setRefreshing] = useState(false);
  // v1.0 仅接通支付宝，默认选支付宝；wechat/bankcard 在 paymentMethods 配置里 available=false 灰掉
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('alipay');
  const [buyerNote, setBuyerNote] = useState('');
  const [deductionAmount, setDeductionAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // 退换货政策协议弹窗状态
  const [policyModalVisible, setPolicyModalVisible] = useState(false);
  const [policyChecked, setPolicyChecked] = useState(false);
  const [policyAgreeing, setPolicyAgreeing] = useState(false);
  // 记录本次会话内是否已同意（避免弹窗后再次弹窗）
  const [localAgreed, setLocalAgreed] = useState(false);
  // 同意标记的 ref 镜像：解决闭包陷阱——pendingCheckoutRef 缓存的旧 handleCheckout 闭包
  // 内部 hasAgreedReturnPolicy 是渲染时的常量值（false），导致同意后再次进入 ensurePolicyAgreed
  // 仍判 false → 弹窗死循环。用 ref 保证旧闭包重入时能读到最新 agreed 状态
  const agreedRef = useRef(false);
  // 待执行的结算函数（同意政策后触发）
  const pendingCheckoutRef = useRef<(() => void) | null>(null);
  // 409 防重弹窗：展示已存在的 ACTIVE Session 摘要 + 三个操作按钮
  const [pendingModal, setPendingModal] = useState<PendingCheckout | null>(null);
  // 记录"取消旧订单后要重新跑哪个结算入口"（普通 vs VIP）
  const pendingRetryRef = useRef<(() => Promise<void>) | null>(null);
  // B05修复：生成幂等键，防止网络重试导致重复订单（每次进入结算页生成一次）
  // 按 bizType 拆分：schema 唯一约束是 (userId, idempotencyKey)，普通+VIP 共用会撞约束
  const normalIdempotencyKeyRef = useRef(`ik_normal_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const vipIdempotencyKeyRef = useRef(`ik_vip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

  // 进入结算页时从服务端同步购物车
  React.useEffect(() => {
    syncFromServer();
  }, []);

  // B03修复：没有选中商品时不fallback到全部，而是显示空状态
  const cartItems = selectedItems.length > 0 ? selectedItems : [];
  // 本地商品小计（用于红包门槛判断等即时展示）
  const localGoodsTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // 红包选择（从 checkout store 读取）
  const parsedCouponIds = storeCouponIds;
  const couponDiscount = storeCouponDiscount;
  const couponCount = parsedCouponIds.length;

  // 提取分类ID和商家ID（传给红包选择页用于筛选可用红包）
  const categoryIds = useMemo(() => {
    const ids = new Set<string>();
    cartItems.forEach((item) => { if (item.categoryId) ids.add(item.categoryId); });
    return Array.from(ids);
  }, [cartItems]);
  const companyIds = useMemo(() => {
    const ids = new Set<string>();
    cartItems.forEach((item) => { if (item.companyId) ids.add(item.companyId); });
    return Array.from(ids);
  }, [cartItems]);

  const previewSignature = cartItems.map((i) => `${i.id || ''}:${i.skuId || i.productId}:${i.quantity}`).join(',');
  const previewErrorToastKeyRef = useRef<string>('');
  const previewExcludedToastKeyRef = useRef<string>('');

  // 地址数据
  const { data: addressData } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => AddressRepo.list(),
    enabled: isLoggedIn,
  });
  const addresses = addressData?.ok ? addressData.data : [];
  const selectedAddress = storeAddressId
    ? addresses.find((a) => a.id === storeAddressId)
    : addresses.find((a) => a.isDefault) ?? addresses[0];

  // 用户资料（用于判断是否已同意退换货政策）
  const { data: profileData } = useQuery({
    queryKey: ['me-profile'],
    queryFn: () => UserRepo.profile(),
    enabled: isLoggedIn,
  });
  const hasAgreedReturnPolicy = localAgreed || (profileData?.ok ? profileData.data.hasAgreedReturnPolicy : false);

  const { data: appConfigResult } = useQuery({
    queryKey: ['app-config'],
    queryFn: AppConfigRepo.getPublicConfig,
    staleTime: 1000 * 60 * 60,
  });
  const lowStockThreshold = appConfigResult?.ok ? appConfigResult.data.lowStockDisplayThreshold : 10;

  // N09修复：调用预结算接口获取服务端计算结果
  const { data: previewData, isError: previewError, isLoading: previewLoading } = useQuery({
    queryKey: ['order-preview', previewSignature, parsedCouponIds, selectedAddress?.id],
    queryFn: () => OrderRepo.previewOrder({
      items: cartItems.map((item, index) => ({
        id: `preview-${item.productId}-${index}`,
        productId: item.productId,
        skuId: item.skuId ?? item.productId,
        title: item.title,
        image: item.image,
        price: item.price,
        quantity: item.quantity,
        cartItemId: item.id,
      })),
      addressId: selectedAddress?.id,
      couponInstanceIds: parsedCouponIds.length > 0 ? parsedCouponIds : undefined,
    }),
    enabled: isLoggedIn && cartItems.length > 0,
  });
  const preview = previewData?.ok ? previewData.data : null;
  const previewPending = cartItems.length > 0 && previewLoading && !previewData;
  // S11补齐：预结算失败时禁止提交（网络错误 or API 返回错误）
  const previewFailed = previewError || (!!previewData && !previewData.ok);

  // S11补齐：预结算失败时显式提示（避免静默回退到本地价格）
  React.useEffect(() => {
    if (!previewData || previewData.ok) return;
    const message = previewData.error.displayMessage ?? '预结算失败，请刷新后重试';
    const toastKey = `${previewSignature}|${parsedCouponIds.join(',')}|${message}`;
    if (previewErrorToastKeyRef.current === toastKey) return;
    show({ message, type: 'error' });
    previewErrorToastKeyRef.current = toastKey;
  }, [previewData, previewSignature, parsedCouponIds, show]);

  React.useEffect(() => {
    if (!preview?.excludedItems?.length) return;
    const toastKey = preview.excludedItems.map((item) => `${item.cartItemId || ''}:${item.skuId}:${item.reason}`).join('|');
    if (previewExcludedToastKeyRef.current === toastKey) return;
    show({ message: '已下架奖品已自动从结算中移除', type: 'warning' });
    previewExcludedToastKeyRef.current = toastKey;
  }, [preview?.excludedItems, show]);

  // S11修复：比对服务端价格与购物车价格，发现差异时提示用户
  const [priceWarningShown, setPriceWarningShown] = useState(false);
  React.useEffect(() => {
    if (!preview || priceWarningShown) return;
    const serverItems = preview.groups.flatMap((g) => g.items);
    let hasChange = false;
    for (const si of serverItems) {
      const cartItem = cartItems.find(
        (ci) => (ci.skuId ?? ci.productId) === si.skuId,
      );
      if (cartItem && Math.abs(cartItem.price - si.unitPrice) > 0.01) {
        hasChange = true;
        break;
      }
    }
    if (hasChange) {
      show({ message: '部分商品价格已变更，请确认最新金额', type: 'warning' });
      setPriceWarningShown(true);
    }
  }, [preview]);

  // N09修复：优先使用服务端返回值；预结算返回前不展示本地假运费
  const total = preview?.summary.totalGoodsAmount ?? localGoodsTotal;
  const shippingFee = preview?.summary.totalShippingFee ?? 0;
  const serverDiscount = preview?.summary.totalDiscount ?? 0;
  const vipDiscount = preview?.summary.vipDiscount ?? 0;
  const finalTotal = preview
    ? Number(preview.summary.totalPayable.toFixed(2))
    : Number(Math.max(0, localGoodsTotal - couponDiscount).toFixed(2));
  const previewMaxDeductible = !isVipMode && preview ? Math.max(0, preview.maxDeductible ?? 0) : 0;
  const maxDeductible = !isVipMode && preview ? Number(Math.min(previewMaxDeductible, finalTotal).toFixed(2)) : 0;
  const pointsBalance = !isVipMode && preview ? Number(Math.max(0, preview.pointsBalance ?? 0).toFixed(2)) : 0;
  const pointsRatio = !isVipMode && preview ? preview.pointsRatio ?? 0 : 0;
  const requestedDeductionAmount = parseMoneyInput(deductionAmount);
  const appliedDeductionAmount = !isVipMode
    ? Number(Math.min(requestedDeductionAmount, maxDeductible, finalTotal).toFixed(2))
    : 0;
  const payableAfterDeduction = !isVipMode
    ? Number(Math.max(0, finalTotal - appliedDeductionAmount).toFixed(2))
    : finalTotal;
  const shippingFeeText = preview
    ? (shippingFee === 0 ? '免运费' : `¥${shippingFee.toFixed(2)}`)
    : (previewFailed ? '校验失败' : '计算中...');

  React.useEffect(() => {
    if (isVipMode) {
      if (deductionAmount) setDeductionAmount('');
      return;
    }
    const current = parseMoneyInput(deductionAmount);
    if (current > maxDeductible) {
      setDeductionAmount(formatMoneyInput(maxDeductible));
    }
  }, [deductionAmount, isVipMode, maxDeductible]);

  const handleDeductionChange = (value: string) => {
    const normalized = normalizeMoneyInput(value);
    const next = parseMoneyInput(normalized);
    if (next > maxDeductible) {
      show({ message: `最多可抵扣 ¥${maxDeductible.toFixed(2)}`, type: 'warning' });
      setDeductionAmount(formatMoneyInput(maxDeductible));
      return;
    }
    setDeductionAmount(normalized);
  };

  const orderItems = useMemo(
    () =>
      cartItems.map((item, index) => ({
        id: `oi-${item.productId}-${index}`,
        productId: item.productId,
        // 传递 skuId，后端需要根据 skuId 查询真实价格和库存
        skuId: item.skuId ?? item.productId,
        title: item.title,
        image: item.image,
        price: item.price,
        quantity: item.quantity,
        stock: item.stock,
        cartItemId: item.id,
      })),
    [cartItems]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  const handleAddressPress = () => {
    if (isVipMode && !isLoggedIn) {
      show({ message: '请先登录，再填写收货地址', type: 'warning' });
      setAuthModalOpen(true);
      return;
    }
    router.push('/checkout-address');
  };

  const handleVipAuthSuccess = async (session: AuthSession) => {
    setLoggedIn({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      userId: session.userId,
      loginMethod: session.loginMethod,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['addresses'] }),
    ]);
    const addressResult = await queryClient.fetchQuery({
      queryKey: ['addresses'],
      queryFn: () => AddressRepo.list(),
    });
    if (addressResult.ok && addressResult.data.length === 0) {
      router.push('/me/addresses');
    }
  };

  // 退换货政策协议：同意后调用后端并继续结算
  const handleAgreePolicy = async () => {
    setPolicyAgreeing(true);
    try {
      const result = await AfterSaleRepo.agreePolicy();
      if (!result.ok) {
        show({ message: '确认失败，请重试', type: 'error' });
        // 防御性清 ref：避免下次成功时调到旧闭包（虽然旧闭包同样会被新弹窗覆盖，
        // 但这里清掉更显式，符合"失败即清理"原则）
        pendingCheckoutRef.current = null;
        return;
      }
      setLocalAgreed(true);
      agreedRef.current = true; // 同步写 ref 让旧闭包重入时能读到最新值
      setPolicyModalVisible(false);
      setPolicyChecked(false);
      await queryClient.invalidateQueries({ queryKey: ['me-profile'] });
      // 执行之前被拦截的结算操作
      if (pendingCheckoutRef.current) {
        const fn = pendingCheckoutRef.current;
        pendingCheckoutRef.current = null;
        fn();
      }
    } finally {
      setPolicyAgreeing(false);
    }
  };

  // 政策拦截：首次结算时弹窗
  // 必须同时检查 agreedRef.current（解决闭包陷阱：旧闭包里的 hasAgreedReturnPolicy 永远是渲染时的快照值）
  const ensurePolicyAgreed = (onProceed: () => void): boolean => {
    if (hasAgreedReturnPolicy || agreedRef.current) return true;
    pendingCheckoutRef.current = onProceed;
    setPolicyModalVisible(true);
    return false;
  };

  /**
   * P5 第三轮支付确认 + 跳转的统一逻辑
   * （普通结算 + VIP 礼包共用，避免 4 处重复代码）
   *
   * 流程图（详见 docs/issues/app-tpfix1.md P5 第三轮）：
   *   1. 立刻 active-query → COMPLETED 直接跳成功页（沙箱场景秒到）
   *   2. 未 COMPLETED → polling 兜底（90 次 × 2s = 180 秒）
   *   3. 期间发现 EXPIRED/FAILED → 明确提示
   *   4. 仍未完成 → 软提示"支付处理中，请稍后在订单列表查看"（不报失败）
   *   5. 成功 → router.replace('/payment-success', params)
   */
  const confirmPaymentAndNavigate = async (args: {
    sessionId: string;
    merchantOrderNo: string;
    amount: number;
    isVip: boolean;
  }) => {
    const { sessionId, merchantOrderNo, amount, isVip } = args;

    show({ message: '支付确认中...', type: 'info' });

    let completed = false;
    let orderIds: string[] = [];

    /**
     * 处理 active-query 返回结果
     * @returns 'completed' | 'terminal-failure' | 'continue-poll'
     *
     * F2 修复：业务错误（INVALID/FORBIDDEN/NOT_FOUND）应停止并提示，而非沉默继续轮询。
     * - 金额不一致后端抛 BadRequestException → code='INVALID' → 直接提示停止
     * - 网络错误 / 服务器异常 → 继续 polling 兜底
     */
    const handleActiveQuery = async (): Promise<'completed' | 'terminal-failure' | 'continue-poll'> => {
      const r = await OrderRepo.activeQueryPayment(sessionId);
      if (r.ok) {
        const { status, orderIds: ids } = r.data;
        if (status === 'COMPLETED') {
          completed = true;
          orderIds = ids ?? [];
          return 'completed';
        }
        if (status === 'EXPIRED' || status === 'FAILED') {
          show({ message: status === 'EXPIRED' ? '支付超时，请重试' : '支付失败', type: 'error' });
          return 'terminal-failure';
        }
        // ACTIVE/PAID/中间态 → 继续 polling
        return 'continue-poll';
      }
      // F2: 业务错误立即终止（区分网络错误）
      const code = r.error.code;
      if (code === 'INVALID' || code === 'FORBIDDEN' || code === 'NOT_FOUND') {
        show({
          message: r.error.displayMessage ?? '支付确认失败，请联系客服',
          type: 'error',
        });
        return 'terminal-failure';
      }
      // NETWORK / UNKNOWN → 继续 polling 兜底
      return 'continue-poll';
    };

    // 1. 立刻主动查询（沙箱 notify 慢/丢失时直接救场）
    const initialOutcome = await handleActiveQuery();
    if (initialOutcome === 'terminal-failure') return;

    // 2. polling 兜底（90 次 × 2 秒 = 180 秒，应对沙箱 notify 长尾）
    //    F1 修复：每 5 轮再调一次 active-query，避免首次 query 错过窗口期后只能等 notify
    if (!completed) {
      const MAX_POLLS = 90;
      const POLL_INTERVAL = 2000;
      const ACTIVE_QUERY_EVERY = 5;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));

        // 每 5 轮（约 10 秒）再触发一次后端 active-query 重查支付宝真实状态
        if (i > 0 && i % ACTIVE_QUERY_EVERY === 0) {
          const outcome = await handleActiveQuery();
          if (outcome === 'completed') break;
          if (outcome === 'terminal-failure') return;
        }

        // 普通本地 session 状态轮询（看 notify 路径有没有更新 session）
        const statusResult = await OrderRepo.getCheckoutSessionStatus(sessionId);
        if (!statusResult.ok) continue;
        const { status, orderIds: ids } = statusResult.data;
        if (status === 'COMPLETED') {
          completed = true;
          orderIds = ids ?? [];
          break;
        }
        if (status === 'EXPIRED' || status === 'FAILED') {
          show({ message: status === 'EXPIRED' ? '支付超时，请重试' : '支付失败', type: 'error' });
          return;
        }
      }
    }

    // 3. 仍未完成 → 软提示而非"失败"（钱可能已扣，避免用户重复支付）
    if (!completed) {
      show({ message: '支付处理中，请稍后在订单列表查看', type: 'warning' });
      return;
    }

    // 4. 成功：刷新缓存 + 清空购物车/VIP 选择 + 跳支付成功页
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-issue'] }),
      queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] }),    // 抵扣后钱包余额变化
      queryClient.invalidateQueries({ queryKey: ['bonus-ledger'] }),    // 钱包流水变化
      ...(isVip ? [queryClient.invalidateQueries({ queryKey: ['bonus-member'] })] : []),
    ]);
    if (isVip) {
      clearVipPackageSelection();
    } else {
      clearCheckedItems();
    }
    resetCheckoutStore();

    router.replace({
      pathname: '/payment-success',
      params: {
        sessionId,
        totalOrderNo: merchantOrderNo,
        amount: amount.toFixed(2),
        firstOrderId: orderIds[0] ?? '',
        orderCount: String(Math.max(1, orderIds.length)),
        isVip: isVip ? '1' : '0',
      },
    });
  };

  const handleCheckout = async () => {
    if (previewPending) {
      show({ message: '价格校验中，请稍候再提交', type: 'warning' });
      return;
    }
    if (!preview || previewFailed) {
      show({ message: '价格校验失败，请刷新后重试', type: 'error' });
      return;
    }
    const blocked = allItems.some((item) => {
      const key = item.skuId ? `${item.productId}:${item.skuId}` : item.productId;
      return selectedIds.has(key) && (item.unavailableReason === 'OUT_OF_STOCK' || Number(item.stock ?? 1) <= 0);
    }) || cartItems.some((item) => item.unavailableReason === 'OUT_OF_STOCK' || Number(item.stock ?? 1) <= 0);
    if (blocked) {
      show({ message: '有商品暂无库存，请返回购物车处理', type: 'warning' });
      return;
    }
    if (!selectedAddress) {
      show({ message: '请先选择收货地址', type: 'warning' });
      return;
    }
    const deductionToSubmit = Number(parseMoneyInput(deductionAmount).toFixed(2));
    if (deductionToSubmit > maxDeductible) {
      show({ message: `最多可抵扣 ¥${maxDeductible.toFixed(2)}`, type: 'warning' });
      setDeductionAmount(formatMoneyInput(maxDeductible));
      return;
    }
    // 退换货政策拦截：未同意则弹窗，同意后自动重新触发
    if (!ensurePolicyAgreed(handleCheckout)) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      // F1 新流程: 创建 CheckoutSession → 模拟支付 → 轮询状态
      const sessionResult = await OrderRepo.createCheckoutSession({
        items: cartItems.map((item) => ({
          skuId: item.skuId ?? item.productId,
          quantity: item.quantity,
          cartItemId: item.id,
        })),
        addressId: selectedAddress.id,
        couponInstanceIds: parsedCouponIds.length > 0 ? parsedCouponIds : undefined,
        paymentChannel: paymentMethod,
        idempotencyKey: normalIdempotencyKeyRef.current,
        expectedTotal: payableAfterDeduction,
        deductionAmount: deductionToSubmit,
        buyerNote: buyerNote.trim() || undefined,
      });
      if (!sessionResult.ok) {
        // 409 防重锁拦截：拿 Session 摘要弹 Modal，让用户决定取消旧/续付/关闭
        if (sessionResult.error.businessCode === 'PENDING_CHECKOUT_EXISTS') {
          const pending = await OrderRepo.getPendingCheckout();
          if (pending.ok && pending.data) {
            pendingRetryRef.current = handleCheckout;
            setPendingModal(pending.data);
          } else {
            show({ message: '订单状态异常，请重试', type: 'error' });
          }
          return;
        }
        show({ message: sessionResult.error.displayMessage ?? '下单失败', type: 'error' });
        return;
      }

      const { sessionId, merchantOrderNo, paymentParams } = sessionResult.data;

      // 支付分流：先调起渠道支付，然后统一交给 confirmPaymentAndNavigate 走 active-query + polling
      // 流程图（详见 docs/issues/app-tpfix1.md P5 第三轮）：
      //   - 6001 用户取消 → 保留 session，跳未完成订单续付页
      //   - 其他 (9000/8000/6004/4000/空/微信 errCode) → 不依赖 SDK resultStatus，进 active-query
      if (paymentParams?.channel === 'alipay' && paymentParams?.orderStr) {
        const alipayResult = await payWithAlipay(paymentParams.orderStr as string);
        if (alipayResult.memo === 'NATIVE_UNAVAILABLE') {
          // 原生模块不可用：dev 走 simulate，release 直接拒
          if (__DEV__) {
            const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
            if (!payResult.ok) {
              show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
              await OrderRepo.cancelCheckoutSession(sessionId);
              return;
            }
          } else {
            show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
            await OrderRepo.cancelCheckoutSession(sessionId);
            return;
          }
        } else if (alipayResult.resultStatus === '6001') {
          // 用户取消支付 — 保留 Session ACTIVE，跳到 /checkout-pending 让用户决定续付或主动取消
          // （不再立即 cancelCheckoutSession；30 分钟后 Cron 自然过期）
          router.replace({ pathname: '/checkout-pending', params: { sessionId } });
          return;
        } else if (alipayResult.memo === 'TIMEOUT') {
          // SDK 90s 无响应（通常支付宝被系统拦截没起来）：不 cancel session，
          // 提示用户 + 走 active-query + polling 兜底（用户仍可能在支付宝里完成支付）
          show({
            message: '支付宝未响应，请确认是否已安装支付宝并允许应用启动它，正在为你确认支付结果…',
            type: 'warning',
            duration: 4000,
          });
        }
        // 9000/8000/6004/4000/空字符串/TIMEOUT 等其他状态：不依赖 SDK 结果，统一走 confirmPaymentAndNavigate
      } else if (paymentParams?.channel === 'wechat' && paymentParams?.prepayId) {
        const wechatResult = await payWithWechat({
          appId: paymentParams.appId,
          partnerId: paymentParams.partnerId,
          timestamp: paymentParams.timestamp,
          nonceStr: paymentParams.nonceStr,
          prepayId: paymentParams.prepayId,
          packageVal: paymentParams.packageVal,
          signType: paymentParams.signType,
          paySign: paymentParams.paySign,
        });
        if (wechatResult.errStr === 'NATIVE_UNAVAILABLE') {
          if (__DEV__) {
            const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
            if (!payResult.ok) {
              show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
              await OrderRepo.cancelCheckoutSession(sessionId);
              return;
            }
          } else {
            show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
            await OrderRepo.cancelCheckoutSession(sessionId);
            return;
          }
        } else if (wechatResult.resultStatus === '6001') {
          router.replace({ pathname: '/checkout-pending', params: { sessionId } });
          return;
        }
        // errCode=0 / 其他错误码：不依赖 SDK 结果，统一走 confirmPaymentAndNavigate
      } else if (paymentMethod === 'alipay') {
        // 用户选了支付宝但后端没生成 orderStr → 后端 SDK 初始化失败/凭据错
        show({ message: '支付服务暂不可用，请稍后重试或联系客服', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      } else if (paymentMethod === 'wechat') {
        show({ message: '微信支付服务暂不可用，请稍后重试或联系客服', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      } else if (__DEV__) {
        // 非支付宝（且 Expo Go 开发环境）：模拟支付回调
        const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
        if (!payResult.ok) {
          show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
          await OrderRepo.cancelCheckoutSession(sessionId);
          return;
        }
      } else {
        // release 防御：UI 已灰掉非支付宝渠道，正常用户走不到这分支
        show({ message: '当前支付方式暂未开通，请使用支付宝', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      }

      // 进入支付确认流程（active-query → polling fallback → 跳成功页）
      // F4: 用后端权威 expectedTotal 而非前端 finalTotal（前端计算可能与服务端有微小差异）
      await confirmPaymentAndNavigate({
        sessionId,
        merchantOrderNo,
        amount: sessionResult.data.expectedTotal,
        isVip: false,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // VIP 礼包结算
  const handleVipCheckout = async () => {
    if (!vipPackageSelection || !vipPackageSelection.giftOptionId || vipPackageSelection.price <= 0) {
      show({ message: 'VIP 套餐信息不完整，请返回重新选择', type: 'warning' });
      return;
    }
    if (!isLoggedIn) {
      show({ message: '请先完成登录，再继续开通 VIP', type: 'warning' });
      setAuthModalOpen(true);
      return;
    }
    if (!selectedAddress) {
      show({ message: '请先选择收货地址', type: 'warning' });
      router.push('/checkout-address');
      return;
    }
    // 退换货政策拦截（VIP 同样需要）
    if (!ensurePolicyAgreed(handleVipCheckout)) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      const sessionResult = await OrderRepo.createVipCheckoutSession({
        packageId: vipPackageSelection.packageId,
        giftOptionId: vipPackageSelection.giftOptionId,
        addressId: selectedAddress.id,
        paymentChannel: paymentMethod,
        idempotencyKey: vipIdempotencyKeyRef.current,
        expectedTotal: vipPackageSelection.price,
        buyerNote: buyerNote.trim() || undefined,
      });
      if (!sessionResult.ok) {
        // VIP 409 防重锁拦截：VIP 不复用 Modal — VIP 没有"续付"语义，
        // 直接 toast 提示等 5min 后端兜底超时即可
        if (sessionResult.error.businessCode === 'PENDING_CHECKOUT_EXISTS') {
          // 区分挡道的是 VIP 自己 vs 普通商品订单
          // 注：getPendingCheckout 现在只返 NORMAL_GOODS（后端 Fix 4 过滤），
          //    返 null 表示 VIP-vs-VIP 自撞，返 data 表示有普通商品在挡道
          const pending = await OrderRepo.getPendingCheckout();
          if (pending.ok && pending.data) {
            // 普通商品 session 挡道 — 提示用户先处理
            Alert.alert(
              '你有未完成的购物订单',
              '需要先完成支付或取消，才能购买 VIP',
              [
                { text: '稍后', style: 'cancel' },
                {
                  text: '去处理',
                  onPress: () => router.push({ pathname: '/checkout-pending', params: { sessionId: pending.data!.sessionId } }),
                },
              ],
            );
          } else {
            // VIP-vs-VIP 自撞（orphan VIP session 5min 内）— 提示等待
            show({ message: '支付未完成，请 5 分钟后重试', type: 'warning', duration: 4000 });
          }
          return;
        }
        show({ message: sessionResult.error.displayMessage ?? 'VIP 下单失败', type: 'error' });
        return;
      }

      const { sessionId, merchantOrderNo, paymentParams } = sessionResult.data;

      // VIP 分支复用主结算支付分流；取消支付时额外做 active-query 防止 SDK 误报
      if (paymentParams?.channel === 'alipay' && paymentParams?.orderStr) {
        const alipayResult = await payWithAlipay(paymentParams.orderStr as string);
        if (alipayResult.memo === 'NATIVE_UNAVAILABLE') {
          if (__DEV__) {
            const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
            if (!payResult.ok) {
              show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
              await OrderRepo.cancelCheckoutSession(sessionId);
              return;
            }
          } else {
            show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
            await OrderRepo.cancelCheckoutSession(sessionId);
            return;
          }
        } else if (alipayResult.resultStatus === '6001') {
          // VIP 6001 二次确认：识别"SDK 返 6001 但实际已付款"的误报场景
          // 关键：active-query 仅用来识别 COMPLETED；其他状态（中间态/query-error）一律不 cancel，
          //      让 5min 后端 cron 兜底处理。这样既识别误报又避免误删已付 session 的资金事故。
          const activeR = await OrderRepo.activeQueryPayment(sessionId);
          if (activeR.ok && activeR.data.status === 'COMPLETED') {
            // 实际已付款 — 走成功路径
            clearVipPackageSelection();
            resetCheckoutStore();
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['orders'] }),
              queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] }),   // 抵扣后钱包余额变化
              queryClient.invalidateQueries({ queryKey: ['bonus-ledger'] }),
            ]);
            show({ message: '支付成功', type: 'success' });
            router.replace('/orders');
            return;
          }
          // 未确认 COMPLETED — 不 cancel，让后端 cron 兜底
          show({ message: '已取消支付，如需重新购买请等 5 分钟', type: 'info', duration: 4000 });
          router.replace('/vip/gifts');
          return;
        } else if (alipayResult.memo === 'TIMEOUT') {
          // SDK 90s 无响应：与主结算分支一致，不 cancel session，让 active-query 兜底
          show({
            message: '支付宝未响应，请确认是否已安装支付宝并允许应用启动它，正在为你确认支付结果…',
            type: 'warning',
            duration: 4000,
          });
        }
        // 其他状态（9000/8000/6004/4000/空/TIMEOUT）→ 进 active-query
      } else if (paymentParams?.channel === 'wechat' && paymentParams?.prepayId) {
        const wechatResult = await payWithWechat({
          appId: paymentParams.appId,
          partnerId: paymentParams.partnerId,
          timestamp: paymentParams.timestamp,
          nonceStr: paymentParams.nonceStr,
          prepayId: paymentParams.prepayId,
          packageVal: paymentParams.packageVal,
          signType: paymentParams.signType,
          paySign: paymentParams.paySign,
        });
        if (wechatResult.errStr === 'NATIVE_UNAVAILABLE') {
          if (__DEV__) {
            const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
            if (!payResult.ok) {
              show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
              await OrderRepo.cancelCheckoutSession(sessionId);
              return;
            }
          } else {
            show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
            await OrderRepo.cancelCheckoutSession(sessionId);
            return;
          }
        } else if (wechatResult.resultStatus === '6001') {
          const activeR = await OrderRepo.activeQueryPayment(sessionId);
          if (activeR.ok && activeR.data.status === 'COMPLETED') {
            clearVipPackageSelection();
            resetCheckoutStore();
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['orders'] }),
              queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] }),
              queryClient.invalidateQueries({ queryKey: ['bonus-ledger'] }),
            ]);
            show({ message: '支付成功', type: 'success' });
            router.replace('/orders');
            return;
          }
          show({ message: '已取消支付，如需重新购买请等 5 分钟', type: 'info', duration: 4000 });
          router.replace('/vip/gifts');
          return;
        }
        // errCode=0 / 其他错误码 → 进 active-query
      } else if (paymentMethod === 'alipay') {
        show({ message: '支付服务暂不可用，请稍后重试或联系客服', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      } else if (paymentMethod === 'wechat') {
        show({ message: '微信支付服务暂不可用，请稍后重试或联系客服', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      } else if (__DEV__) {
        const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
        if (!payResult.ok) {
          show({ message: '模拟支付失败（Expo Go 开发环境）', type: 'error' });
          await OrderRepo.cancelCheckoutSession(sessionId);
          return;
        }
      } else {
        show({ message: '当前支付方式暂未开通，请使用支付宝', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      }

      // 进入支付确认流程（VIP 模式）
      // F4: 用后端权威 expectedTotal 而非前端 vipPackageSelection.price
      await confirmPaymentAndNavigate({
        sessionId,
        merchantOrderNo,
        amount: sessionResult.data.expectedTotal,
        isVip: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 支付方式图标
  const paymentIcons: Record<string, { name: string; color: string }> = {
    wechat: { name: 'wechat', color: '#07C160' },
    alipay: { name: 'alpha-a-circle', color: '#1677FF' },
    bankcard: { name: 'credit-card-outline', color: '#FF6B00' },
  };

  // VIP 模式下的显示金额
  const vipTotal = vipPackageSelection?.price ?? 0;
  const displayTotalText = isVipMode
    ? `¥${vipTotal.toFixed(2)}`
    : (preview ? `¥${payableAfterDeduction.toFixed(2)}` : (previewFailed ? '校验失败' : '计算中...'));
  const hasContent = isVipMode || cartItems.length > 0;

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title={isVipMode ? 'VIP 礼包结算' : '确认订单'} onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace(isVipMode ? '/vip/gifts' : '/cart');
        }
      }} />
      {!hasContent ? (
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
          <EmptyState title="暂无商品" description="购物车为空，无法结算" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: scrollBottomPad }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* 收货地址 */}
          <Animated.View entering={FadeInDown.duration(300)}>
            <Pressable
              onPress={handleAddressPress}
              style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden' }]}
            >
            {/* 顶部渐变装饰条 */}
            <LinearGradient
              colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ height: 3, position: 'absolute', top: 0, left: 0, right: 0 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                <MaterialCommunityIcons name="map-marker" size={20} color={colors.brand.primary} />
              </View>
              <View style={{ flex: 1 }}>
                {selectedAddress ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                        {selectedAddress.receiverName}
                      </Text>
                      <Text style={[typography.bodySm, { color: colors.text.secondary, marginLeft: spacing.md }]}>
                        {selectedAddress.phone}
                      </Text>
                    </View>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4, lineHeight: 18 }]}>
                      {selectedAddress.province}{selectedAddress.city}{selectedAddress.district} {selectedAddress.detail}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>
                      {isVipMode && !isLoggedIn ? '登录后填写收货地址' : '请选择收货地址'}
                    </Text>
                    {isVipMode && !isLoggedIn ? (
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4, lineHeight: 18 }]}>
                        验证手机号后将保留当前 VIP 礼包选择，继续完成结账
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.tertiary} />
            </View>
            </Pressable>
          </Animated.View>

          {/* VIP 礼包模式：专属提示条 + 商品展示 */}
          {isVipMode && vipPackageSelection && (
            <>
              {/* VIP 提示条 */}
              <Animated.View entering={FadeInDown.duration(300).delay(60)}>
                <View style={[styles.card, { backgroundColor: '#FFF8E1', borderRadius: radius.lg, borderLeftWidth: 3, borderLeftColor: '#C9A96E' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <MaterialCommunityIcons name="crown" size={18} color="#C9A96E" style={{ marginRight: 8 }} />
                    <Text style={[typography.bodySm, { color: '#8B6914', flex: 1 }]}>
                      该订单为 VIP 开通礼包，支付成功后自动开通 VIP
                    </Text>
                  </View>
                </View>
              </Animated.View>

              {/* VIP 商品卡片 */}
              <Animated.View
                entering={FadeInDown.duration(300).delay(80)}
                style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <MaterialCommunityIcons name="crown" size={18} color="#C9A96E" style={{ marginRight: 6 }} />
                  <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]}>VIP 开通礼包</Text>
                </View>
                <AiDivider />
                <View style={styles.itemRow}>
                  <GiftCoverImage
                    items={vipPackageSelection.items}
                    coverMode={(vipPackageSelection.coverMode as CoverMode) || 'AUTO_GRID'}
                    coverUrl={vipPackageSelection.coverUrl ?? null}
                    style={[styles.cover, { borderRadius: radius.md }]}
                    placeholderColor="#C9A96E"
                    placeholderBg="#FFF8E1"
                  />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                      {vipPackageSelection.title}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      VIP 专属赠品 x1
                    </Text>
                  </View>
                  <Text style={[typography.bodyStrong, { color: '#C9A96E' }]}>
                    ¥{vipTotal.toFixed(2)}
                  </Text>
                </View>
                {/* VIP 小计 */}
                <View style={[styles.merchantSubtotal, { borderTopColor: colors.divider, marginTop: 12 }]}>
                  <View style={styles.merchantSubtotalRow}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>运费</Text>
                    <Text style={[typography.caption, { color: colors.brand.primary }]}>包邮</Text>
                  </View>
                  <View style={[styles.merchantSubtotalRow, { marginTop: 4 }]}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>此订单不计入消费分润首单</Text>
                  </View>
                </View>
              </Animated.View>
            </>
          )}

          {/* N09：商品清单 — 按商户分组展示（普通模式） */}
          {!isVipMode && preview && preview.groups.length > 0 ? (
            preview.groups.map((group, gi) => (
              <Animated.View
                key={group.companyId}
                entering={FadeInDown.duration(300).delay(80 + gi * 60)}
                style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
              >
                {/* 商户头部 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <MaterialCommunityIcons name="store" size={18} color={colors.brand.primary} style={{ marginRight: 6 }} />
                  <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]}>{group.companyName}</Text>
                </View>
                <AiDivider />
                {/* 商品列表 */}
                {group.items.map((item, ii) => {
                  const cartItem = cartItems.find((candidate) => (candidate.skuId ?? candidate.productId) === item.skuId);
                  const stockText = getStockText(cartItem?.stock, lowStockThreshold);
                  return (
                    <View key={`${item.skuId}-${ii}`} style={styles.itemRow}>
                      <Image source={{ uri: item.image }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {stockText && (
                          <Text style={[typography.captionSm, { color: Number(cartItem?.stock ?? 0) <= 0 ? colors.danger : colors.warning, marginTop: 2 }]}>
                            {stockText}
                          </Text>
                        )}
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                          x{item.quantity}
                        </Text>
                      </View>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                        ¥{(item.unitPrice * item.quantity).toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
                {/* 商户小计 */}
                <View style={[styles.merchantSubtotal, { borderTopColor: colors.divider, marginTop: 12 }]}>
                  <View style={styles.merchantSubtotalRow}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>商品金额</Text>
                    <Text style={[typography.caption, { color: colors.text.primary }]}>¥{group.goodsAmount.toFixed(2)}</Text>
                  </View>
                </View>
              </Animated.View>
            ))
          ) : !isVipMode ? (
            /* 无 preview 数据时降级为原始扁平展示 */
            <Animated.View entering={FadeInDown.duration(300).delay(80)} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.sectionTitle}>
                <AiDivider style={{ flex: 1 }} />
                <Text style={[typography.captionSm, { color: colors.text.secondary, marginHorizontal: spacing.sm }]}>
                  商品清单
                </Text>
                <AiDivider style={{ flex: 1 }} />
              </View>
              {orderItems.map((item) => {
                const stockText = getStockText(item.stock, lowStockThreshold);
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <Image source={{ uri: item.image }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {stockText && (
                        <Text style={[typography.captionSm, { color: Number(item.stock ?? 0) <= 0 ? colors.danger : colors.warning, marginTop: 2 }]}>
                          {stockText}
                        </Text>
                      )}
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                        x{item.quantity}
                      </Text>
                    </View>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      ¥{(item.price * item.quantity).toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </Animated.View>
          ) : null}

          {/* 支付方式 */}
          <Animated.View entering={FadeInDown.duration(300).delay(160)} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.sectionTitle}>
              <AiDivider style={{ flex: 1 }} />
              <Text style={[typography.captionSm, { color: colors.text.secondary, marginHorizontal: spacing.sm }]}>
                支付方式
              </Text>
              <AiDivider style={{ flex: 1 }} />
            </View>
            {paymentMethods.map((method) => {
              const active = paymentMethod === method.value;
              const iconInfo = paymentIcons[method.value];
              const disabled = method.available === false;
              return (
                <Pressable
                  key={method.value}
                  onPress={() => {
                    if (disabled) {
                      // 未接入渠道：toast 提示并阻止选中（避免后端走 simulatePayment 失败）
                      show({
                        message: `${method.label}${method.comingSoon ? `（${method.comingSoon}）` : ''}暂未开通，请使用支付宝`,
                        type: 'info',
                      });
                      return;
                    }
                    setPaymentMethod(method.value);
                  }}
                  style={[
                    styles.payRow,
                    {
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.lg,
                      opacity: disabled ? 0.45 : 1,
                    },
                  ]}
                >
                  {iconInfo && (
                    <MaterialCommunityIcons
                      name={iconInfo.name as any}
                      size={24}
                      color={iconInfo.color}
                      style={{ marginRight: spacing.sm }}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{method.label}</Text>
                      {disabled && method.comingSoon && (
                        <Text style={[typography.captionSm, { color: colors.text.secondary, marginLeft: 6 }]}>
                          · {method.comingSoon}
                        </Text>
                      )}
                    </View>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                      {method.description}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: active ? colors.brand.primary : colors.border,
                        backgroundColor: active ? colors.brand.primary : 'transparent',
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </Animated.View>

          {/* 买家留言（普通 + VIP 都展示） */}
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.sectionTitle}>
              <AiDivider style={{ flex: 1 }} />
              <Text style={[typography.captionSm, { color: colors.text.secondary, marginHorizontal: spacing.sm }]}>
                买家留言（非必填，给商家的话）
              </Text>
              <AiDivider style={{ flex: 1 }} />
            </View>
            <TextInput
              value={buyerNote}
              onChangeText={(t) => setBuyerNote(t.slice(0, 200))}
              placeholder="例如：尽快发货 / 不要冰品"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={200}
              style={[
                styles.remarkInput,
                typography.bodySm,
                {
                  color: colors.text.primary,
                  backgroundColor: colors.bgSecondary,
                  borderRadius: radius.md,
                },
              ]}
            />
            <Text style={[typography.caption, { color: colors.text.tertiary, textAlign: 'right', marginTop: 4 }]}>
              {buyerNote.length}/200
            </Text>
          </View>

          {/* 红包选择（VIP 模式隐藏） */}
          {!isVipMode && (
          <Animated.View entering={FadeInDown.duration(300).delay(200)}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/checkout-coupon',
                  // N04修复：红包门槛按商品金额（不含运费），与后端 goodsAmount 一致
                  params: {
                    orderTotal: String(total),
                    categoryIds: JSON.stringify(categoryIds),
                    companyIds: JSON.stringify(companyIds),
                    currentCouponIds: parsedCouponIds.length > 0 ? JSON.stringify(parsedCouponIds) : undefined,
                  },
                })
              }
              style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center' }]}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: `${colors.danger}15`, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                <MaterialCommunityIcons name="ticket-percent-outline" size={18} color={colors.danger} />
              </View>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]}>红包</Text>
              {couponDiscount > 0 ? (
                <Text style={[typography.bodySm, { color: colors.danger, marginRight: spacing.sm }]}>
                  已选{couponCount}张，-¥{couponDiscount.toFixed(2)}
                </Text>
              ) : (
                <Text style={[typography.bodySm, { color: colors.text.secondary, marginRight: spacing.sm }]}>
                  选择红包
                </Text>
              )}
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.tertiary} />
            </Pressable>
          </Animated.View>
          )}

          {/* 消费积分抵扣（VIP 模式禁用） */}
          {!isVipMode && preview && maxDeductible > 0 ? (
            <Animated.View entering={FadeInDown.duration(300).delay(220)} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                  <MaterialCommunityIcons name="cash-multiple" size={18} color={colors.brand.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>消费积分</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                    可用 ¥{pointsBalance.toFixed(2)}，本单最多抵扣 ¥{maxDeductible.toFixed(2)}
                  </Text>
                </View>
              </View>

              <View style={[styles.deductionInputRow, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bgSecondary }]}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>¥</Text>
                <TextInput
                  value={deductionAmount}
                  onChangeText={handleDeductionChange}
                  editable={maxDeductible > 0}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  style={[styles.deductionInput, typography.bodyStrong, { color: colors.text.primary }]}
                />
                <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
                  最高{Math.round(pointsRatio * 100)}%
                </Text>
              </View>

              <View style={styles.deductionActionRow}>
                <Pressable
                  onPress={() => setDeductionAmount('')}
                  style={[styles.deductionAction, { borderColor: colors.border, borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>不使用</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDeductionAmount(formatMoneyInput(maxDeductible))}
                  disabled={maxDeductible <= 0}
                  style={[
                    styles.deductionAction,
                    {
                      borderColor: colors.brand.primary,
                      borderRadius: radius.pill,
                      backgroundColor: colors.brand.primarySoft,
                      opacity: maxDeductible > 0 ? 1 : 0.5,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.brand.primary, fontWeight: '600' }]}>抵扣最大</Text>
                </Pressable>
              </View>
            </Animated.View>
          ) : null}

          {/* 价格明细 */}
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            {isVipMode ? (
              <>
                <View style={styles.priceRow}>
                  <Text style={[typography.bodySm, { color: colors.text.secondary }]}>VIP 礼包</Text>
                  <Text style={[typography.bodySm, { color: colors.text.primary }]}>¥{vipTotal.toFixed(2)}</Text>
                </View>
                <View style={styles.priceRow}>
                  <Text style={[typography.bodySm, { color: colors.text.secondary }]}>运费</Text>
                  <Text style={[typography.bodySm, { color: colors.brand.primary }]}>包邮</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
                <View style={styles.priceRow}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>合计</Text>
                  <Text style={[typography.title2, { color: '#C9A96E' }]}>¥{vipTotal.toFixed(2)}</Text>
                </View>
                <Text style={[typography.caption, { color: colors.text.tertiary, textAlign: 'right', marginTop: 4 }]}>
                  包邮 · 支付即开通 VIP · 不支持退款
                </Text>
              </>
            ) : (
              <>
                <View style={styles.priceRow}>
                  <Text style={[typography.bodySm, { color: colors.text.secondary }]}>商品金额</Text>
                  <Text style={[typography.bodySm, { color: colors.text.primary }]}>¥{total.toFixed(2)}</Text>
                </View>
                <View style={styles.priceRow}>
                  <Text style={[typography.bodySm, { color: colors.text.secondary }]}>运费</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[typography.bodySm, { color: preview && shippingFee === 0 ? colors.brand.primary : colors.text.primary }]}>
                      {shippingFeeText}
                    </Text>
                    {preview && shippingFee > 0 && preview.summary.amountToFreeShipping != null && preview.summary.amountToFreeShipping > 0 && (
                      <Text style={[typography.caption, { color: colors.brand.primary, marginTop: 2, fontSize: 11 }]}>
                        再买¥{preview.summary.amountToFreeShipping.toFixed(2)}可免运费
                      </Text>
                    )}
                  </View>
                </View>
                {vipDiscount > 0 && (
                  <View style={styles.priceRow}>
                    <Text style={[typography.bodySm, { color: colors.text.secondary }]}>VIP折扣</Text>
                    <Text style={[typography.bodySm, { color: colors.brand.primary }]}>-¥{vipDiscount.toFixed(2)}</Text>
                  </View>
                )}
                {(serverDiscount > 0 || couponDiscount > 0) && (
                  <View style={styles.priceRow}>
                    <Text style={[typography.bodySm, { color: colors.text.secondary }]}>红包抵扣</Text>
                    <Text style={[typography.bodySm, { color: colors.danger }]}>-¥{(serverDiscount || couponDiscount).toFixed(2)}</Text>
                  </View>
                )}
                {appliedDeductionAmount > 0 && (
                  <View style={styles.priceRow}>
                    <Text style={[typography.bodySm, { color: colors.text.secondary }]}>消费积分</Text>
                    <Text style={[typography.bodySm, { color: colors.danger }]}>-¥{appliedDeductionAmount.toFixed(2)}</Text>
                  </View>
                )}
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
                <View style={styles.priceRow}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>合计</Text>
                  <Text style={[typography.title2, { color: colors.text.primary }]}>¥{payableAfterDeduction.toFixed(2)}</Text>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      )}

      {/* 底部提交栏 — 毛玻璃 */}
      {hasContent && (
        Platform.OS === 'ios' ? (
          <BlurView
            onLayout={handleBottomBarLayout}
            intensity={80}
            tint={isDark ? 'dark' : 'light'}
            style={[
              styles.bottomBar,
              compactSubmitBar && styles.bottomBarCompact,
              {
                paddingBottom: barBottomPad,
                paddingHorizontal: spacing.xl,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(6,14,6,0.6)' : 'rgba(250,252,250,0.6)' }]} />
            <View style={compactSubmitBar ? styles.bottomSummaryCompact : styles.bottomSummary}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>应付金额</Text>
              <Text
                {...priceTextProps}
                style={[typography.title3, { color: isVipMode ? '#C9A96E' : colors.text.primary }]}
              >
                {displayTotalText}
              </Text>
            </View>
            <LinearGradient
              colors={[...gradients.goldGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: radius.pill, overflow: 'hidden' }}
            >
              {isVipMode ? (
                <Pressable onPress={handleVipCheckout} disabled={submitting} style={[styles.submitButton, submitting && { opacity: 0.6 }]}>
                  <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                    {submitting ? '开通中...' : !isLoggedIn ? '登录后继续' : '✦ 开通 VIP'}
                  </Text>
                </Pressable>
              ) : (
                <Pressable onPress={handleCheckout} disabled={submitting || previewFailed || previewPending} style={[styles.submitButton, (submitting || previewFailed || previewPending) && { opacity: 0.6 }]}>
                  <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>{submitting ? '提交中...' : previewPending ? '价格校验中...' : previewFailed ? '价格校验失败' : '✦ 提交订单'}</Text>
                </Pressable>
              )}
            </LinearGradient>
          </BlurView>
        ) : (
          <View
            onLayout={handleBottomBarLayout}
            style={[
              styles.bottomBar,
              compactSubmitBar && styles.bottomBarCompact,
              {
                paddingBottom: barBottomPad,
                paddingHorizontal: spacing.xl,
                borderTopColor: colors.border,
                backgroundColor: isDark ? 'rgba(6,14,6,0.95)' : 'rgba(250,252,250,0.95)',
              },
            ]}
          >
            <View style={compactSubmitBar ? styles.bottomSummaryCompact : styles.bottomSummary}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>应付金额</Text>
              <Text
                {...priceTextProps}
                style={[typography.title3, { color: isVipMode ? '#C9A96E' : colors.text.primary }]}
              >
                {displayTotalText}
              </Text>
            </View>
            <LinearGradient
              colors={[...gradients.goldGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: radius.pill, overflow: 'hidden' }}
            >
              {isVipMode ? (
                <Pressable onPress={handleVipCheckout} disabled={submitting} style={[styles.submitButton, submitting && { opacity: 0.6 }]}>
                  <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>{submitting ? '开通中...' : '✦ 开通 VIP'}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={handleCheckout} disabled={submitting || previewFailed || previewPending} style={[styles.submitButton, (submitting || previewFailed || previewPending) && { opacity: 0.6 }]}>
                  <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>{submitting ? '提交中...' : previewPending ? '价格校验中...' : previewFailed ? '价格校验失败' : '✦ 提交订单'}</Text>
                </Pressable>
              )}
            </LinearGradient>
          </View>
        )
      )}

      {/* 退换货政策协议弹窗 */}
      <Modal
        visible={policyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPolicyModalVisible(false);
          pendingCheckoutRef.current = null;
        }}
      >
        <View style={policyStyles.overlay}>
          <View style={[policyStyles.container, { backgroundColor: colors.surface, borderRadius: radius.xl }]}>
            {/* 标题 */}
            <View style={policyStyles.header}>
              <MaterialCommunityIcons name="shield-check-outline" size={22} color={colors.brand.primary} />
              <Text style={[typography.title3, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                退换货规则
              </Text>
            </View>

            {/* 政策内容 */}
            <ScrollView style={policyStyles.content} showsVerticalScrollIndicator={false}>
              <Text style={[typography.bodySm, { color: colors.text.secondary, lineHeight: 22 }]}>
                为保障您的购物权益，请在下单前阅读以下退换货规则：
              </Text>
              <View style={{ marginTop: spacing.md }}>
                <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 22 }]}>
                  1. 普通商品自签收之日起 7 天内支持无理由退货，商品须保持完好未使用状态。
                </Text>
                <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 22, marginTop: spacing.sm }]}>
                  2. 生鲜/易腐商品签收后 24 小时内如有质量问题可申请退换。
                </Text>
                <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 22, marginTop: spacing.sm }]}>
                  3. 质量问题退换货自签收 15 天内可申请，需提供照片凭证。
                </Text>
                <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 22, marginTop: spacing.sm }]}>
                  4. VIP 礼包订单及抽奖奖品订单不支持退换货。
                </Text>
                <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 22, marginTop: spacing.sm }]}>
                  5. 退款将原路返回至支付账户，处理周期为 1-7 个工作日。
                </Text>
              </View>
            </ScrollView>

            {/* 勾选 + 按钮 */}
            <View style={{ marginTop: spacing.lg }}>
              <Pressable
                onPress={() => setPolicyChecked(!policyChecked)}
                style={policyStyles.checkRow}
              >
                <View style={[
                  policyStyles.checkbox,
                  {
                    borderColor: policyChecked ? colors.brand.primary : colors.border,
                    backgroundColor: policyChecked ? colors.brand.primary : 'transparent',
                    borderRadius: radius.sm,
                  },
                ]}>
                  {policyChecked && (
                    <MaterialCommunityIcons name="check" size={14} color={colors.text.inverse} />
                  )}
                </View>
                <Text style={[typography.bodySm, { color: colors.text.secondary, flex: 1 }]}>
                  我已阅读并同意退换货规则
                </Text>
              </Pressable>

              <Pressable
                onPress={handleAgreePolicy}
                disabled={!policyChecked || policyAgreeing}
                style={[
                  policyStyles.confirmButton,
                  {
                    backgroundColor: policyChecked ? colors.brand.primary : colors.muted,
                    borderRadius: radius.lg,
                    opacity: policyChecked && !policyAgreeing ? 1 : 0.5,
                  },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                  {policyAgreeing ? '确认中...' : '确认并继续'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setPolicyModalVisible(false);
                  pendingCheckoutRef.current = null;
                }}
                style={policyStyles.cancelButton}
              >
                <Text style={[typography.bodySm, { color: colors.text.tertiary }]}>取消</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 409 防重 Modal：展示已存在 Session 摘要 + 三按钮（取消旧 / 去支付 / 关闭） */}
      {pendingModal ? (
        <Modal transparent animationType="fade" visible>
          <Pressable
            onPress={() => {
              setPendingModal(null);
              pendingRetryRef.current = null;
            }}
            style={pendingModalStyles.backdrop}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[pendingModalStyles.card, { backgroundColor: colors.surface, borderRadius: radius.xl }]}
            >
              <View style={pendingModalStyles.header}>
                <Text style={[typography.title3, { color: colors.text.primary }]}>你有一个未完成的订单</Text>
                <Countdown
                  expiresAt={pendingModal.expiresAt}
                  style={[typography.caption, { color: '#FF6B35', fontWeight: '600' }]}
                />
              </View>

              <ScrollView style={{ maxHeight: 280 }}>
                {pendingModal.items.map((it, i) => (
                  <OrderItemRow
                    key={i}
                    image={it.image}
                    title={it.title}
                    skuTitle={it.skuTitle}
                    unitPrice={it.unitPrice}
                    quantity={it.quantity}
                  />
                ))}
              </ScrollView>

              <View style={[pendingModalStyles.totalRow, { borderTopColor: colors.border }]}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>共 {pendingModal.itemCount} 件</Text>
                <Text style={[typography.bodyStrong, { color: '#FF6B35' }]}>实付 ¥{pendingModal.expectedTotal.toFixed(2)}</Text>
              </View>

              <Pressable
                onPress={async () => {
                  const oldSessionId = pendingModal.sessionId;
                  const retry = pendingRetryRef.current;
                  const c = await OrderRepo.cancelCheckoutSession(oldSessionId);
                  if (!c.ok) {
                    // cancelSession 可能在取消时发现已支付并主动建单（返"支付已完成，订单已自动创建…"）
                    // 透后端真实 message，并刷新订单列表 + 跳过去
                    const errMsg = c.error.displayMessage ?? '取消旧订单失败';
                    show({ message: errMsg, type: 'error', duration: 4000 });
                    // 如果是"已自动建单"场景，刷新缓存并跳订单列表
                    if (errMsg.includes('已自动创建') || errMsg.includes('支付已完成')) {
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['orders'] }),
                        queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
                        queryClient.invalidateQueries({ queryKey: ['pending-checkout'] }),
                      ]);
                      setPendingModal(null);
                      pendingRetryRef.current = null;
                      router.replace('/orders');
                    }
                    return;
                  }
                  setPendingModal(null);
                  pendingRetryRef.current = null;
                  // 重试当前提交订单流程（普通走 handleCheckout，VIP 走 handleVipCheckout）
                  if (retry) await retry();
                }}
                style={[pendingModalStyles.btnPrimary, { backgroundColor: colors.brand.primary }]}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>取消旧订单，重新下这单</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  const sessionId = pendingModal.sessionId;
                  setPendingModal(null);
                  pendingRetryRef.current = null;
                  router.push({ pathname: '/checkout-pending', params: { sessionId } });
                }}
                style={[pendingModalStyles.btnSecondary, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text.secondary }}>先去支付这单</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setPendingModal(null);
                  pendingRetryRef.current = null;
                }}
                style={pendingModalStyles.btnText}
              >
                <Text style={{ color: colors.text.tertiary }}>关闭</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleVipAuthSuccess}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  cover: {
    width: 56,
    height: 56,
  },
  payRow: {
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  remarkInput: {
    padding: 12,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  deductionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deductionInput: {
    flex: 1,
    marginLeft: 6,
    paddingVertical: 0,
  },
  deductionActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  deductionAction: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 8,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  divider: {
    height: 1,
    marginVertical: 10,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
  },
  bottomBarCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  bottomSummary: {
    flex: 1,
  },
  bottomSummaryCompact: {
    width: '100%',
  },
  submitButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchantSubtotal: {
    borderTopWidth: 1,
    paddingTop: 10,
  },
  merchantSubtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
});

// 退换货政策弹窗样式
const policyStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  container: {
    width: '100%',
    maxHeight: '75%',
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  content: {
    maxHeight: 260,
    marginBottom: 4,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  confirmButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButton: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
});

// 409 防重弹窗样式（与退换货政策弹窗复用同款半透明遮罩）
const pendingModalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  card: { width: '100%', padding: 16, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 8, marginTop: 4 },
  btnPrimary: { padding: 12, borderRadius: 18, alignItems: 'center', marginTop: 12 },
  btnSecondary: { padding: 12, borderRadius: 18, alignItems: 'center', borderWidth: 1, marginTop: 8 },
  btnText: { padding: 8, alignItems: 'center', marginTop: 4 },
});
