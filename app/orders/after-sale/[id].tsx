import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { AppHeader, Screen } from '../../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../../src/components/feedback';
import { OrderRepo } from '../../../src/repos';
import { AfterSaleRepo, ApplyAfterSaleDto } from '../../../src/repos/AfterSaleRepo';
import { useAuthStore } from '../../../src/store';
import { useTheme } from '../../../src/theme';
import { API_BASE_URL } from '../../../src/repos/http/config';
import { afterSaleTypeLabels } from '../../../src/constants/statuses';
import type { AfterSaleType, OrderItem } from '../../../src/types/domain/Order';

// ─── 质量问题原因选项 ───────────────────────────────────
const qualityReasons = [
  { label: '质量问题', value: 'QUALITY_ISSUE' as const },
  { label: '发错商品', value: 'WRONG_ITEM' as const },
  { label: '运输损坏', value: 'DAMAGED' as const },
  { label: '与描述不符', value: 'NOT_AS_DESCRIBED' as const },
  { label: '规格不符', value: 'SIZE_ISSUE' as const },
  { label: '临期/过期', value: 'EXPIRED' as const },
  { label: '其他', value: 'OTHER' as const },
];

// ─── 无需寄回的金额阈值（元） ─────────────────────────────
const NO_RETURN_THRESHOLD = 30;

