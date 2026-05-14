import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { priceTextProps, useTheme } from '../../theme';
import type { VipPackage } from '../../types/domain/Bonus';
import { buildVipHomePromoCards, type VipHomePromoCard } from '../../utils/vipHomePromo';

type VipHomePromoCarouselProps = {
  packages: VipPackage[];
  onPressCard: (card: VipHomePromoCard) => void;
};

// 首页非 VIP 礼包广告位：展示后台 VIP 档位下的主推赠品组合内容。
export function VipHomePromoCarousel({ packages, onPressCard }: VipHomePromoCarouselProps) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const { width } = useWindowDimensions();
  const cards = useMemo(() => buildVipHomePromoCards(packages), [packages]);

  if (cards.length === 0) return null;

  const cardWidth = Math.min(246, Math.max(204, width * 0.58));

  return (
    <View style={{ marginTop: spacing.lg }}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleRow}>
          <MaterialCommunityIcons name="crown-outline" size={16} color="#8A6418" />
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: 6 }]}>
            VIP 开通礼包
          </Text>
        </View>
        <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
          {cards.length} 个档位可选
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: spacing.xl }]}
        style={{ marginHorizontal: -spacing.xl }}
      >
        {cards.map((card, index) => (
          <Pressable
            key={`${card.packageId}-${card.giftOptionId}`}
            onPress={() => onPressCard(card)}
            accessibilityRole="button"
            accessibilityLabel={`${card.price}元 VIP 礼包，${card.title}，点击查看赠品详情`}
            style={[
              styles.cardPressable,
              { width: cardWidth, marginRight: index === cards.length - 1 ? 0 : spacing.sm },
            ]}
          >
            <LinearGradient
              colors={['#0A1F1A', '#173321', '#3A2D12']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.card, { borderRadius: radius.lg }, shadow.sm]}
            >
              <View style={styles.cardGlow} />
              <View style={styles.cardHeader}>
                <View>
                  <Text {...priceTextProps} style={styles.priceText}>
                    ¥{Number.isInteger(card.price) ? card.price.toFixed(0) : card.price.toFixed(2)}
                  </Text>
                  <Text style={styles.packageLabel}>VIP 礼包</Text>
                </View>
                <View style={styles.giftIconBox}>
                  <MaterialCommunityIcons name="gift-outline" size={22} color="#F5E6B8" />
                </View>
              </View>

              <View style={styles.titleRow}>
                <Text style={styles.giftTitle} numberOfLines={1}>
                  {card.title}
                </Text>
                {card.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText} numberOfLines={1}>{card.badge}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.subtitle} numberOfLines={2}>
                {card.subtitle}
              </Text>

              <View style={styles.itemsBox}>
                {card.itemLines.length > 0 ? (
                  card.itemLines.map((line) => (
                    <View key={line} style={styles.itemLine}>
                      <View style={styles.itemDot} />
                      <Text style={styles.itemText} numberOfLines={1}>
                        {line}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyItemsText}>开通后选择该档位赠品</Text>
                )}
              </View>

              <View style={styles.footerRow}>
                <Text style={styles.footerMuted}>
                  {card.giftCount > 1 ? `${card.giftCount} 款可选` : '当前主推'}
                </Text>
                {card.totalPrice > 0 ? (
                  <Text style={styles.footerValue}>参考价 ¥{card.totalPrice.toFixed(0)}</Text>
                ) : null}
              </View>
            </LinearGradient>
          </Pressable>
        ))}
      </ScrollView>
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
    borderWidth: 1,
    borderColor: 'rgba(201, 169, 110, 0.32)',
  },
  cardGlow: {
    position: 'absolute',
    right: -38,
    bottom: -42,
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: 'rgba(245, 230, 184, 0.14)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  priceText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F5E6B8',
    lineHeight: 26,
  },
  packageLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.58)',
    marginTop: 2,
  },
  giftIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 230, 184, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 230, 184, 0.22)',
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
    color: '#FFF7DC',
    lineHeight: 19,
  },
  badge: {
    marginLeft: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(245, 230, 184, 0.42)',
    backgroundColor: 'rgba(245, 230, 184, 0.12)',
    maxWidth: 54,
  },
  badgeText: {
    fontSize: 10,
    color: '#F5E6B8',
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.72)',
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
    backgroundColor: '#F5E6B8',
    marginRight: 6,
  },
  itemText: {
    flex: 1,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    lineHeight: 15,
  },
  emptyItemsText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.11)',
  },
  footerMuted: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.58)',
  },
  footerValue: {
    fontSize: 11,
    color: '#FFF7DC',
    fontWeight: '600',
  },
});
