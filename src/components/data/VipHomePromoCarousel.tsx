import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fitTextProps, priceTextProps, useResponsiveLayout, useTheme } from '../../theme';
import type { VipPackage } from '../../types/domain/Bonus';
import { buildVipHomePromoCards, type VipHomePromoCard } from '../../utils/vipHomePromo';

type VipHomePromoCarouselProps = {
  packages: VipPackage[];
  onPressCard: (card: VipHomePromoCard) => void;
};

const AUTO_PLAY_INTERVAL = 3500;
const RESUME_AFTER_USER_INTERACT = 5000;

// 首页非 VIP 礼包广告位：展示后台 VIP 档位下的主推赠品组合内容（自动轮播 + 用户交互暂停）。
export function VipHomePromoCarousel({ packages, onPressCard }: VipHomePromoCarouselProps) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const { width, isLargeText } = useResponsiveLayout();
  const cards = useMemo(() => buildVipHomePromoCards(packages), [packages]);

  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoPlayPaused, setAutoPlayPaused] = useState(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 大字体/紧凑屏下卡片适度收窄，避免内文拥挤
  const cardWidth = isLargeText
    ? Math.min(220, Math.max(184, width * 0.55))
    : Math.min(246, Math.max(204, width * 0.58));
  const cardStep = cardWidth + 8; // 卡片宽度 + 卡间距 spacing.sm

  // 自动轮播：每 3.5s 切下一张，到尾循环回 0
  useEffect(() => {
    if (autoPlayPaused || cards.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % cards.length;
        scrollRef.current?.scrollTo({ x: next * cardStep, animated: true });
        return next;
      });
    }, AUTO_PLAY_INTERVAL);
    return () => clearInterval(timer);
  }, [autoPlayPaused, cards.length, cardStep]);

  // 用户手动滑动时暂停自动播放，5s 后恢复
  const pauseAutoPlay = () => {
    setAutoPlayPaused(true);
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => setAutoPlayPaused(false), RESUME_AFTER_USER_INTERACT);
  };

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, []);

  const handleMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / cardStep);
    if (idx !== activeIndex && idx >= 0 && idx < cards.length) {
      setActiveIndex(idx);
    }
  };

  if (cards.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.lg }}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleRow}>
          <MaterialCommunityIcons name="crown-outline" size={16} color={colors.brand.primary} />
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 6 }]}>
            VIP 开通礼包
          </Text>
        </View>
        <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
          {cards.length} 个档位可选
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: spacing.xl }]}
        style={{ marginHorizontal: -spacing.xl }}
        onScrollBeginDrag={pauseAutoPlay}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        decelerationRate="fast"
        snapToInterval={cardStep}
        snapToAlignment="start"
      >
        {cards.map((card, index) => (
          <Pressable
            key={`${card.packageId}-${card.giftOptionId}`}
            onPress={() => {
              pauseAutoPlay();
              onPressCard(card);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${card.price}元 VIP 礼包，${card.title}，点击查看赠品详情`}
            style={[
              styles.cardPressable,
              { width: cardWidth, marginRight: index === cards.length - 1 ? 0 : 8 },
            ]}
          >
            <LinearGradient
              colors={['#FFFDF5', '#FFF8E1', '#FFF1C8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[
                styles.card,
                {
                  borderRadius: radius.lg,
                  borderColor: colors.brand.primary,
                },
                shadow.sm,
              ]}
            >
              <View style={styles.cardGlow} />
              <View style={styles.cardHeader}>
                <View>
                  <Text {...priceTextProps} style={styles.priceText}>
                    ¥{Number.isInteger(card.price) ? card.price.toFixed(0) : card.price.toFixed(2)}
                  </Text>
                  <Text style={[styles.packageLabel, { color: colors.text.secondary }]}>
                    VIP 礼包
                  </Text>
                </View>
                <View style={[styles.giftIconBox, { borderColor: colors.brand.primary }]}>
                  <MaterialCommunityIcons name="gift-outline" size={22} color={colors.brand.primary} />
                </View>
              </View>

              <View style={styles.titleRow}>
                <Text
                  {...fitTextProps}
                  style={[styles.giftTitle, { color: colors.brand.primaryDark }]}
                >
                  {card.title}
                </Text>
                {card.badge ? (
                  <View style={[styles.badge, { borderColor: colors.brand.primary, backgroundColor: colors.brand.primarySoft }]}>
                    <Text style={[styles.badgeText, { color: colors.brand.primaryDark }]} numberOfLines={1}>
                      {card.badge}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={[styles.subtitle, { color: colors.text.secondary }]} numberOfLines={2}>
                {card.subtitle}
              </Text>

              <View style={styles.itemsBox}>
                {card.itemLines.length > 0 ? (
                  card.itemLines.map((line, lineIndex) => (
                    <View
                      key={`${card.packageId}-${card.giftOptionId}-line-${lineIndex}`}
                      style={styles.itemLine}
                    >
                      <View style={[styles.itemDot, { backgroundColor: colors.brand.primary }]} />
                      <Text style={[styles.itemText, { color: colors.text.primary }]} numberOfLines={1}>
                        {line}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={[styles.emptyItemsText, { color: colors.text.tertiary }]}>
                    开通后选择该档位赠品
                  </Text>
                )}
              </View>

            </LinearGradient>
          </Pressable>
        ))}
      </ScrollView>

      {cards.length > 1 ? (
        <View style={styles.dotsRow}>
          {cards.map((card, index) => (
            <View
              key={`dot-${card.packageId}-${card.giftOptionId}`}
              style={[
                styles.dot,
                index === activeIndex
                  ? { backgroundColor: colors.brand.primary, width: 16 }
                  : { backgroundColor: colors.border },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listContent: {
    paddingVertical: 2,
  },
  cardPressable: {
    minHeight: 176,
  },
  card: {
    minHeight: 176,
    padding: 14,
    overflow: 'hidden',
    borderWidth: 1.2,
  },
  cardGlow: {
    position: 'absolute',
    right: -38,
    bottom: -42,
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: 'rgba(212, 160, 23, 0.10)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  priceText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#B8860B',
    lineHeight: 26,
  },
  packageLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  giftIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46, 125, 50, 0.08)',
    borderWidth: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  giftTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19,
  },
  badge: {
    marginLeft: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 54,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  itemsBox: {
    marginTop: 8,
    gap: 4,
  },
  itemLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginRight: 6,
  },
  itemText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  emptyItemsText: {
    fontSize: 11,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
