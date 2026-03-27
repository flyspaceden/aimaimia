import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  interpolate,
  runOnJS,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';

import { BonusRepo } from '../../src/repos';
import { useAuthStore, useCheckoutStore } from '../../src/store';
import { useToast } from '../../src/components/feedback';
import { GiftCoverImage } from '../../src/components/cards';
import type { VipGiftOption } from '../../src/types/domain/Bonus';

// ============================================================
// VIP 赠品选择页 — VIP 专属空间
// 设计规范见 buy-vip.md Section 5.2
// ============================================================

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.82;
const CARD_SPACING = 12;
const CARD_TOTAL_WIDTH = CARD_WIDTH + CARD_SPACING;
const SIDE_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2;

// VIP 专属空间色彩规范
const VIP = {
  bgStart: '#0A1F1A',
  bgEnd: '#0D0D0D',
  goldPrimary: '#C9A96E',
  goldLight: '#E8D5A3',
  warmWhite: '#F5F0E8',
  subtleGray: '#8A8578',
  cardBg: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(201,169,110,0.3)',
  cardBorderActive: 'rgba(201,169,110,0.8)',
  cardGlow: 'rgba(201,169,110,0.15)',
  soldOutOverlay: 'rgba(0,0,0,0.6)',
  referralBg: 'rgba(201,169,110,0.08)',
  bottomBarBg: 'rgba(13,13,13,0.85)',
};

// VIP 权益图标
const VIP_BENEFITS = [
  { icon: 'chart-line' as const, label: '专属奖励' },
  { icon: 'account-plus' as const, label: '邀请收益' },
  { icon: 'gift' as const, label: '专属礼包' },
  { icon: 'headset' as const, label: '优先客服' },
  { icon: 'truck-fast' as const, label: '包邮特权' },
  { icon: 'star-circle' as const, label: '消费奖励' },
];

// ============================================================
// 金色粒子背景组件
// ============================================================
function GoldParticles() {
  const particles = useMemo(() => {
    return Array.from({ length: 25 }, (_, i) => ({
      id: i,
      x: Math.random() * SCREEN_WIDTH,
      size: 2 + Math.random() * 3,
      opacity: 0.15 + Math.random() * 0.3,
      speed: 0.4 + Math.random() * 0.5,
      delay: Math.random() * 5000,
    }));
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p) => (
        <ParticleDot key={p.id} config={p} />
      ))}
    </View>
  );
}

function ParticleDot({ config }: { config: { x: number; size: number; opacity: number; speed: number; delay: number } }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      progress.value = withRepeat(
        withTiming(1, { duration: 8000 / config.speed, easing: Easing.linear }),
        -1,
        false,
      );
    }, config.delay);
    return () => clearTimeout(timeout);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: config.x,
    top: interpolate(progress.value, [0, 1], [-20, SCREEN_WIDTH * 2]),
    width: config.size,
    height: config.size,
    borderRadius: config.size / 2,
    backgroundColor: VIP.goldPrimary,
    opacity: interpolate(progress.value, [0, 0.3, 0.7, 1], [0, config.opacity, config.opacity, 0]),
  }));

  return <Animated.View style={animatedStyle} />;
}

// ============================================================
// 脉冲动画 ✦ 装饰
// ============================================================
function PulsingSymbol() {
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.Text style={[styles.pulsingSymbol, animatedStyle]}>✦</Animated.Text>
  );
}

