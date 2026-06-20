import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { paymentMethods } from '../../src/constants/payment';
import { DeliveryOrderRepo } from '../../src/repos/delivery';
import type { DeliveryCheckoutSession } from '../../src/repos/delivery';
import { useDeliveryAuthStore, useDeliveryCartStore } from '../../src/store';
import { payWithAlipay } from '../../src/utils/alipay';
import { resolveDeliveryCheckoutSummary } from '../../src/utils/deliveryCheckoutSummary';
import { hasCompleteWechatPayPayload, payWithWechat } from '../../src/utils/wechat-pay';
import {
  DeliveryButton,
  DeliveryPanel,
  DeliveryTextField,
  formatDeliveryMoney,
  useDeliveryTheme,
} from './_components';

const deliveryPaymentMethods = paymentMethods
  .filter(
    (
      method,
    ): method is (typeof paymentMethods)[number] & { value: 'alipay' | 'wechat' } =>
      method.value === 'alipay' || method.value === 'wechat',
  )
  .map((method) => ({
    ...method,
    channel: method.value === 'wechat' ? ('WECHAT_PAY' as const) : ('ALIPAY' as const),
  }));

const getDefaultDeliveryPaymentChannel = () =>
  deliveryPaymentMethods.find((method) => method.available)?.channel ?? 'ALIPAY';

