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
import { GoldShimmerLine } from '../../src/components/effects/GoldShimmerLine';
import { GoldShineSweep } from '../../src/components/effects/GoldShineSweep';
import { GoldBgGlows } from '../../src/components/effects/GoldBgGlows';
import { BonusRepo, UserRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { priceTextProps, useBottomInset, useTheme } from '../../src/theme';
import { monoFamily } from '../../src/theme/typography';
import { getReferralInviterLabel, hasBoundReferralInviter } from '../../src/utils/referralRelation';

function formatPercent(value?: number | null) {
  if (typeof value !== 'number') return '后台配置';
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

// VIP 专属空间色彩 · 轻金 v1（与 gifts 页一致）
// 背景从深墨绿黑换成暖香槟金，文字翻转为深棕，金色加深为深金 #B8860B + 亮金 #FFD700
// warmWhite 语义已变为"文字主色"（金底上视觉为深棕），key 名保留避免大范围改动
const VIP_COLORS = {
  bgStart: '#FFFDF5',
  bgMid: '#FAF0CC',
  bgEnd: '#EAD78F',
  goldPrimary: '#B8860B',
  goldLight: '#FFD700',
  goldDim: 'rgba(184,134,11,0.6)',
  warmWhite: '#3D2E1A',
  subtleGray: '#5D4A2C',
  cardBg: 'rgba(255,255,255,0.5)',
  cardBorder: 'rgba(184,134,11,0.35)',
  divider: 'rgba(184,134,11,0.25)',
  highlightBg: 'rgba(184,134,11,0.12)',
};

// VIP 专属权益数据
const VIP_BENEFITS = [
  {
    icon: 'tag-minus-outline' as const,
    title: '普通商品会员价',
    desc: '部分普通商品结算时享会员价',
    highlight: '会员价',
    compare: '以结算页展示为准',
  },
  {
    icon: 'truck-check-outline' as const,
    title: '更低包邮门槛',
    desc: '普通商品订单按 VIP 门槛计算运费',
    highlight: '运费优惠',
    compare: '不同地区按平台运费规则计算',
  },
  {
    icon: 'wallet-outline' as const,
    title: '消费积分抵扣更多',
    desc: '普通商品结算可使用更高比例的消费积分抵扣',
    highlight: '最高 15%',
    compare: 'VIP 礼包不可使用消费积分抵扣',
  },
  {
    icon: 'account-cash' as const,
    title: 'VIP 直推佣金',
    desc: '好友成为 VIP 后，后续普通商品订单按 VIP 直推比例结算',
    highlight: '持续佣金',
    compare: '到账与可提现状态以我的财库流水为准',
  },
  {
    icon: 'crown' as const,
    title: 'VIP 身份标识',
    desc: '可使用 VIP 专属头像框与会员身份展示',
    highlight: '身份权益',
    compare: '仅当前 VIP 账号可使用',
  },
];

// 奖励机制说明步骤
const REWARD_STEPS = [
  { step: '1', title: '普通商品确认收货', desc: 'VIP 礼包订单不参与奖励计算' },
  { step: '2', title: '系统按规则计算', desc: '奖励金额、冻结和解锁状态以我的财库流水为准' },
  { step: '3', title: '我的财库查看与提现', desc: '可用余额满足规则后，可申请提现至支付宝' },
];

export default function VipScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollBottomPadding = useBottomInset(40);
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

  // VIP 用户额外查询：财库
  const { data: walletData } = useQuery({
    queryKey: ['bonus-wallet'],
    queryFn: () => BonusRepo.getWallet(),
    enabled: isLoggedIn && isVip,
  });

  const wallet = walletData?.ok ? walletData.data : null;

  // 推荐码 & 深度链接
  const referralCode = isVip ? (member?.referralCode ?? '') : '';
  const deepLink = `https://app.ai-maimai.com/r/${referralCode}`;
  const inviterLabel = getReferralInviterLabel(member);
  const hasInviter = hasBoundReferralInviter(member);
  const directReferralPercentText = formatPercent(member?.directReferralPercent);

  const handleCopyReferral = async () => {
    if (!referralCode) {
      show({ message: '暂无可复制的推荐码', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(referralCode);
    show({ message: '推荐码已复制', type: 'success' });
  };

  const handleShareReferral = async () => {
    if (!referralCode) {
      show({ message: '暂无可分享的推荐码', type: 'info' });
      return;
    }
    try {
      await Share.share({
        message: `我在爱买买发现了优质农产品，使用我的推荐码 ${referralCode} 注册；你成为 VIP 后会进入我的 VIP 团队。${deepLink}`,
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
      {/* 背景金箔光斑（柔焦圆斑，pointerEvents none） */}
      <GoldBgGlows />

      {/* 自定义导航栏 */}
      <View style={[styles.navbar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={VIP_COLORS.warmWhite} />
        </Pressable>
        <Text style={styles.navTitle}>会员中心</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: scrollBottomPadding }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={VIP_COLORS.goldPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 1. VIP 身份卡片 ===== */}
        {member ? (
          <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.section}>
            <View style={styles.identityCard}>
              {/* 金色顶部装饰线（shimmer 流光金线） */}
              <GoldShimmerLine height={3} />
              <View style={styles.identityContent}>
                <View style={styles.identityLeft}>
                  {/* 皇冠图标 */}
                  <View style={styles.crownCircle}>
                    <MaterialCommunityIcons name="crown" size={24} color={VIP_COLORS.goldPrimary} />
                  </View>
                  <View style={{ marginLeft: 14, flex: 1 }}>
                    <Text style={styles.identityTitle}>{isVip ? 'VIP 会员' : '普通会员'}</Text>
                    {member.vipPurchasedAt ? (
                      <Text style={styles.identityDate}>
                        {formatDate(member.vipPurchasedAt)} 加入
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* 二维码图标 */}
                {referralCode ? (
                  <Pressable onPress={() => setQrVisible(true)} style={styles.qrIconBox}>
                    <MaterialCommunityIcons name="qrcode" size={22} color={VIP_COLORS.goldPrimary} />
                  </Pressable>
                ) : null}
              </View>

            </View>
          </Animated.View>
        ) : null}

        {/* ===== 2. 推荐关系确认 ===== */}
        {member ? (
          <Animated.View entering={FadeInDown.duration(400).delay(180)} style={styles.section}>
            <View style={styles.relationCard}>
              <View style={styles.relationHeader}>
                <View style={styles.relationIcon}>
                  <MaterialCommunityIcons
                    name={hasInviter ? 'account-heart-outline' : 'account-question-outline'}
                    size={20}
                    color={VIP_COLORS.goldPrimary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.relationTitle}>推荐关系</Text>
                  <Text style={styles.relationDesc}>
                    {hasInviter
                      ? isVip
                        ? `已加入 ${inviterLabel} 的 VIP 团队`
                        : `如果 ${inviterLabel} 在你成为 VIP 时已经是 VIP，你将进入 TA 的 VIP 团队；如果 TA 仍是普通用户，普通推荐关系会结束`
                      : '尚未绑定推荐人，成为 VIP 时按系统节点分配'}
                  </Text>
                </View>
                {!isVip ? (
                  <Pressable onPress={() => router.push('/me/scanner')} style={styles.relationAction}>
                    <Text style={styles.relationActionText}>去绑定</Text>
                  </Pressable>
                ) : null}
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
                  <Text style={styles.moreText}>我的财库详情</Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={VIP_COLORS.goldDim} />
                </View>
              </View>
              <View style={styles.earningsGrid}>
                <View style={styles.earningsItem}>
                  <Text {...priceTextProps} style={styles.earningsAmount}>¥{wallet.balance.toFixed(2)}</Text>
                  <Text style={styles.earningsLabel}>可用余额</Text>
                </View>
                <View style={[styles.earningsDivider]} />
                <View style={styles.earningsItem}>
                  <Text {...priceTextProps} style={[styles.earningsAmount, { color: VIP_COLORS.subtleGray }]}>
                    ¥{wallet.frozen.toFixed(2)}
                  </Text>
                  <Text style={styles.earningsLabel}>冻结中</Text>
                </View>
                <View style={[styles.earningsDivider]} />
                <View style={styles.earningsItem}>
                  <Text {...priceTextProps} style={[styles.earningsAmount, { color: VIP_COLORS.goldLight }]}>
                    ¥{wallet.total.toFixed(2)}
                  </Text>
                  <Text style={styles.earningsLabel}>累计收益</Text>
                </View>
              </View>
              {/* VIP/普通/产业基金 分项 */}
              {wallet.vip || wallet.normal || wallet.industryFund ? (
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
                  {wallet.industryFund ? (
                    <View style={styles.breakdownItem}>
                      <View style={[styles.breakdownDot, { backgroundColor: '#D4A943' }]} />
                      <Text style={styles.breakdownText}>产业基金 ¥{wallet.industryFund.balance.toFixed(2)}</Text>
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
          <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>奖励规则</Text>
          <Text style={styles.mechanismSubtitle}>
            普通商品确认收货后，按平台规则计算奖励
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
              <Text style={styles.ruleText}>VIP 开通后不再参与普通用户奖励树</Text>
            </View>
            <View style={[styles.ruleDivider]} />
            <View style={styles.ruleItem}>
              <MaterialCommunityIcons name="account-cash-outline" size={18} color={VIP_COLORS.goldPrimary} />
              <Text style={styles.ruleText}>推荐码仅 VIP 用户可展示和分享</Text>
            </View>
            <View style={[styles.ruleDivider]} />
            <View style={styles.ruleItem}>
              <MaterialCommunityIcons name="wallet-outline" size={18} color={VIP_COLORS.goldPrimary} />
              <Text style={styles.ruleText}>商品折扣、包邮门槛、抵扣比例以结算页和平台配置为准</Text>
            </View>
          </View>
        </Animated.View>

        {/* ===== 7. 邀请好友入口 ===== */}
        {referralCode ? (
          <Animated.View entering={FadeInDown.duration(400).delay(800)} style={[styles.section, { marginBottom: 0 }]}>
            <Pressable
              onPress={() => setQrVisible(true)}
              style={styles.inviteCard}
            >
              <LinearGradient
                colors={[VIP_COLORS.goldPrimary, VIP_COLORS.goldLight]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.inviteGradient}
              >
                {/* 流光扫光（在 gradient 之上，content 之下） */}
                <GoldShineSweep width={90} duration={3500} travel={420} />
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
        ) : null}
      </ScrollView>

      {/* 推荐码浮层（与"我的"页面一致） */}
      <Modal transparent visible={qrVisible && !!referralCode} animationType="fade" onRequestClose={() => setQrVisible(false)}>
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

              <Text {...priceTextProps} style={styles.qrCodeText}>
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
            好友成为 VIP 后进入你的 VIP 团队；好友后续普通商品订单按 {directReferralPercentText} 的 VIP 直推比例结算
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
    backgroundColor: 'rgba(255,215,0,0.18)',
    borderWidth: 1.5,
    borderColor: VIP_COLORS.goldPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    // 金光发光环（静态）
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 6,
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
    backgroundColor: 'rgba(184,134,11,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 推荐关系
  relationCard: {
    backgroundColor: VIP_COLORS.highlightBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: VIP_COLORS.cardBorder,
    padding: 14,
  },
  relationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  relationIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(184,134,11,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  relationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: VIP_COLORS.warmWhite,
  },
  relationDesc: {
    fontSize: 12,
    color: VIP_COLORS.subtleGray,
    lineHeight: 18,
    marginTop: 3,
  },
  relationAction: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(184,134,11,0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  relationActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: VIP_COLORS.goldPrimary,
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

  // 财库分项
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
    backgroundColor: 'rgba(184,134,11,0.1)',
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
    backgroundColor: 'rgba(184,134,11,0.15)',
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
    color: 'rgba(184,134,11,0.5)',
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
    backgroundColor: 'rgba(184,134,11,0.15)',
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
