import React, { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { DigitalAssetRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { priceTextProps, useBottomInset, useTheme } from '../../src/theme';
import type { DigitalAssetLedger, DigitalAssetModuleInfo } from '../../src/types';

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
};

const ledgerIcon = (item: DigitalAssetLedger) => {
  if (item.type === 'REFUND_REVERSAL') return 'cash-refund';
  if (item.type === 'ADMIN_ADJUSTMENT') return 'tune-variant';
  if (item.type === 'BACKFILL') return 'archive-check-outline';
  return 'check-decagram-outline';
};

export default function DigitalAssetsScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const bottomInset = useBottomInset(spacing['3xl']);

  const summaryQuery = useQuery({
    queryKey: ['digital-assets-summary'],
    queryFn: () => DigitalAssetRepo.getSummary(),
    enabled: isLoggedIn,
  });
  const ledgerQuery = useQuery({
    queryKey: ['digital-assets-ledgers'],
    queryFn: () => DigitalAssetRepo.getLedgers(),
    enabled: isLoggedIn,
  });

  const summary = summaryQuery.data?.ok ? summaryQuery.data.data : null;
  const ledgers = ledgerQuery.data?.ok ? ledgerQuery.data.data.items : [];
  const listError = summaryQuery.data && !summaryQuery.data.ok
    ? summaryQuery.data.error
    : ledgerQuery.data && !ledgerQuery.data.ok
      ? ledgerQuery.data.error
      : null;
  const isLoading = summaryQuery.isLoading || ledgerQuery.isLoading;
  const isFetching = summaryQuery.isFetching || ledgerQuery.isFetching;

  const modules = useMemo(
    () => summary?.modules ?? [],
    [summary],
  );

  const refetch = () => {
    summaryQuery.refetch();
    ledgerQuery.refetch();
  };

  const renderLedger = ({ item, index }: { item: DigitalAssetLedger; index: number }) => {
    const isCredit = item.direction === 'CREDIT';
    const amountColor = isCredit ? colors.success : colors.danger;
    return (
      <Animated.View entering={FadeInDown.duration(250).delay(index * 24)}>
        <View style={[styles.ledgerRow, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
          <View style={[styles.ledgerIcon, { backgroundColor: isCredit ? colors.brand.primarySoft : `${colors.danger}12` }]}>
            <MaterialCommunityIcons
              name={ledgerIcon(item) as any}
              size={20}
              color={isCredit ? colors.brand.primary : colors.danger}
            />
          </View>
          <View style={styles.ledgerMain}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]} numberOfLines={1}>
              {item.description || (item.orderId ? `订单 ${item.orderId.slice(0, 10)}...` : '数字资产流水')}
            </Text>
            <Text style={[typography.captionSm, { color: colors.muted, marginTop: 4 }]}>
              {formatDateTime(item.createdAt)}
            </Text>
          </View>
          <View style={styles.ledgerAmountBox}>
            <Text {...priceTextProps} style={[typography.bodyStrong, { color: amountColor }]}>
              {isCredit ? '+' : '-'}¥{Math.abs(item.amount).toFixed(2)}
            </Text>
            <Text {...priceTextProps} style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
              余额 ¥{item.balanceAfter.toFixed(2)}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  };

  const renderModule = (item: DigitalAssetModuleInfo) => (
    <View
      key={item.key}
      style={[styles.moduleItem, { backgroundColor: colors.bgSecondary, borderRadius: radius.lg }]}
    >
      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.title}</Text>
      <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]} numberOfLines={2}>
        {item.description}
      </Text>
      <View style={[styles.comingBadge, { backgroundColor: colors.surface, borderRadius: radius.pill }]}>
        <Text style={[typography.captionSm, { color: colors.muted }]}>待开放</Text>
      </View>
    </View>
  );

  const header = (
    <View>
      <LinearGradient
        colors={[colors.brand.primary, colors.gold.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.summaryCard, { borderRadius: radius.xl }]}
      >
        <Text style={styles.summaryLabel}>累计消费数字资产</Text>
        <Text {...priceTextProps} style={styles.summaryAmount}>
          ¥{(summary?.cumulativeSpendAmount ?? 0).toFixed(2)}
        </Text>
        <Text style={styles.summaryHint}>以确认收货后的实付商品金额累计，退款会自动扣回</Text>
      </LinearGradient>

      <View style={styles.moduleGrid}>
        {modules.map(renderModule)}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>资产流水</Text>
      </View>
    </View>
  );

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="数字资产" />
        <EmptyState
          title="请先登录"
          description="登录后查看累计消费数字资产"
          actionLabel="返回我的"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="数字资产" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={150} radius={radius.xl} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={84} radius={radius.lg} />
          <View style={{ height: spacing.sm }} />
          <Skeleton height={84} radius={radius.lg} />
        </View>
      ) : listError ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="数字资产加载失败"
            description={listError.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        </View>
      ) : (
        <FlatList
          data={ledgers}
          keyExtractor={(item) => item.id}
          renderItem={renderLedger}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title="暂无资产流水" description="完成订单并确认收货后开始累计" />}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: bottomInset }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    paddingHorizontal: 22,
    paddingVertical: 24,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
  },
  summaryAmount: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 8,
  },
  summaryHint: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  moduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  moduleItem: {
    width: '48%',
    minHeight: 104,
    padding: 14,
  },
  comingBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 10,
  },
  sectionHeader: {
    marginTop: 22,
    marginBottom: 10,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 10,
  },
  ledgerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerMain: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  ledgerAmountBox: {
    alignItems: 'flex-end',
    marginLeft: 10,
  },
});
