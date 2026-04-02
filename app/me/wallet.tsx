import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { AiDivider } from '../../src/components/ui';
import { BonusRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import type { WalletLedgerEntry } from '../../src/types';

// 筛选标签
type FilterKey = 'all' | 'available' | 'frozen' | 'withdraw';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'available', label: '已到账' },
  { key: 'frozen', label: '待解锁' },
  { key: 'withdraw', label: '已提现' },
];

// 来源标签映射 — 对用户友好的名称
const refTypeLabel: Record<string, string> = {
  ORDER: '消费奖励',
  REFERRAL: '推荐奖励',
  VIP_REFERRAL: '推荐奖励',
  VIP_TREE: '消费奖励',
  NORMAL_TREE: '消费奖励',
  NORMAL_BROADCAST: '消费奖励',
  WITHDRAW: '提现',
};

// 统一列表项类型
interface LedgerDisplayItem {
  id: string;
  title: string;
  desc: string;
  amount: number;
  date: string;
  type: 'income' | 'expense' | 'frozen' | 'expired';
  // 冻结专有
  requiredLevel?: number | null;
  remainingDays?: number | null;
}

// 格式化日期时间：2026-03-26 14:30
const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
};

export default function WalletScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  // 钱包余额
  const { data: walletData, isLoading: walletLoading, isFetching, refetch } = useQuery({
    queryKey: ['bonus-wallet'],
    queryFn: () => BonusRepo.getWallet(),
    enabled: isLoggedIn,
  });

  // 收支流水
  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ['bonus-ledger'],
    queryFn: () => BonusRepo.getWalletLedger(),
    enabled: isLoggedIn,
  });

  // 普通奖励（含冻结详情）
  const { data: normalData } = useQuery({
    queryKey: ['normal-rewards'],
    queryFn: () => BonusRepo.getNormalRewards(),
    enabled: isLoggedIn,
  });

  const wallet = walletData?.ok ? walletData.data : null;
  const walletError = walletData && !walletData.ok ? walletData.error : null;
  const ledgerItems = ledgerData?.ok ? ledgerData.data.items : [];
  const normalItems = normalData?.ok ? normalData.data.items : [];

  // 合并流水 + 冻结奖励为统一列表
  const displayItems = useMemo(() => {
    const items: LedgerDisplayItem[] = [];

    // 从钱包流水中提取冻结条目
    const frozenFromLedger = new Set<string>();

    // 流水记录
    // 后端 entryType: RELEASE（到账）/ FREEZE（冻结）/ WITHDRAW（提现）/ VOID / ADJUST
    ledgerItems.forEach((entry) => {
      const isIncome = entry.entryType === 'RELEASE';
      const isFrozen = entry.status === 'FROZEN' || entry.entryType === 'FREEZE';
      const isWithdraw = entry.entryType === 'WITHDRAW' || entry.refType === 'WITHDRAW';
      const isVoided = entry.status === 'VOIDED' || entry.entryType === 'VOID';
      const isAdjust = entry.entryType === 'ADJUST';
      const title = refTypeLabel[entry.refType ?? ''] ?? (isIncome ? '消费奖励' : isAdjust ? '系统调整' : '支出');
      const meta = entry.meta as Record<string, unknown> | null;

      if (isFrozen && !isWithdraw) {
        // 冻结条目 — 显示解锁条件和倒计时
        const requiredLevel = (meta?.requiredLevel as number) ?? null;
        const expiresAt = meta?.expiresAt ? new Date(meta.expiresAt as string) : null;
        const remainingDays = expiresAt
          ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000))
          : null;

        frozenFromLedger.add(entry.id);
        items.push({
          id: entry.id,
          title: '消费奖励',
          desc: requiredLevel ? `需消费 ${requiredLevel} 笔解锁` : '待解锁',
          amount: entry.amount,
          date: entry.createdAt,
          type: 'frozen',
          requiredLevel,
          remainingDays,
        });
        return;
      }

      if (isVoided) {
        items.push({
          id: entry.id,
          title: '消费奖励',
          desc: '未在有效期内解锁',
          amount: entry.amount,
          date: entry.createdAt,
          type: 'expired',
        });
        return;
      }

      let desc = '';
      if (isWithdraw) {
        desc = '提现至账户';
      } else if (isAdjust) {
        desc = '平台调整';
      } else if (entry.refType === 'REFERRAL' || entry.refType === 'VIP_REFERRAL') {
        desc = '好友开通 VIP';
      } else {
        desc = '订单奖励';
      }

      items.push({
        id: entry.id,
        title,
        desc,
        amount: entry.amount,
        date: entry.createdAt,
        type: isWithdraw ? 'expense' : 'income',
      });
    });

    // 补充 normalItems 中的冻结条目（避免重复）
    normalItems
      .filter((n) => n.status === 'FROZEN' && !frozenFromLedger.has(n.id))
      .forEach((n) => {
        items.push({
          id: `frozen-${n.id}`,
          title: '消费奖励',
          desc: n.requiredLevel ? `需消费 ${n.requiredLevel} 笔解锁` : '待解锁',
          amount: n.amount,
          date: n.createdAt,
          type: 'frozen',
          requiredLevel: n.requiredLevel,
          remainingDays: n.remainingDays,
        });
      });

    // 按日期降序
    items.sort((a, b) => b.date.localeCompare(a.date));

    return items;
  }, [ledgerItems, normalItems]);

  // 筛选
  const filteredItems = useMemo(() => {
    switch (activeFilter) {
      case 'available':
        return displayItems.filter((i) => i.type === 'income');
      case 'frozen':
        return displayItems.filter((i) => i.type === 'frozen');
      case 'withdraw':
        return displayItems.filter((i) => i.type === 'expense');
      default:
        return displayItems;
    }
  }, [displayItems, activeFilter]);

  // 渲染列表项
  const renderItem = ({ item, index }: { item: LedgerDisplayItem; index: number }) => {
    const remainingDays = typeof item.remainingDays === 'number' ? Number(item.remainingDays) : null;
    const isUrgent = item.type === 'frozen' && remainingDays !== null && remainingDays <= 3;
    const isExpired = item.type === 'expired';

    return (
      <Animated.View entering={FadeInDown.duration(250).delay(30 + index * 20)}>
        <View
          style={[
            styles.ledgerRow,
            {
              borderBottomColor: colors.border,
              marginHorizontal: spacing.xl,
              opacity: isExpired ? 0.5 : 1,
            },
          ]}
        >
          {/* 图标 */}
          <View
            style={[
              styles.ledgerIcon,
              {
                backgroundColor:
                  item.type === 'income' ? colors.brand.primarySoft
                  : item.type === 'frozen' ? '#FFF8E1'
                  : item.type === 'expense' ? colors.accent.blueSoft
                  : colors.bgSecondary,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={
                item.type === 'income' ? 'arrow-down-circle-outline'
                : item.type === 'frozen' ? 'lock-clock'
                : item.type === 'expense' ? 'arrow-up-circle-outline'
                : 'close-circle-outline'
              }
              size={20}
              color={
                item.type === 'income' ? colors.brand.primary
                : item.type === 'frozen' ? (isUrgent ? colors.danger : '#E6A817')
                : item.type === 'expense' ? colors.accent.blue
                : colors.muted
              }
            />
          </View>

          {/* 信息 */}
          <View style={styles.ledgerInfo}>
            <View style={styles.ledgerTitleRow}>
              <Text style={[typography.bodyStrong, { color: isExpired ? colors.muted : colors.text.primary, flex: 1 }]}>
                {item.title}
              </Text>
              {/* 状态标签 */}
              <View
                style={[
                  styles.statusTag,
                  {
                    backgroundColor:
                      item.type === 'income' ? colors.brand.primarySoft
                      : item.type === 'frozen' ? '#FFF3E0'
                      : item.type === 'expense' ? colors.accent.blueSoft
                      : colors.bgSecondary,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.captionSm,
                    {
                      fontWeight: '600',
                      color:
                        item.type === 'income' ? colors.brand.primary
                        : item.type === 'frozen' ? '#E65100'
                        : item.type === 'expense' ? colors.accent.blue
                        : colors.muted,
                    },
                  ]}
                >
                  {item.type === 'income' ? '已到账'
                    : item.type === 'frozen' ? '待解锁'
                    : item.type === 'expense' ? '已完成'
                    : '已过期'}
                </Text>
              </View>
            </View>

            {/* 描述 / 冻结详情 */}
            {item.type === 'frozen' ? (
              <View>
                {/* 解锁条件 */}
                <Text style={[typography.captionSm, { color: '#E65100', marginTop: 4 }]}>
                  {item.desc}
                </Text>
                {/* 倒计时 */}
                {remainingDays !== null ? (
                  <View style={styles.frozenTipRow}>
                    <MaterialCommunityIcons
                      name="clock-outline"
                      size={12}
                      color={isUrgent ? colors.danger : colors.text.secondary}
                    />
                    <Text
                      style={[
                        typography.captionSm,
                        {
                          color: isUrgent ? colors.danger : colors.text.secondary,
                          fontWeight: isUrgent ? '600' : '400',
                          marginLeft: 4,
                        },
                      ]}
                    >
                      {isUrgent
                        ? `剩余 ${remainingDays} 天即将过期`
                        : `剩余 ${remainingDays} 天解锁`}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 3 }]}>
                {item.desc}
              </Text>
            )}
          </View>

          {/* 金额 + 日期 */}
          <View style={styles.ledgerRight}>
            <Text
              style={[
                typography.bodyStrong,
                {
                  color:
                    item.type === 'income' ? colors.success
                    : item.type === 'frozen' ? '#E6A817'
                    : item.type === 'expense' ? colors.text.primary
                    : colors.muted,
                },
              ]}
            >
              {item.type === 'expense' ? '' : '+'}{item.amount.toFixed(2)}
            </Text>
            <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 2 }]}>
              {formatDateTime(item.date)}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="奖励钱包" />
      {walletLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={200} radius={radius.lg} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={60} radius={radius.md} />
          <View style={{ height: spacing.sm }} />
          <Skeleton height={60} radius={radius.md} />
          <View style={{ height: spacing.sm }} />
          <Skeleton height={60} radius={radius.md} />
        </View>
      ) : walletError ? (
        <ErrorState title="钱包加载失败" description="请稍后重试" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          initialNumToRender={10}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
          ListHeaderComponent={
            <View>
              {/* ===== 渐变余额卡 ===== */}
              <LinearGradient
                colors={[...gradients.aiGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.balanceCard}
              >
                <Animated.View entering={FadeInDown.duration(300)} style={{ paddingHorizontal: spacing.xl }}>
                  <Text style={styles.balanceLabel}>可用余额（元）</Text>
                  <Text style={styles.balanceAmount}>
                    <Text style={styles.balanceSymbol}>¥</Text>
                    {wallet?.balance.toFixed(2) ?? '0.00'}
                  </Text>

                  <View style={styles.balanceStats}>
                    <View style={styles.balanceStat}>
                      <Text style={[typography.bodyStrong, { color: '#fff' }]}>
                        ¥{wallet?.frozen.toFixed(2) ?? '0.00'}
                      </Text>
                      <Text style={styles.balanceStatLabel}>待解锁</Text>
                    </View>
                    <View style={styles.balanceStatDivider} />
                    <View style={styles.balanceStat}>
                      <Text style={[typography.bodyStrong, { color: '#fff' }]}>
                        ¥{wallet?.total.toFixed(2) ?? '0.00'}
                      </Text>
                      <Text style={styles.balanceStatLabel}>累计收益</Text>
                    </View>
                  </View>

                  <Pressable onPress={() => router.push('/me/withdraw')}>
                    <LinearGradient
                      colors={[...gradients.goldGradient]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.withdrawBtn, { borderRadius: radius.pill }]}
                    >
                      <Text style={[typography.bodyStrong, { color: '#fff', letterSpacing: 1 }]}>申请提现</Text>
                    </LinearGradient>
                  </Pressable>
                </Animated.View>
              </LinearGradient>

              {/* ===== 筛选 Tab ===== */}
              <View style={[styles.filterRow, { paddingHorizontal: spacing.xl }]}>
                {FILTERS.map((filter) => {
                  const isActive = activeFilter === filter.key;
                  return (
                    <Pressable
                      key={filter.key}
                      onPress={() => setActiveFilter(filter.key)}
                      style={[
                        styles.filterTab,
                        {
                          backgroundColor: isActive ? colors.brand.primary : colors.bgSecondary,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          typography.captionSm,
                          {
                            color: isActive ? colors.text.inverse : colors.text.secondary,
                            fontWeight: isActive ? '600' : '500',
                          },
                        ]}
                      >
                        {filter.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <AiDivider style={{ marginHorizontal: spacing.xl, marginBottom: 4 }} />

              <View style={[styles.sectionHeader, { paddingHorizontal: spacing.xl }]}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>收支明细</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            ledgerLoading ? (
              <View style={{ paddingHorizontal: spacing.xl }}>
                <Skeleton height={60} radius={radius.md} style={{ marginBottom: spacing.sm }} />
                <Skeleton height={60} radius={radius.md} />
              </View>
            ) : (
              <EmptyState
                title={
                  activeFilter === 'frozen' ? '暂无待解锁奖励'
                  : activeFilter === 'withdraw' ? '暂无提现记录'
                  : activeFilter === 'available' ? '暂无已到账奖励'
                  : '暂无收支记录'
                }
                description="完成消费或推荐好友后即可获得奖励"
              />
            )
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 余额卡
  balanceCard: {
    paddingTop: 8,
    paddingBottom: 28,
  },
  balanceLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  balanceSymbol: {
    fontSize: 20,
    fontWeight: '500',
  },
  balanceAmount: {
    fontSize: 40,
    fontWeight: '700',
    color: '#fff',
    marginTop: 6,
    marginBottom: 16,
    letterSpacing: -1,
  },
  balanceStats: {
    flexDirection: 'row',
    marginBottom: 18,
  },
  balanceStat: {
    flex: 1,
    alignItems: 'center',
  },
  balanceStatLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  balanceStatDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 4,
  },
  withdrawBtn: {
    paddingVertical: 13,
    alignItems: 'center',
  },

  // 筛选
  filterRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },

  // 区块标题
  sectionHeader: {
    paddingTop: 4,
    paddingBottom: 8,
  },

  // 列表行
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  ledgerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ledgerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  ledgerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ledgerRight: {
    alignItems: 'flex-end',
    marginLeft: 12,
    paddingTop: 2,
  },

  // 状态标签
  statusTag: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 4,
  },

  // 冻结详情
  frozenTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
});