export default function AfterSaleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const accessToken = useAuthStore((state) => state.accessToken);

  // ─── 表单状态 ─────────────────────────────────────────
  // Step 1: 商品选择（单选）
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // Step 2: 售后类型
  const [afterSaleType, setAfterSaleType] = useState<AfterSaleType | null>(null);
  // Step 3: 照片
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Step 4: 原因（仅质量问题类型需要）
  const [selectedReason, setSelectedReason] = useState<(typeof qualityReasons)[number]>(qualityReasons[0]);
  const [note, setNote] = useState('');
  // 提交状态
  const [submitting, setSubmitting] = useState(false);

  // ─── 订单数据加载 ─────────────────────────────────────
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: isLoggedIn && Boolean(orderId),
  });
  const refreshing = isFetching;
  const order = data?.ok ? data.data : null;

  // ─── 选中的商品 ───────────────────────────────────────
  const selectedItem: OrderItem | null = useMemo(() => {
    if (!order || !selectedItemId) return null;
    return order.items.find((i) => i.id === selectedItemId) ?? null;
  }, [order, selectedItemId]);

  // ─── 可用的售后类型（基于选中商品动态计算） ───────────────
  const availableTypes = useMemo((): AfterSaleType[] => {
    if (!order || !selectedItem) return [];
    const types: AfterSaleType[] = [];
    const now = new Date();

    // 无理由退货：需在退货窗口内且非换货后的商品
    if (order.returnWindowExpiresAt) {
      const expiresAt = new Date(order.returnWindowExpiresAt);
      if (expiresAt > now && !selectedItem.isPostReplacement) {
        types.push('NO_REASON_RETURN');
      }
    }

    // 质量问题退货/换货：在售后时间窗口内都可选择
    // 这里简化逻辑：已签收的订单在售后窗口期内均可申请
    types.push('QUALITY_RETURN');
    types.push('QUALITY_EXCHANGE');

    return types;
  }, [order, selectedItem]);

  // 当选中商品变化时，重置售后类型
  const handleSelectItem = (itemId: string) => {
    if (selectedItemId === itemId) return;
    setSelectedItemId(itemId);
    setAfterSaleType(null);
  };

  // ─── 是否需要填写原因（质量问题类型需要） ─────────────────
  const needsReason = afterSaleType === 'QUALITY_RETURN' || afterSaleType === 'QUALITY_EXCHANGE';

  // ─── 预估退款金额（仅退货类型） ────────────────────────────
  const estimatedRefund = useMemo(() => {
    if (!selectedItem || !afterSaleType) return 0;
    if (afterSaleType === 'QUALITY_EXCHANGE') return 0; // 换货无退款
    const itemTotal = selectedItem.price * selectedItem.quantity;
    // 按比例分摊红包抵扣
    if (order?.discountAmount && order.goodsAmount && order.goodsAmount > 0) {
      const ratio = itemTotal / order.goodsAmount;
      const couponShare = order.discountAmount * ratio;
      return Math.max(0, itemTotal - couponShare);
    }
    return itemTotal;
  }, [selectedItem, afterSaleType, order]);

  // ─── 退货运费说明 ─────────────────────────────────────
  const shippingInfo = useMemo(() => {
    if (!afterSaleType || !selectedItem) return '';
    if (afterSaleType === 'NO_REASON_RETURN') {
      return '需要寄回，运费由您承担';
    }
    // 质量问题退货/换货
    const itemTotal = selectedItem.price * selectedItem.quantity;
    if (itemTotal > NO_RETURN_THRESHOLD) {
      return '需要寄回，运费到付（平台承担）';
    }
    return '无需寄回';
  }, [afterSaleType, selectedItem]);

  // ─── 照片上传（复用原有逻辑） ─────────────────────────────
  const handlePickPhotos = async () => {
    if (photos.length >= 10) {
      show({ message: '最多上传 10 张照片', type: 'warning' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10 - photos.length,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const newUrls: string[] = [];
      for (const asset of result.assets) {
        const formData = new FormData();
        const uri = asset.uri;
        const filename = uri.split('/').pop() || 'photo.jpg';
        // @ts-ignore - React Native FormData accepts this format
        formData.append('file', { uri, name: filename, type: 'image/jpeg' });

        const response = await fetch(`${API_BASE_URL}/upload?folder=after-sale`, {
          method: 'POST',
          body: formData,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        const json = await response.json();
        if (json.ok && json.data?.url) {
          newUrls.push(json.data.url);
        } else {
          show({ message: '部分照片上传失败', type: 'error' });
        }
      }
      setPhotos((prev) => [...prev, ...newUrls].slice(0, 10));
    } catch {
      show({ message: '照片上传失败', type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── 表单校验 ─────────────────────────────────────────
  const canSubmit = Boolean(
    selectedItemId &&
      afterSaleType &&
      photos.length >= 1 &&
      !submitting &&
      !uploading
  );

  // ─── 提交售后申请 ─────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit || !selectedItemId || !afterSaleType) return;

    if (photos.length < 1) {
      show({ message: '请至少上传 1 张照片', type: 'warning' });
      return;
    }

    setSubmitting(true);
    try {
      const dto: ApplyAfterSaleDto = {
        orderItemId: selectedItemId,
        afterSaleType,
        photos,
      };

      // 质量问题类型附加原因
      if (needsReason) {
        dto.reasonType = selectedReason.value;
        dto.reason = note.trim() || undefined;
      }

      const result = await AfterSaleRepo.apply(orderId, dto);

      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '售后申请失败', type: 'error' });
        return;
      }

      // 刷新相关查询缓存
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
      await queryClient.invalidateQueries({ queryKey: ['me-order-issue'] });
      await queryClient.invalidateQueries({ queryKey: ['after-sales'] });

      const typeLabel = afterSaleTypeLabels[afterSaleType];
      show({ message: `${typeLabel}申请已提交`, type: 'success' });

      // 导航到售后详情页（如已创建则跳转，否则回订单详情）
      if (result.data?.id) {
        router.replace({ pathname: '/orders/after-sale-detail/[id]' as any, params: { id: result.data.id } });
      } else {
        router.replace({ pathname: '/orders/[id]', params: { id: orderId } });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ─── 加载态 ───────────────────────────────────────────
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="申请售后" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={120} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={80} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  // ─── 错误态 ───────────────────────────────────────────
  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="申请售后" />
        <ErrorState
          title="订单加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  // ─── VIP 礼包不支持售后 ────────────────────────────────
  if (data.data.bizType === 'VIP_PACKAGE') {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="申请售后" />
        <EmptyState title="VIP 礼包不支持退换" description="VIP 开通礼包订单不支持退款和换货" />
      </Screen>
    );
  }

  // 可选择的商品（过滤掉奖品）
  const selectableItems = order!.items.filter((item) => !item.isPrize);
  const prizeItems = order!.items.filter((item) => item.isPrize);

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title="申请售后" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ═══════ Step 1: 选择商品（单选） ═══════ */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={styles.stepHeader}>
              <View style={[styles.stepBadge, { backgroundColor: colors.brand.primary }]}>
                <Text style={[typography.captionSm, { color: colors.text.inverse }]}>1</Text>
              </View>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                选择售后商品
              </Text>
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4, marginLeft: 30 }]}>
              每次仅可选择一件商品申请售后
            </Text>

            {selectableItems.length === 0 && prizeItems.length === 0 ? (
              <View style={{ marginTop: spacing.sm }}>
                <EmptyState title="暂无商品" description="订单中没有商品记录" />
              </View>
            ) : (
              <>
                {/* 可选择的普通商品 */}
                {selectableItems.map((item) => {
                  const isSelected = selectedItemId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => handleSelectItem(item.id)}
                      style={[
                        styles.itemRow,
                        {
                          marginTop: spacing.md,
                          backgroundColor: isSelected ? colors.brand.primarySoft : 'transparent',
                          borderRadius: radius.md,
                          padding: spacing.sm,
                        },
                      ]}
                    >
                      {/* 单选圆点 */}
                      <View
                        style={[
                          styles.radioBtn,
                          {
                            borderColor: isSelected ? colors.brand.primary : colors.border,
                            backgroundColor: isSelected ? colors.brand.primary : 'transparent',
                            borderRadius: 11,
                          },
                        ]}
                      >
                        {isSelected && (
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text.inverse }} />
                        )}
                      </View>

                      {/* 商品图片 */}
                      <Image source={{ uri: item.image }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />

                      {/* 商品信息 */}
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={[typography.bodySm, { color: colors.text.primary }]} numberOfLines={2}>
                          {item.title}
                        </Text>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                          ¥{item.price.toFixed(2)} x{item.quantity}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}

                {/* 奖品商品（禁用，附提示） */}
                {prizeItems.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.itemRow,
                      {
                        marginTop: spacing.md,
                        opacity: 0.45,
                        borderRadius: radius.md,
                        padding: spacing.sm,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.radioBtn,
                        { borderColor: colors.border, backgroundColor: colors.bgSecondary, borderRadius: 11 },
                      ]}
                    />
                    <Image source={{ uri: item.image }} style={[styles.cover, { borderRadius: radius.md }]} contentFit="cover" />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[typography.bodySm, { color: colors.text.tertiary }]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>
                        奖品不支持退换
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        </Animated.View>

        {/* ═══════ Step 2: 选择售后类型 ═══════ */}
        {selectedItemId && (
          <Animated.View entering={FadeInDown.duration(300).delay(60)}>
            <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepBadge, { backgroundColor: colors.brand.primary }]}>
                  <Text style={[typography.captionSm, { color: colors.text.inverse }]}>2</Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                  选择售后类型
                </Text>
              </View>

              {availableTypes.length === 0 ? (
                <View style={{ marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.bgSecondary, borderRadius: radius.md }}>
                  <Text style={[typography.bodySm, { color: colors.text.secondary, textAlign: 'center' }]}>
                    该商品已超过售后申请期限
                  </Text>
                </View>
              ) : (
                <View style={[styles.typeRow, { marginTop: spacing.md }]}>
                  {availableTypes.map((type) => {
                    const active = afterSaleType === type;
                    const label = afterSaleTypeLabels[type];
                    // 为不同类型显示图标
                    const iconName =
                      type === 'NO_REASON_RETURN'
                        ? 'undo-variant'
                        : type === 'QUALITY_RETURN'
                          ? 'cash-refund'
                          : 'swap-horizontal';
                    return (
                      <Pressable
                        key={type}
                        onPress={() => setAfterSaleType(type)}
                        style={[
                          styles.typeCard,
                          {
                            borderRadius: radius.lg,
                            borderWidth: 1.5,
                            borderColor: active ? colors.brand.primary : colors.border,
                            backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={iconName as any}
                          size={24}
                          color={active ? colors.brand.primary : colors.text.tertiary}
                        />
                        <Text
                          style={[
                            typography.bodySm,
                            {
                              color: active ? colors.brand.primary : colors.text.primary,
                              marginTop: 6,
                              textAlign: 'center',
                            },
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* ═══════ Step 3: 上传照片 ═══════ */}
        {afterSaleType && (
          <Animated.View entering={FadeInDown.duration(300).delay(120)}>
            <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepBadge, { backgroundColor: colors.brand.primary }]}>
                  <Text style={[typography.captionSm, { color: colors.text.inverse }]}>3</Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                  上传照片 <Text style={[typography.caption, { color: colors.danger }]}>*</Text>
                </Text>
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4, marginLeft: 30 }]}>
                请拍摄商品问题照片（至少 1 张，最多 10 张）
              </Text>
              <View style={styles.photoGrid}>
                {photos.map((url, index) => (
                  <View key={index} style={styles.photoWrapper}>
                    <Image source={{ uri: url }} style={[styles.photo, { borderRadius: radius.md }]} contentFit="cover" />
                    <Pressable onPress={() => removePhoto(index)} style={styles.photoRemove}>
                      <MaterialCommunityIcons name="close-circle" size={20} color={colors.danger} />
                    </Pressable>
                  </View>
                ))}
                {photos.length < 10 && (
                  <Pressable
                    onPress={handlePickPhotos}
                    disabled={uploading}
                    style={[
                      styles.photoAdd,
                      { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bgSecondary },
                    ]}
                  >
                    {uploading ? (
                      <ActivityIndicator size="small" color={colors.brand.primary} />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="camera-plus-outline" size={24} color={colors.text.tertiary} />
                        <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 4 }]}>
                          {photos.length}/10
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
              </View>
            </View>
          </Animated.View>
        )}

        {/* ═══════ Step 4: 原因选择（仅质量问题类型） ═══════ */}
        {afterSaleType && needsReason && (
          <Animated.View entering={FadeInDown.duration(300).delay(180)}>
            <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepBadge, { backgroundColor: colors.brand.primary }]}>
                  <Text style={[typography.captionSm, { color: colors.text.inverse }]}>4</Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                  问题原因
                </Text>
              </View>
              <View style={styles.reasonRow}>
                {qualityReasons.map((reason) => {
                  const active = reason.value === selectedReason.value;
                  return (
                    <Pressable
                      key={reason.value}
                      onPress={() => setSelectedReason(reason)}
                      style={[styles.reasonChip, { borderRadius: radius.pill, overflow: 'hidden' }]}
                    >
                      {active ? (
                        <LinearGradient
                          colors={[colors.brand.primarySoft, colors.ai.soft]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[styles.reasonChipInner, { borderRadius: radius.pill }]}
                        >
                          <Text style={[typography.caption, { color: colors.brand.primary }]}>{reason.label}</Text>
                        </LinearGradient>
                      ) : (
                        <View
                          style={[
                            styles.reasonChipInner,
                            { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill },
                          ]}
                        >
                          <Text style={[typography.caption, { color: colors.text.secondary }]}>{reason.label}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm, marginLeft: 30 }]}>
                补充说明（仅"其他"时建议填写）
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="补充说明有助于更快处理"
                placeholderTextColor={colors.muted}
                style={[
                  styles.textarea,
                  { borderColor: colors.border, color: colors.text.primary, borderRadius: radius.md, marginLeft: 0 },
                ]}
                multiline
              />
            </View>
          </Animated.View>
        )}

        {/* ═══════ Step 5: 确认摘要与提交 ═══════ */}
        {afterSaleType && photos.length > 0 && (
          <Animated.View entering={FadeInDown.duration(300).delay(240)}>
            <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepBadge, { backgroundColor: colors.brand.primary }]}>
                  <Text style={[typography.captionSm, { color: colors.text.inverse }]}>
                    {needsReason ? '5' : '4'}
                  </Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                  确认信息
                </Text>
              </View>

              {/* 摘要信息 */}
              <View style={[styles.summaryBlock, { backgroundColor: colors.bgSecondary, borderRadius: radius.md }]}>
                {/* 商品名称 */}
                <View style={styles.summaryRow}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>售后商品</Text>
                  <Text style={[typography.bodySm, { color: colors.text.primary, flex: 1, textAlign: 'right' }]} numberOfLines={1}>
                    {selectedItem?.title ?? '-'}
                  </Text>
                </View>
                {/* 售后类型 */}
                <View style={styles.summaryRow}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>售后类型</Text>
                  <Text style={[typography.bodySm, { color: colors.brand.primary }]}>
                    {afterSaleTypeLabels[afterSaleType]}
                  </Text>
                </View>
                {/* 照片数量 */}
                <View style={styles.summaryRow}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>凭证照片</Text>
                  <Text style={[typography.bodySm, { color: colors.text.primary }]}>{photos.length} 张</Text>
                </View>
                {/* 预估退款（退货类型） */}
                {(afterSaleType === 'NO_REASON_RETURN' || afterSaleType === 'QUALITY_RETURN') && (
                  <View style={styles.summaryRow}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>预估退款</Text>
                    <Text style={[typography.bodyStrong, { color: colors.danger }]}>
                      ¥{estimatedRefund.toFixed(2)}
                    </Text>
                  </View>
                )}
                {/* 运费说明 */}
                {shippingInfo ? (
                  <View style={[styles.summaryRow, { borderBottomWidth: 0 }]}>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>退回方式</Text>
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>{shippingInfo}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* 提交按钮 */}
            <Pressable onPress={handleSubmit} disabled={!canSubmit}>
              <LinearGradient
                colors={[colors.brand.primary, colors.ai.start]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.submitButton, { borderRadius: radius.pill, opacity: canSubmit ? 1 : 0.5 }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                  {submitting ? '提交中...' : `提交${afterSaleTypeLabels[afterSaleType]}申请`}
                </Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── 样式 ─────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 16,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  radioBtn: {
    width: 22,
    height: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  cover: {
    width: 64,
    height: 64,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginLeft: 30,
  },
  typeCard: {
    flex: 1,
    minWidth: 90,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    marginLeft: 30,
    gap: 8,
  },
  photoWrapper: {
    position: 'relative',
  },
  photo: {
    width: 80,
    height: 80,
  },
  photoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: 'white',
    borderRadius: 10,
  },
  photoAdd: {
    width: 80,
    height: 80,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    marginLeft: 30,
  },
  reasonChip: {
    marginRight: 8,
    marginBottom: 8,
  },
  reasonChipInner: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  textarea: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
    marginTop: 8,
    textAlignVertical: 'top',
  },
  summaryBlock: {
    marginTop: 12,
    marginLeft: 30,
    padding: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2EAE2',
  },
  submitButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
});
