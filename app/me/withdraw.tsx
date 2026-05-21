import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback';
import { AppBottomSheet } from '../../src/components/overlay';
import { BonusRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, priceTextProps, useBottomInset, useTheme } from '../../src/theme';

const TAX_RATE = 0.20;
const QUICK_AMOUNTS = [10, 50, 100];

const parseAmount = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatAmountInput = (value: number) => {
  if (value <= 0) return '';
  return value.toFixed(2);
};

const normalizeAmountText = (value: string) => {
  const cleaned = value.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  const integerPart = parts[0] ?? '';
  const decimalPart = parts.length > 1 ? parts.slice(1).join('').slice(0, 2) : undefined;
  return decimalPart === undefined ? integerPart : `${integerPart}.${decimalPart}`;
};

export default function WithdrawScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const safeBottom = useBottomInset(spacing['3xl']);
  const [amount, setAmount] = useState('');
  const [alipayAccount, setAlipayAccount] = useState('');
  const [alipayName, setAlipayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lawSheetOpen, setLawSheetOpen] = useState(false);

  const { data: walletData } = useQuery({
    queryKey: ['bonus-wallet'],
    queryFn: () => BonusRepo.getWallet(),
    enabled: isLoggedIn,
  });
  const balance = walletData?.ok ? walletData.data.balance : 0;
  const grossAmount = parseAmount(amount);
  const taxAmount = useMemo(() => Number((grossAmount * TAX_RATE).toFixed(2)), [grossAmount]);
  const netAmount = useMemo(() => Number(Math.max(0, grossAmount - taxAmount).toFixed(2)), [grossAmount, taxAmount]);

  const setClampedAmount = (value: number) => {
    const next = Math.min(Math.max(0, value), balance);
    setAmount(formatAmountInput(next));
  };

  const handleAmountChange = (value: string) => {
    const normalized = normalizeAmountText(value);
    const next = parseAmount(normalized);
    if (next > balance) {
      show({ message: '提现金额不能超过可用积分', type: 'warning' });
      setAmount(formatAmountInput(balance));
      return;
    }
    setAmount(normalized);
  };

  const handleWithdraw = async () => {
    if (!grossAmount || grossAmount <= 0) {
      show({ message: '请输入提现金额', type: 'error' });
      return;
    }
    if (grossAmount > balance) {
      show({ message: '可用积分不足', type: 'error' });
      return;
    }
    if (!alipayAccount.trim()) {
      show({ message: '请输入支付宝账号', type: 'error' });
      return;
    }
    if (!alipayName.trim()) {
      show({ message: '请输入支付宝实名姓名', type: 'error' });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await BonusRepo.requestWithdraw({
        amount: grossAmount,
        alipayAccount: alipayAccount.trim(),
        alipayName: alipayName.trim(),
      });
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '提现失败', type: 'error' });
        return;
      }

      if (result.data.status === 'PAID') {
        show({ message: `提现成功，¥${result.data.netAmount.toFixed(2)} 已到账`, type: 'success' });
      } else if (result.data.status === 'PROCESSING') {
        show({ message: '提现处理中，请稍后查看', type: 'info' });
      } else {
        show({ message: `提现失败：${result.data.message}`, type: 'error' });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] }),
        queryClient.invalidateQueries({ queryKey: ['bonus-ledger'] }),
        queryClient.invalidateQueries({ queryKey: ['bonus-withdraw-history'] }),
      ]);
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title="消费积分提现" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: safeBottom + 120 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Animated.View entering={FadeInDown.duration(300)}>
          <LinearGradient
            colors={[...gradients.aiGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.balanceBanner, shadow.md, { borderRadius: radius.lg }]}
          >
            <Text style={[typography.caption, { color: 'rgba(255,255,255,0.72)' }]}>可用积分</Text>
            <Text {...priceTextProps} style={[styles.balanceAmount, { color: '#FFFFFF' }]}>
              ¥{balance.toFixed(2)}
            </Text>
            <Text style={[typography.captionSm, { color: 'rgba(255,255,255,0.68)', marginTop: 4 }]}>
              提现至支付宝，平台按规则代扣个税
            </Text>
          </LinearGradient>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(80)} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>提现金额</Text>
          <View style={[styles.amountRow, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bgSecondary }]}>
            <Text style={[typography.title2, { color: colors.text.primary }]}>¥</Text>
            <TextInput
              value={amount}
              onChangeText={handleAmountChange}
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={[styles.amountInput, { color: colors.text.primary, ...typography.title1 }]}
            />
          </View>
          <View style={styles.quickRow}>
            {QUICK_AMOUNTS.map((item) => (
              <Pressable
                key={item}
                onPress={() => setClampedAmount(item)}
                style={[styles.quickButton, { borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.bgSecondary }]}
              >
                <Text style={[typography.caption, { color: colors.text.primary }]}>¥{item}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setClampedAmount(balance)}
              style={[styles.quickButton, { borderColor: colors.brand.primary, borderRadius: radius.pill, backgroundColor: colors.brand.primarySoft }]}
            >
              <Text style={[typography.caption, { color: colors.brand.primary, fontWeight: '600' }]}>全部</Text>
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(140)} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>支付宝收款信息</Text>
          <View style={[styles.inputRow, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bgSecondary }]}>
            <MaterialCommunityIcons name="alpha-a-circle-outline" size={20} color={colors.accent.blue} />
            <TextInput
              value={alipayAccount}
              onChangeText={setAlipayAccount}
              placeholder="支付宝账号 / 手机号 / 邮箱"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={[styles.textInput, typography.bodySm, { color: colors.text.primary }]}
            />
          </View>
          <View style={[styles.inputRow, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bgSecondary }]}>
            <MaterialCommunityIcons name="account-outline" size={20} color={colors.brand.primary} />
            <TextInput
              value={alipayName}
              onChangeText={setAlipayName}
              placeholder="支付宝实名认证姓名"
              placeholderTextColor={colors.muted}
              style={[styles.textInput, typography.bodySm, { color: colors.text.primary }]}
            />
          </View>
          <View style={styles.warningRow}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.warning ?? '#E65100'} />
            <Text style={[typography.captionSm, { color: colors.warning ?? '#E65100', flex: 1, marginLeft: 6, lineHeight: 18 }]}>
              账号和实名姓名必须与支付宝注册信息一致。错误信息可能导致打款失败或款项进入陌生人账户；款项失败时原路退回积分，平台不承担额外赔偿。
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(200)} style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <View style={styles.summaryRow}>
            <Text style={[typography.bodySm, { color: colors.text.secondary }]}>申请金额</Text>
            <Text style={[typography.bodySm, { color: colors.text.primary }]}>¥{grossAmount.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Pressable
              onPress={() => setLawSheetOpen(true)}
              hitSlop={8}
              style={styles.taxLabelRow}
            >
              <Text style={[typography.bodySm, { color: colors.text.secondary }]}>代扣个税（20%）</Text>
              <MaterialCommunityIcons
                name="information-outline"
                size={16}
                color={colors.text.tertiary ?? colors.text.secondary}
                style={{ marginLeft: 4 }}
              />
            </Pressable>
            <Text style={[typography.bodySm, { color: colors.danger }]}>-¥{taxAmount.toFixed(2)}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.divider }]} />
          <View style={styles.summaryRow}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>预计到账</Text>
            <Text {...priceTextProps} style={[typography.title2, { color: colors.brand.primary }]}>¥{netAmount.toFixed(2)}</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(260)}>
          <Pressable onPress={handleWithdraw} disabled={submitting || grossAmount <= 0}>
            <LinearGradient
              colors={submitting || grossAmount <= 0 ? [colors.border, colors.border] : [...gradients.goldGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.submitButton, { borderRadius: radius.pill }]}
            >
              <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: submitting || grossAmount <= 0 ? colors.text.secondary : colors.text.inverse }]}>
                {submitting ? '提交中...' : '确认提现'}
              </Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>

        <View style={[styles.noticeBox, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
          <Text style={[typography.bodySm, { color: colors.text.primary, fontWeight: '600', marginBottom: 8 }]}>
            提现规则与法律说明
          </Text>
          {[
            '限额：单笔 ¥10–¥10000；每日最多 3 次，间隔 ≥60 秒；单用户年累计上限 ¥50000。具体数值以管理端配置为准。',
            '个税代扣：依据《个人所得税法》及《财政部 税务总局公告 2019 年第 74 号》，按"偶然所得"项目代扣 20% 个税。实际到账 = 申请金额 × 80%，税款由平台依法解缴税务机关。',
            '资金通路：款项到账您的支付宝余额。如需进一步从支付宝转出至银行卡，支付宝可能收取服务费（详见支付宝规则），与本平台无关。',
            '账号责任：请妥善保管登录账号、避免在不可信网络登录。v1.0 暂未启用短信验证 / 支付密码，登录态被盗用导致的资金损失由用户自行承担。',
            '失败处理：通道返回失败时，款项原路退回消费积分余额；支付宝不确定状态由系统每 10 分钟自动查询补偿，最终状态以钱包记录为准。',
            '完整权益与责任详见《用户协议》与《个人信息保护政策》。',
          ].map((line, idx) => (
            <View key={idx} style={styles.noticeItem}>
              <Text style={[typography.captionSm, { color: colors.text.secondary, width: 18 }]}>{idx + 1}.</Text>
              <Text style={[typography.captionSm, { color: colors.text.secondary, flex: 1, lineHeight: 18 }]}>{line}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <AppBottomSheet
        open={lawSheetOpen}
        onClose={() => setLawSheetOpen(false)}
        mode="auto"
        scrollable
        title="关于 20% 代扣个税"
      >
        <View style={{ gap: 12 }}>
          <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 22 }]}>
            根据《中华人民共和国个人所得税法》及《财政部 税务总局公告 2019 年第 74 号》，平台向个人发放的奖励性收入按"<Text style={{ fontWeight: '600' }}>偶然所得</Text>"项目计征个人所得税，税率 <Text style={{ fontWeight: '600' }}>20%</Text>。
          </Text>
          <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 22 }]}>
            平台代为扣缴，依法解缴至税务机关；提现申请金额、代扣金额、实际到账金额均记录在您的钱包流水中，便于您查询及个人税务申报。
          </Text>
          <Text style={[typography.bodySm, { color: colors.text.secondary, lineHeight: 22 }]}>
            代扣比例为平台依据税法在管理端配置的当前值。比例如调整，仅对调整后的新提现生效，已完成的提现按当时记录的比例不变。
          </Text>
          <View style={[styles.lawHighlight, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
            <Text style={[typography.captionSm, { color: colors.text.secondary, lineHeight: 20 }]}>
              举例：申请提现 ¥100，代扣个税 ¥20，实际到账您的支付宝余额 ¥80。
            </Text>
          </View>
          <Pressable
            onPress={() => setLawSheetOpen(false)}
            style={[styles.lawCloseBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>我知道了</Text>
          </Pressable>
        </View>
      </AppBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceBanner: {
    padding: 20,
    alignItems: 'center',
  },
  balanceAmount: {
    fontSize: 38,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    padding: 16,
    marginTop: 16,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  amountInput: {
    flex: 1,
    marginLeft: 8,
    paddingVertical: 0,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  quickButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  textInput: {
    flex: 1,
    marginLeft: 8,
    paddingVertical: 0,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  submitButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  noticeBox: {
    padding: 12,
    marginTop: 16,
  },
  noticeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 2,
  },
  taxLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lawHighlight: {
    padding: 10,
  },
  lawCloseBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
});
