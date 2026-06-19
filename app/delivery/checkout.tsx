import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { DeliveryOrderRepo } from '../../src/repos/delivery';
import { useDeliveryAuthStore, useDeliveryCartStore } from '../../src/store';
import {
  DeliveryButton,
  DeliveryPanel,
  DeliveryTextField,
  formatDeliveryMoney,
  useDeliveryTheme,
} from './_components';

export default function DeliveryCheckoutScreen() {
  const router = useRouter();
  const { show } = useToast();
  const { palette, spacing, typography } = useDeliveryTheme();
  const currentUnit = useDeliveryAuthStore((state) => state.currentUnit);
  const items = useDeliveryCartStore((state) => state.items.filter((item) => item.isSelected));
  const [note, setNote] = React.useState('');
  const [paymentChannel, setPaymentChannel] = React.useState<'ALIPAY' | 'WECHAT_PAY'>('ALIPAY');
  const [submitting, setSubmitting] = React.useState(false);

  const total = items.reduce((sum, item) => sum + item.lineAmount, 0);

  const handleSubmit = async () => {
    if (!items.length) {
      show({ message: '请先选择要结算的商品', type: 'warning' });
      return;
    }

    setSubmitting(true);
    const result = await DeliveryOrderRepo.createCheckout({
      cartItemIds: items.map((item) => item.id),
      note: note.trim() || undefined,
      paymentChannel,
    });
    setSubmitting(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '创建配送结算单失败', type: 'error' });
      return;
    }

    router.replace({
      pathname: '/delivery/payment-success',
      params: {
        checkoutId: result.data.id,
        merchantOrderNo: result.data.merchantOrderNo,
      },
    });
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="配送结算" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
          <DeliveryPanel style={{ marginBottom: spacing.md }}>
            <Text style={[typography.headingSm, { color: palette.text.primary }]}>配送单位</Text>
            <Text style={[typography.bodyStrong, { color: palette.text.primary, marginTop: spacing.md }]}>
              {currentUnit?.name || '未选择单位'}
            </Text>
            {currentUnit ? (
              <>
                <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                  {currentUnit.contactName} · {currentUnit.contactPhone}
                </Text>
                <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                  {currentUnit.provinceName} {currentUnit.cityName} {currentUnit.districtName} {currentUnit.detailAddress}
                </Text>
              </>
            ) : null}
          </DeliveryPanel>

          <DeliveryPanel style={{ marginBottom: spacing.md }}>
            <Text style={[typography.headingSm, { color: palette.text.primary }]}>支付方式</Text>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <DeliveryButton
                  label="支付宝"
                  variant={paymentChannel === 'ALIPAY' ? 'primary' : 'secondary'}
                  onPress={() => setPaymentChannel('ALIPAY')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <DeliveryButton
                  label="微信支付"
                  variant={paymentChannel === 'WECHAT_PAY' ? 'primary' : 'secondary'}
                  onPress={() => setPaymentChannel('WECHAT_PAY')}
                />
              </View>
            </View>
          </DeliveryPanel>

          <DeliveryPanel style={{ marginBottom: spacing.md }}>
            <Text style={[typography.headingSm, { color: palette.text.primary, marginBottom: spacing.md }]}>
              商品清单
            </Text>
            <View style={{ gap: spacing.sm }}>
              {items.map((item) => (
                <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: palette.text.primary }]} numberOfLines={1}>
                      {item.productTitle}
                    </Text>
                    <Text style={[typography.caption, { color: palette.text.secondary, marginTop: 2 }]}>
                      {item.skuTitle} · x{item.quantity}
                    </Text>
                  </View>
                  <Text style={[typography.bodyStrong, { color: palette.brand.primaryDark }]}>
                    {formatDeliveryMoney(item.lineAmount)}
                  </Text>
                </View>
              ))}
            </View>
          </DeliveryPanel>

          <DeliveryTextField
            label="备注"
            value={note}
            onChangeText={setNote}
            placeholder="选填，给配送链路的备注"
            multiline
          />

          <DeliveryPanel style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>商品金额</Text>
              <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>
                {formatDeliveryMoney(total)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
              <Text style={[typography.headingSm, { color: palette.text.primary }]}>应付合计</Text>
              <Text style={[typography.headingSm, { color: palette.brand.primaryDark }]}>
                {formatDeliveryMoney(total)}
              </Text>
            </View>
          </DeliveryPanel>

          <DeliveryButton
            label={submitting ? '提交中...' : '提交配送结算'}
            onPress={handleSubmit}
            disabled={submitting || !items.length}
            style={{ marginTop: spacing.lg }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
