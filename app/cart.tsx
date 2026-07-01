import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppHeader, Screen } from '../src/components/layout';
import { useToast } from '../src/components/feedback';
import { QuantityStepper } from '../src/components/inputs';
import { Price } from '../src/components/ui/Price';
import { AiBadge } from '../src/components/ui/AiBadge';
import { AiOrb } from '../src/components/effects/AiOrb';
import { ProductCard } from '../src/components/cards/ProductCard';
import { RecommendRepo } from '../src/repos';
import { AppConfigRepo } from '../src/repos/AppConfigRepo';
import { useAuthStore, useCartStore, useCheckoutStore } from '../src/store';
import { isSelectableCartItem } from '../src/store/useCartStore';
import { AuthModal } from '../src/components/overlay';
import { PendingCheckoutBanner } from '../src/components/overlay/PendingCheckoutBanner';
import { BundleSummary } from '../src/components/orders/BundleSummary';
import { compactActionTextProps, priceTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../src/theme';
import { useMeasuredBottomBar } from '../src/hooks/useMeasuredBottomBar';
import { getPrizeMergeNotice } from '../src/utils/cartMerge';
import { getStockText } from '../src/utils/stockDisplay';

// RECOMMEND_CARD_WIDTH 不依赖屏幕宽度（固定 140pt），保留在模块顶层
// SCREEN_WIDTH 已删除：原本声明但未使用，且模块顶层 Dimensions.get 违反响应式规范
const RECOMMEND_CARD_WIDTH = 140;

/** 倒计时 hook */
function useCountdown(expiresAt?: string) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('已过期');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return remaining;
}

/** 过期倒计时小组件 */
function ExpiryCountdown({ expiresAt, colors, typography }: { expiresAt: string; colors: any; typography: any }) {
  const remaining = useCountdown(expiresAt);
  if (!remaining) return null;
  const isExpired = remaining === '已过期';
  return (
    <Text style={[typography.captionSm, { color: isExpired ? colors.danger : colors.text.secondary, marginTop: 2 }]}>
      {isExpired ? '已过期' : `剩余 ${remaining}`}
    </Text>
  );
}

function unavailableText(reason?: string | null) {
  switch (reason) {
    case 'SKU_INACTIVE':
      return '规格已下架';
    case 'PRODUCT_INACTIVE':
      return '商品已下架';
    case 'PRIZE_INACTIVE':
      return '奖品已停发';
    case 'SKU_MISSING':
      return '规格不存在';
    case 'PRODUCT_MISSING':
      return '商品不存在';
    case 'OUT_OF_STOCK':
      return '无库存';
    default:
      return '已下架';
  }
}

