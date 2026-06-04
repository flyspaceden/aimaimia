import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AccountDeletionRepo } from '../../src/repos';
import { logoutAndClearClientState } from '../../src/utils/logout';
import { compactActionTextProps, fitTextProps, useBottomInset, useTheme } from '../../src/theme';
import type {
  AccountDeletionBlocker,
  AccountDeletionBlockerCode,
  AccountDeletionPreview,
} from '../../src/types/domain/AccountDeletion';

// ==================== 文案常量 ====================

/** 仅微信用户须手动输入的确认四字 */
const WECHAT_CONFIRM_TEXT = '确认注销';
/** 发送验证码倒计时秒数 */
const SMS_COUNTDOWN = 60;

/**
 * 注销须知（与 spec 的「账号注销须知」段一一对应）。
 * 每段一个标题 + 若干正文条目，正文段落保持默认字体缩放（无障碍）。
 */
const NOTICE_SECTIONS: Array<{ title: string; paragraphs: string[] }> = [
  {
    title: '一、立即生效不可撤销',
    paragraphs: [
      '您的账号在通过身份核验、提交注销申请后将立即注销，无法登录、无法恢复。请在提交前确认。',
    ],
  },
  {
    title: '二、订单与售后不受影响',
    paragraphs: [
      '您账号下已支付的订单将正常履约发货，不会因注销而取消；进行中的售后/退换货将依据《消费者权益保护法》继续处理，相关退款将按原支付路径退回您的支付账户。',
    ],
  },
  {
    title: '三、虚拟资产即时清零作废（含可提现余额）',
    paragraphs: [
      '提交注销的瞬间，下列资产将立即清零作废，不予退还、兑现或补偿：',
      '1. 消费积分、分润奖励、钱包或余额类权益（含可提现部分）；',
      '2. 平台红包与已绑定未使用的优惠券；',
      '3. 抽奖中奖名额、购物车中的奖品权益；',
      '4. 待发放、冻结中或可提现的分润奖励。',
      '提交注销即视为您自愿放弃上述全部资产（包括本可提现的余额），平台不予退还或补偿。',
      '如您有正在支付或确认中的订单、支付处理中记录、提现处理中记录，平台将暂不受理注销，请先完成、取消或等待处理结束后再提交。',
    ],
  },
  {
    title: '四、VIP 推荐关系处理',
    paragraphs: [
      '如您是 VIP 用户，您在推荐树中的节点位置予以保留，您推荐用户的分润链路不受影响；但您账号上未发放/待发放/冻结中的分润不再发放给您，全部由平台处理。',
    ],
  },
  {
    title: '五、关联功能终止',
    paragraphs: [
      '注销后：无法用本账号登录任何端口；关注商家、收货地址、发票抬头、AI 对话等可删除数据将被清除或匿名化；订单、售后、支付、发票、分润流水及相关客服工单将依法或为履约争议处理需要保留；推荐码永久失效。',
    ],
  },
  {
    title: '六、数据保留与清除',
    paragraphs: [
      '我们将在注销后清除您的个人资料、设备信息、行为日志等可删除数据。但依法保留：订单交易记录 3 年（电子商务法 §31）、发票数据 5 年、网络日志 6 个月（网络安全法 §21）。',
    ],
  },
  {
    title: '七、注销前置条件',
    paragraphs: [
      '您不是任何商户的创始人（OWNER）；不存在正在支付或确认中的订单、支付处理中记录、提现处理中记录；通过身份核验（绑定手机号者短信验证，仅微信者弹窗确认）。',
    ],
  },
];

/** 作废警示要点（资产卡下方醒目展示，覆盖 spec 关键处置口径） */
const VOID_WARNINGS: string[] = [
  '账号一经注销立即生效、不可恢复',
  '消费积分、冻结/可提现分润、平台红包、抽奖名额全部清零作废',
  '订单、支付、退款、发票、售后记录依法保留并继续处理',
  '手机号 / 微信可重新注册，但已作废权益不会迁回',
];