// ============================================================
// 赠品卡片组件
// ============================================================
function GiftCard({
  item,
  index,
  scrollX,
  isSelected,
  onSelect,
}: {
  item: VipGiftOption;
  index: number;
  scrollX: SharedValue<number>;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const inputRange = [
    (index - 1) * CARD_TOTAL_WIDTH,
    index * CARD_TOTAL_WIDTH,
    (index + 1) * CARD_TOTAL_WIDTH,
  ];

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollX.value, inputRange, [0.85, 1, 0.85], 'clamp');
    const cardOpacity = interpolate(scrollX.value, inputRange, [0.5, 1, 0.5], 'clamp');
    return {
      transform: [{ scale }],
      opacity: cardOpacity,
    };
  });

  const borderStyle = useAnimatedStyle(() => {
    const isCurrent = interpolate(scrollX.value, inputRange, [0, 1, 0], 'clamp') > 0.5;
    return {
      borderColor: isCurrent && isSelected ? VIP.cardBorderActive : VIP.cardBorder,
      shadowRadius: isCurrent && isSelected ? 12 : 0,
      shadowColor: VIP.goldPrimary,
      shadowOpacity: isCurrent && isSelected ? 0.3 : 0,
      shadowOffset: { width: 0, height: 0 },
    };
  });

  const isSoldOut = !item.available;

  return (
    <Animated.View style={[styles.cardWrapper, animatedStyle]}>
      <Pressable
        onPress={isSoldOut ? undefined : onSelect}
        disabled={isSoldOut}
        style={{ flex: 1 }}
      >
        <Animated.View style={[styles.card, borderStyle]}>
          {/* 赠品封面 */}
          <View style={styles.cardImageBox}>
            <GiftCoverImage
              items={item.items}
              coverMode={item.coverMode}
              coverUrl={item.coverUrl}
              style={styles.cardImage}
            />
          </View>

          {/* 赠品信息 */}
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            {item.subtitle ? (
              <Text style={styles.cardSubtitle} numberOfLines={2}>{item.subtitle}</Text>
            ) : null}
            {/* 商品内容摘要 */}
            {item.items.length > 0 ? (
              <Text style={styles.cardItemsSummary} numberOfLines={2}>
                {item.items.map((it) => `${it.productTitle}×${it.quantity}`).join(' + ')}
              </Text>
            ) : null}
            {item.totalPrice > 0 ? (
              <Text style={styles.cardTotalPrice}>
                市场参考价 ¥{item.totalPrice.toFixed(0)}
              </Text>
            ) : null}
            {item.badge ? (
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>{item.badge}</Text>
              </View>
            ) : null}
          </View>

          {/* 售罄遮罩 */}
          {isSoldOut ? (
            <View style={styles.soldOutOverlay}>
              <Text style={styles.soldOutText}>已售罄</Text>
            </View>
          ) : null}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// ============================================================
// 主页面
// ============================================================
export default function VipGiftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const setVipPackageSelection = useCheckoutStore((s) => s.setVipPackageSelection);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const scrollX = useSharedValue(0);
  const flatListRef = useRef<FlatList>(null);

  // 获取赠品方案
  const { data: giftData, isLoading } = useQuery({
    queryKey: ['vip-gift-options'],
    queryFn: () => BonusRepo.getVipGiftOptions(),
  });

  // 检查是否已是 VIP（已登录时）
  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });

  const packages = giftData?.ok ? giftData.data.packages : [];
  const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
  const currentPackage = packages[selectedPackageIndex];
  const giftOptions = currentPackage?.giftOptions ?? [];
  const vipPrice = currentPackage?.price ?? 0;
  const member = memberData?.ok ? memberData.data : null;
  const isVip = member?.tier === 'VIP';

  // 滚动处理
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const [currentIndex, setCurrentIndex] = useState(0);

  // 当前可见卡片追踪
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    [],
  );

  // 左右箭头导航
  const scrollToIndex = useCallback((index: number) => {
    if (index < 0 || index >= giftOptions.length) return;
    flatListRef.current?.scrollToOffset({
      offset: index * CARD_TOTAL_WIDTH,
      animated: true,
    });
  }, [giftOptions.length]);

  // 选中赠品并进入结账
  const handleCheckout = useCallback(() => {
    if (selectedIndex === null || !currentPackage) return;
    const selected = giftOptions[selectedIndex];
    if (!selected || !selected.available) return;

    // 持久化选择到 store
    setVipPackageSelection({
      packageId: currentPackage.id,
      giftOptionId: selected.id,
      title: selected.title,
      coverMode: selected.coverMode,
      coverUrl: selected.coverUrl ?? undefined,
      totalPrice: selected.totalPrice,
      price: currentPackage.price,
      items: selected.items,
    });

    // 进入结账页（结账页会处理登录判断）
    router.push('/checkout');
  }, [selectedIndex, giftOptions, currentPackage, setVipPackageSelection, router]);

  // 已是 VIP — 显示提示页
  if (isLoggedIn && isVip) {
    return (
      <LinearGradient
        colors={[VIP.bgStart, VIP.bgEnd]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <StatusBar style="light" />
        <GoldParticles />
        <View style={styles.vipAlreadyContainer}>
          <MaterialCommunityIcons name="crown" size={64} color={VIP.goldPrimary} />
          <Text style={styles.vipAlreadyTitle}>您已是 VIP 会员</Text>
          <Text style={styles.vipAlreadySubtitle}>尊享全部 VIP 权益</Text>
          <Pressable
            onPress={() => router.push('/me/vip')}
            style={styles.vipAlreadyButton}
          >
            <LinearGradient
              colors={[VIP.goldPrimary, VIP.goldLight]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.vipAlreadyButtonGradient}
            >
              <Text style={styles.vipAlreadyButtonText}>查看我的 VIP</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </LinearGradient>
    );
  }

  // 加载态
  if (isLoading) {
    return (
      <LinearGradient
        colors={[VIP.bgStart, VIP.bgEnd]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <StatusBar style="light" />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[VIP.bgStart, VIP.bgEnd]}
      style={styles.container}
    >
      <StatusBar style="light" />
      <GoldParticles />

      {/* 导航栏 */}
      <View style={[styles.navbar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={VIP.warmWhite} />
        </Pressable>
      </View>

      {/* 可滚动内容 */}
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        directionalLockEnabled
        nestedScrollEnabled
        entering={FadeIn.duration(400)}
      >
        {/* 标题区 */}
        <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.titleSection}>
          <View style={styles.titleRow}>
            <PulsingSymbol />
            <Text style={styles.mainTitle}> VIP 会员专属空间 </Text>
            <PulsingSymbol />
          </View>
          <Text style={styles.subTitle}>所有礼遇，仅为 VIP 准备</Text>
        </Animated.View>

        {/* 价格档位选择 */}
        {packages.length > 0 && (
          <Animated.View entering={FadeInDown.delay(150).duration(500)} style={styles.priceTabs}>
            {packages.map((pkg, index) => (
              <Pressable
                key={pkg.id}
                onPress={() => {
                  setSelectedPackageIndex(index);
                  setSelectedIndex(null);
                  flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
                }}
                style={[
                  styles.priceTab,
                  selectedPackageIndex === index && styles.priceTabActive,
                ]}
              >
                <Text style={[
                  styles.priceTabAmount,
                  selectedPackageIndex === index && styles.priceTabAmountActive,
                ]}>
                  ¥{pkg.price}
                </Text>
                <Text style={[
                  styles.priceTabLabel,
                  selectedPackageIndex === index && styles.priceTabLabelActive,
                ]}>
                  VIP 礼包
                </Text>
                <Text style={styles.priceTabCount}>
                  {pkg.giftOptions.length} 款可选
                </Text>
              </Pressable>
            ))}
          </Animated.View>
        )}

        {/* 推荐人提示条（无推荐人时显示） */}
        {(!isLoggedIn || (member && !member.inviterUserId)) ? (
          <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.referralBar}>
            <View style={styles.referralBorder} />
            <Text style={styles.referralText}>扫描好友邀请码，绑定专属推荐人</Text>
          </Animated.View>
        ) : null}

        {/* 赠品卡片轮播 */}
        <Animated.View entering={FadeInDown.delay(300).duration(500)}>
          <View style={styles.carouselContainer}>
            {/* 左箭头 */}
            {giftOptions.length > 1 && currentIndex > 0 ? (
              <Pressable
                style={[styles.arrowButton, styles.arrowLeft]}
                onPress={() => scrollToIndex(currentIndex - 1)}
                hitSlop={8}
              >
                <MaterialCommunityIcons name="chevron-left" size={28} color={VIP.goldPrimary} />
              </Pressable>
            ) : null}

            <Animated.FlatList
              ref={flatListRef}
              data={giftOptions}
              keyExtractor={(item) => item.id}
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              snapToInterval={CARD_TOTAL_WIDTH}
              decelerationRate="fast"
              contentContainerStyle={{
                paddingHorizontal: SIDE_PADDING,
              }}
              onScroll={scrollHandler}
              scrollEventThrottle={16}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              renderItem={({ item, index }) => (
                <GiftCard
                  item={item}
                  index={index}
                  scrollX={scrollX}
                  isSelected={selectedIndex === index}
                  onSelect={() => setSelectedIndex(index)}
                />
              )}
              ListEmptyComponent={
                <View style={styles.emptyGifts}>
                  <MaterialCommunityIcons name="gift-off" size={48} color={VIP.subtleGray} />
                  <Text style={styles.emptyText}>暂无赠品方案</Text>
                </View>
              }
            />

            {/* 右箭头 */}
            {giftOptions.length > 1 && currentIndex < giftOptions.length - 1 ? (
              <Pressable
                style={[styles.arrowButton, styles.arrowRight]}
                onPress={() => scrollToIndex(currentIndex + 1)}
                hitSlop={8}
              >
                <MaterialCommunityIcons name="chevron-right" size={28} color={VIP.goldPrimary} />
              </Pressable>
            ) : null}
          </View>

          {/* 指示器 */}
          {giftOptions.length > 0 ? (
            <View style={styles.indicatorRow}>
              {giftOptions.map((_, i) => (
                <IndicatorDot key={i} index={i} scrollX={scrollX} />
              ))}
              <Text style={styles.indicatorText}>
                {' '}{currentIndex + 1} / {giftOptions.length}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        {/* VIP 权益横排 */}
        <Animated.View entering={FadeInDown.delay(400).duration(500)} style={styles.benefitsRow}>
          {VIP_BENEFITS.map((b) => (
            <View key={b.label} style={styles.benefitItem}>
              <MaterialCommunityIcons name={b.icon} size={22} color={VIP.goldPrimary} />
              <Text style={styles.benefitLabel}>{b.label}</Text>
            </View>
          ))}
        </Animated.View>
      </Animated.ScrollView>

      {/* 底部固定栏 */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.bottomBarContent}>
          <View style={styles.bottomPriceSection}>
            <Text style={styles.bottomLabel}>开通 VIP</Text>
            <Text style={styles.bottomPrice}>¥{vipPrice}</Text>
          </View>
          <Pressable
            onPress={handleCheckout}
            disabled={selectedIndex === null}
            style={({ pressed }) => [
              styles.checkoutButton,
              selectedIndex === null && styles.checkoutButtonDisabled,
              pressed && selectedIndex !== null && styles.checkoutButtonPressed,
            ]}
          >
            <LinearGradient
              colors={selectedIndex !== null ? [VIP.goldPrimary, VIP.goldLight] : ['#555', '#444']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.checkoutButtonGradient}
            >
              <Text style={[
                styles.checkoutButtonText,
                selectedIndex === null && styles.checkoutButtonTextDisabled,
              ]}>
                立即开通
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
        <Text style={styles.bottomHint}>包邮 · 支付即开通 VIP</Text>
      </View>
    </LinearGradient>
  );
}

// ============================================================
// 指示器圆点
// ============================================================
function IndicatorDot({ index, scrollX }: { index: number; scrollX: SharedValue<number> }) {
  const inputRange = [
    (index - 1) * CARD_TOTAL_WIDTH,
    index * CARD_TOTAL_WIDTH,
    (index + 1) * CARD_TOTAL_WIDTH,
  ];

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollX.value, inputRange, [1, 1.5, 1], 'clamp');
    const dotOpacity = interpolate(scrollX.value, inputRange, [0.3, 1, 0.3], 'clamp');
    return {
      transform: [{ scale }],
      opacity: dotOpacity,
    };
  });

  return <Animated.View style={[styles.indicatorDot, animatedStyle]} />;
}

