import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { Skeleton, useToast } from '../../src/components/feedback';
import { OrderNoReveal } from '../../src/components/orders/OrderNoReveal';
import { OrderRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useBottomInset, useTheme } from '../../src/theme';
import { shipmentStatusLabels } from '../../src/constants/statuses';

/** 遮蔽运单号：保留前4后4，中间用星号 */
function maskTrackingNo(no: string | null | undefined): string {
  if (!no) return '';
  if (no.length <= 8) return no;
  return `${no.slice(0, 4)}****${no.slice(-4)}`;
}

/**
 * 顺丰 OrderState 会把同一状态带不同时间戳重复推送 → 按「文案+地点」折叠为最新一条，
 * 再按时间倒序；message 为空兜底「物流更新」。同时清掉已堆积的历史重复节点。
 */
function dedupTimelineEvents(
  evts: { id: string; occurredAt: string; message: string; location?: string }[],
) {
  const byKey = new Map<string, (typeof evts)[number]>();
  for (const evt of evts) {
    const key = `${evt.message ?? ''}|${evt.location ?? ''}`;
    const prev = byKey.get(key);
    if (!prev || new Date(evt.occurredAt).getTime() > new Date(prev.occurredAt).getTime()) {
      byKey.set(key, evt);
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .map((evt) => ({
      id: evt.id,
      time: evt.occurredAt,
      status: evt.message || '物流更新',
      location: evt.location ?? '',
    }));
}

const CARRIER_PHONES: Record<string, string> = {
  SF: '95338', YTO: '95554', ZTO: '95311', STO: '95543', YD: '95546', JD: '95311', EMS: '11183',
};

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

/** 单个包裹的物流时间线 */
type TimelineItem = { id: string; time: string; status: string; location: string };

function TimelineSection({
  items,
  isFirst,
  colors,
  typography,
  radius,
  shadow,
}: {
  items: TimelineItem[];
  isFirst: boolean;
  colors: any;
  typography: any;
  radius: any;
  shadow: any;
}) {
  return (
    <>
      {items.map((item, index) => (
        <Animated.View key={item.id} entering={FadeInDown.duration(300).delay(100 + index * 50)}>
          <View
            style={[
              styles.timelineRow,
              (isFirst && index === 0) ? shadow.md : shadow.sm,
              { backgroundColor: colors.surface, borderRadius: radius.lg },
            ]}
          >
            <View style={styles.timelineLeft}>
              {isFirst && index === 0 ? (
                <PulsingDot color={colors.brand.primary} />
              ) : (
                <View style={[styles.dot, { backgroundColor: colors.border }]} />
              )}
              {index !== items.length - 1 ? (
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
    </>
  );
}

export default function OrderTrackScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  // R-RS07: ScrollView paddingBottom 吃系统 safe-area，避免底部内容贴边。
  const safeBottom = useBottomInset(spacing['3xl']);
  // 多包裹时当前展开的包裹索引集合（默认全部展开）
  const [expandedPkgs, setExpandedPkgs] = useState<Set<number>>(new Set());

  // 从 OrderRepo 获取缓存的物流数据（初始加载）
  // 物流页打开 = 用户主动想看最新进度，30s 轮询不停（除非整单已签收/取消/退款由调用方判断）
  const { data: shipmentData, isLoading: shipmentLoading, refetch: refetchShipment } = useQuery({
    queryKey: ['shipment', orderId],
    queryFn: () => OrderRepo.getShipment(orderId!),
    enabled: isLoggedIn && Boolean(orderId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // 切回前台 / back 回物流页立即刷新
  useFocusEffect(
    React.useCallback(() => {
      refetchShipment();
    }, [refetchShipment]),
  );

  const shipment = shipmentData?.ok ? shipmentData.data : null;
  const packages = shipment?.shipments || [];
  const isMultiPackage = packages.length > 1;

  // 多包裹首次加载时默认展开所有包裹
  useEffect(() => {
    if (isMultiPackage && expandedPkgs.size === 0) {
      setExpandedPkgs(new Set(packages.map((_, i) => i)));
    }
  }, [isMultiPackage, packages.length]);

  // 真实物流事件转 timeline；去重折叠重复推送；无数据返回空数组（UI 自行渲染空态）
  const timeline = useMemo(
    () => dedupTimelineEvents(shipment?.events ?? []),
    [shipment],
  );

  // 各包裹独立的 timeline（同样去重折叠）
  const packageTimelines = useMemo(
    () => packages.map((pkg) => dedupTimelineEvents(pkg.events ?? [])),
    [packages],
  );

  // 订单显示标题和状态
  const orderTitle = orderId ? `订单#${orderId.slice(-6)}` : '订单#20250112';
  const statusLabel = shipment
    ? (shipmentStatusLabels[shipment.status] ?? shipment.status)
    : '暂无物流信息';

  // 下拉刷新：主动查询快递100获取最新物流数据
  const handleRefresh = async () => {
    setRefreshing(true);
    if (orderId) {
      // 主动调用快递100查询最新物流并更新本地数据库
      const result = await OrderRepo.refreshShipmentTracking(orderId);
      if (result.ok) {
        // 用主动查询的新数据更新 react-query 缓存
        queryClient.setQueryData(['shipment', orderId], result);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    setRefreshing(false);
  };

  // 切换包裹展开/收起
  const togglePackage = (index: number) => {
    setExpandedPkgs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="物流追踪" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: safeBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* 头部卡片 */}
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
              {orderId ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginRight: 6 }]}>订单号</Text>
                  <OrderNoReveal
                    orderNo={orderId}
                    textStyle={[typography.caption, { color: colors.text.primary, fontFamily: 'monospace' }]}
                  />
                </View>
              ) : null}
              {/* 单包裹显示承运商信息 + 运单号点击复制 + 快递客服电话 */}
              {!isMultiPackage && shipment ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>{shipment.carrierName}</Text>
                  {shipment.trackingNo ? (
                    <Pressable
                      onPress={async () => {
                        await Clipboard.setStringAsync(shipment.trackingNo!);
                        toast.show({ message: '运单号已复制', type: 'success' });
                      }}
                      style={{ marginLeft: 6 }}
                    >
                      <Text style={[typography.caption, { color: colors.accent.blue }]}>{maskTrackingNo(shipment.trackingNo)} [复制]</Text>
                    </Pressable>
                  ) : null}
                  {CARRIER_PHONES[shipment.carrierCode] ? (
                    <Pressable onPress={() => Linking.openURL(`tel:${CARRIER_PHONES[shipment.carrierCode]}`)} style={{ marginLeft: 6 }}>
                      <Text style={[typography.caption, { color: colors.brand.primary }]}>📞 客服</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {isMultiPackage ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  本订单已拆分为 {packages.length} 个包裹分别发货
                </Text>
              ) : null}
            </View>
          </View>
        </Animated.View>

        {/* 物流节点 */}
        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>物流节点</Text>

          {shipmentLoading ? (
            <View style={{ marginTop: spacing.md }}>
              <Skeleton height={60} radius={radius.lg} />
              <Skeleton height={60} radius={radius.lg} style={{ marginTop: spacing.sm }} />
            </View>
          ) : isMultiPackage ? (
            /* 多包裹：按包裹分组显示，可折叠 */
            packages.map((pkg, pkgIndex) => {
              const isExpanded = expandedPkgs.has(pkgIndex);
              const pkgTimeline = packageTimelines[pkgIndex] || [];
              const statusText = shipmentStatusLabels[pkg.status] ?? pkg.status;

              return (
                <Animated.View
                  key={pkg.id}
                  entering={FadeInDown.duration(300).delay(pkgIndex * 80)}
                >
                  {/* 包裹分组头 */}
                  <Pressable
                    onPress={() => togglePackage(pkgIndex)}
                    style={[
                      styles.packageHeader,
                      {
                        backgroundColor: colors.brand.primarySoft,
                        borderRadius: radius.md,
                        marginTop: spacing.md,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                        包裹{pkgIndex + 1} {pkg.carrierName || ''}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                        {maskTrackingNo(pkg.trackingNoMasked || pkg.trackingNo)} · {statusText}
                      </Text>
                    </View>
                    <MaterialCommunityIcons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={colors.text.secondary}
                    />
                  </Pressable>
                  {/* 包裹物流事件列表 */}
                  {isExpanded ? (
                    pkgTimeline.length > 0 ? (
                      <TimelineSection
                        items={pkgTimeline}
                        isFirst={pkgIndex === 0}
                        colors={colors}
                        typography={typography}
                        radius={radius}
                        shadow={shadow}
                      />
                    ) : (
                      <Text
                        style={[
                          typography.caption,
                          { color: colors.text.tertiary, textAlign: 'center', marginTop: spacing.md },
                        ]}
                      >
                        暂无物流信息
                      </Text>
                    )
                  ) : null}
                </Animated.View>
              );
            })
          ) : timeline.length > 0 ? (
            /* 单包裹：保持原有的混合时间线 */
            <TimelineSection
              items={timeline}
              isFirst={true}
              colors={colors}
              typography={typography}
              radius={radius}
              shadow={shadow}
            />
          ) : (
            <Text
              style={[
                typography.caption,
                { color: colors.text.tertiary, textAlign: 'center', marginTop: spacing.md },
              ]}
            >
              暂无物流信息
            </Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 16,
  },
  packageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
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
});
