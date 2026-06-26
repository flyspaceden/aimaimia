import React from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { AppHeader, Screen } from '../../src/components/layout';
import { Skeleton, useToast } from '../../src/components/feedback';
import { AiDivider } from '../../src/components/ui';
import { FloatingParticles } from '../../src/components/effects/FloatingParticles';
import { BonusRepo, CouponRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useBottomInset, useTheme } from '../../src/theme';
import { monoFamily } from '../../src/theme/typography';
import { getReferralInviterLabel, hasBoundReferralInviter } from '../../src/utils/referralRelation';

// 推荐码展示页
export default function ReferralScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  // 非 VIP 分支底部双按钮（"扫描推荐码" / "了解 VIP"）需要吃 safe area，
  // 否则在华为/Honor/小米 3 键虚拟键设备上会被系统按钮挡住
  const bottomPadding = useBottomInset(0);

  const { data, isLoading } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });

  const member = data?.ok ? data.data : null;
  const isVip = member?.tier === 'VIP';
  const referralCode = isVip ? (member?.referralCode ?? '') : '';
  const deepLink = `https://app.ai-maimai.com/r/${referralCode}`;
  const inviterLabel = getReferralInviterLabel(member);
  const hasInviter = hasBoundReferralInviter(member);
  const inviteeVipCount = member?.inviteeVipCount ?? 0;

  // 复制推荐码
  const handleCopy = async () => {
    if (!referralCode) {
      show({ message: '暂无可复制的推荐码', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(referralCode);
    show({ message: '推荐码已复制', type: 'success' });
  };

  // 分享推荐码
  const handleShare = async () => {
    if (!referralCode) {
      show({ message: '暂无可分享的推荐码', type: 'info' });
      return;
    }
    try {
      const result = await Share.share({
        message: `我在爱买买发现了优质农产品，使用我的推荐码 ${referralCode} 注册，双方都能获得红包奖励！${deepLink}`,
      });
      if (result.action === Share.sharedAction) {
        CouponRepo.reportShareEvent({
          scene: 'REFERRAL',
          targetId: referralCode || 'GLOBAL',
        }).catch(() => {});
      }
    } catch {
      // 用户取消分享，不需处理
    }
  };

  // 推荐步骤数据
  const steps = [
    { icon: 'share-variant-outline' as const, label: '分享' },
    { icon: 'account-plus-outline' as const, label: '好友注册' },
    { icon: 'gift-outline' as const, label: '双方获红包' },
  ];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="我的推荐码"
        rightSlot={
          <Pressable onPress={() => router.push('/me/scanner')} hitSlop={10}>
            <MaterialCommunityIcons name="qrcode-scan" size={22} color={colors.text.primary} />
          </Pressable>
        }
      />

      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={400} radius={radius.xl} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={140} radius={radius.lg} />
        </View>
      ) : !isVip ? (
        <View style={[styles.nonVipContainer, { padding: spacing.xl, paddingBottom: spacing.xl + bottomPadding }]}>
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={[styles.bindingCard, shadow.sm, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}
          >
            <View style={[styles.bindingIcon, { backgroundColor: hasInviter ? colors.brand.primarySoft : colors.background }]}>
              <MaterialCommunityIcons
                name={hasInviter ? 'account-heart-outline' : 'qrcode-scan'}
                size={30}
                color={hasInviter ? colors.brand.primary : colors.muted}
              />
            </View>
            <Text style={[typography.headingSm, { color: colors.text.primary, marginTop: spacing.md, textAlign: 'center' }]}>
              {hasInviter ? '已绑定推荐人' : '尚未绑定推荐人'}
            </Text>
            {hasInviter ? (
              <>
                <Text style={[typography.bodyStrong, { color: colors.brand.primary, marginTop: spacing.sm, textAlign: 'center' }]}>
                  {inviterLabel}
                </Text>
                <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: spacing.xs, textAlign: 'center' }]}>
                  购买 VIP 后将加入该推荐人的 VIP 团队
                </Text>
              </>
            ) : null}
          </Animated.View>

          <View style={styles.nonVipActions}>
            <Pressable
              onPress={() => router.push('/me/scanner')}
              style={[styles.primaryBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <MaterialCommunityIcons name="qrcode-scan" size={17} color="#FFFFFF" />
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: '#FFFFFF', marginLeft: 6 }]}>
                扫描推荐码
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => router.push('/me/vip')}
            style={[styles.secondaryBtn, { borderColor: colors.border, borderRadius: radius.pill }]}
          >
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
              了解 VIP
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ flex: 1, padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
          {/* 渐变英雄卡 */}
          <Animated.View entering={FadeInDown.duration(400)}>
            <LinearGradient
              colors={[...gradients.aiGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.heroCard, shadow.lg, { borderRadius: radius.xl }]}
            >
              {/* 粒子效果 */}
              <FloatingParticles count={8} color={colors.ai.glow} />

              {/* 标题行 */}
              <View style={styles.titleRow}>
                <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>我的专属推荐码</Text>
              </View>

              {/* QR 码容器 */}
              <Animated.View
                entering={FadeInDown.duration(400).delay(100)}
                style={[styles.qrContainer, shadow.lg, { borderRadius: radius.xl, backgroundColor: '#FFFFFF' }]}
              >
                {referralCode ? (
                  <QRCode
                    value={deepLink}
                    size={180}
                    color={colors.brand.primaryDark}
                    backgroundColor="#FFFFFF"
                  />
                ) : (
                  <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[typography.caption, { color: colors.muted }]}>暂无推荐码</Text>
                  </View>
                )}
              </Animated.View>

              {/* 推荐码文字 */}
              <Animated.View entering={FadeInDown.duration(400).delay(200)}>
                <Text style={styles.codeText}>
                  {referralCode.split('').join(' ')}
                </Text>
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(400).delay(250)} style={styles.inviteeCountRow}>
                <MaterialCommunityIcons name="account-star-outline" size={16} color="#FFFFFF" />
                <Text style={[typography.caption, { color: '#FFFFFF', marginLeft: 6 }]}>
                  已推荐 {inviteeVipCount} 位 VIP
                </Text>
              </Animated.View>

              {/* 操作按钮 */}
              <Animated.View entering={FadeInDown.duration(400).delay(300)} style={styles.actionRow}>
                <Pressable
                  onPress={handleCopy}
                  style={[styles.outlineBtn, { borderRadius: radius.pill }]}
                >
                  <MaterialCommunityIcons name="content-copy" size={16} color="#FFFFFF" />
                  <Text style={[typography.bodySm, { color: '#FFFFFF', marginLeft: 6 }]}>复制推荐码</Text>
                </Pressable>

                <View style={{ width: spacing.md }} />

                <Pressable onPress={handleShare} style={{ flex: 1 }}>
                  <LinearGradient
                    colors={[...gradients.goldGradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.shareBtn, { borderRadius: radius.pill }]}
                  >
                    <MaterialCommunityIcons name="shimmer" size={16} color="#FFFFFF" />
                    <Text style={[typography.bodyStrong, { color: '#FFFFFF', marginLeft: 6 }]}>分享给好友</Text>
                  </LinearGradient>
                </Pressable>
              </Animated.View>
            </LinearGradient>
          </Animated.View>

          {/* 推荐奖励说明卡片 */}
          <Animated.View
            entering={FadeInDown.duration(400).delay(400)}
            style={[styles.rewardCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }]}
          >
            <Text style={[typography.headingSm, { color: colors.text.primary }]}>推荐奖励</Text>
            <AiDivider style={{ marginVertical: spacing.sm }} />

            {/* 3步图示 */}
            <View style={styles.stepsRow}>
              {steps.map((step, index) => (
                <React.Fragment key={step.label}>
                  <View style={styles.stepItem}>
                    <View style={[styles.stepIcon, { backgroundColor: colors.brand.primarySoft }]}>
                      <MaterialCommunityIcons name={step.icon} size={24} color={colors.brand.primary} />
                    </View>
                    <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 6 }]}>
                      {step.label}
                    </Text>
                  </View>
                  {index < steps.length - 1 && (
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={18}
                      color={colors.muted}
                      style={{ marginTop: -10 }}
                    />
                  )}
                </React.Fragment>
              ))}
            </View>

            <Text style={[typography.caption, { color: colors.text.secondary, textAlign: 'center', marginTop: spacing.md }]}>
              分享推荐码，好友注册后双方获得红包奖励
            </Text>
          </Animated.View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nonVipContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  bindingCard: {
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
  },
  bindingIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nonVipActions: {
    marginTop: 18,
  },
  primaryBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryBtn: {
    minHeight: 48,
    marginTop: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  heroCard: {
    padding: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginBottom: 20,
    zIndex: 1,
  },
  qrContainer: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  codeText: {
    fontFamily: monoFamily,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    color: '#FFFFFF',
    marginTop: 20,
    textAlign: 'center',
    zIndex: 1,
  },
  inviteeCountRow: {
    minHeight: 28,
    marginTop: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    zIndex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 20,
    width: '100%',
    zIndex: 1,
  },
  outlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  rewardCard: {
    padding: 16,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  stepItem: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  stepIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