// ============================================================
// 样式表
// ============================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // 导航栏
  navbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 可滚动内容
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 100,
  },
  // 标题区
  titleSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mainTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: VIP.goldPrimary,
    letterSpacing: 2,
  },
  pulsingSymbol: {
    fontSize: 20,
    color: VIP.goldPrimary,
  },
  subTitle: {
    fontSize: 14,
    color: VIP.warmWhite,
    marginTop: 8,
    letterSpacing: 1,
  },
  // 推荐人提示条
  referralBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: VIP.referralBg,
    borderRadius: 8,
  },
  referralBorder: {
    width: 3,
    height: '100%',
    backgroundColor: VIP.goldPrimary,
    borderRadius: 2,
    marginRight: 12,
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  referralText: {
    fontSize: 13,
    color: VIP.warmWhite,
    marginLeft: 8,
  },
  // 轮播容器
  carouselContainer: {
    position: 'relative',
  },
  arrowButton: {
    position: 'absolute',
    top: '40%',
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: VIP.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowLeft: {
    left: 4,
  },
  arrowRight: {
    right: 4,
  },
  // 赠品卡片
  cardWrapper: {
    width: CARD_WIDTH,
    marginRight: CARD_SPACING,
  },
  card: {
    flex: 1,
    backgroundColor: VIP.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: VIP.cardBorder,
    overflow: 'hidden',
  },
  cardImageBox: {
    width: '100%',
    aspectRatio: 1.2,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImagePlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    padding: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: VIP.goldPrimary,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: VIP.warmWhite,
    lineHeight: 20,
    marginBottom: 8,
  },
  cardItemsSummary: {
    fontSize: 12,
    color: VIP.subtleGray,
    lineHeight: 18,
    marginBottom: 6,
  },
  cardTotalPrice: {
    fontSize: 14,
    color: VIP.subtleGray,
    textDecorationLine: 'line-through',
    marginBottom: 8,
  },
  badgeContainer: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: VIP.goldPrimary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 12,
    color: VIP.goldPrimary,
    fontWeight: '500',
  },
  // 售罄遮罩
  soldOutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: VIP.soldOutOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  soldOutText: {
    fontSize: 16,
    color: VIP.warmWhite,
    fontWeight: '600',
  },
  // 空状态
  emptyGifts: {
    width: SCREEN_WIDTH - 48,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: VIP.subtleGray,
    marginTop: 12,
  },
  // 指示器
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  indicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: VIP.goldPrimary,
  },
  indicatorText: {
    fontSize: 12,
    color: VIP.warmWhite,
    marginLeft: 4,
  },
  // VIP 权益横排
  benefitsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    marginTop: 32,
  },
  benefitItem: {
    alignItems: 'center',
    width: SCREEN_WIDTH / 6 - 8,
    marginBottom: 12,
  },
  benefitLabel: {
    fontSize: 10,
    color: VIP.warmWhite,
    marginTop: 6,
    textAlign: 'center',
  },
  // 价格档位选择
  priceTabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  priceTab: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(201,169,110,0.3)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  priceTabActive: {
    borderColor: '#C9A96E',
    backgroundColor: 'rgba(201,169,110,0.12)',
  },
  priceTabAmount: {
    fontSize: 22,
    fontWeight: '700',
    color: '#8A8578',
  },
  priceTabAmountActive: {
    color: '#C9A96E',
  },
  priceTabLabel: {
    fontSize: 11,
    color: '#8A8578',
    marginTop: 4,
  },
  priceTabLabelActive: {
    color: '#F5F0E8',
  },
  priceTabCount: {
    fontSize: 10,
    color: '#8A8578',
    marginTop: 2,
  },
  // 底部固定栏
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: 'rgba(201,169,110,0.15)',
  },
  bottomBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomPriceSection: {
    flex: 1,
  },
  bottomLabel: {
    fontSize: 13,
    color: VIP.warmWhite,
  },
  bottomPrice: {
    fontSize: 24,
    fontWeight: '700',
    color: VIP.goldPrimary,
  },
  bottomHint: {
    fontSize: 12,
    color: VIP.subtleGray,
    marginTop: 6,
    textAlign: 'center',
  },
  checkoutButton: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  checkoutButtonDisabled: {
    opacity: 0.4,
  },
  checkoutButtonPressed: {
    opacity: 0.85,
  },
  checkoutButtonGradient: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
  },
  checkoutButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1207',
    textAlign: 'center',
  },
  checkoutButtonTextDisabled: {
    color: '#888',
  },
  // 已是 VIP
  vipAlreadyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  vipAlreadyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: VIP.goldPrimary,
    marginTop: 20,
  },
  vipAlreadySubtitle: {
    fontSize: 14,
    color: VIP.warmWhite,
    marginTop: 8,
  },
  vipAlreadyButton: {
    marginTop: 32,
    borderRadius: 24,
    overflow: 'hidden',
  },
  vipAlreadyButtonGradient: {
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 24,
  },
  vipAlreadyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1207',
  },
  // 加载态
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: VIP.subtleGray,
  },
});
