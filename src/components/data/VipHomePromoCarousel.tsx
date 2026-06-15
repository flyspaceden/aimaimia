import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fitTextProps, priceTextProps, useResponsiveLayout, useTheme } from '../../theme';
import type { VipPackage } from '../../types/domain/Bonus';
import {
  buildVipHomePromoCards,
  getVipPromoCarouselCopy,
  type VipHomePromoCard,
  type VipPromoMode,
} from '../../utils/vipHomePromo';

type VipHomePromoCarouselProps = {
  packages: VipPackage[];
  onPressCard: (card: VipHomePromoCard) => void;
  // purchase = 非 VIP 购买语境（默认，现有调用零破坏）；referral = VIP 推荐语境，仅替换标题与无障碍文案
  mode?: VipPromoMode;
};

// 每秒平移多少 dp，太大眼花、太小停滞，28dp/s 在 240dp 卡上等价一张约 8.5s 走完
const SCROLL_SPEED_DP_PER_SEC = 28;

// 首页非 VIP 礼包广告位：连续顺滑滚动的跑马灯（复制一份卡片实现无缝循环）
export function VipHomePromoCarousel({ packages, onPressCard, mode = 'purchase' }: VipHomePromoCarouselProps) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const { width, isLargeText } = useResponsiveLayout();
  const cards = useMemo(() => buildVipHomePromoCards(packages), [packages]);
  const copy = getVipPromoCarouselCopy(mode);

  // 大字体/紧凑屏下卡片适度收窄，避免内文拥挤
  const cardWidth = isLargeText
    ? Math.min(220, Math.max(184, width * 0.55))
    : Math.min(246, Math.max(204, width * 0.58));
  const cardStep = cardWidth + 8;
  // 复制一份卡片以实现无缝循环：translateX 跑到 -loopDistance 时，
  // 视觉位置等同于 0（第二组的开头与第一组的开头屏幕位置一致），瞬时 reset 用户察觉不到
  const loopCards = useMemo(
    () => (cards.length > 1 ? [...cards, ...cards] : cards),
    [cards],
  );
  const loopDistance = cardStep * cards.length;

  const translateX = useRef(new Animated.Value(0)).current;
  // 自驱动循环（替代 Animated.loop）使我们能在长按时停在当前位置，松开后从该位置续滑
  const currentXRef = useRef(0);
  const pausedRef = useRef(false);

  const runOneCycle = useCallback(() => {
    if (pausedRef.current || cards.length <= 1 || loopDistance <= 0) return;
    const start = currentXRef.current; // ≤ 0
    const remaining = loopDistance + start;
    if (remaining <= 0) {
      // 已到/越过尾部，重置后继续
      translateX.setValue(0);
      currentXRef.current = 0;
      runOneCycle();
      return;
    }
    const duration = (remaining / SCROLL_SPEED_DP_PER_SEC) * 1000;
    Animated.timing(translateX, {
      toValue: -loopDistance,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        // 自然滑到 -loopDistance：复制卡组让该位置视觉等同 0，瞬时 reset 用户无感
        translateX.setValue(0);
        currentXRef.current = 0;
        if (!pausedRef.current) runOneCycle();
      }
      // !finished → 被 stopAnimation 打断，currentXRef 已由 handlePressIn 捕获
    });
  }, [cards.length, loopDistance, translateX]);

  useEffect(() => {
    currentXRef.current = 0;
    pausedRef.current = false;
    translateX.setValue(0);
    runOneCycle();
    return () => {
      translateX.stopAnimation();
    };
  }, [cards.length, loopDistance, runOneCycle, translateX]);

  const handlePressIn = useCallback(() => {
    pausedRef.current = true;
    translateX.stopAnimation((value) => {
      currentXRef.current = value;
    });
  }, [translateX]);

  const handlePressOut = useCallback(() => {
    pausedRef.current = false;
    runOneCycle();
  }, [runOneCycle]);

  if (cards.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.lg }}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleRow}>
          <MaterialCommunityIcons name="crown-outline" size={16} color={colors.brand.primary} />
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 6 }]}>
            {copy.title}
          </Text>
        </View>
        <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
          {cards.length} 个档位可选
        </Text>
      </View>

      <View
        style={[
          styles.marqueeViewport,
          { marginHorizontal: -spacing.xl, paddingLeft: spacing.xl },
        ]}
      >
        <Animated.View style={[styles.marqueeTrack, { transform: [{ translateX }] }]}>
          {loopCards.map((card, index) => (
            <Pressable
              key={`${card.packageId}-${card.giftOptionId}-${index}`}
              onPress={() => onPressCard(card)}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              accessibilityRole="button"
              accessibilityLabel={`${card.price}元 VIP 礼包，${card.title}，${copy.cardActionHint}`}
              style={[styles.cardPressable, { width: cardWidth, marginRight: 8 }]}
            >
              <LinearGradient
                colors={['#FFFDF5', '#FFF8E1', '#FFF1C8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.card,
                  { borderRadius: radius.lg, borderColor: colors.brand.primary },
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
                    <View
                      style={[
                        styles.badge,
                        {
                          borderColor: colors.brand.primary,
                          backgroundColor: colors.brand.primarySoft,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.badgeText, { color: colors.brand.primaryDark }]}
                        numberOfLines={1}
                      >
                        {card.badge}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text style={[styles.subtitle, { color: colors.text.secondary }]} numberOfLines={2}>
                  {card.subtitle}
                </Text>
              </LinearGradient>
            </Pressable>
          ))}
        </Animated.View>
      </View>
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
  marqueeViewport: {
    overflow: 'hidden',
  },
  marqueeTrack: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  cardPressable: {
    height: 154,
  },
  card: {
    height: 154,
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
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
  },
});
