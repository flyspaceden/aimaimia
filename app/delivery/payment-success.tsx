import React from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { DeliveryOrderRepo } from '../../src/repos/delivery';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  formatDeliveryMoney,
  useDeliveryTheme,
} from './_components';

export default function DeliveryPaymentSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ checkoutId?: string; merchantOrderNo?: string }>();
  const checkoutId = typeof params.checkoutId === 'string' ? params.checkoutId : '';
  const merchantOrderNo = typeof params.merchantOrderNo === 'string' ? params.merchantOrderNo : '';
  const { palette, spacing, typography } = useDeliveryTheme();

  const query = useQuery({
    queryKey: ['delivery-checkout-status', checkoutId],
    queryFn: async () => {
      await DeliveryOrderRepo.activeQueryPayment(checkoutId);
      return DeliveryOrderRepo.getCheckout(checkoutId);
    },
    enabled: Boolean(checkoutId),
    refetchInterval: 15_000,
  });

  if (checkoutId && query.isLoading && !query.data) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="配送结算状态" />
        <DeliveryLoading />
      </Screen>
    );
  }

  const checkout = query.data?.ok ? query.data.data : null;
  const title =
    checkout?.status === 'COMPLETED' || checkout?.status === 'PAID'
      ? '支付成功'
      : '支付结果确认中';
  const description =
    checkout?.status === 'COMPLETED' || checkout?.status === 'PAID'
      ? '配送订单正在生成或已经生成，可以去订单页查看'
      : '已拉起配送支付，当前还在等待渠道回调或订单生成，请稍后刷新状态';

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="配送结算状态" />
      <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center' }}>
        {!checkoutId ? (
          <DeliveryMessageState
            title="缺少结算单信息"
            description="请返回配送商品页重新发起结算"
            actionLabel="返回商品页"
            onAction={() => router.replace('/delivery/(tabs)/products')}
            icon="alert-circle-outline"
          />
        ) : (
          <DeliveryPanel>
            <Text style={[typography.headingLg, { color: palette.text.primary }]}>{title}</Text>
            <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.sm }]}>
              {description}
            </Text>
            <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
              <View>
                <Text style={[typography.caption, { color: palette.text.secondary }]}>结算单号</Text>
                <Text style={[typography.bodyStrong, { color: palette.text.primary, marginTop: 4 }]}>
                  {merchantOrderNo || checkout?.merchantOrderNo || '-'}
                </Text>
              </View>
              <View>
                <Text style={[typography.caption, { color: palette.text.secondary }]}>当前状态</Text>
                <Text style={[typography.bodyStrong, { color: palette.text.primary, marginTop: 4 }]}>
                  {checkout?.status || 'ACTIVE'}
                </Text>
              </View>
              {checkout ? (
                <View>
                  <Text style={[typography.caption, { color: palette.text.secondary }]}>订单金额</Text>
                  <Text style={[typography.bodyStrong, { color: palette.brand.primaryDark, marginTop: 4 }]}>
                    {formatDeliveryMoney(checkout.totalAmount)}
                  </Text>
                </View>
              ) : null}
            </View>
            <DeliveryButton
              label="刷新状态"
              variant="secondary"
              onPress={() => query.refetch()}
              style={{ marginTop: spacing.xl }}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <DeliveryButton
                  label="返回商品"
                  variant="ghost"
                  onPress={() => router.replace('/delivery/(tabs)/products')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <DeliveryButton
                  label="查看订单"
                  onPress={() => router.push('/delivery/orders')}
                />
              </View>
            </View>
          </DeliveryPanel>
        )}
      </View>
    </Screen>
  );
}
