import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, Screen } from '../src/components/layout';
import { EmptyState, Skeleton } from '../src/components/feedback';
import { CouponRepo } from '../src/repos';
import { useAuthStore, useCheckoutStore } from '../src/store';
import { useTheme } from '../src/theme';
import type { CheckoutEligibleCoupon } from '../src/types/domain/Coupon';

/**
 * 格式化折扣展示文案
 * - FIXED 类型：¥10
 * - PERCENT 类型：discountValue=20 表示打 8 折（即减 20%）
 */
const formatDiscountLabel = (coupon: CheckoutEligibleCoupon): { symbol: string; value: string } => {
  if (coupon.discountType === 'FIXED') {
    return { symbol: '¥', value: String(coupon.discountValue) };
  }
  // PERCENT 类型：discountValue 是折扣百分比，如 20 表示减 20%，即打 8 折
  const zheKou = (100 - coupon.discountValue) / 10;
  return { symbol: '', value: `${zheKou}折` };
};

/**
 * 计算剩余有效时间文案
 */
const formatExpiry = (expiresAt: string): string => {
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const diff = expiry - now;
  if (diff <= 0) return '已过期';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 30) return `${Math.floor(days / 30)}个月后过期`;
  if (days > 0) return `${days}天后过期`;
  if (hours > 0) return `${hours}小时后过期`;
  return '即将过期';
};

