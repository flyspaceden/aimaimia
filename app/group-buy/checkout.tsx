import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import { GROUP_BUY_COLORS } from '../../src/components/group-buy';
import { paymentMethods } from '../../src/constants/payment';
import { AddressRepo, GroupBuyRepo, OrderRepo } from '../../src/repos';
import { useAuthStore, useCheckoutStore } from '../../src/store';
import { useMeasuredBottomBar } from '../../src/hooks/useMeasuredBottomBar';
import { useConfirmPayment } from '../../src/hooks/useConfirmPayment';
import { compactActionTextProps, fitTextProps, priceTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../src/theme';
import { payWithAlipay } from '../../src/utils/alipay';
import { hasCompleteWechatPayPayload, payWithWechat } from '../../src/utils/wechat-pay';
import type { GroupBuyActivity, PaymentMethod } from '../../src/types';

const formatPrice = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

const getActivityItems = (activity: GroupBuyActivity) => (
  activity.items && activity.items.length > 0
    ? activity.items
    : [{
        productId: activity.product.id,
        productTitle: activity.product.title,
        imageUrl: activity.product.imageUrl,
        skuId: activity.sku.id,
        skuTitle: activity.sku.title,
        stock: activity.sku.stock,
        weightGram: activity.sku.weightGram,
        quantity: 1,
      }]
);

const createIdempotencyKey = () => `gb-app-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function GroupBuyCheckoutScreen() {
  const { activityId: rawActivityId, shareCode: rawShareCode } = useLocalSearchParams<{
    activityId: string;
    shareCode?: string;
  }>();
  const activityId = Array.isArray(rawActivityId) ? rawActivityId[0] : rawActivityId;
  const shareCode = Array.isArray(rawShareCode) ? rawShareCode[0] : rawShareCode;
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirmPayment = useConfirmPayment();
  const { show } = useToast();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { isCompact, isLargeText } = useResponsiveLayout();
  const bottomInset = useBottomInset(spacing.md);
  const { bottomPadding, onBarLayout } = useMeasuredBottomBar(isCompact || isLargeText ? 150 : 112, spacing.xl);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const selectedAddressId = useCheckoutStore((state) => state.selectedAddressId);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    () => paymentMethods.find((method) => method.available)?.value ?? 'alipay',
  );
  const idempotencyKeyRef = useRef(createIdempotencyKey());

  const activityQuery = useQuery({
    queryKey: ['group-buy-activity', activityId],
    queryFn: () => GroupBuyRepo.getActivity(String(activityId)),
    enabled: Boolean(activityId),
  });

  const addressesQuery = useQuery({
    queryKey: ['addresses'],
    queryFn: () => AddressRepo.list(),
    enabled: isLoggedIn,
  });

  const currentQuery = useQuery({
    queryKey: ['group-buy-current'],
    queryFn: () => GroupBuyRepo.getCurrent(),
    enabled: isLoggedIn,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: true,
  });

  const landingQuery = useQuery({
    queryKey: ['group-buy-landing', shareCode],
    queryFn: () => GroupBuyRepo.getLanding(String(shareCode)),
    enabled: Boolean(shareCode),
  });

  const activity = activityQuery.data?.ok ? activityQuery.data.data : null;
  const addresses = addressesQuery.data?.ok ? addressesQuery.data.data : [];
  const selectedAddress = selectedAddressId
    ? addresses.find((address) => address.id === selectedAddressId)
    : addresses.find((address) => address.isDefault) ?? addresses[0];
  const currentState = currentQuery.data?.ok ? currentQuery.data.data : null;
  const landing = landingQuery.data?.ok ? landingQuery.data.data : null;
  const occupiesSlot = Boolean(currentState?.occupiesSlot);

  const previewQuery = useQuery({
    queryKey: ['group-buy-checkout-preview', activity?.id, selectedAddress?.id, shareCode],
    queryFn: () => GroupBuyRepo.previewCheckout({
      activityId: String(activity?.id),
      addressId: String(selectedAddress?.id),
      paymentChannel: paymentMethod,
      shareCode,
    }),
    enabled: Boolean(isLoggedIn && activity?.id && selectedAddress?.id && !occupiesSlot),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const preview = previewQuery.data?.ok ? previewQuery.data.data : null;
  const previewError = previewQuery.data && !previewQuery.data.ok
    ? previewQuery.data.error.displayMessage ?? '金额计算失败，请刷新后重试'
    : null;
  const displayedShippingText = activity?.freeShipping
    ? '包邮'
    : preview
      ? formatPrice(preview.shippingFee)
      : selectedAddress
        ? '计算中'
        : '选择地址后计算';
  const displayedTotalText = preview
    ? formatPrice(preview.expectedTotal)
    : activity?.freeShipping
      ? formatPrice(activity.price)
      : '待计算';

  const paymentMethodMeta = useMemo(
    () => paymentMethods.find((method) => method.value === paymentMethod) ?? paymentMethods[0],
    [paymentMethod],
  );

  const refreshGroupBuyCurrent = async () => {
    await queryClient.invalidateQueries({ queryKey: ['group-buy-current'] });
    const latest = await GroupBuyRepo.getCurrent();
    queryClient.setQueryData(['group-buy-current'], latest);
    return latest;
  };

  const handleCreateCheckout = async (target: GroupBuyActivity) => {
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      return;
    }
    if (occupiesSlot) {
      show({ message: '需要先结束当前团购，再购买新的团购商品', type: 'warning' });
      router.replace('/group-buy');
      return;
    }
    if ((target.availableStock ?? target.sku.stock) <= 0) {
      show({ message: '该团购商品暂无库存', type: 'info' });
      return;
    }
    if (!selectedAddress) {
      show({ message: '请先选择收货地址', type: 'warning' });
      router.push('/checkout-address');
      return;
    }
    if (!paymentMethodMeta?.available) {
      show({ message: paymentMethodMeta?.comingSoon ?? '该支付方式暂不可用', type: 'info' });
      return;
    }
    if (submitting) return;

    setSubmitting(true);
    try {
      const previewResult = await GroupBuyRepo.previewCheckout({
        activityId: target.id,
        addressId: selectedAddress.id,
        paymentChannel: paymentMethod,
        shareCode,
      });

      if (!previewResult.ok) {
        show({ message: previewResult.error.displayMessage ?? '金额计算失败，请刷新后重试', type: 'error' });
        return;
      }

      const sessionResult = await GroupBuyRepo.createCheckout({
        activityId: target.id,
        addressId: selectedAddress.id,
        paymentChannel: paymentMethod,
        expectedTotal: previewResult.data.expectedTotal,
        shareCode,
        idempotencyKey: idempotencyKeyRef.current,
      });

      if (!sessionResult.ok) {
        show({ message: sessionResult.error.displayMessage ?? '下单失败', type: 'error' });
        return;
      }

      const { sessionId, merchantOrderNo, paymentParams } = sessionResult.data;

      if (paymentParams?.channel === 'alipay' && paymentParams.orderStr) {
        const alipayResult = await payWithAlipay(paymentParams.orderStr);
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
          const activeR = await OrderRepo.activeQueryPayment(sessionId);
          if (activeR.ok && activeR.data.status === 'COMPLETED') {
            await refreshGroupBuyCurrent();
            await confirmPayment({
              sessionId,
              sdkResultStatus: '9000',
              onSuccess: async () => {
                await refreshGroupBuyCurrent();
                router.replace('/orders');
              },
            });
            return;
          }
          show({ message: '已取消支付，如需重新购买请稍后再试', type: 'info', duration: 4000 });
          router.replace({ pathname: '/group-buy/[activityId]', params: { activityId: target.id } });
          return;
        } else if (alipayResult.memo === 'TIMEOUT') {
          show({
            message: '支付宝未响应，正在为你确认支付结果…',
            type: 'warning',
            duration: 4000,
          });
        }
      } else if (paymentParams?.channel === 'wechat' && hasCompleteWechatPayPayload(paymentParams as any)) {
        const wechatResult = await payWithWechat(paymentParams as any);
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
            await refreshGroupBuyCurrent();
            await confirmPayment({
              sessionId,
              sdkResultStatus: '9000',
              onSuccess: async () => {
                await refreshGroupBuyCurrent();
                router.replace('/orders');
              },
            });
            return;
          }
          show({ message: '已取消支付，如需重新购买请稍后再试', type: 'info', duration: 4000 });
          router.replace({ pathname: '/group-buy/[activityId]', params: { activityId: target.id } });
          return;
        } else if (wechatResult.errStr === 'WECHAT_NOT_INSTALLED') {
          show({ message: '请先安装微信 App 后再使用微信支付', type: 'error' });
          router.replace({ pathname: '/group-buy/[activityId]', params: { activityId: target.id } });
          return;
        }
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

      const confirmResult = await confirmPayment({
        sessionId,
        sdkResultStatus: '9000',
        onSuccess: async () => {
          await refreshGroupBuyCurrent();
          router.replace('/orders');
        },
      });
      if (confirmResult.outcome === 'pending-confirm') {
        await refreshGroupBuyCurrent();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading =
    activityQuery.isLoading ||
    (isLoggedIn && (addressesQuery.isLoading || currentQuery.isLoading)) ||
    (Boolean(shareCode) && landingQuery.isLoading);

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购付款" />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton height={160} radius={8} />
          <Skeleton height={120} radius={8} />
          <Skeleton height={180} radius={8} />
        </ScrollView>
      </Screen>
    );
  }

  if (!activityQuery.data || !activityQuery.data.ok || !activity) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购付款" />
        <ErrorState
          title="团购商品加载失败"
          description={activityQuery.data?.ok === false ? activityQuery.data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={() => activityQuery.refetch()}
        />
      </Screen>
    );
  }

  if (isLoggedIn && currentQuery.data && !currentQuery.data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购付款" />
        <ErrorState
          title="团购状态加载失败"
          description={currentQuery.data.error.displayMessage ?? '请刷新后重试'}
          actionLabel="重新加载"
          onAction={() => currentQuery.refetch()}
        />
      </Screen>
    );
  }

  if (shareCode && landingQuery.data && !landingQuery.data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购付款" />
        <ErrorState
          title="推荐码不可用"
          description={landingQuery.data.error.displayMessage ?? '请返回团购页重新选择商品'}
          actionLabel="查看团购商品"
          onAction={() => router.replace('/group-buy')}
        />
      </Screen>
    );
  }

  if (shareCode && landing && !landing.valid) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团购付款" />
        <ErrorState
          title="推荐码不可用"
          description={landing.reason ?? '该团购推荐码已失效'}
          actionLabel="查看团购商品"
          onAction={() => router.replace('/group-buy')}
        />
      </Screen>
    );
  }

  const activityItems = getActivityItems(activity);
  const itemSummary = activity.itemSummary || `${activity.product.title} · ${activity.sku.title}`;

  return (
    <Screen contentStyle={{ flex: 1 }} statusBarStyle="dark">
      <AppHeader title="团购付款" subtitle="现金购买指定商品" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomPadding, gap: spacing.lg }}
      >
        <View style={[styles.productCard, shadow.sm, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.productImage, { borderRadius: 8, backgroundColor: GROUP_BUY_COLORS.mist }]}>
            {activity.product.imageUrl ? (
              <Image source={{ uri: activity.product.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <MaterialCommunityIcons name="shopping-outline" size={34} color={GROUP_BUY_COLORS.tide} />
            )}
          </View>
          <View style={styles.productInfo}>
            <Text {...fitTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
              {activity.title}
            </Text>
            <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary, marginTop: 3 }]}>
              {itemSummary}
            </Text>
            <View style={styles.itemList}>
              {activityItems.map((item) => (
                <Text
                  key={`${item.productId}-${item.skuId}`}
                  numberOfLines={1}
                  style={[typography.caption, { color: colors.text.secondary }]}
                >
                  {item.productTitle} x{item.quantity} · {item.skuTitle}
                </Text>
              ))}
            </View>
            <Text {...priceTextProps} style={[typography.headingMd, { color: GROUP_BUY_COLORS.coral, marginTop: 8, fontWeight: '800' }]}>
              {formatPrice(activity.price)}
            </Text>
          </View>
        </View>

        {shareCode && landing?.inviter ? (
          <View style={[styles.inviterBox, { borderRadius: 8, backgroundColor: '#FFF7DF', borderColor: `${GROUP_BUY_COLORS.brass}55` }]}>
            <MaterialCommunityIcons name="account-check-outline" size={20} color={GROUP_BUY_COLORS.brass} />
            <View style={styles.inviterContent}>
              <Text {...fitTextProps} style={[typography.bodyStrong, { color: GROUP_BUY_COLORS.pine }]}>
                来自分享用户
              </Text>
              <Text style={[typography.caption, { color: GROUP_BUY_COLORS.inkSoft, marginTop: 2 }]}>
                {landing.inviter.nickname || landing.inviter.buyerNo || '分享用户'} 邀请你购买同款商品，你正常享受商品服务。
              </Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.section, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={20} color={GROUP_BUY_COLORS.tide} />
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 7 }]}>
              收货地址
            </Text>
          </View>
          {!isLoggedIn ? (
            <EmptyState
              title="登录后选择地址"
              description="团购商品需要确认收货地址后付款"
              actionLabel="登录"
              onAction={() => setAuthModalOpen(true)}
            />
          ) : selectedAddress ? (
            <Pressable
              onPress={() => router.push('/checkout-address')}
              style={[styles.addressBox, { borderColor: GROUP_BUY_COLORS.mist, backgroundColor: GROUP_BUY_COLORS.porcelain }]}
            >
              <View style={styles.addressCopy}>
                <Text {...fitTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  {selectedAddress.receiverName} {selectedAddress.phone}
                </Text>
                <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: 4 }]}>
                  {selectedAddress.province}{selectedAddress.city}{selectedAddress.district}{selectedAddress.detail}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.tertiary} />
            </Pressable>
          ) : (
            <EmptyState
              title="暂无收货地址"
              description="请先添加地址后再付款"
              actionLabel="添加地址"
              onAction={() => router.push({ pathname: '/me/addresses', params: { openNew: '1' } })}
            />
          )}
        </View>

        <View style={[styles.section, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <MaterialCommunityIcons name="credit-card-outline" size={20} color={GROUP_BUY_COLORS.tide} />
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 7 }]}>
              支付方式
            </Text>
          </View>
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {paymentMethods.map((method) => {
              const active = paymentMethod === method.value;
              return (
                <Pressable
                  key={method.value}
                  onPress={() => {
                    if (!method.available) {
                      show({ message: method.comingSoon ?? '该支付方式暂不可用', type: 'info' });
                      return;
                    }
                    setPaymentMethod(method.value);
                  }}
                  style={[
                    styles.paymentRow,
                    {
                      borderRadius: 8,
                      borderColor: active ? GROUP_BUY_COLORS.tide : colors.border,
                      backgroundColor: active ? GROUP_BUY_COLORS.porcelain : colors.surface,
                      opacity: method.available ? 1 : 0.58,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={method.value === 'wechat' ? 'wechat' : method.value === 'alipay' ? 'alpha-a-circle' : 'credit-card-outline'}
                    size={22}
                    color={method.value === 'wechat' ? '#07C160' : method.value === 'alipay' ? '#1677FF' : colors.muted}
                  />
                  <View style={styles.paymentText}>
                    <Text {...fitTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      {method.label}
                    </Text>
                    {method.description || method.comingSoon ? (
                      <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                        {method.available ? method.description : method.comingSoon}
                      </Text>
                    ) : null}
                  </View>
                  <MaterialCommunityIcons
                    name={active ? 'radiobox-marked' : 'radiobox-blank'}
                    size={20}
                    color={active ? GROUP_BUY_COLORS.tide : colors.muted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.section, { borderRadius: 8, backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.amountLine}>
            <Text style={[typography.bodySm, { color: colors.text.secondary }]}>商品金额</Text>
            <Text {...priceTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
              {formatPrice(activity.price)}
            </Text>
          </View>
          <View style={[styles.amountLine, { marginTop: spacing.sm }]}>
            <Text style={[typography.bodySm, { color: colors.text.secondary }]}>运费</Text>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
              {displayedShippingText}
            </Text>
          </View>
          {previewError ? (
            <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
              {previewError}
            </Text>
          ) : null}
          <View style={[styles.amountLine, { marginTop: spacing.sm }]}>
            <Text style={[typography.bodySm, { color: colors.text.secondary }]}>活动优惠</Text>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>不可叠加</Text>
          </View>
          <View style={[styles.amountDivider, { backgroundColor: colors.border }]} />
          <View style={styles.amountLine}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>应付金额</Text>
            <Text {...priceTextProps} style={[typography.headingMd, { color: GROUP_BUY_COLORS.coral, fontWeight: '800' }]}>
              {displayedTotalText}
            </Text>
          </View>
          <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: spacing.sm }]}>
            团购商品仅支持现金支付，不可使用消费积分、平台红包或团购返还余额抵扣。
          </Text>
          <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: spacing.xs }]}>
            支付成功后立即生成团购推荐码；商品不支持退换货，收货后24小时内质量问题可联系客服补发。
          </Text>
          <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: spacing.xs }]}>
            VIP用户购买团购后会累计消费资产，普通用户不累计消费资产。
          </Text>
        </View>
      </ScrollView>

      <LinearGradient
        colors={['rgba(255,255,255,0.96)', 'rgba(247,250,247,0.96)']}
        style={[styles.bottomBar, shadow.lg, { paddingBottom: bottomInset, borderTopColor: colors.border }]}
        onLayout={onBarLayout}
      >
        <View style={styles.bottomPrice}>
          <Text {...priceTextProps} style={[typography.headingMd, { color: GROUP_BUY_COLORS.coral, fontWeight: '800' }]}>
            {displayedTotalText}
          </Text>
          <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
            现金支付
          </Text>
        </View>
        <Pressable
          onPress={() => handleCreateCheckout(activity)}
          disabled={submitting || (Boolean(selectedAddress) && previewQuery.isLoading)}
          style={[styles.payButton, { borderRadius: radius.pill, backgroundColor: GROUP_BUY_COLORS.pine }]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: '#FFFFFF' }]}>
              {previewQuery.isLoading ? '计算中' : '确认付款'}
            </Text>
          )}
        </Pressable>
      </LinearGradient>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['addresses'] }),
            queryClient.invalidateQueries({ queryKey: ['group-buy-current'] }),
          ]);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  productCard: {
    borderWidth: 1,
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  productImage: {
    width: 92,
    height: 92,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  itemList: {
    marginTop: 7,
    gap: 2,
  },
  inviterBox: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 13,
    gap: 9,
  },
  inviterContent: {
    flex: 1,
    minWidth: 0,
  },
  section: {
    borderWidth: 1,
    padding: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addressBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 13,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addressCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentRow: {
    borderWidth: 1,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 10,
  },
  paymentText: {
    flex: 1,
    minWidth: 0,
  },
  amountLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  amountDivider: {
    height: 1,
    marginVertical: 13,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bottomPrice: {
    flex: 1,
    minWidth: 0,
  },
  payButton: {
    minWidth: 142,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
});
