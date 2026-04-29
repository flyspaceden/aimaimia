import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback';
import { BonusRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';

const channels = [
  { key: 'wechat', label: '微信', icon: 'wechat' as const },
  { key: 'alipay', label: '支付宝', icon: 'alpha-a-circle-outline' as const },
  { key: 'bankcard', label: '银行卡', icon: 'credit-card-outline' as const },
];

export default function WithdrawScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState('wechat');
  const [submitting, setSubmitting] = useState(false);

  const { data: walletData } = useQuery({
    queryKey: ['bonus-wallet'],
    queryFn: () => BonusRepo.getWallet(),
    enabled: isLoggedIn,
  });
  const balance = walletData?.ok ? walletData.data.balance : 0;

  const handleWithdraw = async () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) { show({ message: '请输入正确的提现金额', type: 'error' }); return; }
    if (num > balance) { show({ message: '余额不足', type: 'error' }); return; }
    setSubmitting(true);
    const result = await BonusRepo.requestWithdraw(num, channel);
    setSubmitting(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '提现失败', type: 'error' });
      return;
    }
    show({ message: '提现申请已提交', type: 'success' });
    queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] });
    queryClient.invalidateQueries({ queryKey: ['bonus-ledger'] });
    router.back();
  };

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title="申请提现" />
      {/* ScrollView 让"确认提现"按钮在键盘弹起时能滚到可视区上方
          原手写 KAV Android behavior=undefined 等于禁用，实际并未生效 */}
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 200 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
          {/* 可用余额 — 渐变背景 */}
          <Animated.View entering={FadeInDown.duration(300)}>
            <LinearGradient
              colors={[...gradients.aiGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.balanceBanner, shadow.md, { borderRadius: radius.lg }]}
            >
              <Text style={[typography.caption, { color: 'rgba(255,255,255,0.7)' }]}>可提现余额</Text>
              <Text style={[typography.title1, { color: '#FFFFFF', marginTop: 4 }]}>
                {balance.toFixed(2)} 元
              </Text>
            </LinearGradient>
          </Animated.View>

          {/* 金额输入 */}
          <Animated.View entering={FadeInDown.duration(300).delay(80)}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: spacing.xl }]}>
              提现金额
            </Text>
            <View style={[styles.amountRow, shadow.md, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }]}>
              <Text style={[typography.title2, { color: colors.text.primary }]}>¥</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                style={[styles.amountInput, { color: colors.text.primary, ...typography.title1 }]}
              />
              <Pressable onPress={() => setAmount(balance.toString())}>
                <Text style={[typography.caption, { color: colors.accent.blue }]}>全部提现</Text>
              </Pressable>
            </View>
          </Animated.View>

          {/* 提现渠道 */}
          <Animated.View entering={FadeInDown.duration(300).delay(160)}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: spacing.xl }]}>
              提现方式
            </Text>
            {channels.map((ch, index) => {
              const active = channel === ch.key;
              return (
                <Animated.View key={ch.key} entering={FadeInDown.duration(300).delay(200 + index * 40)}>
                  <Pressable
                    onPress={() => setChannel(ch.key)}
                    style={[
                      styles.channelRow,
                      {
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.lg,
                        backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={ch.icon}
                      size={24}
                      color={active ? colors.brand.primary : colors.text.secondary}
                    />
                    <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1, marginLeft: 12 }]}>
                      {ch.label}
                    </Text>
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor: active ? colors.brand.primary : colors.border,
                          backgroundColor: active ? colors.brand.primary : 'transparent',
                        },
                      ]}
                    />
                  </Pressable>
                </Animated.View>
              );
            })}
          </Animated.View>

          {/* 提交按钮 — 金色渐变 */}
          <Animated.View entering={FadeInDown.duration(300).delay(320)}>
            <Pressable onPress={handleWithdraw} disabled={submitting}>
              <LinearGradient
                colors={submitting ? [colors.border, colors.border] : [...gradients.goldGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.submitButton, { borderRadius: radius.pill, marginTop: spacing['2xl'] }]}
              >
                <Text style={[typography.bodyStrong, { color: submitting ? colors.text.secondary : '#FFFFFF' }]}>
                  {submitting ? '提交中...' : '确认提现'}
                </Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* 提现说明 */}
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              提现说明：提现申请提交后将在 1-3 个工作日内到账。最低提现金额 1 元。
            </Text>
          </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceBanner: {
    padding: 20,
    alignItems: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  amountInput: {
    flex: 1,
    marginLeft: 8,
    paddingVertical: 0,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  submitButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
});
