import React, { useState } from 'react';
import { Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AiBadge } from '../../src/components/ui';
import { FloatingParticles } from '../../src/components/effects/FloatingParticles';
import { BonusRepo, UserRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { monoFamily } from '../../src/theme/typography';

// VIP 专属空间色彩（与 gifts 页一致）
const VIP_COLORS = {
  bgStart: '#0A1F1A',
  bgMid: '#0F1A14',
  bgEnd: '#0D0D0D',
  goldPrimary: '#C9A96E',
  goldLight: '#E8D5A3',
  goldDim: 'rgba(201,169,110,0.6)',
  warmWhite: '#F5F0E8',
  subtleGray: '#8A8578',
  cardBg: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(201,169,110,0.2)',
  divider: 'rgba(201,169,110,0.12)',
  highlightBg: 'rgba(201,169,110,0.08)',
};

// VIP 专属权益数据
const VIP_BENEFITS = [
  {
    icon: 'chart-areaspline' as const,
    title: '消费奖励翻倍',
    desc: '每笔消费均可获得丰厚奖励返现',
    highlight: '高额返利',
    compare: '比普通用户更高',
  },
  {
    icon: 'account-cash' as const,
    title: '推荐 VIP 奖励',
    desc: '每成功推荐一位好友成为 VIP，即得现金奖励',
    highlight: '推荐有奖',
    compare: '即时到账',
  },
  {
    icon: 'tag-minus-outline' as const,
    title: '专属商品折扣',
    desc: '全场商品享受 VIP 专属价',
    highlight: '95折',
    compare: '普通用户无折扣',
  },
  {
    icon: 'truck-check-outline' as const,
    title: '超低包邮门槛',
    desc: 'VIP 专享更低包邮门槛',
    highlight: '包邮特权',
    compare: '低于普通用户',
  },
  {
    icon: 'gift-outline' as const,
    title: '入会专属礼包',
    desc: '开通 VIP 即可选择一份精选赠品',
    highlight: '专属赠品',
    compare: '限 VIP 用户',
  },
];

// 奖励机制说明步骤
const REWARD_STEPS = [
  { step: '1', title: '您消费', desc: '每次购物产生利润' },
  { step: '2', title: '奖励分配', desc: '消费产生的利润自动转为您的奖励' },
  { step: '3', title: '推荐有奖', desc: '推荐好友成为 VIP，即得现金奖励' },
];

export default function VipScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [qrVisible, setQrVisible] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['me-vip-profile'],
    queryFn: () => UserRepo.profile(),
    enabled: isLoggedIn,
  });
  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });

  const profile = data?.ok ? data.data : null;
  const error = data && !data.ok ? data.error : null;
  const member = memberData?.ok ? memberData.data : null;
  const isVip = member?.tier === 'VIP';

  // VIP 用户额外查询：钱包
  const { data: walletData } = useQuery({
    queryKey: ['my-wallet'],
    queryFn: () => BonusRepo.getWallet(),
    enabled: isLoggedIn && isVip,
  });

  const wallet = walletData?.ok ? walletData.data : null;

  // 推荐码 & 深度链接
  const referralCode = member?.referralCode ?? '';
  const deepLink = `https://app.ai-maimai.com/r/${referralCode}`;

  const handleCopyReferral = async () => {
    await Clipboard.setStringAsync(referralCode);
    show({ message: '推荐码已复制', type: 'success' });
  };

  const handleShareReferral = async () => {
    try {
      await Share.share({
        message: `我在爱买买发现了优质农产品，使用我的推荐码 ${referralCode} 注册，双方都能获得红包奖励！${deepLink}`,
      });
    } catch {
      // 用户取消分享
    }
  };

  // 格式化日期
  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  // 加载态
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1, backgroundColor: VIP_COLORS.bgStart }}>
        <View style={{ padding: spacing.xl, paddingTop: insets.top + 60 }}>
          <Skeleton height={180} radius={radius.lg} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={100} radius={radius.lg} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={200} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  // 错误态
  if (error) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <View style={{ padding: spacing.xl, paddingTop: insets.top + 60 }}>
          <ErrorState title="会员信息加载失败" description={error.displayMessage ?? '请稍后重试'} onAction={refetch} />
        </View>
      </Screen>
    );
  }

  return (
    <LinearGradient
      colors={[VIP_COLORS.bgStart, VIP_COLORS.bgMid, VIP_COLORS.bgEnd]}
      style={styles.container}
    >
      {/* 自定义导航栏 */}
      <View style={[styles.navbar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={VIP_COLORS.warmWhite} />
        </Pressable>
        <Text style={styles.navTitle}>会员中心</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={VIP_COLORS.goldPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 1. VIP 身份卡片 ===== */}
        {member ? (
          <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.section}>
            <View style={styles.identityCard}>
              {/* 金色顶部装饰线 */}
              <LinearGradient
                colors={[VIP_COLORS.goldPrimary, VIP_COLORS.goldLight, VIP_COLORS.goldPrimary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cardTopLine}
              />
              <View style={styles.identityContent}>
                <View style={styles.identityLeft}>
                  {/* 皇冠图标 */}
                  <View style={styles.crownCircle}>
                    <MaterialCommunityIcons name="crown" size={24} color={VIP_COLORS.goldPrimary} />
                  </View>
                  <View style={{ marginLeft: 14, flex: 1 }}>
                    <Text style={styles.identityTitle}>VIP 会员</Text>
                    {member.vipPurchasedAt ? (
                      <Text style={styles.identityDate}>
                        {formatDate(member.vipPurchasedAt)} 加入
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* 二维码图标 */}
                <Pressable onPress={() => setQrVisible(true)} style={styles.qrIconBox}>
                  <MaterialCommunityIcons name="qrcode" size={22} color={VIP_COLORS.goldPrimary} />
                </Pressable>
              </View>

            </View>
          </Animated.View>
        ) : null}

        {/* ===== 2. 收益概览 ===== */}
        {isVip && wallet ? (
          <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.section}>
            <Pressable onPress={() => router.push('/me/wallet')} style={styles.earningsCard}>
              <View style={styles.earningsHeader}>
                <Text style={styles.sectionTitle}>收益概览</Text>
                <View style={styles.earningsMore}>
                  <Text style={styles.moreText}>钱包详情</Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={VIP_COLORS.goldDim} />
                </View>
              </View>
              <View style={styles.earningsGrid}>
                <View style={styles.earningsItem}>
                  <Text style={styles.earningsAmount}>¥{wallet.balance.toFixed(2)}</Text>
                  <Text style={styles.earningsLabel}>可用余额</Text>
                </View>
                <View style={[styles.earningsDivider]} />
                <View style={styles.earningsItem}>
                  <Text style={[styles.earningsAmount, { color: VIP_COLORS.subtleGray }]}>
                    ¥{wallet.frozen.toFixed(2)}
                  </Text>
                  <Text style={styles.earningsLabel}>冻结中</Text>
                </View>
                <View style={[styles.earningsDivider]} />
                <View style={styles.earningsItem}>
                  <Text style={[styles.earningsAmount, { color: VIP_COLORS.goldLight }]}>
                    ¥{wallet.total.toFixed(2)}
                  </Text>
                  <Text style={styles.earningsLabel}>累计收益</Text>
                </View>
              </View>
              {/* VIP/普通分项 */}
              {wallet.vip || wallet.normal ? (
                <View style={styles.walletBreakdown}>
                  {wallet.vip ? (
                    <View style={styles.breakdownItem}>
                      <View style={[styles.breakdownDot, { backgroundColor: VIP_COLORS.goldPrimary }]} />
                      <Text style={styles.breakdownText}>VIP奖励 ¥{wallet.vip.balance.toFixed(2)}</Text>
                    </View>
                  ) : null}
                  {wallet.normal ? (
                    <View style={styles.breakdownItem}>
                      <View style={[styles.breakdownDot, { backgroundColor: '#4CAF50' }]} />
                      <Text style={styles.breakdownText}>普通奖励 ¥{wallet.normal.balance.toFixed(2)}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
        ) : null}

        {/* ===== 3. VIP 专属权益 ===== */}
        <Animated.View entering={FadeInDown.duration(400).delay(400)} style={styles.section}>
          <Text style={[styles.sectionTitle, { marginBottom: 14 }]}>VIP 专属权益</Text>
          {VIP_BENEFITS.map((benefit, index) => (
            <Animated.View
              key={benefit.title}
              entering={FadeInDown.duration(300).delay(450 + index * 60)}
            >
              <View style={styles.benefitCard}>
                <View style={styles.benefitIconBox}>
                  <MaterialCommunityIcons name={benefit.icon} size={22} color={VIP_COLORS.goldPrimary} />
                </View>
                <View style={styles.benefitContent}>
                  <View style={styles.benefitTitleRow}>
                    <Text style={styles.benefitTitle}>{benefit.title}</Text>
                    <View style={styles.benefitHighlight}>
                      <Text style={styles.benefitHighlightText}>{benefit.highlight}</Text>
                    </View>
                  </View>
                  <Text style={styles.benefitDesc}>{benefit.desc}</Text>
                  <Text style={styles.benefitCompare}>{benefit.compare}</Text>
                </View>
              </View>
            </Animated.View>
          ))}
        </Animated.View>

        {/* ===== 6. 分润机制说明 ===== */}
        <Animated.View entering={FadeInDown.duration(400).delay(700)} style={styles.section}>
          <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>奖励机制</Text>
          <Text style={styles.mechanismSubtitle}>
            消费享奖励，推荐得现金
          </Text>

          {/* 步骤流程 */}
          <View style={styles.stepsContainer}>
            {REWARD_STEPS.map((item, index) => (
              <View key={item.step} style={styles.stepRow}>
                {/* 步骤编号 + 连接线 */}
                <View style={styles.stepTimeline}>
                  <View style={styles.stepCircle}>
                    <Text style={styles.stepNumber}>{item.step}</Text>
                  </View>
                  {index < REWARD_STEPS.length - 1 ? (
                    <View style={styles.stepLine} />
                  ) : null}
                </View>
                {/* 步骤内容 */}
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>{item.title}</Text>
                  <Text style={styles.stepDesc}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* 关键规则卡片 */}
          <View style={styles.rulesCard}>
            <View style={styles.ruleItem}>
              <MaterialCommunityIcons name="cart-check" size={18} color={VIP_COLORS.goldPrimary} />
              <Text style={styles.ruleText}>每次消费自动产生奖励，可在钱包中查看</Text>
            </View>
            <View style={[styles.ruleDivider]} />
            <View style={styles.ruleItem}>
              <MaterialCommunityIcons name="account-cash-outline" size={18} color={VIP_COLORS.goldPrimary} />
              <Text style={styles.ruleText}>推荐好友开通 VIP，即可获得现金奖励</Text>
            </View>
            <View style={[styles.ruleDivider]} />
            <View style={styles.ruleItem}>
              <MaterialCommunityIcons name="wallet-outline" size={18} color={VIP_COLORS.goldPrimary} />
              <Text style={styles.ruleText}>奖励余额可随时申请提现至微信或支付宝</Text>
            </View>
          </View>
        </Animated.View>

        {/* ===== 7. 邀请好友入口 ===== */}
        <Animated.View entering={FadeInDown.duration(400).delay(800)} style={[styles.section, { marginBottom: 0 }]}>
          <Pressable
            onPress={() => member && setQrVisible(true)}
            style={styles.inviteCard}
          >
            <LinearGradient
              colors={[VIP_COLORS.goldPrimary, VIP_COLORS.goldLight]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.inviteGradient}
            >
              <View style={styles.inviteContent}>
                <View>
                  <Text style={styles.inviteTitle}>邀请好友成为 VIP</Text>
                  <Text style={styles.inviteDesc}>好友成功开通，您即得现金奖励</Text>
                </View>
                <MaterialCommunityIcons name="qrcode" size={28} color="rgba(26,18,7,0.4)" />
              </View>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </ScrollView>

      {/* 推荐码浮层（与"我的"页面一致） */}
      <Modal transparent visible={qrVisible} animationType="fade" onRequestClose={() => setQrVisible(false)}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
          </BlurView>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
        )}

        <Pressable onPress={() => setQrVisible(false)} style={styles.qrCloseBtn} hitSlop={10}>
          <MaterialCommunityIcons name="close-circle" size={32} color="rgba(255,255,255,0.7)" />
        </Pressable>

        <View style={styles.qrOverlay}>
          <Animated.View entering={FadeIn.duration(300)}>
            <LinearGradient
              colors={[...gradients.aiGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.qrCard, shadow.lg, { borderRadius: radius.xl }]}
            >
              <FloatingParticles count={8} color={colors.ai.glow} />

              <View style={styles.qrTitleRow}>
                <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>我的专属推荐码</Text>
                <AiBadge variant="recommend" />
              </View>

              <View style={[styles.qrCodeBox, shadow.lg, { borderRadius: radius.xl, backgroundColor: '#FFFFFF' }]}>
                {referralCode ? (
                  <QRCode
                    value={deepLink}
                    size={160}
                    color={colors.brand.primaryDark}
                    backgroundColor="#FFFFFF"
                  />
                ) : (
                  <View style={{ width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[typography.caption, { color: colors.muted }]}>暂无推荐码</Text>
                  </View>
                )}
              </View>

              <Text style={styles.qrCodeText}>
                {referralCode.split('').join(' ')}
              </Text>

              <View style={styles.qrActions}>
                <Pressable onPress={handleCopyReferral} style={[styles.qrOutlineBtn, { borderRadius: radius.pill }]}>
                  <MaterialCommunityIcons name="content-copy" size={16} color="#FFFFFF" />
                  <Text style={[typography.bodySm, { color: '#FFFFFF', marginLeft: 6 }]}>复制</Text>
                </Pressable>
                <View style={{ width: spacing.sm }} />
                <Pressable onPress={handleShareReferral} style={{ flex: 1 }}>
                  <LinearGradient
                    colors={[...gradients.goldGradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.qrShareBtn, { borderRadius: radius.pill }]}
                  >
                    <MaterialCommunityIcons name="share-variant-outline" size={16} color="#FFFFFF" />
                    <Text style={[typography.bodyStrong, { color: '#FFFFFF', marginLeft: 6 }]}>分享给好友</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>
          </Animated.View>

          <Text style={[typography.caption, { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: spacing.md }]}>
            分享推荐码，好友注册后双方获得红包奖励
          </Text>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // 导航栏
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: VIP_COLORS.warmWhite,
    letterSpacing: 0.5,
  },

  // 通用区块
  section: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: VIP_COLORS.warmWhite,
    letterSpacing: 0.3,
  },

  // 身份卡片
  identityCard: {
    backgroundColor: VIP_COLORS.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: VIP_COLORS.cardBorder,
    overflow: 'hidden',
  },
  cardTopLine: {
    height: 2,
  },
  identityContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    paddingBottom: 14,
  },
  identityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  crownCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(201,169,110,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(201,169,110,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  identityTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: VIP_COLORS.goldPrimary,
    letterSpacing: 1,
  },
  identityDate: {
    fontSize: 12,
    color: VIP_COLORS.subtleGray,
    marginTop: 3,
  },
  qrIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(201,169,110,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 收益概览
  earningsCard: {
    backgroundColor: VIP_COLORS.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: VIP_COLORS.cardBorder,
    padding: 18,
  },
  earningsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  earningsMore: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moreText: {
    fontSize: 12,
    color: VIP_COLORS.goldDim,
  },
  earningsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  earningsItem: {
    flex: 1,
    alignItems: 'center',
  },
  earningsAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: VIP_COLORS.goldPrimary,
  },
  earningsLabel: {
    fontSize: 11,
    color: VIP_COLORS.subtleGray,
    marginTop: 4,
  },
  earningsDivider: {
    width: 1,
    height: 28,
    backgroundColor: VIP_COLORS.divider,
  },

  // 钱包分项
  walletBreakdown: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: VIP_COLORS.divider,
    gap: 24,
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breakdownDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  breakdownText: {
    fontSize: 11,
    color: VIP_COLORS.subtleGray,
  },

  // 权益卡片
  benefitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: VIP_COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: VIP_COLORS.cardBorder,
    padding: 14,
    marginBottom: 8,
  },
  benefitIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(201,169,110,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  benefitContent: {
    flex: 1,
  },
  benefitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  benefitTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: VIP_COLORS.warmWhite,
  },
  benefitHighlight: {
    backgroundColor: 'rgba(201,169,110,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  benefitHighlightText: {
    fontSize: 12,
    fontWeight: '700',
    color: VIP_COLORS.goldPrimary,
  },
  benefitDesc: {
    fontSize: 12,
    color: VIP_COLORS.subtleGray,
    marginTop: 4,
    lineHeight: 18,
  },
  benefitCompare: {
    fontSize: 11,
    color: 'rgba(201,169,110,0.5)',
    marginTop: 3,
  },

  // 分润机制
  mechanismSubtitle: {
    fontSize: 12,
    color: VIP_COLORS.subtleGray,
    marginBottom: 16,
  },
  stepsContainer: {
    marginBottom: 16,
  },
  stepRow: {
    flexDirection: 'row',
  },
  stepTimeline: {
    alignItems: 'center',
    width: 32,
    marginRight: 12,
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(201,169,110,0.15)',
    borderWidth: 1,
    borderColor: VIP_COLORS.goldPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: VIP_COLORS.goldPrimary,
  },
  stepLine: {
    width: 1,
    height: 24,
    backgroundColor: VIP_COLORS.divider,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 16,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: VIP_COLORS.warmWhite,
  },
  stepDesc: {
    fontSize: 12,
    color: VIP_COLORS.subtleGray,
    marginTop: 2,
  },

  // 规则卡片
  rulesCard: {
    backgroundColor: VIP_COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: VIP_COLORS.cardBorder,
    padding: 14,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  ruleText: {
    fontSize: 12,
    color: VIP_COLORS.warmWhite,
    marginLeft: 10,
    flex: 1,
    lineHeight: 18,
  },
  ruleDivider: {
    height: 1,
    backgroundColor: VIP_COLORS.divider,
    marginLeft: 28,
  },

  // 邀请好友
  inviteCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  inviteGradient: {
    padding: 20,
    borderRadius: 16,
  },
  inviteContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1207',
    letterSpacing: 0.5,
  },
  inviteDesc: {
    fontSize: 12,
    color: 'rgba(26,18,7,0.7)',
    marginTop: 4,
  },

  // 推荐码浮层
  qrCloseBtn: {
    position: 'absolute',
    top: 54,
    right: 20,
    zIndex: 10,
  },
  qrOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  qrCard: {
    padding: 24,
    alignItems: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  qrTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginBottom: 20,
    zIndex: 1,
  },
  qrCodeBox: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  qrCodeText: {
    fontFamily: monoFamily,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    color: '#FFFFFF',
    marginTop: 20,
    textAlign: 'center',
    zIndex: 1,
  },
  qrActions: {
    flexDirection: 'row',
    marginTop: 20,
    width: '100%',
    zIndex: 1,
  },
  qrOutlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  qrShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
});