export default function CartScreen() {
  const { colors, radius, shadow, spacing, typography, gradients, isDark } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const clearVipPackageSelection = useCheckoutStore((s) => s.clearVipPackageSelection);
  // 底部确认栏统一使用系统 safe-area + 视觉间距，避免全局推断导致底部 gap。
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactRows = isCompact || isLargeText;
  // 2026-05-20 v5：extra 从 spacing.sm(8) → 4。减少 Xiaomi 手势条上按钮下方的可见空白。
  const barBottomPad = useBottomInset(4);
  const { bottomPadding: scrollBottomPad, onBarLayout: handleCheckoutBarLayout } =
    useMeasuredBottomBar(compactRows ? 148 : 112, spacing.lg);
  const items = useCartStore((s) => s.items);
  const selectedIds = useCartStore((s) => s.selectedIds);
  const virtualNotices = useCartStore((s) => s.virtualNotices);
  const clearVirtualNotice = useCartStore((s) => s.clearVirtualNotice);
  const clear = useCartStore((s) => s.clear);
  const updateQty = useCartStore((s) => s.updateQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const toggleSelect = useCartStore((s) => s.toggleSelect);
  const selectAll = useCartStore((s) => s.selectAll);
  const deselectAll = useCartStore((s) => s.deselectAll);
  const isAllSelected = useCartStore((s) => s.isAllSelected);
  const cartCount = useCartStore((s) => s.count());
  const selectedTotal = useCartStore((s) => s.selectedTotal);
  const selectedNonPrizeTotal = useCartStore((s) => s.selectedNonPrizeTotal);
  const selectedCount = useCartStore((s) => s.selectedCount);
  const addItem = useCartStore((s) => s.addItem);
  const removePrizeItem = useCartStore((s) => s.removePrizeItem);
  const syncFromServer = useCartStore((s) => s.syncFromServer);
  const loading = useCartStore((s) => s.loading);
  const [isEditing, setIsEditing] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  const { data: appConfigResult } = useQuery({
    queryKey: ['app-config'],
    queryFn: AppConfigRepo.getPublicConfig,
    staleTime: 1000 * 60 * 60,
  });
  const lowStockThreshold = appConfigResult?.ok ? appConfigResult.data.lowStockDisplayThreshold : 10;

  // 进入购物车页时从服务端同步（仅登录状态，仅首次挂载）
  useEffect(() => {
    if (isLoggedIn) {
      syncFromServer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 推荐
  const { data: recommendData } = useQuery({
    queryKey: ['cart-recommend'],
    queryFn: () => RecommendRepo.listForMe(),
  });
  // 过滤掉奖品（标题含"奖品"的平台商品），只展示常规商品
  const recommendations = (recommendData?.ok ? recommendData.data : []).filter(
    (rec) => !rec.product.title.includes('（奖品）') && !rec.product.title.includes('(奖品)')
  );

  const allSelected = isAllSelected();
  const total = selectedTotal();
  const selCount = selectedCount();

  // N08修复：删除选中项，cartKey 格式为 productId:skuId 或 productId
  const handleDeleteSelected = () => {
    const keys = [...selectedIds];
    keys.forEach((key) => {
      const [productId, skuId] = key.includes(':') ? key.split(':') : [key, undefined];
      removeItem(productId, skuId);
    });
    show({ message: `已删除 ${keys.length} 件商品`, type: 'success' });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const handleCheckoutPress = () => {
    if (selCount === 0) {
      show({ message: '请先选择商品', type: 'info' });
      return;
    }
    if (!isLoggedIn) {
      setAuthModalOpen(true);
      return;
    }
    const { items: currentItems, selectedIds: currentSelectedIds } = useCartStore.getState();
    const selectedItems = currentItems.filter((item) => {
      const key = item.skuId ? `${item.productId}:${item.skuId}` : item.productId;
      return currentSelectedIds.has(key);
    });
    const blocked = selectedItems.some((item) => item.unavailableReason === 'OUT_OF_STOCK' || Number(item.stock ?? 1) <= 0);
    if (blocked) {
      show({ message: '有商品暂无库存，请移除后再结算', type: 'warning' });
      return;
    }
    // 清除可能残留的 VIP 礼包选择，防止普通结算误入 VIP 模式
    clearVipPackageSelection();
    router.push('/checkout');
  };

  // 首次加载中
  if (loading && items.length === 0) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="购物车" onBack={handleBack} />
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.brand.primary} />
          <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: spacing.md }]}>
            加载中...
          </Text>
        </View>
      </Screen>
    );
  }

  // 空购物车
  if (items.length === 0 && virtualNotices.length === 0) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="购物车" onBack={handleBack} />
        {/* 未完成订单横幅（无未支付订单时返回 null） */}
        <PendingCheckoutBanner />
        <View style={styles.emptyContainer}>
          {/* 【AI 多轮对话已下线】原 onPress={() => router.push('/ai/chat')} 已移除，光球仅作装饰 */}
          <AiOrb size="small" />
          <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.lg }]}>
            购物车是空的
          </Text>
          <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm, textAlign: 'center' }]}>
            让脉脉帮你挑点好的？
          </Text>
          <View style={[styles.emptyActions, { marginTop: spacing.lg }]}>
            <Pressable
              onPress={() => router.push('/(tabs)/home')}
              style={[styles.emptyButton, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>去逛逛</Text>
            </Pressable>
            {/* 【AI 多轮对话已下线】「问问 AI」入口（→/ai/chat）已注释，恢复时取消注释即可
            <Pressable
              onPress={() => router.push('/ai/chat')}
              style={[
                styles.emptyButton,
                {
                  backgroundColor: colors.ai.soft,
                  borderRadius: radius.pill,
                  marginLeft: spacing.md,
                },
              ]}
            >
              <Text style={[typography.bodyStrong, { color: colors.ai.start }]}>问问 AI</Text>
            </Pressable>
            */}
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title={`购物车(${cartCount})`}
        onBack={handleBack}
        rightSlot={
          <Pressable onPress={() => setIsEditing(!isEditing)} hitSlop={10} style={{ padding: 8 }}>
            <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>
              {isEditing ? '完成' : '编辑'}
            </Text>
          </Pressable>
        }
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id ?? (item.skuId ? `${item.productId}:${item.skuId}` : item.productId)}
        initialNumToRender={6}
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingBottom: scrollBottomPad,
          paddingTop: spacing.sm,
        }}
        ListHeaderComponent={
          <>
            {/* 未完成订单横幅（无未支付订单时返回 null） */}
            <PendingCheckoutBanner />

            {/* 全选栏 */}
            <View style={[styles.selectBar, { marginBottom: spacing.sm }]}>
              <Pressable
                onPress={() => (allSelected ? deselectAll() : selectAll())}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <MaterialCommunityIcons
                  name={allSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={22}
                  color={allSelected ? colors.brand.primary : colors.text.secondary}
                />
                <Text style={[typography.bodySm, { color: colors.text.primary, marginLeft: spacing.xs }]}>全选</Text>
              </Pressable>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                已选 {items.filter((item) => isSelectableCartItem(item) && selectedIds.has(item.skuId ? `${item.productId}:${item.skuId}` : item.productId)).reduce((sum, item) => sum + item.quantity, 0)}/{items.filter(isSelectableCartItem).reduce((sum, item) => sum + item.quantity, 0)}
              </Text>
            </View>
            {virtualNotices.map((notice) => (
              <View
                key={notice.skuId}
                style={[
                  styles.card,
                  shadow.sm,
                  {
                    borderColor: colors.danger,
                    borderWidth: 1,
                    backgroundColor: colors.surface,
                    borderRadius: radius.lg,
                    marginBottom: spacing.sm,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
                    {notice.title}
                  </Text>
                  <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>
                    {notice.message}
                  </Text>
                </View>
                <Pressable onPress={() => clearVirtualNotice(notice.skuId)} hitSlop={8}>
                  <MaterialCommunityIcons name="delete-outline" size={20} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </>
        }
        renderItem={({ item }) => {
          // N08修复：使用 cartKey 匹配选中状态
          const key = item.skuId ? `${item.productId}:${item.skuId}` : item.productId;
          const selected = selectedIds.has(key);
          const isPrize = item.isPrize === true;
          const unavailableReason = item.unavailableReason;
          const isUnavailable = !!unavailableReason;
          const stockText = getStockText(item.stock, lowStockThreshold);
          const nonPrizeTotal = selectedNonPrizeTotal();
          // 动态计算锁定状态：赠品在非奖品总额达到门槛时自动解锁
          const isLocked = !isUnavailable && item.isLocked === true && (!item.threshold || nonPrizeTotal < item.threshold);
          const unlockGap = isLocked && item.threshold ? item.threshold - nonPrizeTotal : 0;
          return (
            <View
              style={[
                styles.card,
                compactRows && styles.cardCompact,
                shadow.sm,
                {
                  backgroundColor: colors.surface,
                  borderRadius: radius.lg,
                  marginBottom: spacing.md,
                  opacity: isLocked || isUnavailable ? 0.5 : 1,
                },
              ]}
            >
              {/* 复选框 — THRESHOLD_GIFT 和锁定赠品不可勾选，DISCOUNT_BUY 可取消 */}
              {(() => {
                const isThresholdGift = isPrize && !!item.threshold;
                const checkboxDisabled = isUnavailable || isLocked || isThresholdGift;
                const isChecked = isUnavailable || isLocked ? false : isThresholdGift ? true : selected;
                return (
                  <Pressable
                    onPress={() => !checkboxDisabled && toggleSelect(item.productId, item.skuId)}
                    disabled={checkboxDisabled}
                    style={{ padding: 4 }}
                  >
                    <MaterialCommunityIcons
                      name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={isChecked ? colors.brand.primary : colors.text.secondary}
                    />
                  </Pressable>
                );
              })()}

              <View style={{ position: 'relative' }}>
                <Image
                  source={{ uri: item.image }}
                  style={[styles.cover, compactRows && styles.coverCompact, { borderRadius: radius.md }]}
                  contentFit="cover"
                />
                {/* 奖品徽标 */}
                {isPrize && (
                  <View style={[styles.prizeBadge, { backgroundColor: colors.brand.primary, borderRadius: radius.sm }]}>
                    <Text style={[typography.captionSm, { color: '#fff', fontSize: 10 }]}>奖品</Text>
                  </View>
                )}
                {isUnavailable && (
                  <View style={[styles.unavailableBadge, { backgroundColor: colors.danger, borderRadius: radius.sm }]}>
                    <Text style={[typography.captionSm, { color: '#fff', fontSize: 10 }]}>{unavailableText(unavailableReason)}</Text>
                  </View>
                )}
                {/* 锁定遮罩 */}
                {isLocked && (
                  <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }]}>
                    <MaterialCommunityIcons name="lock" size={20} color="#fff" />
                  </View>
                )}
              </View>

              <View style={[styles.content, compactRows && styles.contentCompact]}>
                <Text
                  style={[typography.bodyStrong, { color: colors.text.primary }]}
                  numberOfLines={compactRows ? 3 : 2}
                  ellipsizeMode="tail"
                >
                  {item.title}
                </Text>
                {stockText && (
                  <Text style={[typography.captionSm, { color: Number(item.stock ?? 0) <= 0 ? colors.danger : colors.warning, marginTop: 2 }]}>
                    {stockText}
                  </Text>
                )}
                {item.pendingClaim && (
                  <Text style={[typography.captionSm, { color: colors.brand.primary, marginTop: 2 }]}>
                    已加入本地购物车，登录后确认领取
                  </Text>
                )}
                <BundleSummary productType={item.productType} bundleItems={item.bundleItems} />
                {isUnavailable && (
                  <Text style={[typography.captionSm, { color: colors.danger, marginTop: 2 }]}>
                    {unavailableText(unavailableReason)}，仅可移除
                  </Text>
                )}
                {/* 锁定赠品提示 */}
                {isLocked && unlockGap > 0 && (
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                    再消费 ¥{unlockGap.toFixed(2)} 解锁
                  </Text>
                )}
                {/* 过期倒计时 */}
                {item.expiresAt && <ExpiryCountdown expiresAt={item.expiresAt} colors={colors} typography={typography} />}
                <View style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
                  <Price value={item.price} />
                  {/* 奖品项显示原价划线 */}
                  {isPrize && item.originalPrice != null && item.originalPrice > item.price && (
                    <Text style={[typography.captionSm, { color: colors.text.tertiary, textDecorationLine: 'line-through', marginLeft: spacing.xs }]}>
                      ¥{item.originalPrice.toFixed(2)}
                    </Text>
                  )}
                </View>
                <View style={[styles.metaRow, compactRows && styles.metaRowCompact]}>
                  {/* 奖品不可修改数量 */}
                  {isUnavailable ? (
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>不可结算</Text>
                  ) : isPrize ? (
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>x{item.quantity}</Text>
                  ) : (
                    <View>
                      <QuantityStepper
                        value={item.quantity}
                        max={item.maxPerOrder ?? 99}
                        onChange={(next) => updateQty(item.productId, next, item.skuId)}
                      />
                      {item.maxPerOrder != null && (
                        <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 2 }]}>
                          限购 {item.maxPerOrder} 件
                        </Text>
                      )}
                    </View>
                  )}
                  <Pressable
                    onPress={() => {
                      if (isPrize && item.id) {
                        removePrizeItem(item.id);
                        show({ message: isLocked ? '已放弃奖品' : '已移除奖品', type: 'success' });
                      } else {
                        removeItem(item.productId, item.skuId);
                      }
                    }}
                    hitSlop={8}
                  >
                    <MaterialCommunityIcons name="delete-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <>
            {/* 编辑模式下的批量删除 */}
            {isEditing && selCount > 0 && (
              <Pressable
                onPress={handleDeleteSelected}
                style={[styles.deleteButton, { borderColor: colors.danger, borderRadius: radius.md }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.danger }]}>
                  删除选中({selCount})
                </Text>
              </Pressable>
            )}

            {/* AI 推荐区 */}
            {recommendations.length > 0 && (
              <View style={{ marginTop: spacing.lg }}>
                <AiBadge variant="recommend" style={{ marginBottom: spacing.md }} />
                <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.md }]}>
                  猜你还想买
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: spacing.xl }}
                >
                  {recommendations.slice(0, 6).map((rec) => (
                    <Pressable
                      key={rec.id}
                      onPress={() => router.push({ pathname: '/product/[id]', params: { id: rec.product.id } })}
                      style={[
                        styles.recCard,
                        shadow.sm,
                        {
                          backgroundColor: colors.surface,
                          borderRadius: radius.lg,
                          width: RECOMMEND_CARD_WIDTH,
                          marginRight: spacing.md,
                        },
                      ]}
                    >
                      <Image
                        source={{ uri: rec.product.image }}
                        style={{ width: RECOMMEND_CARD_WIDTH, height: RECOMMEND_CARD_WIDTH, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}
                        contentFit="cover"
                      />
                      <View style={{ padding: spacing.sm }}>
                        <Text style={[typography.captionSm, { color: colors.text.primary }]} numberOfLines={1}>
                          {rec.product.title}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                          <Text style={[typography.captionSm, { color: colors.brand.primary }]}>
                            ¥{rec.product.price.toFixed(0)}
                          </Text>
                          <Pressable
                            onPress={() => {
                              addItem(rec.product, 1, rec.product.defaultSkuId, rec.product.price);
                              show({ message: '已加入购物车', type: 'success' });
                            }}
                            hitSlop={6}
                          >
                            <MaterialCommunityIcons name="cart-plus" size={18} color={colors.brand.primary} />
                          </Pressable>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        }
      />

      {/* 底部结算栏 — 毛玻璃 */}
      {Platform.OS === 'ios' ? (
        <BlurView
          onLayout={handleCheckoutBarLayout}
          intensity={80}
          tint={isDark ? 'dark' : 'light'}
          style={[
            styles.checkoutBar,
            compactRows && styles.checkoutBarCompact,
            {
              paddingBottom: barBottomPad,
              paddingHorizontal: spacing.xl,
              borderTopColor: colors.divider,
            },
          ]}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(6,14,6,0.6)' : 'rgba(250,252,250,0.6)' }]} />
          <View style={compactRows ? styles.checkoutSummaryCompact : styles.checkoutSummary}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>合计</Text>
            <Text {...priceTextProps} style={[typography.title3, { color: colors.text.primary }]}>
              ¥{total.toFixed(2)}
            </Text>
          </View>
          <LinearGradient
            colors={[...gradients.goldGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ borderRadius: radius.pill, overflow: 'hidden' }}
          >
            <Pressable
              onPress={handleCheckoutPress}
              style={styles.checkoutButton}
            >
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                去结算({selCount})
              </Text>
            </Pressable>
          </LinearGradient>
        </BlurView>
      ) : (
        <View
          onLayout={handleCheckoutBarLayout}
          style={[
            styles.checkoutBar,
            compactRows && styles.checkoutBarCompact,
            {
              paddingBottom: barBottomPad,
              paddingHorizontal: spacing.xl,
              borderTopColor: colors.divider,
              backgroundColor: isDark ? 'rgba(6,14,6,0.95)' : 'rgba(250,252,250,0.95)',
            },
          ]}
        >
          <View style={compactRows ? styles.checkoutSummaryCompact : styles.checkoutSummary}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>合计</Text>
            <Text {...priceTextProps} style={[typography.title3, { color: colors.text.primary }]}>
              ¥{total.toFixed(2)}
            </Text>
          </View>
          <LinearGradient
            colors={[...gradients.goldGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ borderRadius: radius.pill, overflow: 'hidden' }}
          >
            <Pressable
              onPress={handleCheckoutPress}
              style={styles.checkoutButton}
            >
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                去结算({selCount})
              </Text>
            </Pressable>
          </LinearGradient>
        </View>
      )}

      {/* 未登录结算时弹出登录/注册 */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={async (session) => {
          useAuthStore.getState().setLoggedIn({
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            userId: session.userId,
            loginMethod: session.loginMethod,
          });
          // 登录成功后合并本地购物车到服务端（内部会 syncFromServer）
          const mergeOutcome = await useCartStore.getState().syncLocalCartToServer();
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['lottery-today'] }),
            queryClient.invalidateQueries({ queryKey: ['lottery-today-page'] }),
          ]);
          const prizeNotice = getPrizeMergeNotice(mergeOutcome?.mergeResults);
          if (prizeNotice) {
            show({ type: 'warning', message: `${prizeNotice.title}：${prizeNotice.message}` });
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyActions: {
    flexDirection: 'row',
  },
  emptyButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  selectBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  cardCompact: {
    alignItems: 'flex-start',
  },
  cover: {
    width: 80,
    height: 80,
    marginLeft: 8,
  },
  coverCompact: {
    width: 64,
    height: 64,
  },
  content: {
    flex: 1,
    marginLeft: 12,
  },
  contentCompact: {
    minWidth: 0,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaRowCompact: {
    alignItems: 'flex-start',
    gap: 8,
  },
  deleteButton: {
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  recCard: {
    overflow: 'hidden',
  },
  checkoutBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
  },
  checkoutBarCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  checkoutSummary: {
    flex: 1,
  },
  checkoutSummaryCompact: {
    width: '100%',
  },
  checkoutButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prizeBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  unavailableBadge: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 4,
    alignItems: 'center',
    paddingVertical: 2,
  },
});