export default function DeliveryCheckoutScreen() {
  const router = useRouter();
  const { show } = useToast();
  const { palette, spacing, typography } = useDeliveryTheme();
  const currentUnit = useDeliveryAuthStore((state) => state.currentUnit);
  const items = useDeliveryCartStore((state) => state.items.filter((item) => item.isSelected));
  const syncCartFromServer = useDeliveryCartStore((state) => state.syncFromServer);
  const [note, setNote] = React.useState('');
  const [paymentChannel, setPaymentChannel] = React.useState<'ALIPAY' | 'WECHAT_PAY'>(
    () => getDefaultDeliveryPaymentChannel(),
  );
  const [lockedCheckout, setLockedCheckout] = React.useState<DeliveryCheckoutSession | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);

  const total = items.reduce((sum, item) => sum + item.lineAmount, 0);
  const checkoutSignature = React.useMemo(
    () => JSON.stringify({
      items: items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        lineAmount: item.lineAmount,
      })),
      note: note.trim(),
      paymentChannel,
    }),
    [items, note, paymentChannel],
  );
  const summary = React.useMemo(
    () => resolveDeliveryCheckoutSummary({
      localGoodsAmount: total,
      lockedCheckout,
    }),
    [lockedCheckout, total],
  );
  const availablePaymentChannel = React.useMemo(
    () => deliveryPaymentMethods.find((method) => method.available)?.channel ?? 'ALIPAY',
    [],
  );
  const selectedPaymentMethod = React.useMemo(
    () => deliveryPaymentMethods.find((method) => method.channel === paymentChannel) ?? null,
    [paymentChannel],
  );

  React.useEffect(() => {
    if (selectedPaymentMethod?.available) {
      return;
    }
    setPaymentChannel(availablePaymentChannel);
  }, [availablePaymentChannel, selectedPaymentMethod]);

  React.useEffect(() => {
    setLockedCheckout(null);
  }, [checkoutSignature]);

  const navigateToStatus = (checkoutId: string, merchantOrderNo?: string | null) => {
    router.replace({
      pathname: '/delivery/payment-success',
      params: {
        checkoutId,
        merchantOrderNo: merchantOrderNo || undefined,
      },
    });
  };

  const navigateIfCanceledPaymentWasActuallyPaid = async (
    checkoutId: string,
    merchantOrderNo?: string | null,
  ) => {
    const result = await DeliveryOrderRepo.activeQueryPayment(checkoutId);
    if (!result.ok) {
      return false;
    }
    if (result.data.status !== 'COMPLETED' && result.data.status !== 'PAID') {
      return false;
    }

    await syncCartFromServer();
    navigateToStatus(checkoutId, merchantOrderNo);
    return true;
  };

  const confirmPaymentAndNavigate = async (checkoutId: string, merchantOrderNo?: string | null) => {
    show({ message: '配送支付确认中...', type: 'info' });

    let completed = false;
    const handleActiveQuery = async (): Promise<'completed' | 'terminal-failure' | 'continue-poll'> => {
      const result = await DeliveryOrderRepo.activeQueryPayment(checkoutId);
      if (result.ok) {
        if (result.data.status === 'COMPLETED' || result.data.status === 'PAID') {
          completed = true;
          return 'completed';
        }
        if (result.data.status === 'EXPIRED' || result.data.status === 'FAILED') {
          show({ message: result.data.status === 'EXPIRED' ? '配送支付超时，请重试' : '配送支付失败', type: 'error' });
          return 'terminal-failure';
        }
        return 'continue-poll';
      }

      const code = result.error.code;
      if (code === 'INVALID' || code === 'FORBIDDEN' || code === 'NOT_FOUND') {
        show({ message: result.error.displayMessage ?? '配送支付确认失败，请联系客服', type: 'error' });
        return 'terminal-failure';
      }
      return 'continue-poll';
    };

    const firstOutcome = await handleActiveQuery();
    if (firstOutcome === 'terminal-failure') {
      return false;
    }

    if (!completed) {
      const maxPolls = 90;
      const pollIntervalMs = 2000;
      const activeQueryEvery = 5;
      for (let i = 0; i < maxPolls; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        if (i > 0 && i % activeQueryEvery === 0) {
          const outcome = await handleActiveQuery();
          if (outcome === 'completed') break;
          if (outcome === 'terminal-failure') return false;
        }

        const statusResult = await DeliveryOrderRepo.getCheckout(checkoutId);
        if (!statusResult.ok) {
          continue;
        }
        const { status } = statusResult.data;
        if (status === 'COMPLETED' || status === 'PAID') {
          completed = true;
          break;
        }
        if (status === 'EXPIRED' || status === 'FAILED') {
          show({ message: status === 'EXPIRED' ? '配送支付超时，请重试' : '配送支付失败', type: 'error' });
          return false;
        }
      }
    }

    if (!completed) {
      show({ message: '配送支付处理中，请稍后在配送订单中查看', type: 'warning' });
      navigateToStatus(checkoutId, merchantOrderNo);
      return true;
    }

    await syncCartFromServer();
    navigateToStatus(checkoutId, merchantOrderNo);
    return true;
  };

  const handleSubmit = async () => {
    if (submittingRef.current) {
      return;
    }
    if (!items.length) {
      show({ message: '请先选择要结算的商品', type: 'warning' });
      return;
    }
    if (!selectedPaymentMethod?.available) {
      setPaymentChannel(availablePaymentChannel);
      show({ message: '当前支付方式不可用，请选择可用渠道后重试', type: 'warning' });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    let shouldReleaseSubmitLock = true;

    try {
      let checkout = lockedCheckout;
      if (!checkout) {
        const result = await DeliveryOrderRepo.createCheckout({
          cartItemIds: items.map((item) => item.id),
          note: note.trim() || undefined,
          paymentChannel,
        });

        if (!result.ok) {
          show({ message: result.error.displayMessage ?? '创建配送结算单失败', type: 'error' });
          return;
        }

        checkout = result.data;
        setLockedCheckout(checkout);
        show({ message: '配送费用已锁定，请核对应付合计后确认支付', type: 'success' });
        return;
      }

      const paymentResult = await DeliveryOrderRepo.createPaymentParams(checkout.id);
      if (!paymentResult.ok) {
        setLockedCheckout(null);
        show({ message: paymentResult.error.displayMessage ?? '拉起配送支付失败', type: 'error' });
        return;
      }

      const { paymentParams, merchantOrderNo } = paymentResult.data;
      if (paymentParams?.channel === 'alipay' && paymentParams.orderStr) {
        const alipayResult = await payWithAlipay(paymentParams.orderStr);
        if (alipayResult.memo === 'NATIVE_UNAVAILABLE') {
          show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
          return;
        }
        if (alipayResult.resultStatus === '6001') {
          const recovered = await navigateIfCanceledPaymentWasActuallyPaid(checkout.id, merchantOrderNo);
          if (recovered) {
            shouldReleaseSubmitLock = false;
            return;
          }
          show({ message: '已取消支付', type: 'warning' });
          return;
        }
        if (!alipayResult.success) {
          show({
            message:
              alipayResult.memo === 'TIMEOUT'
                ? '支付宝未响应，正在等待配送支付回调确认'
                : '正在确认支付宝支付结果',
            type: 'warning',
          });
        }
        shouldReleaseSubmitLock = !(await confirmPaymentAndNavigate(checkout.id, merchantOrderNo));
        return;
      }

      if (paymentParams?.channel === 'wechat' && hasCompleteWechatPayPayload(paymentParams)) {
        const wechatResult = await payWithWechat(paymentParams);
        if (wechatResult.errStr === 'NATIVE_UNAVAILABLE') {
          show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
          return;
        }
        if (wechatResult.errStr === 'WECHAT_NOT_INSTALLED') {
          show({ message: '请先安装微信 App 后再使用微信支付', type: 'error' });
          return;
        }
        if (wechatResult.resultStatus === '6001') {
          const recovered = await navigateIfCanceledPaymentWasActuallyPaid(checkout.id, merchantOrderNo);
          if (recovered) {
            shouldReleaseSubmitLock = false;
            return;
          }
          show({ message: '已取消支付', type: 'warning' });
          return;
        }
        if (!wechatResult.success) {
          show({ message: '正在确认微信支付结果', type: 'warning' });
        }
        shouldReleaseSubmitLock = !(await confirmPaymentAndNavigate(checkout.id, merchantOrderNo));
        return;
      }

      show({ message: '支付服务暂不可用，请稍后重试或联系客服', type: 'error' });
    } finally {
      if (shouldReleaseSubmitLock) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
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
              {deliveryPaymentMethods.map((method) => (
                <View key={method.channel} style={{ flex: 1 }}>
                  <DeliveryButton
                    label={method.label}
                    variant={paymentChannel === method.channel ? 'primary' : 'secondary'}
                    onPress={() => {
                      if (!method.available) {
                        return;
                      }
                      setPaymentChannel(method.channel);
                    }}
                    disabled={!method.available || submitting}
                  />
                </View>
              ))}
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
            onChangeText={(value) => {
              setNote(value);
              setLockedCheckout(null);
            }}
            placeholder="选填，给配送链路的备注"
            multiline
          />

          <DeliveryPanel style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>商品金额</Text>
              <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>
                {formatDeliveryMoney(summary.goodsAmount)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
              <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>配送费</Text>
              <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>
                {summary.shippingFee === null ? '提交后锁定' : formatDeliveryMoney(summary.shippingFee)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
              <Text style={[typography.headingSm, { color: palette.text.primary }]}>应付合计</Text>
              <Text style={[typography.headingSm, { color: palette.brand.primaryDark }]}>
                {formatDeliveryMoney(summary.totalAmount)}
              </Text>
            </View>
            {summary.source === 'LOCKED_CHECKOUT' ? (
              <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.sm }]}>
                已按平台规则锁定配送费用，确认无误后继续支付。
              </Text>
            ) : null}
          </DeliveryPanel>

          <DeliveryButton
            label={submitting ? '提交中...' : lockedCheckout ? '确认支付' : '提交配送结算'}
            onPress={handleSubmit}
            disabled={submitting || !items.length}
            style={{ marginTop: spacing.lg }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
