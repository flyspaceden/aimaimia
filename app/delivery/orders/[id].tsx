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

const pickupStatusLabels: Record<string, string> = {
  NOT_STARTED: '待配送',
  PARTIAL_PICKED: '分批配送中',
  ALL_PICKED: '已全部送达',
  CANCELED: '配送已取消',
};

const pickupBatchStatusLabels: Record<string, string> = {
  PLANNED: '计划中',
  READY_TO_CALL: '待顺丰下单',
  CALLING_CARRIER: '顺丰下单中',
  WAITING_DRIVER: '等待顺丰揽收',
  DRIVER_ASSIGNED: '顺丰已接单',
  ARRIVED: '快递员已上门',
  LOADED: '顺丰已揽收',
  DELIVERING: '配送中',
  COMPLETED: '已完成',
  CANCELED: '已取消',
  EXCEPTION: '异常',
};

const carrierProviderLabels: Record<string, string> = {
  SF: '顺丰',
  MANUAL: '人工安排',
};

const carrierWaybillStatusLabels: Record<string, string> = {
  WAITING_PICKUP: '等待揽收',
  SHIPPED: '已揽收',
  IN_TRANSIT: '运输中',
  DELIVERED: '已签收',
  EXCEPTION: '物流异常',
  CANCELED: '已取消',
};

const shipmentStatusLabels: Record<string, string> = {
  INIT: '待发货',
  SHIPPED: '已发货',
  IN_TRANSIT: '运输中',
  DELIVERED: '已送达',
  EXCEPTION: '物流异常',
};

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
    try {
      await Linking.openURL(result.data.fileUrl);
    } catch {
      show({ message: '配送清单打开失败，请稍后重试', type: 'error' });
    }
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
  const hasPickupBatches = order.pickupBatches.length > 0;

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
          <Row
            label={hasPickupBatches || order.pickupMode === 'MULTI_BATCH' ? '预收配送运费' : '配送运费'}
            value={formatDeliveryMoney(
              hasPickupBatches || order.pickupMode === 'MULTI_BATCH'
                ? order.prepaidPickupShippingFee
                : order.shippingFee,
            )}
          />
          <Row label="应付合计" value={formatDeliveryMoney(order.totalAmount)} emphasize />
        </DeliveryPanel>

        {hasPickupBatches ? (
          <DeliveryPanel style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
              <Text style={[typography.headingSm, { color: palette.text.primary }]}>
                配送进度
              </Text>
              <Text style={[typography.caption, { color: palette.brand.primaryDark }]} numberOfLines={1}>
                {pickupStatusLabels[order.pickupStatus] ?? '状态待更新'}
              </Text>
            </View>
            <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
              预计 {order.plannedPickupCount} 个配送批次 · 已预收 {formatDeliveryMoney(order.prepaidPickupShippingFee)}
            </Text>

            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {order.items.map((item) => (
                <View key={item.id}>
                  <Text style={[typography.bodyStrong, { color: palette.text.primary }]} numberOfLines={1}>
                    {item.productTitle}
                  </Text>
                  <Text style={[typography.caption, { color: palette.text.secondary, marginTop: 2 }]}>
                    已购 {item.quantity}{item.unitName} · 已送达 {item.pickedQuantity}{item.unitName} · 待配送 {item.remainingQuantity}{item.unitName}
                  </Text>
                </View>
              ))}
            </View>

            <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
              {order.pickupBatches.map((batch) => {
                return (
                  <View
                    key={batch.id}
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: palette.border,
                      paddingTop: spacing.md,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                      <Text style={[typography.bodyStrong, { color: palette.text.primary, flex: 1 }]} numberOfLines={1}>
                        第 {batch.batchNo} 个配送批次
                      </Text>
                      <Text style={[typography.caption, { color: palette.brand.primaryDark }]} numberOfLines={1}>
                        {pickupBatchStatusLabels[batch.status] ?? '状态待更新'}
                      </Text>
                    </View>
                    <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                      {carrierProviderLabels[batch.provider] ?? '配送承运方'} · {batch.expressTypeName || '快递产品待确定'}
                    </Text>
                    <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                      {batch.packageCount ? `${batch.packageCount}件` : '件数待确定'} · {batch.totalWeightKg ? `${batch.totalWeightKg}kg` : '重量待确定'}
                    </Text>
                    {batch.waybills.length > 0 ? (
                      <View style={{ marginTop: spacing.xs, gap: 2 }}>
                        {batch.waybills.map((waybill) => (
                          <Text key={waybill.trackingNo} style={[typography.caption, { color: palette.brand.primaryDark }]}>
                            顺丰运单 {waybill.trackingNo} · {carrierWaybillStatusLabels[waybill.status] ?? '状态待更新'}
                          </Text>
                        ))}
                      </View>
                    ) : (
                      <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                        顺丰运单号 {batch.carrierOrderNo || '待生成'}
                      </Text>
                    )}
                    <Text style={[typography.caption, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                      {batch.completedAt
                        ? `完成时间 ${formatDeliveryDate(batch.completedAt)}`
                        : `计划时间 ${formatDeliveryDate(batch.plannedPickupAt) || '待安排'}`}
                    </Text>
                    <View style={{ marginTop: spacing.sm, gap: 2 }}>
                      {batch.items.map((item) => (
                        <Text
                          key={item.id}
                          style={[typography.caption, { color: palette.text.tertiary }]}
                          numberOfLines={1}
                        >
                          {item.productTitle || '配送商品'} {item.skuTitle ? `· ${item.skuTitle}` : ''} · 计划 {item.quantity}{item.unitName} · 已送达 {item.pickedQuantity}{item.unitName}
                        </Text>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </DeliveryPanel>
        ) : (
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
                      {shipmentStatusLabels[shipment.status] ?? '状态待更新'}
                      {shipment.shippedAt ? ` · 发货于 ${new Date(shipment.shippedAt).toLocaleString()}` : ''}
                    </Text>
                    {shipment.waybillUrl ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`打开面单 ${shipment.waybillNo || ''}`.trim()}
                        onPress={async () => {
                          try {
                            await Linking.openURL(shipment.waybillUrl!);
                          } catch {
                            show({ message: '面单打开失败，请稍后重试', type: 'error' });
                          }
                        }}
                      >
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
        )}

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

function formatDeliveryDate(value: string | null) {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleString();
}
