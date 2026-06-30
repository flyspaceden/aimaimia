import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';

import { BonusRepo } from '../../src/repos';
import { useAuthStore, useCheckoutStore } from '../../src/store';
import { useToast } from '../../src/components/feedback';
import { GiftCoverImage } from '../../src/components/cards';
import { GoldShineSweep } from '../../src/components/effects/GoldShineSweep';
import { GoldBgGlows } from '../../src/components/effects/GoldBgGlows';
import { useMeasuredBottomBar } from '../../src/hooks/useMeasuredBottomBar';
import { compactActionTextProps, priceTextProps, useBottomInset, useResponsiveLayout } from '../../src/theme';
import type { VipGiftOption } from '../../src/types/domain/Bonus';

// ============================================================
// VIP 赠品选择页 — VIP 专属空间
// 设计规范见 buy-vip.md Section 5.2
// ============================================================

// VIP 专属空间色彩规范 · 轻金 v1
// 背景从深墨绿黑换成暖香槟金，文字翻转为深棕，金色加深为深金 + 亮金
// warmWhite 语义已变为"文字主色"（金底上视觉为深棕），key 名保留避免大范围改动
const VIP = {
  bgStart: '#FFFDF5',
  bgEnd: '#EAD78F',
  goldPrimary: '#B8860B',
  goldLight: '#FFD700',
  warmWhite: '#3D2E1A',
  subtleGray: '#5D4A2C',
  cardBg: 'rgba(255,255,255,0.55)',
  cardBorder: 'rgba(184,134,11,0.35)',
  cardBorderActive: '#B8860B',
  cardGlow: 'rgba(184,134,11,0.2)',
  soldOutOverlay: 'rgba(255,253,245,0.65)',
  referralBg: 'rgba(184,134,11,0.12)',
  bottomBarBg: 'rgba(255,253,245,0.92)',
};

// VIP 权益图标
const VIP_BENEFITS = [
  { icon: 'chart-line' as const, label: '专属奖励' },
  { icon: 'account-plus' as const, label: '邀请收益' },
  { icon: 'gift' as const, label: '专属礼包' },
  { icon: 'headset' as const, label: '优先客服' },
  { icon: 'star-circle' as const, label: '消费奖励' },
];

function collectGiftImages(option: VipGiftOption | null | undefined) {
  if (!option) return [];
  const images = [
    option.coverMode === 'CUSTOM' ? option.coverUrl : null,
    ...option.items.map((item) => item.productImage),
  ].filter((uri): uri is string => Boolean(uri));
  return Array.from(new Set(images));
}

// ============================================================
// 金色粒子背景组件
// ============================================================
function GoldParticles({ screenWidth }: { screenWidth: number }) {
  const particles = useMemo(() => {
    return Array.from({ length: 25 }, (_, i) => ({
      id: i,
      x: Math.random() * screenWidth,
      size: 2 + Math.random() * 3,
      opacity: 0.15 + Math.random() * 0.3,
      speed: 0.4 + Math.random() * 0.5,
      delay: Math.random() * 5000,
    }));
  }, [screenWidth]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p) => (
        <ParticleDot key={p.id} config={p} screenWidth={screenWidth} />
      ))}
    </View>
  );
}