/** 红包选择卡片（React.memo 优化列表渲染） */
const CouponCard = React.memo(function CouponCard({
  item,
  selected,
  disabled,
  onPress,
  colors,
  radius,
  shadow,
  spacing,
  typography,
}: {
  item: CheckoutEligibleCoupon;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: any;
  radius: any;
  shadow: any;
  spacing: any;
  typography: any;
}) {
  const { symbol, value } = formatDiscountLabel(item);
  const isIneligible = !item.eligible;
  const isDisabled = disabled || isIneligible;
  const expiryText = formatExpiry(item.expiresAt);
  const isExpiringSoon = expiryText.includes('小时') || expiryText === '即将过期';

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      style={[
        styles.card,
        shadow.sm,
        {
          backgroundColor: isDisabled ? colors.bgSecondary : colors.surface,
          borderRadius: radius.lg,
          borderWidth: selected ? 1.5 : 0,
          borderColor: selected ? colors.brand.primary : 'transparent',
          opacity: isDisabled ? 0.55 : 1,
        },
      ]}
    >
      {/* 左侧金额区 */}
      <LinearGradient
        colors={isDisabled ? [colors.muted, colors.border] : [colors.danger, '#E57373']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.amountSection, { borderRadius: radius.md }]}
      >
        {symbol ? (
          <>
            <Text style={styles.amountSymbol}>{symbol}</Text>
            <Text style={styles.amountValue}>{value}</Text>
          </>
        ) : (
          <Text style={[styles.amountValue, { fontSize: 22 }]}>{value}</Text>
        )}
        {item.minOrderAmount > 0 ? (
          <Text style={styles.amountThreshold}>满¥{item.minOrderAmount}可用</Text>
        ) : (
          <Text style={styles.amountThreshold}>无门槛</Text>
        )}
      </LinearGradient>

      {/* 右侧信息区 */}
      <View style={[styles.infoSection, { paddingHorizontal: spacing.md }]}>
        <Text
          style={[typography.bodyStrong, { color: isDisabled ? colors.muted : colors.text.primary }]}
          numberOfLines={1}
        >
          {item.campaignName}
        </Text>

        {/* 预估抵扣 */}
        {item.eligible && item.estimatedDiscount > 0 && (
          <Text style={[typography.captionSm, { color: colors.danger, marginTop: 2 }]}>
            预估可减 ¥{item.estimatedDiscount.toFixed(2)}
          </Text>
        )}

        {/* PERCENT 类型显示最大抵扣额 */}
        {item.discountType === 'PERCENT' && item.maxDiscountAmount !== null && (
          <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
            最高减¥{item.maxDiscountAmount}
          </Text>
        )}

        {/* 过期倒计时 */}
        <Text
          style={[
            typography.captionSm,
            {
              color: isExpiringSoon ? colors.warning : colors.text.secondary,
              marginTop: 2,
            },
          ]}
        >
          {expiryText}
        </Text>

        {/* 不可叠加标签 */}
        {!item.stackable && (
          <View style={[styles.statusTag, { backgroundColor: colors.bgSecondary, marginTop: 4 }]}>
            <Text style={[typography.captionSm, { color: colors.muted }]}>不可叠加</Text>
          </View>
        )}

        {/* 不可用原因 */}
        {isIneligible && item.ineligibleReason && (
          <View style={[styles.statusTag, { backgroundColor: `${colors.danger}15`, marginTop: 4 }]}>
            <Text style={[typography.captionSm, { color: colors.danger }]}>{item.ineligibleReason}</Text>
          </View>
        )}
      </View>

      {/* 选中指示器（多选复选框样式） */}
      {!isDisabled && (
        <View style={styles.checkWrap}>
          <View
            style={[
              styles.checkbox,
              {
                borderColor: selected ? colors.brand.primary : colors.border,
                backgroundColor: selected ? colors.brand.primary : 'transparent',
                borderRadius: 4,
              },
            ]}
          >
            {selected && (
              <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
});

export default function CheckoutCouponScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  // 接收参数：订单金额 + 分类ID列表 + 商家ID列表 + 已选红包（回显）
  const { orderTotal, categoryIds, companyIds, currentCouponIds } = useLocalSearchParams<{
    orderTotal?: string;
    categoryIds?: string;
    companyIds?: string;
    currentCouponIds?: string;
  }>();

  const orderAmount = parseFloat(orderTotal ?? '0');
  const parsedCategoryIds: string[] = useMemo(() => {
    try { return categoryIds ? JSON.parse(categoryIds) : []; } catch { return []; }
  }, [categoryIds]);
  const parsedCompanyIds: string[] = useMemo(() => {
    try { return companyIds ? JSON.parse(companyIds) : []; } catch { return []; }
  }, [companyIds]);

  // 初始化已选红包（从 checkout 页传入，用于回显）
  const initialSelected = useMemo(() => {
    try {
      const ids = currentCouponIds ? JSON.parse(currentCouponIds) : [];
      return new Set<string>(ids);
    } catch {
      return new Set<string>();
    }
  }, [currentCouponIds]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelected);

  // 查询结算可用红包
  const { data, isLoading } = useQuery({
    queryKey: ['checkout-eligible-coupons', orderAmount, parsedCategoryIds, parsedCompanyIds],
    queryFn: () => CouponRepo.getCheckoutEligible({
      orderAmount,
      categoryIds: parsedCategoryIds,
      companyIds: parsedCompanyIds,
    }),
    enabled: isLoggedIn && orderAmount > 0,
  });

  const allCoupons = data?.ok ? data.data : [];

  // 分离可用和不可用红包
  const { eligible, ineligible } = useMemo(() => {
    const elig: CheckoutEligibleCoupon[] = [];
    const inelig: CheckoutEligibleCoupon[] = [];
    allCoupons.forEach((coupon) => {
      if (coupon.eligible) {
        elig.push(coupon);
      } else {
        inelig.push(coupon);
      }
    });
    // 可用红包按预估抵扣金额降序
    elig.sort((a, b) => b.estimatedDiscount - a.estimatedDiscount);
    return { eligible: elig, ineligible: inelig };
  }, [allCoupons]);

  // 计算当前已选红包的总抵扣金额
  const { totalDiscount, selectedCount } = useMemo(() => {
    let total = 0;
    let count = 0;
    eligible.forEach((coupon) => {
      if (selectedIds.has(coupon.id)) {
        total += coupon.estimatedDiscount;
        count++;
      }
    });
    // 总抵扣不能超过订单金额
    total = Math.min(total, orderAmount);
    return { totalDiscount: Number(total.toFixed(2)), selectedCount: count };
  }, [eligible, selectedIds, orderAmount]);

  // 判断已选红包中是否包含不可叠加红包 / 可叠加红包
  const { hasSelectedNonStackable, hasSelectedStackable } = useMemo(() => {
    let nonStack = false;
    let stack = false;
    eligible.forEach((coupon) => {
      if (selectedIds.has(coupon.id)) {
        if (coupon.stackable) stack = true;
        else nonStack = true;
      }
    });
    return { hasSelectedNonStackable: nonStack, hasSelectedStackable: stack };
  }, [eligible, selectedIds]);

  const handleSelect = useCallback((coupon: CheckoutEligibleCoupon) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(coupon.id)) {
        // 取消选中
        next.delete(coupon.id);
        return next;
      }

      // 叠加规则检查
      if (!coupon.stackable) {
        // 不可叠加红包：选中时清除所有其他已选红包
        const hasOtherSelected = next.size > 0;
        if (hasOtherSelected) {
          Alert.alert(
            '不可叠加',
            `该红包不可与其他红包同时使用。是否替换已选红包？`,
            [
              { text: '取消', style: 'cancel' },
              {
                text: '替换',
                onPress: () => {
                  setSelectedIds(new Set([coupon.id]));
                },
              },
            ]
          );
          return prev; // 不立即变更，等用户确认
        }
      } else {
        // 可叠加红包：如果已选了不可叠加红包，禁止选择
        const hasNonStackable = eligible.some(
          (c) => next.has(c.id) && !c.stackable
        );
        if (hasNonStackable) {
          return prev; // 已选不可叠加红包时，不允许再选其他
        }
      }

      // 检查抵扣总额是否超过订单金额
      let currentTotal = 0;
      eligible.forEach((c) => {
        if (next.has(c.id)) {
          currentTotal += c.estimatedDiscount;
        }
      });
      if (currentTotal + coupon.estimatedDiscount > orderAmount) {
        Alert.alert('提示', '已选红包抵扣总额已达到订单金额上限');
        return prev;
      }

      next.add(coupon.id);
      return next;
    });
  }, [eligible, orderAmount]);

  const setSelectedCoupons = useCheckoutStore((s) => s.setSelectedCoupons);
  const clearCoupons = useCheckoutStore((s) => s.clearCoupons);

  // 确认选择，传回 checkout 页
  const handleConfirm = () => {
    if (selectedCount > 0) {
      setSelectedCoupons(Array.from(selectedIds), totalDiscount);
    } else {
      clearCoupons();
    }
    router.back();
  };

  // 不使用红包
  const handleSkip = () => {
    clearCoupons();
    router.back();
  };

  const renderItem = useCallback(
    ({ item, index }: { item: CheckoutEligibleCoupon; index: number }) => {
      const isIneligible = !item.eligible;
      // 叠加规则禁用：已选不可叠加→禁用所有其他；已选可叠加→禁用不可叠加
      let isStackBlocked = false;
      if (!isIneligible && !selectedIds.has(item.id)) {
        if (hasSelectedNonStackable) {
          // 已选了不可叠加红包，禁用所有其他红包
          isStackBlocked = true;
        } else if (hasSelectedStackable && !item.stackable) {
          // 已选了可叠加红包，禁用不可叠加红包
          isStackBlocked = true;
        }
      }
      return (
        <Animated.View entering={FadeInDown.duration(250).delay(30 + index * 20)}>
          <CouponCard
            item={item}
            selected={selectedIds.has(item.id)}
            disabled={isIneligible || isStackBlocked}
            onPress={() => handleSelect(item)}
            colors={colors}
            radius={radius}
            shadow={shadow}
            spacing={spacing}
            typography={typography}
          />
        </Animated.View>
      );
    },
    [selectedIds, hasSelectedNonStackable, hasSelectedStackable, colors, radius, shadow, spacing, typography, handleSelect]
  );

  // 合并列表：可用 + 不可用分组
  type ListItem = CheckoutEligibleCoupon | { type: 'header'; title: string; id: string };
  const sections = useMemo(() => {
    const list: ListItem[] = [];
    if (eligible.length > 0) {
      list.push(...eligible);
    }
    if (ineligible.length > 0) {
      list.push({ type: 'header', title: '暂不可用', id: '__header_ineligible' });
      list.push(...ineligible);
    }
    return list;
  }, [eligible, ineligible]);

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="选择红包" />

      {/* 顶部统计 */}
      <View
        style={[
          styles.summary,
          {
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <MaterialCommunityIcons name="ticket-percent-outline" size={18} color={colors.brand.primary} />
        <Text style={[typography.bodySm, { color: colors.text.primary, marginLeft: spacing.sm }]}>
          可用 <Text style={{ color: colors.danger, fontWeight: '600' }}>{eligible.length}</Text> 张红包
        </Text>
        {selectedCount > 0 && (
          <Text style={[typography.bodySm, { color: colors.danger, marginLeft: 'auto' }]}>
            已选 {selectedCount} 张，-¥{totalDiscount.toFixed(2)}
          </Text>
        )}
      </View>

      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={88} radius={radius.lg} style={{ marginBottom: spacing.md }} />
          ))}
        </View>
      ) : allCoupons.length === 0 ? (
        <EmptyState title="暂无可用红包" description="参与平台活动可获取红包" />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item: ListItem) => {
            if ('type' in item && item.type === 'header') return item.id;
            return (item as CheckoutEligibleCoupon).id;
          }}
          initialNumToRender={8}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 100 }}
          renderItem={({ item, index }: { item: ListItem; index: number }) => {
            // 分组标题
            if ('type' in item && item.type === 'header') {
              return (
                <Text
                  style={[
                    typography.captionSm,
                    {
                      color: colors.text.secondary,
                      marginTop: spacing.md,
                      marginBottom: spacing.sm,
                    },
                  ]}
                >
                  {item.title}
                </Text>
              );
            }
            return renderItem({ item: item as CheckoutEligibleCoupon, index });
          }}
        />
      )}

      {/* 底部确认栏 */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + spacing.sm,
            paddingHorizontal: spacing.xl,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <Pressable
          onPress={handleSkip}
          style={{ paddingVertical: 12, paddingHorizontal: spacing.md }}
        >
          <Text style={[typography.bodySm, { color: colors.text.secondary }]}>不使用红包</Text>
        </Pressable>
        <LinearGradient
          colors={[...gradients.goldGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ borderRadius: radius.pill, overflow: 'hidden' }}
        >
          <Pressable onPress={handleConfirm} style={styles.confirmButton}>
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
              {selectedCount > 0
                ? `确认使用 ${selectedCount} 张 -¥${totalDiscount.toFixed(2)}`
                : '确认'}
            </Text>
          </Pressable>
        </LinearGradient>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  amountSection: {
    width: 90,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  amountSymbol: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  amountValue: {
    fontSize: 28,
    color: '#FFFFFF',
    fontWeight: '800',
    lineHeight: 34,
  },
  amountThreshold: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  infoSection: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  statusTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  checkWrap: {
    paddingRight: 14,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  confirmButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
});
