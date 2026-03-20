import React, { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, Screen } from '../src/components/layout';
import { AuthModal } from '../src/components/overlay';
import { EmptyState, useToast } from '../src/components/feedback';
import { AiDivider } from '../src/components/ui/AiDivider';
import { paymentMethods } from '../src/constants';
import { AddressRepo, BonusRepo, OrderRepo } from '../src/repos';
import { useAuthStore, useCartStore, useCheckoutStore } from '../src/store';
import { useTheme } from '../src/theme';
import { AuthSession, PaymentMethod } from '../src/types';
import type { VipPackageSelection } from '../src/store/useCheckoutStore';

export default function CheckoutScreen() {
  const { colors, radius, shadow, spacing, typography, gradients, isDark } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
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
    () => allItems.filter((item) => {
      const key = item.skuId ? `${item.productId}:${item.skuId}` : item.productId;
      return selectedIds.has(key);
    }),
    [allItems, selectedIds]
  );
  const [refreshing, setRefreshing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wechat');
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // B05修复：生成幂等键，防止网络重试导致重复订单（每次进入结算页生成一次）
  const idempotencyKeyRef = useRef(`ik_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

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

  const previewSignature = cartItems.map((i) => `${i.skuId || i.productId}:${i.quantity}`).join(',');
  const previewErrorToastKeyRef = useRef<string>('');

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

  // N09修复：优先使用服务端返回值，fallback 到本地计算
  const total = preview?.summary.totalGoodsAmount ?? localGoodsTotal;
  const shippingFee = preview?.summary.totalShippingFee ?? (localGoodsTotal >= 99 ? 0 : 8);
  const serverDiscount = preview?.summary.totalDiscount ?? 0;
  const vipDiscount = preview?.summary.vipDiscount ?? 0;
  const finalTotal = preview
    ? Number(preview.summary.totalPayable.toFixed(2))
    : Number(Math.max(0, localGoodsTotal + shippingFee - couponDiscount).toFixed(2));

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

  const handleCheckout = async () => {
    if (previewPending) {
      show({ message: '价格校验中，请稍候再提交', type: 'warning' });
      return;
    }
    if (!selectedAddress) {
      show({ message: '请先选择收货地址', type: 'warning' });
      return;
    }
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
        idempotencyKey: idempotencyKeyRef.current,
        expectedTotal: preview ? preview.summary.totalPayable : undefined,
      });
      if (!sessionResult.ok) {
        show({ message: sessionResult.error.displayMessage ?? '下单失败', type: 'error' });
        return;
      }

      const { sessionId, merchantOrderNo } = sessionResult.data;

      // 开发环境：模拟支付回调触发后端完成支付
      const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
      if (!payResult.ok) {
        show({ message: '支付触发失败，请稍后重试', type: 'error' });
        // 取消会话释放红包
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      }

      // 轮询会话状态，等待后端处理完成
      const MAX_POLLS = 30;
      const POLL_INTERVAL = 2000;
      let completed = false;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const statusResult = await OrderRepo.getCheckoutSessionStatus(sessionId);
        if (!statusResult.ok) continue;

        const { status } = statusResult.data;
        if (status === 'COMPLETED') {
          completed = true;
          break;
        }
        if (status === 'EXPIRED' || status === 'FAILED') {
          show({ message: status === 'EXPIRED' ? '支付超时，请重试' : '支付失败', type: 'error' });
          return;
        }
      }

      if (!completed) {
        show({ message: '支付处理超时，请在订单列表中查看状态', type: 'warning' });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
      await queryClient.invalidateQueries({ queryKey: ['me-order-issue'] });
      // 仅清除已结算的购物车项
      clearCheckedItems();
      resetCheckoutStore();
      show({ message: '支付成功，订单已生成', type: 'success' });
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
    if (submitting) return;
    setSubmitting(true);
    try {
      const sessionResult = await OrderRepo.createVipCheckoutSession({
        giftOptionId: vipPackageSelection.giftOptionId,
        addressId: selectedAddress.id,
        paymentChannel: paymentMethod,
        idempotencyKey: idempotencyKeyRef.current,
        expectedTotal: vipPackageSelection.price,
      });
      if (!sessionResult.ok) {
        show({ message: sessionResult.error.displayMessage ?? 'VIP 下单失败', type: 'error' });
        return;
      }

      const { sessionId, merchantOrderNo } = sessionResult.data;

      // 模拟支付
      const payResult = await OrderRepo.simulatePayment(merchantOrderNo);
      if (!payResult.ok) {
        show({ message: '支付触发失败，请稍后重试', type: 'error' });
        await OrderRepo.cancelCheckoutSession(sessionId);
        return;
      }

      // 轮询会话状态
      const MAX_POLLS = 30;
      const POLL_INTERVAL = 2000;
      let completed = false;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const statusResult = await OrderRepo.getCheckoutSessionStatus(sessionId);
        if (!statusResult.ok) continue;
        const { status } = statusResult.data;
        if (status === 'COMPLETED') {
          completed = true;
          break;
        }
        if (status === 'EXPIRED' || status === 'FAILED') {
          show({ message: status === 'EXPIRED' ? '支付超时，请重试' : '支付失败', type: 'error' });
          return;
        }
      }

      if (!completed) {
        show({ message: '支付处理超时，请在订单列表中查看状态', type: 'warning' });
        return;
      }

      // VIP 成功：刷新会员状态和订单
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
        queryClient.invalidateQueries({ queryKey: ['bonus-member'] }),
      ]);
      clearVipPackageSelection();
      resetCheckoutStore();
      show({ message: 'VIP 开通成功！赠品订单已生成', type: 'success' });
      // 跳转到 VIP 成功页或 VIP 页面
      router.replace('/me/vip');
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
  const displayTotal = isVipMode ? vipTotal : finalTotal;
  const hasContent = isVipMode || cartItems.length > 0;

  return (
    <Screen contentStyle={{ flex: 1 }}>
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
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
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
                  {vipPackageSelection.coverUrl ? (
                    <Image source={{ uri: vipPackageSelection.coverUrl }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />
                  ) : (
                    <View style={[styles.cover, { borderRadius: radius.md, backgroundColor: '#FFF8E1', alignItems: 'center', justifyContent: 'center' }]}>
                      <MaterialCommunityIcons name="gift" size={28} color="#C9A96E" />
                    </View>
                  )}
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
                {group.items.map((item, ii) => (
                  <View key={`${item.skuId}-${ii}`} style={styles.itemRow}>
                    <Image source={{ uri: item.image }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                        x{item.quantity}
                      </Text>
                    </View>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      ¥{(item.unitPrice * item.quantity).toFixed(2)}
                    </Text>
                  </View>
                ))}
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
              {orderItems.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Image source={{ uri: item.image }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      x{item.quantity}
                    </Text>
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                    ¥{(item.price * item.quantity).toFixed(2)}
                  </Text>
                </View>
              ))}
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
              return (
                <Pressable
                  key={method.value}
                  onPress={() => setPaymentMethod(method.value)}
                  style={[
                    styles.payRow,
                    {
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.lg,
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
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{method.label}</Text>
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

          {/* 订单备注（VIP 模式隐藏） */}
          {!isVipMode && (
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.sectionTitle}>
              <AiDivider style={{ flex: 1 }} />
              <Text style={[typography.captionSm, { color: colors.text.secondary, marginHorizontal: spacing.sm }]}>
                订单备注
              </Text>
              <AiDivider style={{ flex: 1 }} />
            </View>
            <TextInput
              value={remark}
              onChangeText={setRemark}
              placeholder="选填：可备注特殊要求"
              placeholderTextColor={colors.muted}
              multiline
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
          </View>
          )}

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
                    <Text style={[typography.bodySm, { color: shippingFee === 0 ? colors.brand.primary : colors.text.primary }]}>
                      {shippingFee === 0 ? '免运费' : `¥${shippingFee.toFixed(2)}`}
                    </Text>
                    {shippingFee > 0 && preview?.summary.amountToFreeShipping != null && preview.summary.amountToFreeShipping > 0 && (
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
                <View style={[styles.divider, { backgroundColor: colors.divider }]} />
                <View style={styles.priceRow}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>合计</Text>
                  <Text style={[typography.title2, { color: colors.text.primary }]}>¥{finalTotal.toFixed(2)}</Text>
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
            intensity={80}
            tint={isDark ? 'dark' : 'light'}
            style={[
              styles.bottomBar,
              {
                paddingBottom: insets.bottom + spacing.sm,
                paddingHorizontal: spacing.xl,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(6,14,6,0.6)' : 'rgba(250,252,250,0.6)' }]} />
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>应付金额</Text>
              <Text style={[typography.title3, { color: isVipMode ? '#C9A96E' : colors.text.primary }]}>¥{displayTotal.toFixed(2)}</Text>
            </View>
            <LinearGradient
              colors={[...gradients.goldGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: radius.pill, overflow: 'hidden' }}
            >
              {isVipMode ? (
                <Pressable onPress={handleVipCheckout} disabled={submitting} style={[styles.submitButton, submitting && { opacity: 0.6 }]}>
                  <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                    {submitting ? '开通中...' : !isLoggedIn ? '登录后继续' : '✦ 开通 VIP'}
                  </Text>
                </Pressable>
              ) : (
                <Pressable onPress={handleCheckout} disabled={submitting || previewFailed || previewPending} style={[styles.submitButton, (submitting || previewFailed || previewPending) && { opacity: 0.6 }]}>
                  <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>{submitting ? '提交中...' : previewPending ? '价格校验中...' : previewFailed ? '价格校验失败' : '✦ 提交订单'}</Text>
                </Pressable>
              )}
            </LinearGradient>
          </BlurView>
        ) : (
          <View
            style={[
              styles.bottomBar,
              {
                paddingBottom: insets.bottom + spacing.sm,
                paddingHorizontal: spacing.xl,
                borderTopColor: colors.border,
                backgroundColor: isDark ? 'rgba(6,14,6,0.95)' : 'rgba(250,252,250,0.95)',
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>应付金额</Text>
              <Text style={[typography.title3, { color: isVipMode ? '#C9A96E' : colors.text.primary }]}>¥{displayTotal.toFixed(2)}</Text>
            </View>
            <LinearGradient
              colors={[...gradients.goldGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: radius.pill, overflow: 'hidden' }}
            >
              {isVipMode ? (
                <Pressable onPress={handleVipCheckout} disabled={submitting} style={[styles.submitButton, submitting && { opacity: 0.6 }]}>
                  <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>{submitting ? '开通中...' : '✦ 开通 VIP'}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={handleCheckout} disabled={submitting || previewFailed || previewPending} style={[styles.submitButton, (submitting || previewFailed || previewPending) && { opacity: 0.6 }]}>
                  <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>{submitting ? '提交中...' : previewPending ? '价格校验中...' : previewFailed ? '价格校验失败' : '✦ 提交订单'}</Text>
                </Pressable>
              )}
            </LinearGradient>
          </View>
        )
      )}

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
  submitButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
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
