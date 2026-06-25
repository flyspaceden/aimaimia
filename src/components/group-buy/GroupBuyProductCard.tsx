import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { compactActionTextProps, fitTextProps, priceTextProps, useTheme } from '../../theme';
import type { GroupBuyActivity } from '../../types';
import { getGroupBuyCountdownState } from '../../utils/groupBuyCountdown';
import { Countdown } from '../ui/Countdown';
import { GROUP_BUY_COLORS } from './constants';

type GroupBuyProductCardProps = {
  activity: GroupBuyActivity;
  onPress?: () => void;
  onPurchase?: () => void;
  onExpire?: () => void;
  featured?: boolean;
};

const formatPrice = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

export const GroupBuyProductCard = ({
  activity,
  onPress,
  onPurchase,
  onExpire,
  featured = false,
}: GroupBuyProductCardProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const [clockState, setClockState] = useState(() => getGroupBuyCountdownState(activity.endAt));
  const activityEnded = activity.status === 'ENDED' || clockState.expired;
  const countdownUrgent = !activityEnded && clockState.urgent;
  const availableStock = activityEnded ? 0 : activity.availableStock ?? activity.sku.stock;
  const stockLabel = activityEnded ? '活动已结束' : availableStock > 0 ? `可购 ${availableStock} 份` : '暂时无货';
  const itemSummary = activity.itemSummary || `${activity.product.title} · ${activity.sku.title}`;

  useEffect(() => {
    setClockState(getGroupBuyCountdownState(activity.endAt));
  }, [activity.id, activity.endAt]);

  const handleExpire = () => {
    setClockState({ expired: true, urgent: false });
    onExpire?.();
  };

  const handleCountdownTick = (remainingMs: number) => {
    setClockState({
      expired: remainingMs <= 0,
      urgent: remainingMs > 0 && remainingMs < 24 * 60 * 60 * 1000,
    });
  };

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        shadow.sm,
        {
          borderRadius: 8,
          backgroundColor: colors.surface,
          borderColor: featured ? `${GROUP_BUY_COLORS.brass}66` : colors.border,
        },
      ]}
    >
      <View style={[styles.imageWrap, { borderRadius: 8, backgroundColor: GROUP_BUY_COLORS.mist }]}>
        {activity.product.imageUrl ? (
          <Image
            source={{ uri: activity.product.imageUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={160}
          />
        ) : (
          <View style={styles.imageFallback}>
            <MaterialCommunityIcons name="shopping-outline" size={30} color={GROUP_BUY_COLORS.tide} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(18,55,42,0.72)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.imageMetaRow}>
          <View style={[styles.badge, { backgroundColor: 'rgba(255,253,246,0.92)' }]}>
            <MaterialCommunityIcons name="tag-outline" size={13} color={GROUP_BUY_COLORS.tide} />
            <Text {...compactActionTextProps} style={[typography.caption, styles.badgeText, { color: GROUP_BUY_COLORS.pine }]}>
              团购商品
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: activity.freeShipping ? GROUP_BUY_COLORS.tide : 'rgba(255,253,246,0.92)' }]}>
            <MaterialCommunityIcons
              name={activity.freeShipping ? 'truck-check-outline' : 'truck-outline'}
              size={13}
              color={activity.freeShipping ? '#FFFFFF' : GROUP_BUY_COLORS.tide}
            />
            <Text
              {...compactActionTextProps}
              style={[
                typography.caption,
                styles.badgeText,
                { color: activity.freeShipping ? '#FFFFFF' : GROUP_BUY_COLORS.pine },
              ]}
            >
              {activity.freeShipping ? '包邮' : '按配置运费'}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.body, { padding: spacing.md }]}>
        <Text {...fitTextProps} style={[typography.headingSm, { color: colors.text.primary }]}>
          {activity.title}
        </Text>
        <Text
          {...fitTextProps}
          style={[typography.bodySm, { color: colors.text.secondary, marginTop: 4 }]}
        >
          {itemSummary}
        </Text>

        {activity.endAt ? (
          <View
            style={[
              styles.countdownStrip,
              {
                backgroundColor: countdownUrgent ? '#FFF1EC' : GROUP_BUY_COLORS.porcelain,
                borderColor: countdownUrgent ? `${GROUP_BUY_COLORS.coral}66` : GROUP_BUY_COLORS.mist,
                marginTop: spacing.sm,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={countdownUrgent ? 'timer-alert-outline' : 'clock-outline'}
              size={14}
              color={activityEnded ? GROUP_BUY_COLORS.inkSoft : countdownUrgent ? GROUP_BUY_COLORS.coral : GROUP_BUY_COLORS.tide}
            />
            {activityEnded ? (
              <Text {...compactActionTextProps} style={[typography.caption, styles.countdownText, { color: GROUP_BUY_COLORS.inkSoft }]}>
                活动已结束
              </Text>
            ) : (
              <Countdown
                expiresAt={activity.endAt}
                format="days-hours-minutes"
                prefix={countdownUrgent ? '活动即将结束' : '剩余'}
                onExpire={handleExpire}
                onTick={handleCountdownTick}
                {...compactActionTextProps}
                style={[
                  typography.caption,
                  styles.countdownText,
                  countdownUrgent && styles.countdownTextUrgent,
                  { color: countdownUrgent ? GROUP_BUY_COLORS.coral : GROUP_BUY_COLORS.tide },
                ]}
              />
            )}
          </View>
        ) : null}

        <View style={[styles.infoRow, { marginTop: spacing.md }]}>
          <View style={styles.priceBlock}>
            <Text {...priceTextProps} style={[typography.headingMd, styles.priceText, { color: GROUP_BUY_COLORS.coral }]}>
              {formatPrice(activity.price)}
            </Text>
            <Text {...fitTextProps} style={[typography.caption, { color: colors.text.tertiary, marginTop: 2 }]}>
              团购价
            </Text>
          </View>
          <View style={[styles.stockPill, { borderColor: colors.border, backgroundColor: colors.bgSecondary }]}>
            <Text {...compactActionTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
              {stockLabel}
            </Text>
          </View>
        </View>

        <View style={[styles.footerRow, { marginTop: spacing.md }]}>
          <Text
            numberOfLines={2}
            style={[typography.caption, styles.shippingText, { color: GROUP_BUY_COLORS.inkSoft }]}
          >
            {activity.shippingSummary}
          </Text>
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onPurchase?.();
            }}
            disabled={availableStock <= 0}
            style={[
              styles.buyButton,
              {
                borderRadius: radius.pill,
                backgroundColor: availableStock > 0 ? GROUP_BUY_COLORS.pine : colors.bgSecondary,
              },
            ]}
          >
            <Text
              {...compactActionTextProps}
              style={[typography.bodyStrong, { color: availableStock > 0 ? '#FFFFFF' : colors.muted }]}
            >
              {activityEnded ? '已结束' : '购买'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageWrap: {
    height: 170,
    overflow: 'hidden',
  },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageMetaRow: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  badge: {
    minHeight: 26,
    maxWidth: '56%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    marginLeft: 4,
  },
  body: {},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  priceBlock: {
    flex: 1,
    minWidth: 0,
  },
  priceText: {
    fontWeight: '800',
  },
  stockPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  countdownStrip: {
    alignSelf: 'flex-start',
    minHeight: 28,
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countdownText: {
    marginLeft: 5,
  },
  countdownTextUrgent: {
    fontWeight: '800',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shippingText: {
    flex: 1,
    minWidth: 0,
  },
  buyButton: {
    minWidth: 82,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});