/** blocker 行动提示（按 code 给出引导） */
const BLOCKER_HINTS: Record<AccountDeletionBlockerCode, string> = {
  IS_COMPANY_OWNER: '您是企业创始人，请先转让或注销企业',
  USER_NOT_ACTIVE: '账号状态不支持注销',
  ACTIVE_CHECKOUT_EXISTS: '您有正在支付或确认中的订单，请先完成或取消',
  PENDING_PAYMENT_EXISTS: '您有支付处理中记录，请稍后再试',
  WITHDRAW_PROCESSING_EXISTS: '您有提现处理中记录，请到账或失败后再注销',
};

// ==================== 工具函数 ====================

/** 金额按元展示（Reward / 钱包等为 Float / 元） */
const formatMoney = (v: number): string => `¥${(v ?? 0).toFixed(2)}`;

// ==================== 主页面 ====================

type Step = 1 | 2 | 3;

export default function AccountDeletionScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const bottomInset = useBottomInset(16);

  // 预览：阻塞项 + 资产快照 + 核验方式
  const previewQuery = useQuery({
    queryKey: ['account-deletion-preview'],
    queryFn: () => AccountDeletionRepo.preview(),
    staleTime: 0,
  });
  const preview: AccountDeletionPreview | undefined = previewQuery.data?.ok
    ? previewQuery.data.data
    : undefined;
  // Repo 返回 Result<T>：业务层 ok=false 也要当错误态处理
  const isErrored = previewQuery.isError || (previewQuery.data && !previewQuery.data.ok);

  // 步骤状态机：1 须知+资产+同意 / 2 身份核验 / 3 成功
  const [step, setStep] = useState<Step>(1);
  // Step 1：勾选同意
  const [agreed, setAgreed] = useState(false);
  // Step 2 - SMS：验证码 + 倒计时
  const [smsCode, setSmsCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  // Step 2 - WECHAT：确认四字输入
  const [wechatInput, setWechatInput] = useState('');
  // 提交中态：防重复提交
  const [submitting, setSubmitting] = useState(false);
  // 错误播报（assertive live region）
  const [stepError, setStepError] = useState('');

  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 倒计时清理
  useEffect(() => {
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, []);

  const startCountdown = () => {
    setCountdown(SMS_COUNTDOWN);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  // 发送短信验证码
  const handleSendCode = async () => {
    if (countdown > 0 || sendingCode) return;
    setSendingCode(true);
    const r = await AccountDeletionRepo.sendCode();
    setSendingCode(false);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '验证码发送失败', type: 'error' });
      return;
    }
    show({ message: '验证码已发送', type: 'success' });
    startCountdown();
  };

  const identityVerify = preview?.identityVerify;
  // 最终提交是否可点：SMS 需 6 位码；WECHAT 需输入完全匹配四字
  const canSubmit =
    identityVerify === 'SMS'
      ? smsCode.trim().length === 6
      : identityVerify === 'WECHAT_MODAL'
        ? wechatInput.trim() === WECHAT_CONFIRM_TEXT
        : false;

  // 执行注销
  const handleExecute = async () => {
    if (!canSubmit || submitting || !identityVerify) return;
    setStepError('');
    setSubmitting(true);
    const r = await AccountDeletionRepo.execute({
      confirmationMethod: identityVerify,
      smsCode: identityVerify === 'SMS' ? smsCode.trim() : undefined,
      modalConfirmText: identityVerify === 'WECHAT_MODAL' ? wechatInput.trim() : undefined,
      acknowledgedNotice: true,
    });
    setSubmitting(false);
    if (!r.ok) {
      const msg = r.error.displayMessage ?? '注销失败，请稍后重试';
      setStepError(msg);
      AccessibilityInfo.announceForAccessibility?.(msg);
      show({ message: msg, type: 'error' });
      return;
    }
    setStep(3);
  };

  // Step 3：退出 App → 清本地态 → 回首页
  const handleExitApp = () => {
    logoutAndClearClientState();
    router.replace('/(tabs)/home');
  };

  // ==================== 渲染分支 ====================

  // loading 态：骨架屏
  if (previewQuery.isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="注销账号" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={28} width="60%" />
          <Skeleton height={120} radius={radius.lg} style={{ marginTop: spacing.lg }} />
          <Skeleton height={160} radius={radius.lg} style={{ marginTop: spacing.lg }} />
          <Skeleton height={48} radius={radius.pill} style={{ marginTop: spacing.xl }} />
        </View>
      </Screen>
    );
  }

  // error 态：错误三态 + 重试
  if (isErrored || !preview) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="注销账号" />
        <View style={styles.centerFill}>
          <ErrorState
            title="加载失败"
            description="无法获取注销信息，请检查网络后重试"
            actionLabel="重新加载"
            onAction={() => previewQuery.refetch()}
          />
        </View>
      </Screen>
    );
  }

  // 公共底部主按钮容器（固定底部，吃 safe-area）
  const renderBottomBar = (node: React.ReactNode) => (
    <View
      style={[
        styles.bottomBar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: bottomInset,
        },
        shadow.sm,
      ]}
    >
      {node}
    </View>
  );

  // ---------- blocked 态：存在阻塞项 ----------
  if (!preview.canDelete) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="注销账号" />
        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
          <Animated.View entering={FadeInDown.duration(280)}>
            <View
              style={[
                styles.bannerWarn,
                { backgroundColor: colors.danger + '14', borderColor: colors.danger, borderRadius: radius.lg },
              ]}
              accessibilityRole="alert"
            >
              <MaterialCommunityIcons name="alert-circle-outline" size={22} color={colors.danger} />
              <Text style={[typography.body, { color: colors.danger, marginLeft: spacing.sm, flex: 1 }]}>
                当前暂不能注销，请先处理以下事项
              </Text>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              {preview.blockers.map((b: AccountDeletionBlocker, idx) => (
                <View
                  key={`${b.code}-${idx}`}
                  style={[
                    styles.blockerRow,
                    { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md },
                    shadow.sm,
                  ]}
                >
                  <MaterialCommunityIcons name="close-circle" size={20} color={colors.danger} />
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      {b.message || BLOCKER_HINTS[b.code] || '存在阻塞项'}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                      {BLOCKER_HINTS[b.code] ?? '请先处理后再试'}
                      {b.count > 0 ? `（${b.count}）` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </Animated.View>
        </ScrollView>

        {renderBottomBar(
          <Pressable
            disabled
            style={[styles.primaryBtn, { backgroundColor: colors.border, borderRadius: radius.pill }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.tertiary }]} {...compactActionTextProps}>
              暂不能注销
            </Text>
          </Pressable>,
        )}
      </Screen>
    );
  }

  // ---------- Step 3：成功页 ----------
  if (step === 3) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="注销账号" showBack={false} />
        <View style={styles.centerFill} accessibilityRole="alert">
          <Animated.View entering={FadeInDown.duration(280)} style={styles.successWrap}>
            <View style={[styles.successIcon, { backgroundColor: colors.success + '18' }]}>
              <MaterialCommunityIcons name="check-circle" size={56} color={colors.success} />
            </View>
            <Text style={[typography.title2, { color: colors.text.primary, marginTop: spacing.lg }]}>
              账号已注销
            </Text>
            <Text
              style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm, textAlign: 'center' }]}
            >
              您的账号已成功注销并立即生效。感谢您一路以来的陪伴。
            </Text>
          </Animated.View>
        </View>
        {renderBottomBar(
          <Pressable
            onPress={handleExitApp}
            style={[styles.primaryBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            accessibilityRole="button"
            accessibilityLabel="退出 App"
          >
            <Text style={[typography.bodyStrong, { color: colors.text.onPrimary }]} {...compactActionTextProps}>
              退出 App
            </Text>
          </Pressable>,
        )}
      </Screen>
    );
  }

  // ---------- Step 2：身份核验 ----------
  if (step === 2) {
    const isSms = identityVerify === 'SMS';
    return (
      <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
        <AppHeader title="身份核验" onBack={() => setStep(1)} />
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Animated.View entering={FadeInDown.duration(280)}>
            {isSms ? (
              <>
                <Text style={[typography.title3, { color: colors.text.primary }]}>短信验证</Text>
                <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  请输入 {preview.maskedPhone ?? '已绑定手机号'} 收到的验证码
                </Text>

                <View
                  style={[
                    styles.inputRow,
                    { borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.lg },
                  ]}
                >
                  <TextInput
                    style={[typography.body, styles.input, { color: colors.text.primary }]}
                    placeholder="6 位验证码"
                    placeholderTextColor={colors.text.tertiary}
                    keyboardType="number-pad"
                    maxLength={6}
                    value={smsCode}
                    onChangeText={(t) => setSmsCode(t.replace(/[^0-9]/g, ''))}
                    accessibilityLabel="短信验证码输入框"
                  />
                  <Pressable
                    onPress={handleSendCode}
                    disabled={countdown > 0 || sendingCode}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={countdown > 0 ? `${countdown} 秒后可重新发送` : '发送验证码'}
                  >
                    <Text
                      style={[
                        typography.bodyStrong,
                        { color: countdown > 0 || sendingCode ? colors.text.tertiary : colors.brand.primary },
                      ]}
                    >
                      {sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s` : '发送验证码'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={[typography.title3, { color: colors.text.primary }]}>确认注销</Text>
                <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                  您的账号仅绑定微信，请手动输入「{WECHAT_CONFIRM_TEXT}」四字以确认。
                </Text>

                <View
                  style={[
                    styles.inputRow,
                    { borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.lg },
                  ]}
                >
                  <TextInput
                    style={[typography.body, styles.input, { color: colors.text.primary }]}
                    placeholder={`请输入「${WECHAT_CONFIRM_TEXT}」`}
                    placeholderTextColor={colors.text.tertiary}
                    value={wechatInput}
                    onChangeText={setWechatInput}
                    accessibilityLabel="确认注销文字输入框"
                  />
                </View>
              </>
            )}

            {/* 不可恢复醒目提示 */}
            <View
              style={[
                styles.bannerWarn,
                {
                  backgroundColor: colors.danger + '14',
                  borderColor: colors.danger,
                  borderRadius: radius.md,
                  marginTop: spacing.xl,
                },
              ]}
            >
              <MaterialCommunityIcons name="alert" size={20} color={colors.danger} />
              <Text style={[typography.bodySm, { color: colors.danger, marginLeft: spacing.sm, flex: 1 }]}>
                提交后账号将立即注销且不可恢复
              </Text>
            </View>

            {/* 错误播报 */}
            {stepError ? (
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={[typography.bodySm, { color: colors.danger, marginTop: spacing.md }]}
              >
                {stepError}
              </Text>
            ) : null}
          </Animated.View>
        </ScrollView>

        {renderBottomBar(
          <Pressable
            onPress={handleExecute}
            disabled={!canSubmit || submitting}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: !canSubmit || submitting ? colors.border : colors.danger,
                borderRadius: radius.pill,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="确认提交注销"
            accessibilityState={{ disabled: !canSubmit || submitting }}
          >
            <Text
              style={[
                typography.bodyStrong,
                { color: !canSubmit || submitting ? colors.text.tertiary : colors.text.onPrimary },
              ]}
              {...compactActionTextProps}
            >
              {submitting ? '提交中…' : '确认提交注销'}
            </Text>
          </Pressable>,
        )}
      </Screen>
    );
  }

  // ---------- Step 1：须知 + 资产 + 同意 ----------
  const { assets, pending } = preview;
  const assetRows: Array<{ label: string; value: string }> = [
    { label: '钱包 / 可提现余额', value: formatMoney(assets.withdrawableRewards) },
    { label: '消费积分', value: `${assets.points}` },
    { label: '平台红包', value: `${assets.coupons} 张` },
    { label: '冻结分润', value: formatMoney(assets.frozenRewards) },
    { label: '抽奖名额', value: `${assets.lotteryQuota}` },
  ];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="注销账号" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        showsVerticalScrollIndicator
      >
        {/* 须知 */}
        <Animated.View entering={FadeInDown.duration(280)}>
          <Text style={[typography.title2, { color: colors.text.primary }]} {...fitTextProps}>
            账号注销须知
          </Text>
          <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: spacing.sm, lineHeight: 20 }]}>
            提交账号注销即视为您已阅读并同意以下全部内容。账号注销一经提交立即生效、不可恢复，请务必谨慎操作。
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, marginTop: spacing.lg },
              shadow.sm,
            ]}
          >
            {NOTICE_SECTIONS.map((sec, i) => (
              <View key={sec.title} style={{ marginTop: i === 0 ? 0 : spacing.md }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{sec.title}</Text>
                {sec.paragraphs.map((p, j) => (
                  <Text
                    key={j}
                    style={[
                      typography.bodySm,
                      { color: colors.text.secondary, marginTop: spacing.xs, lineHeight: 21 },
                    ]}
                  >
                    {p}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </Animated.View>

        {/* 资产卡 */}
        <Animated.View entering={FadeInDown.duration(280).delay(60)}>
          <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.xl }]}>
            将被清零的资产
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, marginTop: spacing.sm },
              shadow.sm,
            ]}
          >
            {assetRows.map((row, i) => (
              <View
                key={row.label}
                style={[
                  styles.assetRow,
                  i < assetRows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.divider },
                ]}
              >
                <Text style={[typography.body, { color: colors.text.primary }]}>{row.label}</Text>
                <View style={styles.spacer} />
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{row.value}</Text>
              </View>
            ))}
          </View>

          {/* 醒目作废警示 */}
          <View
            style={[
              styles.warnCard,
              { backgroundColor: colors.danger + '12', borderColor: colors.danger, borderRadius: radius.lg },
            ]}
          >
            <View style={styles.warnHeader}>
              <MaterialCommunityIcons name="alert-octagon" size={20} color={colors.danger} />
              <Text style={[typography.bodyStrong, { color: colors.danger, marginLeft: spacing.sm, flex: 1 }]}>
                上述资产将全部清零作废，包括可提现余额，注销后不予退还
              </Text>
            </View>
            {VOID_WARNINGS.map((w) => (
              <View key={w} style={styles.warnItem}>
                <MaterialCommunityIcons name="circle-medium" size={18} color={colors.danger} />
                <Text style={[typography.bodySm, { color: colors.danger, flex: 1, lineHeight: 20 }]}>{w}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* 进行中事项（仅告知不阻断） */}
        {(pending.paidOrders > 0 || pending.activeAfterSales > 0) && (
          <Animated.View entering={FadeInDown.duration(280).delay(120)}>
            <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.xl }]}>
              进行中事项（不受影响）
            </Text>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, marginTop: spacing.sm },
                shadow.sm,
              ]}
            >
              {pending.paidOrders > 0 && (
                <View style={styles.assetRow}>
                  <MaterialCommunityIcons name="package-variant-closed" size={18} color={colors.brand.primary} />
                  <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                    已付款订单
                  </Text>
                  <View style={styles.spacer} />
                  <Text style={[typography.bodySm, { color: colors.text.secondary }]}>
                    {pending.paidOrders} 笔 · 继续履约
                  </Text>
                </View>
              )}
              {pending.activeAfterSales > 0 && (
                <View style={styles.assetRow}>
                  <MaterialCommunityIcons name="backup-restore" size={18} color={colors.brand.primary} />
                  <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                    进行中售后
                  </Text>
                  <View style={styles.spacer} />
                  <Text style={[typography.bodySm, { color: colors.text.secondary }]}>
                    {pending.activeAfterSales} 单 · 继续受理
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* 勾选同意 */}
        <Animated.View entering={FadeInDown.duration(280).delay(160)}>
          <Pressable
            onPress={() => setAgreed((v) => !v)}
            style={[styles.agreeRow, { marginTop: spacing.xl }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="我已阅读并同意上述全部内容"
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name={agreed ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={24}
              color={agreed ? colors.brand.primary : colors.text.tertiary}
            />
            <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm, flex: 1 }]}>
              我已阅读并同意上述全部内容
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>

      {renderBottomBar(
        <Pressable
          onPress={() => agreed && setStep(2)}
          disabled={!agreed}
          style={[
            styles.primaryBtn,
            { backgroundColor: agreed ? colors.danger : colors.border, borderRadius: radius.pill },
          ]}
          accessibilityRole="button"
          accessibilityLabel="下一步"
          accessibilityState={{ disabled: !agreed }}
        >
          <Text
            style={[typography.bodyStrong, { color: agreed ? colors.text.onPrimary : colors.text.tertiary }]}
            {...compactActionTextProps}
          >
            下一步
          </Text>
        </Pressable>,
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    padding: 14,
  },
  spacer: {
    flex: 1,
  },
  // ---- blocked ----
  bannerWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    padding: 12,
  },
  blockerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  // ---- asset / pending ----
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  // ---- 作废警示卡 ----
  warnCard: {
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
  },
  warnHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  warnItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  // ---- 同意 ----
  agreeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  // ---- 输入框 ----
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
  },
  input: {
    flex: 1,
    height: 48,
    padding: 0,
  },
  // ---- 底部固定栏 ----
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  primaryBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ---- 成功页 ----
  successWrap: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
