import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { InvoiceRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useBottomInset, useTheme } from '../../src/theme';
import { AppError, Invoice, InvoiceStatus } from '../../src/types';

// 发票状态标签映射
const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  REQUESTED: '待开票',
  ISSUED: '已开票',
  FAILED: '开票失败',
  CANCELED: '已取消',
};

// 发票状态颜色映射
const getStatusColor = (status: InvoiceStatus, colors: any): string => {
  switch (status) {
    case 'REQUESTED': return colors.warning;
    case 'ISSUED': return colors.success;
    case 'FAILED': return colors.danger;
    case 'CANCELED': return colors.muted;
    default: return colors.text.secondary;
  }
};

export default function InvoicesScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  // 底部"管理发票抬头"按钮吃系统 safe-area + 视觉间距。
  const bottomPadding = useBottomInset(0);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => InvoiceRepo.getInvoices(),
    enabled: isLoggedIn,
  });

  const listError = data && !data.ok ? data.error : null;
  const invoices = data?.ok ? data.data.items : [];

  const openPdf = useCallback(async (url?: string | null) => {
    if (!url || !/^https?:\/\//.test(url)) {
      show({ message: '发票 PDF 地址无效', type: 'error' });
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      show({ message: '无法打开发票 PDF，请稍后重试', type: 'error' });
    }
  }, [show]);

  // 取消开票申请
  const handleCancel = useCallback(async (invoice: Invoice) => {
    Alert.alert('取消申请', `确认取消订单 ${invoice.orderId.slice(0, 10)}... 的开票申请？`, [
      { text: '再想想', style: 'cancel' },
      {
        text: '确认取消',
        style: 'destructive',
        onPress: async () => {
          setCancelingId(invoice.id);
          const result = await InvoiceRepo.cancelInvoice(invoice.id);
          setCancelingId(null);
          if (!result.ok) {
            show({ message: result.error.displayMessage ?? '取消失败', type: 'error' });
            return;
          }
          show({ message: '已取消开票申请', type: 'success' });
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
          queryClient.invalidateQueries({ queryKey: ['invoice-detail', invoice.id] });
          queryClient.invalidateQueries({ queryKey: ['order', invoice.orderId] });
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        },
      },
    ]);
  }, [show, queryClient]);

  // 渲染发票卡片
  const renderItem = useCallback(({ item, index }: { item: Invoice; index: number }) => {
    const statusColor = getStatusColor(item.status, colors);
    const isCanceling = cancelingId === item.id;
    return (
      <Animated.View entering={FadeInDown.duration(300).delay(50 + index * 30)}>
        <Pressable
          onPress={() => router.push({ pathname: '/invoices/[id]' as any, params: { id: item.id } })}
          style={[
            styles.card,
            shadow.md,
            { backgroundColor: colors.surface, borderRadius: radius.lg },
          ]}
        >
          {/* 顶部：订单号 + 状态标签 */}
          <View style={styles.cardHeader}>
            <Text style={[typography.bodySm, { color: colors.text.primary, flex: 1 }]} numberOfLines={1}>
              订单 {item.orderId.length > 16 ? item.orderId.slice(0, 16) + '...' : item.orderId}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '18', borderRadius: radius.pill }]}>
              <Text style={[typography.captionSm, { color: statusColor }]}>
                {invoiceStatusLabels[item.status]}
              </Text>
            </View>
          </View>

          {/* 抬头名称 */}
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 8 }]} numberOfLines={1}>
            {item.profileSnapshot.title}
          </Text>

          {/* 抬头类型 + 申请时间 */}
          <View style={styles.cardMeta}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>
              {item.profileSnapshot.type === 'PERSONAL' ? '个人' : '企业'} · {item.requestedAt || item.createdAt}
            </Text>
            {item.status === 'REQUESTED' && (
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                系统正在自动开票
              </Text>
            )}
          </View>

          {/* 操作按钮 */}
          <View style={styles.cardFooter}>
            {item.status === 'ISSUED' && item.pdfUrl ? (
              <Pressable
                onPress={() => openPdf(item.pdfUrl)}
                style={[styles.actionBtn, { borderColor: colors.brand.primary, borderRadius: radius.pill }]}
              >
                <Text style={[typography.caption, { color: colors.brand.primary, fontWeight: '600' }]}>查看发票</Text>
              </Pressable>
            ) : null}
            {item.status === 'REQUESTED' ? (
              <Pressable
                onPress={() => handleCancel(item)}
                disabled={isCanceling}
                style={[styles.actionBtn, { borderColor: colors.danger, borderRadius: radius.pill, opacity: isCanceling ? 0.5 : 1 }]}
              >
                <Text style={[typography.caption, { color: colors.danger, fontWeight: '600' }]}>
                  {isCanceling ? '取消中...' : '取消申请'}
                </Text>
              </Pressable>
            ) : null}
            {item.status === 'FAILED' ? (
              <Text style={[typography.caption, { color: colors.danger }]}>开票失败，请联系客服</Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    );
  }, [colors, radius, shadow, typography, cancelingId, handleCancel, openPdf, router]);

  const keyExtractor = useCallback((item: Invoice) => item.id, []);

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="我的发票" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={120} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={120} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={120} radius={radius.lg} />
        </View>
      ) : (listError as AppError | null) ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="发票加载失败"
            description={listError?.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        </View>
      ) : invoices.length === 0 ? (
        // flex:1 让空态填满剩余空间，否则底部"管理发票抬头"按钮会贴在空态下方（页面中部）
        <View style={{ flex: 1, padding: spacing.xl }}>
          <EmptyState title="暂无发票记录" description="完成订单后可申请开票" />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={invoices}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        />
      )}

      {/* 底部入口：管理发票抬头 */}
      <Pressable
        onPress={() => router.push('/invoices/profiles')}
        style={[
          styles.bottomBtn,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            paddingBottom: 14 + bottomPadding,
          },
        ]}
      >
        <Text {...compactActionTextProps} style={[typography.bodySm, { color: colors.accent.blue }]}>
          管理发票抬头
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cardMeta: {
    marginTop: 6,
  },
  cardFooter: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  actionBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginLeft: 8,
  },
  bottomBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
});
