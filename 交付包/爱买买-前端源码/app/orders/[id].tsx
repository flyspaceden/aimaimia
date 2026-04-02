import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { orderStatusLabels } from '../../src/constants/statuses';
import { OrderRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

const afterSaleLabels: Record<string, string> = {
  applying: '申请中',
  reviewing: '审核中',
  refunding: '退款中',
  completed: '已完成',
};

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: Boolean(orderId),
  });
  const refreshing = isFetching;

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="订单详情" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={200} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="订单详情" />
        <ErrorState
          title="订单加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const order = data.data;
  const afterSaleTimeline = order.afterSaleTimeline ?? [];

  const handlePay = async () => {
    const result = await OrderRepo.payOrder(order.id, order.paymentMethod ?? 'wechat');
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '支付失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    show({ message: '支付成功', type: 'success' });
    refetch();
  };

  const handleAdvanceAfterSale = async () => {
    const result = await OrderRepo.advanceAfterSale(order.id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '更新失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-issue'] });
    show({ message: '售后进度已更新', type: 'success' });
    refetch();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="订单详情" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
      >
        <View style={[styles.summaryCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{order.id}</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            {orderStatusLabels[order.status]} · {order.createdAt}
          </Text>
          {order.logisticsStatus ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
              物流：{order.logisticsStatus}
            </Text>
          ) : null}
          {order.tracePreview ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              预计送达：{order.tracePreview}
            </Text>
          ) : null}
          {order.afterSaleStatus ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              售后进度：{afterSaleLabels[order.afterSaleStatus] ?? '处理中'}
            </Text>
          ) : null}
        </View>

        <View style={[styles.actionRow, { borderColor: colors.border }]}>
          {order.status === 'pendingPay' ? (
            <Pressable
              onPress={handlePay}
              style={[styles.actionButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <Text style={[typography.caption, { color: colors.text.inverse }]}>立即支付</Text>
            </Pressable>
          ) : null}
          {order.status === 'shipping' ? (
            <Pressable
              onPress={() => router.push('/orders/track')}
              style={[styles.actionButtonOutline, { borderColor: colors.border, borderRadius: radius.pill }]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>查看物流</Text>
            </Pressable>
          ) : null}
          {order.status !== 'afterSale' && order.status !== 'pendingPay' ? (
            <Pressable
              onPress={() => router.push({ pathname: '/orders/after-sale/[id]', params: { id: order.id } })}
              style={[styles.actionButtonOutline, { borderColor: colors.border, borderRadius: radius.pill }]}
            >
              <Text style={[typography.caption, { color: colors.text.secondary }]}>申请售后</Text>
            </Pressable>
          ) : null}
        </View>

        {order.status === 'afterSale' ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>售后进度</Text>
            <View style={[styles.afterSaleCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              {afterSaleTimeline.length === 0 ? (
                <Text style={[typography.caption, { color: colors.text.secondary }]}>暂无售后节点</Text>
              ) : (
                afterSaleTimeline.map((step, index) => (
                  <View key={`${step.status}-${index}`} style={styles.afterSaleRow}>
                    <View
                      style={[
                        styles.afterSaleDot,
                        {
                          backgroundColor:
                            step.status === order.afterSaleStatus ? colors.brand.primary : colors.border,
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{step.title}</Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                        {step.time}
                      </Text>
                      {step.note ? (
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                          {step.note}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
              <Pressable
                onPress={handleAdvanceAfterSale}
                style={[styles.afterSaleAction, { borderRadius: radius.pill, borderColor: colors.border }]}
              >
                <Text style={[typography.caption, { color: colors.text.secondary }]}>模拟推进售后</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>商品清单</Text>
          {order.items.length === 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <EmptyState title="暂无商品" description="订单中没有商品记录" />
            </View>
          ) : (
            order.items.map((item) => (
              <View
                key={item.id}
                style={[styles.itemRow, { borderBottomColor: colors.border }]}
              >
                <View style={styles.itemInfo}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.title}</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    数量 x{item.quantity}
                  </Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  ¥{item.price.toFixed(2)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text style={[typography.body, { color: colors.text.secondary }]}>合计</Text>
          <Text style={[typography.title3, { color: colors.text.primary }]}>¥{order.totalPrice.toFixed(2)}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 10,
  },
  actionButtonOutline: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 10,
  },
  afterSaleCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 12,
  },
  afterSaleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  afterSaleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
    marginTop: 6,
  },
  afterSaleAction: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  totalRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
