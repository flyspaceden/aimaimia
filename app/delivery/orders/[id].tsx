import React from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { useToast } from '../../../src/components/feedback/Toast';
import { DeliveryManifestRepo, DeliveryOrderRepo } from '../../../src/repos/delivery';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  DeliveryStatusPill,
  formatDeliveryMoney,
  useDeliveryTheme,
} from '../_components';

export default function DeliveryOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { show } = useToast();
  const { spacing, typography, palette } = useDeliveryTheme();

  const query = useQuery({
    queryKey: ['delivery-order', id],
    queryFn: () => DeliveryOrderRepo.getOrder(String(id)),
    enabled: Boolean(id),
  });

  const openManifest = async () => {
    const result = await DeliveryManifestRepo.getOrderManifest(String(id));
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '获取配送清单失败', type: 'error' });
      return;
    }
    await Linking.openURL(result.data.fileUrl);
  };

  if (query.isLoading && !query.data) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="订单详情" />
        <DeliveryLoading />
      </Screen>
    );
  }

  if (!query.data || !query.data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="订单详情" />
        <DeliveryMessageState
          title="订单加载失败"
          description={query.data?.ok === false ? query.data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          actionLabel="重新加载"
          onAction={() => query.refetch()}
          icon="alert-circle-outline"
        />
      </Screen>
    );
  }

  const order = query.data.data;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="订单详情" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => query.refetch()} />}
      >
        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>{order.id}</Text>
            <DeliveryStatusPill status={order.status} />
          </View>
          <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.sm }]}>
            支付单号 {order.merchantOrderNo || '-'}
          </Text>
          {order.note ? (
            <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.sm }]}>
              备注：{order.note}
            </Text>
          ) : null}
        </DeliveryPanel>

        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary }]}>配送信息</Text>
          <Text style={[typography.bodyStrong, { color: palette.text.primary, marginTop: spacing.md }]}>
            {order.unit.name}
          </Text>
          <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}>
            {order.address.recipientName} · {order.address.phone}
          </Text>
          <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}>
            {order.address.regionText} {order.address.detailAddress}
          </Text>
        </DeliveryPanel>

        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary, marginBottom: spacing.md }]}>
            商品明细
          </Text>
          <View style={{ gap: spacing.md }}>
            {order.items.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: palette.text.primary }]} numberOfLines={1}>
                    {item.productTitle}
                  </Text>
                  <Text style={[typography.caption, { color: palette.text.secondary, marginTop: 2 }]}>
                    {item.skuTitle} · {item.merchantName} · x{item.quantity}
                  </Text>
                </View>
                <Text style={[typography.bodyStrong, { color: palette.brand.primaryDark }]}>
                  {formatDeliveryMoney(item.lineAmount)}
                </Text>
              </View>
            ))}
          </View>
        </DeliveryPanel>

        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary, marginBottom: spacing.md }]}>
            金额汇总
          </Text>
          <Row label="商品金额" value={formatDeliveryMoney(order.goodsAmount)} />
          <Row label="配送运费" value={formatDeliveryMoney(order.shippingFee)} />
          <Row label="应付合计" value={formatDeliveryMoney(order.totalAmount)} emphasize />
        </DeliveryPanel>

        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary, marginBottom: spacing.md }]}>
            物流信息
          </Text>
          {order.shipments.length === 0 ? (
            <Text style={[typography.bodySm, { color: palette.text.secondary }]}>暂未发货</Text>
          ) : (
            <View style={{ gap: spacing.md }}>
              {order.shipments.map((shipment) => (
                <View key={shipment.id}>
                  <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>
                    {shipment.carrierName} · {shipment.waybillNo || '待回填单号'}
                  </Text>
                  <Text style={[typography.caption, { color: palette.text.secondary, marginTop: 2 }]}>
                    {shipment.status}
                    {shipment.shippedAt ? ` · 发货于 ${new Date(shipment.shippedAt).toLocaleString()}` : ''}
                  </Text>
                  {shipment.waybillUrl ? (
                    <Pressable onPress={() => Linking.openURL(shipment.waybillUrl!)}>
                      <Text style={[typography.caption, { color: palette.brand.primaryDark, marginTop: spacing.xs }]}>
                        打开面单
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </DeliveryPanel>

        <DeliveryButton label="打开配送清单" icon="file-document-outline" onPress={openManifest} />
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  const { palette, spacing, typography } = useDeliveryTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: emphasize ? 0 : spacing.sm }}>
      <Text style={[typography.bodySm, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[emphasize ? typography.bodyStrong : typography.bodySm, { color: emphasize ? palette.brand.primaryDark : palette.text.primary }]}>
        {value}
      </Text>
    </View>
  );
}
