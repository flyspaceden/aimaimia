import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { Skeleton } from '../../src/components/feedback';
import { AiCardGlow } from '../../src/components/ui';
import { OrderRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';

// I10修复：保留 mock 作为无 orderId 时的 fallback
const fallbackTimeline = [
  { id: 't1', time: '今天 09:20', status: '包裹已揽收', location: '上海转运中心' },
  { id: 't2', time: '昨天 18:40', status: '已发货', location: '青禾农场仓库' },
  { id: 't3', time: '昨天 10:10', status: '订单已出库', location: '青禾农场' },
];

// 当前节点脉动
function PulsingDot({ color }: { color: string }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.3, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.dot, { backgroundColor: color }, pulseStyle]} />
  );
}

export default function OrderTrackScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [refreshing, setRefreshing] = useState(false);

  // I10修复：从 OrderRepo 获取真实物流数据
  const { data: shipmentData, isLoading: shipmentLoading, refetch } = useQuery({
    queryKey: ['shipment', orderId],
    queryFn: () => OrderRepo.getShipment(orderId!),
    enabled: isLoggedIn && Boolean(orderId),
  });

  const shipment = shipmentData?.ok ? shipmentData.data : null;
  const packages = shipment?.shipments || [];

  // 将真实物流事件转为 timeline 格式，无数据时 fallback 到 mock
  const timeline = useMemo(() => {
    if (shipment?.events && shipment.events.length > 0) {
      return shipment.events.map((evt) => ({
        id: evt.id,
        time: evt.occurredAt,
        status: evt.message,
        location: evt.location ?? '',
      }));
    }
    return fallbackTimeline;
  }, [shipment]);

  // 订单显示标题和状态
  const orderTitle = orderId ? `订单#${orderId.slice(-8)}` : '订单#20250112';
  const statusLabel = shipment
    ? (shipment.status === 'DELIVERED' ? '已送达' : shipment.status === 'IN_TRANSIT' ? '运输中' : shipment.status)
    : '运输中（占位）';
  const carrierInfo = shipment
    ? [shipment.carrierName, shipment.trackingNo].filter(Boolean).join(' ')
    : '';

  const handleRefresh = async () => {
    setRefreshing(true);
    if (orderId) await refetch();
    else await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="物流追踪" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* 头部卡片 — 装饰条 + 动画入场 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[{ borderRadius: radius.lg, overflow: 'hidden' }, shadow.md]}>
            <LinearGradient
              colors={[colors.brand.primary, colors.ai.start]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ height: 3 }}
            />
            <View style={[styles.heroCard, { backgroundColor: colors.surface }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{orderTitle}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                当前状态：{statusLabel}
              </Text>
              {carrierInfo ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  {carrierInfo}
                </Text>
              ) : null}
              {packages.length > 1 ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  本订单已拆分为 {packages.length} 个包裹分别发货
                </Text>
              ) : null}
              {/* 地图占位区 — ai.soft 背景 */}
              <View style={[styles.mapPlaceholder, { backgroundColor: colors.ai.soft, borderRadius: radius.md }]}>
                <MaterialCommunityIcons name="map-outline" size={22} color={colors.ai.start} />
                <Text style={[typography.caption, { color: colors.ai.start, marginLeft: 6 }]}>物流轨迹地图占位</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* 物流节点 — 脉动当前节点 + 渐变连接线 + 交错入场 */}
        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>物流节点</Text>
          {shipmentLoading ? (
            <View style={{ marginTop: spacing.md }}>
              <Skeleton height={60} radius={radius.lg} />
              <Skeleton height={60} radius={radius.lg} style={{ marginTop: spacing.sm }} />
            </View>
          ) : timeline.map((item, index) => (
            <Animated.View key={item.id} entering={FadeInDown.duration(300).delay(100 + index * 50)}>
              <View
                style={[
                  styles.timelineRow,
                  index === 0 ? shadow.md : shadow.sm,
                  { backgroundColor: colors.surface, borderRadius: radius.lg },
                ]}
              >
                <View style={styles.timelineLeft}>
                  {index === 0 ? (
                    <PulsingDot color={colors.brand.primary} />
                  ) : (
                    <View style={[styles.dot, { backgroundColor: colors.border }]} />
                  )}
                  {index !== timeline.length - 1 ? (
                    <LinearGradient
                      colors={[colors.brand.primary, colors.ai.start]}
                      style={styles.gradientLine}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.status}</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{item.location}</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>{item.time}</Text>
                </View>
              </View>
            </Animated.View>
          ))}
        </View>

        {/* 产地联动卡 — AiCardGlow 包裹 */}
        <Animated.View entering={FadeInDown.duration(300).delay(300)}>
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>产地实景联动</Text>
            <AiCardGlow style={[shadow.md, { marginTop: spacing.sm }]}>
              <View style={{ padding: 16 }}>
                <Text style={[typography.body, { color: colors.text.secondary }]}>
                  未来将展示企业展览馆的产地实景与检验报告（占位）。
                </Text>
                <Pressable
                  onPress={() => router.push('/(tabs)/museum')}
                  style={[styles.cta, { borderColor: colors.brand.primary, borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>查看企业展览馆</Text>
                </Pressable>
              </View>
            </AiCardGlow>
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 16,
  },
  mapPlaceholder: {
    marginTop: 12,
    paddingVertical: 18,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  timelineRow: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 12,
    flexDirection: 'row',
  },
  timelineLeft: {
    width: 24,
    alignItems: 'center',
    marginRight: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  gradientLine: {
    width: 2,
    flex: 1,
    marginTop: 4,
    borderRadius: 1,
  },
  cta: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
});
