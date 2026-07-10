import React from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { CaptainRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, priceTextProps, useTheme } from '../../src/theme';
import type { CaptainLedger, CaptainOrderProgress } from '../../src/types';

const money = (value?: number | null) => `¥${Number(value ?? 0).toFixed(2)}`;
const percent = (value?: number | null) => `${(Number(value ?? 0) * 100).toFixed(1)}%`;

const ledgerTypeLabel: Record<string, string> = {
  DIRECT_ORDER: '推广奖励',
  LEGACY_INDIRECT_ORDER: '历史二级佣金',
  MANAGEMENT_ALLOWANCE: '管理津贴',
  GROWTH_BONUS: '增长奖励',
  CULTIVATION_BONUS: '有效成交辅导奖',
  PERFORMANCE_BONUS: '经营绩效奖',
  TEAM_POOL: '历史团队池奖励',
  VOID: '售后冲回',
  ADJUSTMENT: '人工调整',
};

const statusLabel: Record<string, string> = {
  FROZEN: '待到账',
  AVAILABLE: '已到账',
  VOIDED: '已作废',
  WITHDRAWN: '已支付',
  CLAWBACK_PENDING: '待处理',
};

export default function CaptainCenterPage() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const profileQuery = useQuery({
    queryKey: ['captain-me'],
    queryFn: () => CaptainRepo.getMyCaptainProfile(),
    enabled: isLoggedIn,
  });
  const ledgerQuery = useQuery({
    queryKey: ['captain-me-ledgers'],
    queryFn: () => CaptainRepo.getMyLedgers(1, 8),
    enabled: isLoggedIn,
  });
  const orderQuery = useQuery({
    queryKey: ['captain-me-orders'],
    queryFn: () => CaptainRepo.getMyOrders(1, 8),
    enabled: isLoggedIn,
  });

  const data = profileQuery.data?.ok ? profileQuery.data.data : null;
  const profile = data?.profile ?? null;
  const account = data?.account ?? null;
  const metric = data?.metric ?? null;
  const ledgers = ledgerQuery.data?.ok ? ledgerQuery.data.data.items : [];
  const orders = orderQuery.data?.ok ? orderQuery.data.data.items : [];
  const captainCode = profile?.captainCode ?? '';
  const shareLink = captainCode ? `https://app.ai-maimai.com/c/${captainCode}` : '';

  const copyCode = async () => {
    if (!captainCode) return;
    await Clipboard.setStringAsync(captainCode);
    show({ message: '团长码已复制', type: 'success' });
  };

  const shareCode = async () => {
    if (!shareLink) return;
    try {
      await Share.share({
        message: `我在爱买买分享了预包装海鲜团长经营码 ${captainCode}，打开链接绑定：${shareLink}`,
      });
    } catch {
      // 用户取消分享不处理
    }
  };

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团长经营" />
        <View style={{ padding: spacing.xl }}>
          <ErrorState title="请先登录" description="登录后查看团长经营奖励" />
        </View>
      </Screen>
    );
  }

  if (profileQuery.isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团长经营" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={220} radius={radius.xl} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={160} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data?.isCaptain || !profile) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="团长经营" />
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="暂未开通团长经营"
            description="当前账号还不是有效团长，开通后可在这里查看经营奖励和订单进度"
            onAction={() => profileQuery.refetch()}
            actionLabel="刷新"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="团长经营" />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
        <LinearGradient
          colors={['#0F766E', '#164E63']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderRadius: radius.xl }, shadow.lg]}
        >
          <View style={styles.heroTop}>
            <View>
              <Text style={[typography.caption, styles.heroCaption]}>团长经营奖励</Text>
              <Text {...priceTextProps} style={styles.heroAmount}>{money((account?.balance ?? 0) + (account?.frozen ?? 0))}</Text>
            </View>
            <View style={styles.qrBox}>
              {shareLink ? <QRCode value={shareLink} size={78} /> : null}
            </View>
          </View>
          <View style={styles.codeRow}>
            <Text style={styles.codeText}>{captainCode}</Text>
            <Pressable onPress={copyCode} hitSlop={10}>
              <MaterialCommunityIcons name="content-copy" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
          <Pressable onPress={shareCode} style={styles.shareButton}>
            <MaterialCommunityIcons name="share-variant-outline" size={17} color="#FFFFFF" />
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: '#FFFFFF', marginLeft: 8 }]}>
              分享团长码
            </Text>
          </Pressable>
        </LinearGradient>

        <View style={styles.statsGrid}>
          <Stat label="已到账" value={money(account?.balance)} />
          <Stat label="待到账" value={money(account?.frozen)} />
          <Stat label="本月直接客户 GMV" value={money(metric?.personalGmv)} />
          <Stat label="有效直接客户" value={`${metric?.directEffectiveBuyers ?? 0} 人`} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.headingSm, { color: colors.text.primary }]}>月度进度</Text>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              {metric?.qualified ? '已达标' : '待达标'}
            </Text>
          </View>
          <ProgressRow label="有效直接成交客户" value={`${metric?.directEffectiveBuyers ?? 0} 人`} />
          <ProgressRow label="新增有效直接客户" value={`${metric?.newEffectiveMembers ?? 0} 人`} />
          <ProgressRow label="退款率" value={percent(metric?.refundRate)} />
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 10 }]}>
            当前档位：{metric?.qualifiedTier ?? '未达档'}，月度奖励以后台当月配置和审核结果为准
          </Text>
        </View>

        <ListSection<CaptainOrderProgress>
          title="订单进度"
          items={orders}
          emptyText="暂无经营订单"
          renderItem={(item) => (
            <View key={item.id} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  订单 {item.orderId.slice(-8)}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  基数 {money(item.commissionBase)} · 状态 {item.status}
                </Text>
              </View>
              <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>
                {money(item.commissionBase * item.directRate)}
              </Text>
            </View>
          )}
        />

        <ListSection<CaptainLedger>
          title="奖励明细"
          items={ledgers}
          emptyText="暂无经营奖励流水"
          renderItem={(item) => (
            <View key={item.id} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  {ledgerTypeLabel[item.type] ?? item.type}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  {statusLabel[item.status] ?? item.status}
                </Text>
              </View>
              <Text style={[typography.bodyStrong, { color: item.amount < 0 ? colors.danger : colors.brand.primary }]}>
                {money(item.amount)}
              </Text>
            </View>
          )}
        />
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors, radius, shadow, typography } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
      <Text style={[typography.headingSm, { color: colors.text.primary, marginTop: 6 }]}>{value}</Text>
    </View>
  );
}

function ProgressRow({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.progressRow}>
      <Text style={[typography.bodySm, { color: colors.text.secondary }]}>{label}</Text>
      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{value}</Text>
    </View>
  );
}

function ListSection<T>({
  title,
  items,
  emptyText,
  renderItem,
}: {
  title: string;
  items: T[];
  emptyText: string;
  renderItem: (item: T) => React.ReactNode;
}) {
  const { colors, radius, shadow, typography } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
      <Text style={[typography.headingSm, { color: colors.text.primary, marginBottom: 10 }]}>{title}</Text>
      {items.length > 0 ? items.map(renderItem) : (
        <Text style={[typography.caption, { color: colors.text.secondary }]}>{emptyText}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 20,
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroCaption: {
    color: 'rgba(255,255,255,0.76)',
  },
  heroAmount: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 6,
  },
  qrBox: {
    width: 90,
    height: 90,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  codeText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
    marginRight: 10,
  },
  shareButton: {
    alignSelf: 'flex-start',
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    marginHorizontal: -5,
  },
  statCard: {
    width: '47.5%',
    margin: '1.25%',
    padding: 14,
    minHeight: 82,
  },
  section: {
    marginTop: 16,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressRow: {
    paddingVertical: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listRow: {
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
