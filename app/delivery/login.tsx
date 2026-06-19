import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { DeliveryAuthRepo } from '../../src/repos/delivery';
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
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    if (!phone.trim() || !code.trim()) {
      show({ message: '请填写手机号和验证码', type: 'warning' });
      return;
    }

    setSubmitting(true);
    const result = await DeliveryAuthRepo.loginWithPhone({
      phone: phone.trim(),
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
            <DeliveryButton
              label={submitting ? '登录中...' : '进入配送'}
              onPress={handleSubmit}
              disabled={submitting}
              style={{ marginTop: spacing.xl }}
            />
          </DeliveryPanel>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({});