function ParticleDot({
  config,
  screenWidth,
}: {
  config: { x: number; size: number; opacity: number; speed: number; delay: number };
  screenWidth: number;
}) {
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
    top: interpolate(progress.value, [0, 1], [-20, screenWidth * 2]),
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
  onOpenImages,
  cardWidth,
  cardSpacing,
  cardTotalWidth,
}: {
  item: VipGiftOption;
  index: number;
  scrollX: SharedValue<number>;
  isSelected: boolean;
  onSelect: () => void;
  onOpenImages: () => void;
  cardWidth: number;
  cardSpacing: number;
  cardTotalWidth: number;
}) {
  const inputRange = [
    (index - 1) * cardTotalWidth,
    index * cardTotalWidth,
    (index + 1) * cardTotalWidth,
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
  const previewImageCount = collectGiftImages(item).length;

  return (
    <Animated.View style={[styles.cardWrapper, { width: cardWidth, marginRight: cardSpacing }, animatedStyle]}>
      <Pressable
        onPress={isSoldOut ? undefined : onSelect}
        disabled={isSoldOut}
        style={{ flex: 1 }}
      >
        <Animated.View style={[styles.card, borderStyle]}>
          {/* 赠品封面 */}
          <View style={styles.cardImageBox}>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onOpenImages();
              }}
              disabled={previewImageCount === 0}
              style={styles.cardImagePressable}
            >
              <GiftCoverImage
                items={item.items}
                coverMode={item.coverMode}
                coverUrl={item.coverUrl}
                style={styles.cardImage}
              />
              {previewImageCount > 0 ? (
                <View style={styles.imagePreviewBadge}>
                  <MaterialCommunityIcons name="image-multiple" size={14} color="#FFFDF5" />
                  <Text style={styles.imagePreviewBadgeText}>{previewImageCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {/* 赠品信息 */}
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            {item.subtitle ? (
              <Text style={styles.cardSubtitle} numberOfLines={2}>{item.subtitle}</Text>
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
              <Text style={styles.soldOutText}>已售完</Text>
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
  const params = useLocalSearchParams<{ packageId?: string; giftOptionId?: string }>();
  const insets = useSafeAreaInsets();
  const barBottomPad = useBottomInset(16);  // 16dp extra + 系统 safe-area
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compactBottomBar = isCompact || isLargeText;
  const { bottomPadding: contentBottomPad, onBarLayout: handleBottomBarLayout } =
    useMeasuredBottomBar(compactBottomBar ? 184 : 150, 24);
  const { show } = useToast();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const setVipPackageSelection = useCheckoutStore((s) => s.setVipPackageSelection);

  // 响应式尺寸（分屏/旋转/字体放大时实时更新，不可在模块顶层用 Dimensions.get）
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const CARD_WIDTH = SCREEN_WIDTH * 0.82;
  const CARD_SPACING = 12;
  const CARD_TOTAL_WIDTH = CARD_WIDTH + CARD_SPACING;
  const SIDE_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2;

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const scrollX = useSharedValue(0);
  const flatListRef = useRef<FlatList>(null);
  const previewFlatListRef = useRef<FlatList<string>>(null);
  const initialSelectionAppliedRef = useRef(false);
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);

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

  const packageIdParam = typeof params.packageId === 'string' ? params.packageId : undefined;
  const giftOptionIdParam = typeof params.giftOptionId === 'string' ? params.giftOptionId : undefined;

  // 滚动处理
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const selectedGiftOption = giftOptions[selectedIndex ?? currentIndex] ?? null;

  useEffect(() => {
    if (!packages.length || initialSelectionAppliedRef.current || !packageIdParam) return;

    initialSelectionAppliedRef.current = true;
    const nextPackageIndex = packages.findIndex((pkg) => pkg.id === packageIdParam);
    if (nextPackageIndex < 0) return;

    const nextGiftOptions = packages[nextPackageIndex].giftOptions;
    const nextGiftIndex = giftOptionIdParam
      ? nextGiftOptions.findIndex((gift) => gift.id === giftOptionIdParam)
      : -1;
    const scrollIndex = nextGiftIndex >= 0 ? nextGiftIndex : 0;

    setSelectedPackageIndex(nextPackageIndex);
    setSelectedIndex(nextGiftIndex >= 0 ? nextGiftIndex : null);
    setCurrentIndex(scrollIndex);

    const timer = setTimeout(() => {
      flatListRef.current?.scrollToOffset({
        offset: scrollIndex * CARD_TOTAL_WIDTH,
        animated: false,
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [packages, packageIdParam, giftOptionIdParam, CARD_TOTAL_WIDTH]);

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
  }, [giftOptions.length, CARD_TOTAL_WIDTH]);

  const openImagePreview = useCallback((option: VipGiftOption, initialIndex = 0) => {
    const images = collectGiftImages(option);
    if (images.length === 0) return;
    const safeIndex = Math.min(Math.max(initialIndex, 0), images.length - 1);
    setPreviewImages(images);
    setPreviewImageIndex(safeIndex);
    setImagePreviewVisible(true);
    setTimeout(() => {
      previewFlatListRef.current?.scrollToIndex({ index: safeIndex, animated: false });
    }, 0);
  }, []);

  const closeImagePreview = useCallback(() => {
    setImagePreviewVisible(false);
  }, []);

  const handlePreviewMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const width = event.nativeEvent.layoutMeasurement.width;
    if (width <= 0) return;
    setPreviewImageIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }, []);

  const openGiftItemImage = useCallback((option: VipGiftOption, productImage: string | null) => {
    const images = collectGiftImages(option);
    const nextIndex = productImage ? images.findIndex((uri) => uri === productImage) : 0;
    openImagePreview(option, nextIndex >= 0 ? nextIndex : 0);
  }, [openImagePreview]);

  // 选中赠品并进入结账
  const handleCheckout = useCallback(() => {
    // VIP 浏览模式物理隔离：任何路径不得写入结算选择
    if (isVip) return;
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
  }, [isVip, selectedIndex, giftOptions, currentPackage, setVipPackageSelection, router]);

  // VIP 浏览模式：分享给好友开通（跳推荐码页，面对面扫码最顺）
  const handleShareToFriend = useCallback(() => {
    router.push('/me/referral');
  }, [router]);

  const handleMemberAgreementPress = useCallback(() => {
    router.push('/member-service-agreement');
  }, [router]);

  // VIP 浏览模式 CTA 恒可点（分享不依赖选中赠品）；非 VIP 需先选赠品
  const ctaEnabled = isVip || selectedIndex !== null;

  // 加载态
  if (isLoading) {
    return (
      <LinearGradient
        colors={[VIP.bgStart, VIP.bgEnd]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <StatusBar style="dark" />
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
      <StatusBar style="dark" />
      <GoldBgGlows />
      <GoldParticles screenWidth={SCREEN_WIDTH} />

      {/* 导航栏 */}
      <View style={[styles.navbar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={VIP.warmWhite} />
        </Pressable>
      </View>

      {/* 可滚动内容 */}
      <Animated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: contentBottomPad }]}
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

        {/* VIP 浏览模式提示条：明确"这不是让你再买"，是给好友看的 */}
        {isVip ? (
          <Animated.View entering={FadeInDown.delay(150).duration(500)} style={styles.vipBrowseBar}>
            <MaterialCommunityIcons name="crown" size={16} color={VIP.goldPrimary} />
            <Text style={styles.vipBrowseText}>您已是 VIP 会员 · 以下为礼包内容，可展示给好友</Text>
          </Animated.View>
        ) : null}

        {/* 价格档位选择 */}
        {packages.length > 0 && (
          <Animated.View entering={FadeInDown.delay(150).duration(500)} style={styles.priceTabs}>
            {packages.map((pkg, index) => (
              <Pressable
                key={pkg.id}
                onPress={() => {
                  setSelectedPackageIndex(index);
                  setSelectedIndex(null);
                  setCurrentIndex(0);
                  flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
                }}
                style={[
                  styles.priceTab,
                  selectedPackageIndex === index && styles.priceTabActive,
                ]}
              >
                <Text {...priceTextProps} style={[
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

        {/* 推荐人提示条（无推荐人且非 VIP 时显示） */}
        {!isVip && (!isLoggedIn || (member && !member.inviterUserId)) ? (
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
                  onOpenImages={() => openImagePreview(item)}
                  cardWidth={CARD_WIDTH}
                  cardSpacing={CARD_SPACING}
                  cardTotalWidth={CARD_TOTAL_WIDTH}
                />
              )}
              ListEmptyComponent={
                <View style={[styles.emptyGifts, { width: SCREEN_WIDTH - 48 }]}>
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
                <IndicatorDot key={i} index={i} scrollX={scrollX} cardTotalWidth={CARD_TOTAL_WIDTH} />
              ))}
              <Text style={styles.indicatorText}>
                {' '}{currentIndex + 1} / {giftOptions.length}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        {selectedGiftOption ? (
          <Animated.View entering={FadeInDown.delay(360).duration(500)} style={styles.giftDetailCard}>
            <View style={styles.giftDetailHeader}>
              <View>
                <Text style={styles.giftDetailEyebrow}>礼包清单</Text>
                <Text style={styles.giftDetailTitle}>{selectedGiftOption.title}</Text>
              </View>
              <Text style={styles.giftDetailCount}>
                共 {selectedGiftOption.items.reduce((sum, item) => sum + item.quantity, 0)} 件
              </Text>
            </View>
            <View style={styles.giftDetailList}>
              {selectedGiftOption.items.map((giftItem, itemIndex) => (
                <View
                  key={`${giftItem.skuId}-${itemIndex}`}
                  style={[
                    styles.giftDetailItem,
                    itemIndex > 0 && styles.giftDetailItemDivider,
                  ]}
                >
                  {giftItem.productImage ? (
                    <Pressable
                      onPress={() => openGiftItemImage(selectedGiftOption, giftItem.productImage)}
                      style={styles.giftDetailThumbPressable}
                    >
                      <Image
                        source={{ uri: giftItem.productImage }}
                        style={styles.giftDetailThumb}
                        contentFit="cover"
                      />
                    </Pressable>
                  ) : (
                    <View style={[styles.giftDetailThumb, styles.giftDetailThumbFallback]}>
                      <MaterialCommunityIcons name="image-off-outline" size={18} color={VIP.goldPrimary} />
                    </View>
                  )}
                  <View style={styles.giftDetailInfo}>
                    <Text style={styles.giftDetailName}>{giftItem.productTitle}</Text>
                    {giftItem.skuTitle ? (
                      <Text style={styles.giftDetailSpec}>{giftItem.skuTitle}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.giftDetailQty}>x{giftItem.quantity}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* VIP 权益横排 */}
        <Animated.View entering={FadeInDown.delay(400).duration(500)} style={styles.benefitsRow}>
          {VIP_BENEFITS.map((b) => (
            <View key={b.label} style={[styles.benefitItem, { width: SCREEN_WIDTH / VIP_BENEFITS.length - 8 }]}>
              <MaterialCommunityIcons name={b.icon} size={22} color={VIP.goldPrimary} />
              <Text style={styles.benefitLabel}>{b.label}</Text>
            </View>
          ))}
        </Animated.View>
      </Animated.ScrollView>

      {/* 底部固定栏 */}
      <View
        onLayout={handleBottomBarLayout}
        style={[styles.bottomBar, compactBottomBar && styles.bottomBarCompact, { paddingBottom: barBottomPad }]}
      >
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
        <View style={[styles.bottomBarContent, compactBottomBar && styles.bottomBarContentCompact]}>
          <View style={[styles.bottomPriceSection, compactBottomBar && styles.bottomPriceSectionCompact]}>
            <Text style={styles.bottomLabel}>{isVip ? 'VIP 礼包' : '开通 VIP'}</Text>
            <Text {...priceTextProps} style={styles.bottomPrice}>¥{vipPrice}</Text>
          </View>
          <Pressable
            onPress={isVip ? handleShareToFriend : handleCheckout}
            disabled={!ctaEnabled}
            style={({ pressed }) => [
              styles.checkoutButton,
              !ctaEnabled && styles.checkoutButtonDisabled,
              pressed && ctaEnabled && styles.checkoutButtonPressed,
            ]}
          >
            <LinearGradient
              colors={ctaEnabled ? [VIP.goldPrimary, VIP.goldLight] : ['#999', '#777']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.checkoutButtonGradient}
            >
              {ctaEnabled ? (
                <GoldShineSweep width={80} duration={3500} travel={300} />
              ) : null}
              <Text
                {...compactActionTextProps}
                style={[
                  styles.checkoutButtonText,
                  !ctaEnabled && styles.checkoutButtonTextDisabled,
                ]}
              >
                {isVip ? '分享给好友开通' : '立即开通'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
        <Text style={styles.bottomHint}>
          {isVip ? '好友支付即开通 VIP · 您可获得推荐奖励' : '支付即开通 VIP'}
        </Text>
        {!isVip ? (
          <View style={styles.memberAgreementPrompt}>
            <Text style={styles.memberAgreementText}>开通前请阅读并同意</Text>
            <Pressable onPress={handleMemberAgreementPress} hitSlop={8}>
              <Text style={styles.memberAgreementLink}>《会员服务协议》</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Modal
        visible={imagePreviewVisible}
        transparent
        animationType="fade"
        onRequestClose={closeImagePreview}
      >
        <View style={styles.previewOverlay}>
          <Pressable onPress={closeImagePreview} hitSlop={12} style={styles.previewCloseButton}>
            <MaterialCommunityIcons name="close" size={26} color="#FFFDF5" />
          </Pressable>
          <FlatList
            ref={previewFlatListRef}
            data={previewImages}
            keyExtractor={(uri, index) => `${uri}-${index}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handlePreviewMomentumEnd}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            renderItem={({ item }) => (
              <View style={[styles.previewImagePage, { width: SCREEN_WIDTH }]}>
                <Image source={{ uri: item }} style={styles.previewImage} contentFit="contain" />
              </View>
            )}
          />
          {previewImages.length > 1 ? (
            <View style={styles.previewCounter}>
              <Text style={styles.previewCounterText}>
                {previewImageIndex + 1} / {previewImages.length}
              </Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </LinearGradient>
  );
}

// ============================================================
// 指示器圆点
// ============================================================
function IndicatorDot({
  index,
  scrollX,
  cardTotalWidth,
}: {
  index: number;
  scrollX: SharedValue<number>;
  cardTotalWidth: number;
}) {
  const inputRange = [
    (index - 1) * cardTotalWidth,
    index * cardTotalWidth,
    (index + 1) * cardTotalWidth,
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
  // 赠品卡片（width / marginRight 通过内联 style 注入，依赖响应式 SCREEN_WIDTH）
  cardWrapper: {},
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
  cardImagePressable: {
    width: '100%',
    height: '100%',
  },
  imagePreviewBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    minWidth: 42,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(26,18,7,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,253,245,0.35)',
  },
  imagePreviewBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFDF5',
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
  // 空状态（width 通过内联 style 注入）
  emptyGifts: {
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
  giftDetailCard: {
    marginHorizontal: 24,
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(184,134,11,0.28)',
    backgroundColor: 'rgba(255,253,245,0.62)',
  },
  giftDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  giftDetailEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: VIP.goldPrimary,
    marginBottom: 4,
  },
  giftDetailTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: VIP.warmWhite,
    lineHeight: 21,
  },
  giftDetailCount: {
    flexShrink: 0,
    fontSize: 12,
    color: VIP.subtleGray,
    marginTop: 2,
  },
  giftDetailList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(184,134,11,0.22)',
  },
  giftDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  giftDetailItemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(184,134,11,0.18)',
  },
  giftDetailThumbPressable: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  giftDetailThumb: {
    width: 54,
    height: 54,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  giftDetailThumbFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  giftDetailInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 10,
  },
  giftDetailName: {
    fontSize: 14,
    fontWeight: '600',
    color: VIP.warmWhite,
    lineHeight: 20,
  },
  giftDetailSpec: {
    fontSize: 12,
    color: VIP.subtleGray,
    lineHeight: 18,
    marginTop: 3,
  },
  giftDetailQty: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: '700',
    color: VIP.goldPrimary,
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
    // width 通过内联 style 注入（依赖响应式 SCREEN_WIDTH）
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
    borderColor: 'rgba(184,134,11,0.3)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  priceTabActive: {
    borderColor: '#C9A96E',
    backgroundColor: 'rgba(184,134,11,0.12)',
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
    borderTopColor: 'rgba(184,134,11,0.15)',
  },
  bottomBarCompact: {
    paddingHorizontal: 16,
  },
  bottomBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomBarContentCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  bottomPriceSection: {
    flex: 1,
  },
  bottomPriceSectionCompact: {
    flex: 0,
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
  memberAgreementPrompt: {
    minHeight: 24,
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  memberAgreementText: {
    fontSize: 12,
    color: VIP.warmWhite,
  },
  memberAgreementLink: {
    fontSize: 12,
    color: VIP.goldPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
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
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
  },
  previewCloseButton: {
    position: 'absolute',
    top: 52,
    right: 18,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  previewImagePage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewCounter: {
    position: 'absolute',
    bottom: 46,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  previewCounterText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFDF5',
  },
  // VIP 浏览模式提示条
  vipBrowseBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 24,
    marginBottom: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: VIP.referralBg,
    borderWidth: 1,
    borderColor: VIP.cardBorder,
    borderRadius: 8,
  },
  vipBrowseText: {
    fontSize: 13,
    color: VIP.warmWhite,
    fontWeight: '600',
    flexShrink: 1,
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
