/**
 * 售后详情页 — 显示单个售后申请的完整信息与状态操作
 *
 * 根据不同状态展示对应操作按钮：
 * - REQUESTED / UNDER_REVIEW → 撤销申请
 * - APPROVED + requiresReturn → 填写退货物流表单
 * - REJECTED / SELLER_REJECTED_RETURN → 升级仲裁 / 接受关闭
 * - REPLACEMENT_SHIPPED → 确认收货
 * 等等，详见 spec 9.3 状态-操作映射表。
 */
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../../src/components/feedback';
import { afterSaleStatusLabels, afterSaleTypeLabels } from '../../../src/constants/statuses';
import { OrderRepo } from '../../../src/repos';
import { AfterSaleRepo } from '../../../src/repos/AfterSaleRepo';
import { useAuthStore } from '../../../src/store';
import { useTheme, useBottomInset } from '../../../src/theme';
import { payWithAlipay } from '../../../src/utils/alipay';
import { payWithWechat } from '../../../src/utils/wechat-pay';
import type {
  AfterSaleDetailStatus,
  AfterSaleRequest,
  AfterSaleType,
  ReturnShippingPayer,
  ReturnShippingPaymentStatus,
} from '../../../src/types/domain/Order';

// ─── 物流轨迹 Timeline（纯 View 实现，避免引第三方库）───────
function TrackingTimeline({
  events,
  accent,
  colors,
  typography,
}: {
  events: Array<{ time: string; message: string; location?: string }>;
  accent: string;
  colors: any;
  typography: any;
}) {
  // 倒序展示：最新事件在顶
  const sorted = [...events].sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return (
    <View>
      {sorted.map((e, idx) => {
        const isLatest = idx === 0;
        return (
          <View key={`${e.time}-${idx}`} style={{ flexDirection: 'row', marginBottom: 12 }}>
            {/* 圆点 + 竖线 */}
            <View style={{ width: 16, alignItems: 'center' }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: isLatest ? accent : colors.border,
                  marginTop: 4,
                }}
              />
              {idx < sorted.length - 1 && (
                <View style={{ width: 2, flex: 1, backgroundColor: colors.border, marginTop: 2 }} />
              )}
            </View>
            {/* 文案 */}
            <View style={{ flex: 1, marginLeft: 8, paddingBottom: 4 }}>
              <Text style={[typography.bodySm, { color: isLatest ? colors.text.primary : colors.text.secondary }]}>
                {e.message}
              </Text>
              <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 2 }]}>
                {e.time}
                {e.location ? ` · ${e.location}` : ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── 照片瓦片：处理 loading / error 兜底 ───────────────────
function PhotoTile({
  uri,
  size,
  radius,
}: {
  uri: string;
  size: number;
  radius: number;
}) {
  const [hasError, setHasError] = useState(false);
  if (hasError) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: '#F3F4F6',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name="image-off-outline" size={20} color="#9CA3AF" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#F3F4F6' }}
      contentFit="cover"
      transition={150}
      onError={() => setHasError(true)}
    />
  );
}

// ─── 质量问题原因标签 ───────────────────────────────────
const reasonTypeLabels: Record<string, string> = {
  QUALITY_ISSUE: '质量问题',
  WRONG_ITEM: '发错商品',
  DAMAGED: '运输损坏',
  NOT_AS_DESCRIBED: '与描述不符',
  SIZE_ISSUE: '规格不符',
  EXPIRED: '临期/过期',
  OTHER: '其他',
};

// ─── 状态颜色映射 ────────────────────────────────────────
const getStatusColor = (status: AfterSaleDetailStatus, colors: any): string => {
  switch (status) {
    case 'REQUESTED':
    case 'UNDER_REVIEW':
      return colors.warning;
    case 'APPROVED':
    case 'RETURN_SHIPPING':
    case 'RECEIVED_BY_SELLER':
    case 'REFUNDING':
    case 'REPLACEMENT_SHIPPED':
      return colors.info;
    case 'REFUNDED':
    case 'COMPLETED':
      return colors.success;
    case 'REJECTED':
    case 'SELLER_REJECTED_RETURN':
    case 'PENDING_ARBITRATION':
      return colors.danger;
    case 'CLOSED':
    case 'CANCELED':
      return colors.muted;
    default:
      return colors.text.secondary;
  }
};

// ─── 售后类型标签颜色 ───────────────────────────────────
const getTypeColor = (type: AfterSaleType, colors: any): { bg: string; text: string } => {
  switch (type) {
    case 'NO_REASON_RETURN':
      return { bg: colors.accent.blueSoft, text: colors.accent.blue };
    case 'NO_REASON_EXCHANGE':
      return { bg: colors.brand.primarySoft, text: colors.brand.primary };
    case 'QUALITY_RETURN':
      return { bg: 'rgba(211, 47, 47, 0.08)', text: colors.danger };
    case 'QUALITY_EXCHANGE':
      return { bg: colors.ai.soft, text: colors.ai.start };
    default:
      return { bg: colors.bgSecondary, text: colors.text.secondary };
  }
};

const BLOCKING_BUYER_SHIPPING_PAYMENT_STATUSES: ReturnShippingPaymentStatus[] = ['UNPAID', 'PENDING', 'FAILED'];
const WAYBILL_READY_SHIPPING_PAYMENT_STATUSES: ReturnShippingPaymentStatus[] = ['NOT_REQUIRED', 'PAID'];

export default function AfterSaleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const asId = String(id ?? '');
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const scrollBottomPad = useBottomInset(spacing['3xl']);
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  // 操作中状态
  const [actionLoading, setActionLoading] = useState(false);
  const actionInFlightRef = useRef(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['after-sale', asId],
    queryFn: () => AfterSaleRepo.getById(asId),
    enabled: isLoggedIn && Boolean(asId),
  });

  // 刷新关联缓存
  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['after-sale', asId] }),
      queryClient.invalidateQueries({ queryKey: ['after-sales'] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['me-order-counts'] }),
      // 售后状态变化可能触发退款/积分返还，需同步刷新钱包
      queryClient.invalidateQueries({ queryKey: ['bonus-wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['bonus-ledger'] }),
    ]);
  };

  // ─── 通用操作 handler ────────────────────────────────────
  const executeAction = async (
    action: () => Promise<any>,
    successMsg: string,
  ) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setActionLoading(true);
    try {
      const result = await action();
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '操作失败', type: 'error' });
        return;
      }
      await invalidateAll();
      show({ message: successMsg, type: 'success' });
      refetch();
    } finally {
      actionInFlightRef.current = false;
      setActionLoading(false);
    }
  };

  const handleCancel = () => {
    Alert.alert('确认撤销', '确定要撤销这个售后申请吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认撤销',
        style: 'destructive',
        onPress: () => executeAction(() => AfterSaleRepo.cancel(asId), '售后申请已撤销'),
      },
    ]);
  };

  const handleConfirmReceive = () => {
    Alert.alert('确认收货', '确认您已收到换货商品？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认收货',
        onPress: () => executeAction(() => AfterSaleRepo.confirmReceive(asId), '已确认收货'),
      },
    ]);
  };

  const handleEscalate = () => {
    Alert.alert('升级仲裁', '确定要将此售后申请升级到平台仲裁吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认升级',
        onPress: () => executeAction(() => AfterSaleRepo.escalate(asId), '已提交平台仲裁'),
      },
    ]);
  };

  const handleAcceptClose = () => {
    Alert.alert('接受关闭', '确定接受关闭此售后申请吗？关闭后不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '接受关闭',
        style: 'destructive',
        onPress: () => executeAction(() => AfterSaleRepo.acceptClose(asId), '售后申请已关闭'),
      },
    ]);
  };

  const handlePayReturnShipping = async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setActionLoading(true);
    try {
      const result = await AfterSaleRepo.createReturnShippingPayment(asId);
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '退货运费支付失败', type: 'error' });
        return;
      }

      const params = result.data.paymentParams;
      let shouldActiveQuery = true;
      if (params?.channel === 'alipay' && params.orderStr) {
        const payResult = await payWithAlipay(params.orderStr);
        if (payResult.resultStatus === '6001') {
          shouldActiveQuery = false;
          show({ message: '已取消支付', type: 'warning' });
        } else if (!payResult.success) {
          const message =
            payResult.memo === 'NATIVE_UNAVAILABLE'
              ? '支付单已创建，请在真机环境完成支付宝支付'
              : payResult.memo === 'TIMEOUT'
                ? '支付宝暂未返回结果，正在查询支付状态'
                : '支付未完成，正在查询支付状态';
          show({ message, type: 'warning' });
        }
      } else if (params?.channel === 'wechat') {
        if (
          !params.appId ||
          !params.partnerId ||
          !params.timestamp ||
          !params.nonceStr ||
          !params.prepayId ||
          !params.packageVal ||
          !params.signType ||
          !params.paySign
        ) {
          show({ message: '支付参数获取失败，请稍后重试', type: 'error' });
          return;
        }
        const payResult = await payWithWechat({
          appId: params.appId,
          partnerId: params.partnerId,
          timestamp: params.timestamp,
          nonceStr: params.nonceStr,
          prepayId: params.prepayId,
          packageVal: params.packageVal,
          signType: params.signType,
          paySign: params.paySign,
        });
        if (payResult.resultStatus === '6001') {
          shouldActiveQuery = false;
          show({ message: '已取消支付', type: 'warning' });
        } else if (payResult.errStr === 'NATIVE_UNAVAILABLE') {
          shouldActiveQuery = false;
          show({ message: '支付组件不可用，请更新到最新版 App 后重试', type: 'error' });
        } else if (payResult.errStr === 'WECHAT_NOT_INSTALLED') {
          shouldActiveQuery = false;
          show({ message: '请先安装微信 App 后再使用微信支付', type: 'error' });
        } else if (!payResult.success) {
          show({ message: '支付未完成，正在查询支付状态', type: 'warning' });
        }
      } else {
        show({ message: '支付参数获取失败，请稍后重试', type: 'error' });
        return;
      }

      if (shouldActiveQuery) {
        const activeQueryResult = await OrderRepo.activeQueryPayment(result.data.merchantPaymentNo);
        if (!activeQueryResult.ok) {
          show({ message: activeQueryResult.error.displayMessage ?? '支付状态查询失败，请稍后刷新', type: 'warning' });
        } else if (activeQueryResult.data.status === 'PAID') {
          show({ message: '退货运费支付完成，可生成顺丰退货面单', type: 'success' });
        }
      }

      await invalidateAll();
      refetch();
    } finally {
      actionInFlightRef.current = false;
      setActionLoading(false);
    }
  };

  const handleCreateReturnWaybill = () => {
    executeAction(() => AfterSaleRepo.createReturnWaybill(asId), '顺丰退货面单已生成');
  };

  // ─── 加载态 ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="售后详情" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={80} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={100} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={160} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  // ─── 错误态 ─────────────────────────────────────────────
  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="售后详情" />
        <ErrorState
          title="售后详情加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const as = data.data;
  const statusColor = getStatusColor(as.status, colors);
  const typeColor = getTypeColor(as.afterSaleType, colors);
  const snapshot = as.orderItem?.productSnapshot;
  const productImage = snapshot?.image ?? snapshot?.images?.[0];
  const productTitle = snapshot?.title ?? '商品';
  const unitPrice = as.orderItem?.unitPrice ?? 0;
  const quantity = as.orderItem?.quantity ?? 1;
  const companyName = as.orderItem?.company?.name ?? snapshot?.companyName ?? null;
  const returnShippingPayer = resolveReturnShippingPayer(as);
  const isLegacyManualReturnShipping =
    as.isLegacyManualReturnShipping ?? Boolean(as.returnWaybillNo && !as.returnSfOrderId);
  const returnShippingPaymentStatus = resolveReturnShippingPaymentStatus(as, returnShippingPayer, isLegacyManualReturnShipping);
  const requiresBuyerShippingPayment =
    as.status === 'APPROVED' &&
    as.requiresReturn &&
    returnShippingPayer === 'BUYER' &&
    !isLegacyManualReturnShipping &&
    !as.returnShippingFeeDeducted &&
    !as.returnShippingPaidAt &&
    (
      as.requiresBuyerShippingPayment === true ||
      BLOCKING_BUYER_SHIPPING_PAYMENT_STATUSES.includes(returnShippingPaymentStatus)
    ) &&
    !WAYBILL_READY_SHIPPING_PAYMENT_STATUSES.includes(returnShippingPaymentStatus);
  const canCreateReturnWaybill =
    as.status === 'APPROVED' &&
    as.requiresReturn &&
    WAYBILL_READY_SHIPPING_PAYMENT_STATUSES.includes(returnShippingPaymentStatus);
  const sellerPayerCostNote =
    as.requiresReturn && returnShippingPayer === 'SELLER'
      ? (
          as.returnShippingCostNote ??
          '质量售后退货运费由商家承担，平台顺丰面单寄回，不会作为单独退款打给你'
        )
      : null;
  const refundProgressText = getRefundProgressText(as);

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title="售后详情" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: scrollBottomPad }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ═══════ A. 状态横幅 ═══════ */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View
            style={[
              styles.statusBanner,
              shadow.md,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderLeftWidth: 4,
                borderLeftColor: statusColor,
              },
            ]}
          >
            <View style={styles.statusRow}>
              <Text style={[typography.headingSm, { color: statusColor }]}>
                {afterSaleStatusLabels[as.status]}
              </Text>
              <View style={[styles.typeTag, { backgroundColor: typeColor.bg, borderRadius: radius.sm }]}>
                <Text style={[typography.captionSm, { color: typeColor.text }]}>
                  {afterSaleTypeLabels[as.afterSaleType]}
                </Text>
              </View>
            </View>
            <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 4 }]}>
              售后编号: {as.id}
            </Text>
          </View>
        </Animated.View>

        {/* ═══════ B. 商品信息 ═══════ */}
        <Animated.View entering={FadeInDown.duration(300).delay(60)}>
          <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
              售后商品
            </Text>
            <View style={styles.productRow}>
              {productImage ? (
                <Image
                  source={{ uri: productImage }}
                  style={[styles.productImage, { borderRadius: radius.md }]}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[styles.productImage, { borderRadius: radius.md, backgroundColor: colors.skeleton }]}
                />
              )}
              <View style={styles.productInfo}>
                <Text style={[typography.bodySm, { color: colors.text.primary }]} numberOfLines={2}>
                  {productTitle}
                </Text>
                {companyName && (
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]} numberOfLines={1}>
                    商家：{companyName}
                  </Text>
                )}
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                  ¥{unitPrice.toFixed(2)} x{quantity}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ═══════ C. 凭证照片 ═══════ */}
        {as.photos && as.photos.length > 0 && (
          <Animated.View entering={FadeInDown.duration(300).delay(120)}>
            <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
                凭证照片
              </Text>
              <View style={styles.photoGrid}>
                {as.photos.map((url, index) => (
                  <PhotoTile key={index} uri={url} size={80} radius={radius.md} />
                ))}
              </View>
            </View>
          </Animated.View>
        )}

        {/* ═══════ D. 原因说明 ═══════ */}
        <Animated.View entering={FadeInDown.duration(300).delay(180)}>
          <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
              售后原因
            </Text>
            <View style={[styles.infoBlock, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
              <InfoRow label="售后类型" value={afterSaleTypeLabels[as.afterSaleType]} />
              {as.reasonType && (
                <InfoRow label="问题分类" value={reasonTypeLabels[as.reasonType] ?? as.reasonType} />
              )}
              {as.reason && <InfoRow label="补充说明" value={as.reason} />}
              <InfoRow label="申请时间" value={as.createdAt} noBorder />
            </View>
          </View>
        </Animated.View>

        {/* ═══════ E. 退货物流信息 ═══════ */}
        {as.requiresReturn && (
          <Animated.View entering={FadeInDown.duration(300).delay(240)}>
            <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
                退货物流
              </Text>
              {as.returnCarrierName ? (
                <View style={[styles.infoBlock, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
                  <InfoRow label="快递公司" value={as.returnCarrierName} />
                  <InfoRow label="快递单号" value={as.returnWaybillNo ?? '-'} />
                  {as.returnWaybillUrl || as.returnLabelUrl ? (
                    <InfoRow label="电子面单" value="已生成" />
                  ) : null}
                  <InfoRow label="寄出时间" value={as.returnShippedAt ?? '-'} noBorder />
                </View>
              ) : (
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {as.status === 'APPROVED'
                    ? requiresBuyerShippingPayment
                      ? '请先支付退货运费，支付后可生成平台顺丰退货面单'
                      : '售后已通过，可生成平台顺丰退货面单'
                    : '暂无物流信息'}
                </Text>
              )}
              {sellerPayerCostNote ? (
                <View style={[styles.noteBlock, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md, marginTop: spacing.sm }]}>
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>
                    {sellerPayerCostNote}
                  </Text>
                </View>
              ) : null}

              {/* 顺丰物流轨迹（买家寄回 / 卖家拒收回寄） */}
              {as.returnTracking?.events?.length ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
                    物流节点（实时）
                  </Text>
                  <TrackingTimeline events={as.returnTracking.events} accent={colors.brand.primary} colors={colors} typography={typography} />
                </View>
              ) : as.returnWaybillNo ? (
                <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: spacing.sm }]}>
                  暂无物流节点（顺丰可能尚未揽收或推送延迟）
                </Text>
              ) : null}
              {as.sellerReturnTracking?.events?.length ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
                    卖家拒收回寄物流
                  </Text>
                  <TrackingTimeline events={as.sellerReturnTracking.events} accent={colors.warning ?? '#fa8c16'} colors={colors} typography={typography} />
                </View>
              ) : null}
            </View>
          </Animated.View>
        )}

        {/* ═══════ E2. 换货物流（卖家寄出的换货包裹） ═══════ */}
        {as.replacementWaybillNo && (
          <Animated.View entering={FadeInDown.duration(300).delay(280)}>
            <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
                换货物流（卖家寄出）
              </Text>
              <View style={[styles.infoBlock, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
                {as.replacementCarrierName ? (
                  <InfoRow label="快递公司" value={as.replacementCarrierName} />
                ) : null}
                <InfoRow label="快递单号" value={as.replacementWaybillNo} noBorder={!as.replacementTracking?.events?.length} />
              </View>
              {as.replacementTracking?.events?.length ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
                    物流节点（实时）
                  </Text>
                  <TrackingTimeline events={as.replacementTracking.events} accent={colors.success ?? '#52c41a'} colors={colors} typography={typography} />
                </View>
              ) : (
                <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: spacing.sm }]}>
                  暂无物流节点（顺丰可能尚未揽收或推送延迟）
                </Text>
              )}
            </View>
          </Animated.View>
        )}

        {/* ═══════ F. 卖家/管理员备注 ═══════ */}
        {(as.reviewNote || as.sellerRejectReason) && (
          <Animated.View entering={FadeInDown.duration(300).delay(300)}>
            <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
                审核备注
              </Text>
              {as.reviewNote && (
                <View style={[styles.noteBlock, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>审核备注</Text>
                  <Text style={[typography.bodySm, { color: colors.text.primary, marginTop: 4 }]}>
                    {as.reviewNote}
                  </Text>
                </View>
              )}
              {as.sellerRejectReason && (
                <View style={[styles.noteBlock, { backgroundColor: 'rgba(211, 47, 47, 0.05)', borderRadius: radius.md, marginTop: as.reviewNote ? spacing.sm : 0 }]}>
                  <Text style={[typography.caption, { color: colors.danger }]}>卖家驳回原因</Text>
                  <Text style={[typography.bodySm, { color: colors.text.primary, marginTop: 4 }]}>
                    {as.sellerRejectReason}
                  </Text>
                </View>
              )}
              {/* 卖家驳回照片 */}
              {as.sellerRejectPhotos && as.sellerRejectPhotos.length > 0 && (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: 6 }]}>
                    卖家举证照片
                  </Text>
                  <View style={styles.photoGrid}>
                    {as.sellerRejectPhotos.map((url, index) => (
                      <PhotoTile key={index} uri={url} size={80} radius={radius.md} />
                    ))}
                  </View>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* ═══════ G. 退款信息 ═══════ */}
        {as.refundAmount != null && as.afterSaleType !== 'QUALITY_EXCHANGE' && (
          <Animated.View entering={FadeInDown.duration(300).delay(360)}>
            <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
                退款信息
              </Text>
              <View style={[styles.infoBlock, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
                <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={[typography.bodySm, { color: colors.text.secondary }]}>退款金额</Text>
                  <Text style={[typography.headingSm, { color: as.status === 'REFUNDED' ? colors.success : colors.danger }]}>
                    ¥{as.refundAmount.toFixed(2)}
                  </Text>
                </View>
                {refundProgressText ? (
                  <InfoRow label="退款状态" value={refundProgressText} noBorder />
                ) : null}
              </View>
            </View>
          </Animated.View>
        )}

        {/* ═══════ H. 操作区域 ═══════ */}
        <Animated.View entering={FadeInDown.duration(300).delay(420)}>
          <View style={[styles.section, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.sm }]}>
              操作
            </Text>
            {renderActions(as.status, as.requiresReturn)}
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );

  // ─── 根据状态渲染操作区域 ──────────────────────────────────
  function renderActions(status: AfterSaleDetailStatus, requiresReturn: boolean) {
    if (actionLoading) {
      return (
        <View style={styles.actionCenter}>
          <ActivityIndicator size="small" color={colors.brand.primary} />
          <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
            处理中...
          </Text>
        </View>
      );
    }

    switch (status) {
      case 'REQUESTED':
      case 'UNDER_REVIEW':
        return (
          <View>
            <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
              {status === 'REQUESTED' ? '等待卖家审核您的售后申请' : '卖家正在审核您的申请'}
            </Text>
            <Pressable onPress={handleCancel} style={[styles.outlineBtn, { borderColor: colors.danger, borderRadius: radius.pill }]}>
              <Text style={[typography.bodySm, { color: colors.danger }]}>撤销申请</Text>
            </Pressable>
          </View>
        );

      case 'APPROVED':
        if (requiresReturn) {
          if (requiresBuyerShippingPayment) {
            const paymentActionText =
              returnShippingPaymentStatus === 'PENDING'
                ? '刷新支付状态'
                : returnShippingPaymentStatus === 'FAILED'
                  ? '重新支付退货运费'
                  : '支付退货运费';
            return (
              <View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: spacing.md }]}>
                  该售后需要先支付退货运费，支付完成后平台将生成顺丰退货面单
                </Text>
                <Pressable onPress={handlePayReturnShipping} disabled={actionLoading}>
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primaryBtn, { borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>{paymentActionText}</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            );
          }
          if (!canCreateReturnWaybill) {
            return (
              <View style={styles.actionCenter}>
                <MaterialCommunityIcons name="clock-outline" size={20} color={colors.info} />
                <Text style={[typography.bodySm, { color: colors.info, marginLeft: spacing.sm }]}>
                  退货运费状态确认中，请稍后刷新
                </Text>
              </View>
            );
          }
          return (
            <View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: spacing.md }]}>
                售后申请已通过，平台将为您生成顺丰退货面单
              </Text>
              <Pressable onPress={handleCreateReturnWaybill} disabled={actionLoading}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[
                    styles.primaryBtn,
                    {
                      borderRadius: radius.pill,
                      marginTop: spacing.md,
                    },
                  ]}
                >
                  <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>生成顺丰退货面单</Text>
                </LinearGradient>
              </Pressable>
            </View>
          );
        }
        return (
          <View style={styles.actionCenter}>
            <MaterialCommunityIcons name="clock-outline" size={20} color={colors.info} />
            <Text style={[typography.bodySm, { color: colors.info, marginLeft: spacing.sm }]}>
              处理中，请等待
            </Text>
          </View>
        );

      case 'RETURN_SHIPPING':
        return (
          <View style={styles.actionCenter}>
            <MaterialCommunityIcons name="truck-delivery-outline" size={20} color={colors.info} />
            <Text style={[typography.bodySm, { color: colors.info, marginLeft: spacing.sm }]}>
              退货已寄出，等待卖家验收
            </Text>
          </View>
        );

      case 'RECEIVED_BY_SELLER':
        return (
          <View style={styles.actionCenter}>
            <MaterialCommunityIcons name="package-variant" size={20} color={colors.info} />
            <Text style={[typography.bodySm, { color: colors.info, marginLeft: spacing.sm }]}>
              卖家验收中，请耐心等待
            </Text>
          </View>
        );

      case 'SELLER_REJECTED_RETURN':
        return (
          <View>
            <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.md }]}>
              卖家验收不通过，您可以选择升级仲裁或接受关闭
            </Text>
            <View style={styles.actionRow}>
              <Pressable onPress={handleEscalate} style={{ flex: 1, marginRight: spacing.sm }}>
                <LinearGradient
                  colors={[colors.danger, '#E57373']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.primaryBtn, { borderRadius: radius.pill }]}
                >
                  <Text style={[typography.bodySm, { color: colors.text.inverse }]}>升级仲裁</Text>
                </LinearGradient>
              </Pressable>
              <Pressable
                onPress={handleAcceptClose}
                style={[styles.outlineBtn, { flex: 1, borderColor: colors.border, borderRadius: radius.pill }]}
              >
                <Text style={[typography.bodySm, { color: colors.text.secondary }]}>接受关闭</Text>
              </Pressable>
            </View>
          </View>
        );

      case 'PENDING_ARBITRATION':
        return (
          <View style={styles.actionCenter}>
            <MaterialCommunityIcons name="gavel" size={20} color={colors.warning} />
            <Text style={[typography.bodySm, { color: colors.warning, marginLeft: spacing.sm }]}>
              平台仲裁中，请等待
            </Text>
          </View>
        );

      case 'REFUNDING':
        return (
          <View style={styles.actionCenter}>
            <MaterialCommunityIcons name="cash-refund" size={20} color={colors.info} />
            <Text style={[typography.bodySm, { color: colors.info, marginLeft: spacing.sm }]}>
              退款处理中
            </Text>
          </View>
        );

      case 'REFUNDED':
        return (
          <View style={[styles.successBlock, { backgroundColor: 'rgba(46, 125, 50, 0.06)', borderRadius: radius.md }]}>
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.success} />
            <Text style={[typography.bodyStrong, { color: colors.success, marginLeft: spacing.sm }]}>
              退款已完成 ¥{as.refundAmount?.toFixed(2) ?? '0.00'}
            </Text>
          </View>
        );

      case 'REPLACEMENT_SHIPPED':
        const replacementTrackingNo = as.replacementWaybillNo || as.replacementShipmentId;
        return (
          <View>
            <View style={[styles.actionCenter, { marginBottom: spacing.md }]}>
              <MaterialCommunityIcons name="truck-check" size={20} color={colors.info} />
              <Text style={[typography.bodySm, { color: colors.info, marginLeft: spacing.sm }]}>
                换货已发出
              </Text>
            </View>
            {replacementTrackingNo && (
              <Text style={[typography.caption, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
                换货单号: {replacementTrackingNo}
              </Text>
            )}
            <Pressable onPress={handleConfirmReceive}>
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.primaryBtn, { borderRadius: radius.pill }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>确认收货</Text>
              </LinearGradient>
            </Pressable>
          </View>
        );

      case 'COMPLETED':
        return (
          <View style={[styles.successBlock, { backgroundColor: 'rgba(46, 125, 50, 0.06)', borderRadius: radius.md }]}>
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.success} />
            <Text style={[typography.bodyStrong, { color: colors.success, marginLeft: spacing.sm }]}>
              售后已完成
            </Text>
          </View>
        );

      case 'REJECTED':
        return (
          <View>
            <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.md }]}>
              售后申请被驳回，您可以选择升级仲裁或接受关闭
            </Text>
            <View style={styles.actionRow}>
              <Pressable onPress={handleEscalate} style={{ flex: 1, marginRight: spacing.sm }}>
                <LinearGradient
                  colors={[colors.danger, '#E57373']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.primaryBtn, { borderRadius: radius.pill }]}
                >
                  <Text style={[typography.bodySm, { color: colors.text.inverse }]}>升级仲裁</Text>
                </LinearGradient>
              </Pressable>
              <Pressable
                onPress={handleAcceptClose}
                style={[styles.outlineBtn, { flex: 1, borderColor: colors.border, borderRadius: radius.pill }]}
              >
                <Text style={[typography.bodySm, { color: colors.text.secondary }]}>接受关闭</Text>
              </Pressable>
            </View>
          </View>
        );

      case 'CLOSED':
        return (
          <View style={styles.actionCenter}>
            <MaterialCommunityIcons name="close-circle-outline" size={20} color={colors.muted} />
            <Text style={[typography.bodySm, { color: colors.muted, marginLeft: spacing.sm }]}>
              售后已关闭
            </Text>
          </View>
        );

      case 'CANCELED':
        return (
          <View style={styles.actionCenter}>
            <MaterialCommunityIcons name="cancel" size={20} color={colors.muted} />
            <Text style={[typography.bodySm, { color: colors.muted, marginLeft: spacing.sm }]}>
              售后已撤销
            </Text>
          </View>
        );

      default:
        return null;
    }
  }
}

