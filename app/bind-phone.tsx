import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../src/components/layout';
import { useToast } from '../src/components/feedback';
import { UserRepo } from '../src/repos';
import { useTheme } from '../src/theme';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_PATTERN = /^\d{6}$/;

export default function BindPhoneScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cdRef.current) clearInterval(cdRef.current);
    };
  }, []);

  const startCountdown = useCallback(() => {
    setCountdown(60);
    cdRef.current = setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) {
          if (cdRef.current) clearInterval(cdRef.current);
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  }, []);

  const handleSendCode = useCallback(async () => {
    if (!PHONE_PATTERN.test(phone.trim())) {
      show({ message: '请输入有效的手机号', type: 'info' });
      return;
    }
    if (countdown > 0 || sendingCode) return;

    setSendingCode(true);
    const r = await UserRepo.sendBindPhoneCode(phone.trim());
    setSendingCode(false);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '发送失败', type: 'error' });
      return;
    }
    show({ message: '验证码已发送', type: 'success' });
    startCountdown();
  }, [phone, countdown, sendingCode, show, startCountdown]);

  const canSubmit = PHONE_PATTERN.test(phone.trim()) && CODE_PATTERN.test(code.trim()) && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const r = await UserRepo.bindPhone({ phone: phone.trim(), code: code.trim() });
    setSubmitting(false);
    if (!r.ok) {
      show({ message: r.error.displayMessage ?? '绑定失败', type: 'error' });
      return;
    }
    show({ message: '绑定成功', type: 'success' });
    // 刷新账号资料；延迟 500ms 让 Toast 渲染完成后再返回，避免下一页瞬间盖住
    queryClient.invalidateQueries({ queryKey: ['me-profile'] });
    setTimeout(() => router.back(), 500);
  }, [canSubmit, phone, code, show, queryClient, router]);

  const sendButtonLabel = sendingCode
    ? '发送中…'
    : countdown > 0
      ? `${countdown}s 后重发`
      : '发送验证码';
  const sendButtonDisabled = sendingCode || countdown > 0 || !PHONE_PATTERN.test(phone.trim());

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title="绑定手机号" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* 顶部说明卡片 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View
            style={[
              styles.infoCard,
              shadow.sm,
              {
                backgroundColor: colors.brand.primary + '10',
                borderRadius: radius.lg,
                borderColor: colors.brand.primary + '30',
              },
            ]}
          >
            <MaterialCommunityIcons name="cellphone-lock" size={22} color={colors.brand.primary} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>为账号绑定手机号</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                绑定后可直接用该手机号登录此账号
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* 输入卡片 */}
        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <View
            style={[
              styles.card,
              shadow.md,
              { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg },
            ]}
          >
            {/* 手机号 */}
            <View style={[styles.inputRow, { borderColor: colors.border, borderRadius: radius.md }]}>
              <MaterialCommunityIcons name="cellphone" size={18} color={colors.text.secondary} />
              <TextInput
                style={[typography.body, styles.input, { color: colors.text.primary, marginLeft: 8 }]}
                placeholder="请输入手机号"
                placeholderTextColor={colors.text.secondary}
                keyboardType="phone-pad"
                maxLength={11}
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ''))}
                autoComplete="tel"
              />
            </View>

            {/* 验证码 */}
            <View
              style={[
                styles.inputRow,
                {
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  marginTop: spacing.sm,
                },
              ]}
            >
              <MaterialCommunityIcons name="shield-key-outline" size={18} color={colors.text.secondary} />
              <TextInput
                style={[typography.body, styles.input, { color: colors.text.primary, marginLeft: 8 }]}
                placeholder="6 位短信验证码"
                placeholderTextColor={colors.text.secondary}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ''))}
                autoComplete="sms-otp"
              />
              <Pressable onPress={handleSendCode} disabled={sendButtonDisabled} hitSlop={8}>
                <Text
                  style={[
                    typography.bodyStrong,
                    {
                      color: sendButtonDisabled ? colors.text.secondary : colors.brand.primary,
                      fontSize: 13,
                    },
                  ]}
                >
                  {sendButtonLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {/* 提交按钮 */}
        <Animated.View entering={FadeInDown.duration(300).delay(160)}>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[
              styles.submitButton,
              {
                backgroundColor: canSubmit ? colors.brand.primary : colors.border,
                borderRadius: radius.pill,
                marginTop: spacing.xl,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: '#fff' }]}>
              {submitting ? '提交中…' : '确认绑定'}
            </Text>
          </Pressable>
        </Animated.View>

        {/* 底部安全提示 */}
        <Animated.View entering={FadeInDown.duration(300).delay(240)}>
          <View style={{ marginTop: spacing.lg, paddingHorizontal: 4 }}>
            <Text style={[typography.caption, { color: colors.text.secondary, lineHeight: 20 }]}>
              一个账号只能绑定一个手机号，绑定后暂不支持换绑或解绑。请确认手机号属于本人后再提交。
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
  },
  card: {
    padding: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  input: {
    flex: 1,
    height: 44,
    padding: 0,
  },
  submitButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
