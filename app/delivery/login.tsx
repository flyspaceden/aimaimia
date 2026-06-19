import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { DeliveryAuthRepo } from '../../src/repos/delivery';
import { requestWechatAuth } from '../../src/services/wechat';
import { useDeliveryAuthStore } from '../../src/store';
import {
  DeliveryButton,
  DeliveryPanel,
  DeliveryTextField,
  useDeliveryTheme,
} from './_components';

export default function DeliveryLoginScreen() {
  const router = useRouter();
  const { show } = useToast();
  const setSession = useDeliveryAuthStore((state) => state.setSession);
  const { palette, spacing, typography } = useDeliveryTheme();
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [countdown, setCountdown] = React.useState(0);
  const [sendingCode, setSendingCode] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [wechatSubmitting, setWechatSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (countdown <= 0) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setCountdown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

  const sanitizedPhone = phone.trim();
  const phoneValid = /^1\d{10}$/.test(sanitizedPhone);

  const handleSendCode = async () => {
    if (!phoneValid) {
      show({ message: '请输入正确的配送手机号', type: 'warning' });
      return;
    }

    setSendingCode(true);
    const result = await DeliveryAuthRepo.sendSmsCode({ phone: sanitizedPhone });
    setSendingCode(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '验证码发送失败', type: 'error' });
      return;
    }

    setCountdown(60);
    show({ message: result.data.message ?? '验证码已发送', type: 'success' });
  };

  const handleSubmit = async () => {
    if (!sanitizedPhone || !code.trim()) {
      show({ message: '请填写手机号和验证码', type: 'warning' });
      return;
    }

    setSubmitting(true);
    const result = await DeliveryAuthRepo.loginWithPhone({
      phone: sanitizedPhone,
      code: code.trim(),
    });
    setSubmitting(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '配送登录失败', type: 'error' });
      return;
    }

    setSession(result.data);
    router.replace(result.data.requiresUnit ? '/delivery/unit-select' : '/delivery/(tabs)/products');
  };

  const handleWechatLogin = async () => {
    setWechatSubmitting(true);
    try {
      const authCode = await requestWechatAuth();
      const result = await DeliveryAuthRepo.loginWithWechat({ code: authCode });
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '微信配送登录失败', type: 'error' });
        return;
      }

      setSession(result.data);
      router.replace(
        result.data.requiresUnit ? '/delivery/unit-select' : '/delivery/(tabs)/products',
      );
    } catch (error: any) {
      show({ message: error?.message ?? '微信授权失败', type: 'error' });
    } finally {
      setWechatSubmitting(false);
    }
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="配送登录" showBack={false} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center' }}>
          <DeliveryPanel>
            <Text style={[typography.headingLg, { color: palette.text.primary }]}>配送</Text>
            <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.sm }]}>
              使用配送账号进入商品与下单流程
            </Text>
            <DeliveryTextField
              label="手机号"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              placeholder="请输入配送手机号"
              style={{ marginTop: spacing.xl }}
            />
            <DeliveryTextField
              label="验证码"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              placeholder="请输入验证码（测试环境可用 123456）"
              style={{ marginTop: spacing.lg }}
            />
            <View style={[styles.codeActionRow, { marginTop: spacing.md }]}>
              <DeliveryButton
                label={sendingCode ? '发送中...' : countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                onPress={handleSendCode}
                disabled={sendingCode || countdown > 0 || !phoneValid}
                variant="secondary"
                style={styles.codeButton}
              />
            </View>
            <DeliveryButton
              label={submitting ? '登录中...' : '进入配送'}
              onPress={handleSubmit}
              disabled={submitting}
              style={{ marginTop: spacing.xl }}
            />
            <DeliveryButton
              label={wechatSubmitting ? '微信登录中...' : '微信登录'}
              icon="wechat"
              onPress={handleWechatLogin}
              disabled={wechatSubmitting}
              variant="ghost"
              style={{ marginTop: spacing.md }}
            />
          </DeliveryPanel>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  codeButton: {
    minWidth: 132,
  },
});