function resolveReturnShippingPayer(as: AfterSaleRequest): ReturnShippingPayer | undefined {
  if (as.returnShippingPayer) return as.returnShippingPayer;
  if (as.afterSaleType === 'NO_REASON_RETURN' || as.afterSaleType === 'NO_REASON_EXCHANGE') {
    return 'BUYER';
  }
  if (as.afterSaleType === 'QUALITY_RETURN' || as.afterSaleType === 'QUALITY_EXCHANGE') {
    return 'SELLER';
  }
  return undefined;
}

function resolveReturnShippingPaymentStatus(
  as: AfterSaleRequest,
  returnShippingPayer: ReturnShippingPayer | undefined,
  isLegacyManualReturnShipping: boolean,
): ReturnShippingPaymentStatus {
  if (as.returnShippingPaymentStatus) return as.returnShippingPaymentStatus;
  if (!as.requiresReturn || returnShippingPayer !== 'BUYER') return 'NOT_REQUIRED';
  if (as.returnShippingPaidAt) return 'PAID';
  if (isLegacyManualReturnShipping || as.returnShippingFeeDeducted) return 'NOT_REQUIRED';
  if (as.status === 'APPROVED') return 'UNPAID';
  return 'NOT_REQUIRED';
}

function getRefundProgressText(as: AfterSaleRequest): string | null {
  if (as.refundStatus === 'FAILED' && as.refundEscalatedToManual) {
    return '退款已转人工处理';
  }
  if (as.refundStatus === 'REFUNDING' || as.status === 'REFUNDING') {
    return '退款处理中';
  }
  if (
    as.refundStatus === 'REFUNDED' ||
    as.status === 'REFUNDED' ||
    (as.status === 'COMPLETED' && as.refundAmount != null && as.afterSaleType !== 'QUALITY_EXCHANGE')
  ) {
    return '退款完成';
  }
  if (as.refundStatus === 'FAILED') {
    return '退款失败';
  }
  return null;
}

// ─── 信息行子组件 ──────────────────────────────────────────
function InfoRow({ label, value, noBorder }: { label: string; value: string; noBorder?: boolean }) {
  return (
    <View style={[styles.infoRow, noBorder && { borderBottomWidth: 0 }]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statusBanner: {
    padding: 16,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  section: {
    padding: 16,
    marginBottom: 12,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  productImage: {
    width: 64,
    height: 64,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photo: {
    width: 80,
    height: 80,
  },
  infoBlock: {
    padding: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2EAE2',
  },
  infoLabel: {
    fontSize: 13,
    color: '#5A6B5A',
  },
  infoValue: {
    fontSize: 14,
    color: '#1A2E1A',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  noteBlock: {
    padding: 12,
  },
  actionCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  outlineBtn: {
    paddingVertical: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  successBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
});
