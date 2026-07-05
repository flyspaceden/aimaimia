import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ErrorState, Skeleton } from '../feedback';
import { AvatarFrame } from '../ui';
import { compactActionTextProps, fitTextProps, useTheme } from '../../theme';
import { monoFamily } from '../../theme/typography';
import type { UserProfile } from '../../types';

type MeIdentityCardProps = {
  isLoggedIn: boolean;
  profileLoading: boolean;
  profile: UserProfile | null;
  compact: boolean;
  assetRankLabel: string;
  referralCode: string;
  showNormalShareEntry: boolean;
  style?: StyleProp<ViewStyle>;
  onScanPress: () => void;
  onLoginPress: () => void;
  onAppearancePress: () => void;
  onProfilePress: () => void;
  onCopyBuyerNo: () => void;
  onReferralPress: () => void;
  onNormalSharePress: () => void;
  onDigitalAssetsPress: () => void;
  onRetryProfile: () => void;
};

export function MeIdentityCard({
  isLoggedIn,
  profileLoading,
  profile,
  compact,
  assetRankLabel,
  referralCode,
  showNormalShareEntry,
  style,
  onScanPress,
  onLoginPress,
  onAppearancePress,
  onProfilePress,
  onCopyBuyerNo,
  onReferralPress,
  onNormalSharePress,
  onDigitalAssetsPress,
  onRetryProfile,
}: MeIdentityCardProps) {
  const { colors, radius, shadow, spacing, typography } = useTheme();

  if (!isLoggedIn) {
    return (
      <View style={style}>
        <Animated.View
          entering={FadeInDown.duration(300)}
          style={[
            styles.loginCard,
            compact && styles.loginCardCompact,
            { backgroundColor: colors.surface, borderRadius: radius.lg },
            shadow.sm,
          ]}
        >
          <View style={styles.loginInfo}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>登录/注册</Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              登录后解锁会员权益与订单追踪
            </Text>
          </View>
          <View style={[styles.loginActions, compact && styles.loginActionsCompact]}>
            <Pressable
              onPress={onScanPress}
              hitSlop={10}
              style={[styles.scanIconBtn, { borderColor: colors.border, marginRight: 10 }]}
            >
              <MaterialCommunityIcons name="qrcode-scan" size={20} color={colors.brand.primary} />
            </Pressable>
            <Pressable
              onPress={onLoginPress}
              style={[styles.loginButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>立即登录/注册</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    );
  }

  if (profileLoading) {
    return (
      <View style={style}>
        <Skeleton height={140} radius={radius.lg} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={style}>
        <ErrorState title="资料加载失败" description="请稍后重试" onAction={onRetryProfile} />
      </View>
    );
  }

  return (
    <View style={style}>
      <LinearGradient
        colors={[`${colors.brand.primary}10`, `${colors.ai.start}08`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.userCard, { borderRadius: radius.lg }]}
      >
        <View style={[styles.userCardTop, compact && styles.userCardTopCompact]}>
          <Pressable onPress={onAppearancePress}>
            <AvatarFrame uri={profile.avatar} size={64} frame={profile.avatarFrame} />
          </Pressable>
          <View style={styles.userCardInfo}>
            <View style={styles.profileIdentityStack}>
              <Text
                {...fitTextProps}
                numberOfLines={compact ? 2 : 1}
                style={[typography.headingSm, styles.profileNameText, { color: colors.text.primary }]}
              >
                {profile.name}
              </Text>
            </View>
          </View>
          <View style={styles.userCardActions}>
            <Pressable
              onPress={onScanPress}
              hitSlop={8}
              style={[styles.actionChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <MaterialCommunityIcons name="qrcode-scan" size={14} color={colors.brand.primary} />
              <Text {...compactActionTextProps} style={[typography.captionSm, { color: colors.text.secondary, marginLeft: 4 }]}>扫一扫</Text>
            </Pressable>
            <Pressable
              onPress={onProfilePress}
              style={[styles.actionChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.text.secondary} />
              <Text {...compactActionTextProps} style={[typography.captionSm, { color: colors.text.secondary, marginLeft: 4 }]}>编辑</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.profileMetaStack}>
          <Pressable
            onPress={onCopyBuyerNo}
            style={[styles.buyerNoChip, { backgroundColor: colors.gold.light, borderRadius: radius.pill }]}
            accessibilityRole="button"
            accessibilityLabel="复制用户编号"
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.9}
              style={[styles.buyerNoText, { color: colors.gold.primary, fontFamily: monoFamily }]}
            >
              {profile.buyerNo ? `ID: ${profile.buyerNo}` : 'ID: 用户编号生成中'}
            </Text>
            <MaterialCommunityIcons
              name="content-copy"
              size={18}
              color={colors.gold.primary}
              style={{ marginLeft: 6 }}
            />
          </Pressable>
          <View style={styles.profileMetaBottomRow}>
            {referralCode ? (
              <Pressable
                onPress={onReferralPress}
                style={[styles.referralChip, { backgroundColor: colors.ai.soft, borderRadius: radius.pill }]}
              >
                <MaterialCommunityIcons name="qrcode" size={15} color={colors.ai.start} />
                <Text {...compactActionTextProps} style={[typography.captionSm, { color: colors.ai.start, marginLeft: 3 }]}>推荐码</Text>
              </Pressable>
            ) : showNormalShareEntry ? (
              <Pressable
                onPress={onNormalSharePress}
                style={[styles.normalShareChip, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill }]}
              >
                <MaterialCommunityIcons name="sprout-outline" size={15} color={colors.brand.primary} />
                <Text {...compactActionTextProps} style={[typography.captionSm, { color: colors.brand.primary, marginLeft: 3 }]}>普通推荐码</Text>
              </Pressable>
            ) : <View />}
            <Pressable
              onPress={onDigitalAssetsPress}
              style={[styles.assetRankChip, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill }]}
              accessibilityRole="button"
              accessibilityLabel={`数字资产排行榜${assetRankLabel}`}
            >
              <MaterialCommunityIcons name="chart-bar" size={14} color={colors.brand.primary} />
              <Text
                {...compactActionTextProps}
                numberOfLines={1}
                style={[styles.assetRankText, { color: colors.brand.primary }]}
              >
                数字资产排行榜：{assetRankLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  referralChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  normalShareChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  assetRankChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    minWidth: 0,
    maxWidth: '68%',
  },
  assetRankText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginLeft: 3,
    minWidth: 0,
    flexShrink: 1,
  },
  loginCard: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loginCardCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  loginInfo: {
    flex: 1,
    marginRight: 12,
  },
  loginActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loginActionsCompact: {
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  scanIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  userCard: {
    padding: 16,
    overflow: 'hidden',
  },
  userCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userCardTopCompact: {
    alignItems: 'flex-start',
  },
  userCardInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 10,
    minWidth: 0,
  },
  profileIdentityStack: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 7,
  },
  profileNameText: {
    alignSelf: 'stretch',
  },
  profileMetaStack: {
    alignSelf: 'stretch',
    marginTop: 12,
    gap: 8,
  },
  profileMetaBottomRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  buyerNoChip: {
    alignSelf: 'stretch',
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  buyerNoText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    minWidth: 0,
    flexShrink: 1,
  },
  userCardActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minWidth: 86,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
});
