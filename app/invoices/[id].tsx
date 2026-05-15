import React, { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { InvoiceRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useBottomInset, useTheme } from '../../src/theme';
import { InvoiceStatus } from '../../src/types';

// 发票状态标签映射
const statusLabels: Record<InvoiceStatus, string> = {
  REQUESTED: '待开票',
  ISSUED: '已开票',
  FAILED: '开票失败',
  CANCELED: '已取消',
};

const getStatusColor = (status: InvoiceStatus, colors: any): string => {
  switch (status) {
    case 'REQUESTED': return colors.warning;
    case 'ISSUED': return colors.success;
    case 'FAILED': return colors.danger;
    case 'CANCELED': return colors.muted;
    default: return colors.text.secondary;
  }
};

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  // R-RS07: ScrollView paddingBottom 吃 safe area inset + Android OEM 兜底
  const safeBottom = useBottomInset(spacing['3xl']);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['invoice-detail', id],
    queryFn: () => InvoiceRepo.getInvoiceDetail(id!),
    enabled: isLoggedIn && !!id,
  });

  const invoice = data?.ok ? data.data : null;
  const error = data && !data.ok ? data.error : null;

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

  // 取消申请
  const handleCancel = useCallback(() => {
    if (!invoice) return;
    Alert.alert('取消申请', '确认取消此开票申请？', [
      { text: '再想想', style: 'cancel' },
      {
        text: '确认取消',
        style: 'destructive',
        onPress: async () => {
          const result = await InvoiceRepo.cancelInvoice(invoice.id);
          if (!result.ok) {
            show({ message: result.error.displayMessage ?? '取消失败', type: 'error' });
            return;
          }
          show({ message: '已取消开票申请', type: 'success' });
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
          queryClient.invalidateQueries({ queryKey: ['invoice-detail', invoice.id] });
          queryClient.invalidateQueries({ queryKey: ['order', invoice.orderId] });
          queryClient.invalidateQueries({ queryKey: ['orders'] });
          router.back();
        },
      },
    ]);
  }, [invoice, show, queryClient, router]);

  // 加载态
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="发票详情" showBack />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={200} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={120} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  // 错误态
  if (error || !invoice) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="发票详情" showBack />
        <ErrorState title={error?.displayMessage ?? '加载失败'} onAction={refetch} />
      </Screen>
    );
  }

  const statusColor = getStatusColor(invoice.status, colors);
  const snapshot = invoice.profileSnapshot;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="发票详情" showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: safeBottom }}>
        {/* 状态卡片 */}
        <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <View style={styles.row}>
            <Text style={[typography.headingSm, { color: colors.text.primary }]}>发票状态</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '18', borderRadius: radius.pill }]}>
              <Text style={[typography.bodySm, { color: statusColor, fontWeight: '600' }]}>
                {statusLabels[invoice.status]}
              </Text>
            </View>
          </View>
          {invoice.invoiceNo && (
            <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: 8 }]}>
              发票号码：{invoice.invoiceNo}
            </Text>
          )}
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            申请时间：{invoice.requestedAt || invoice.createdAt}
          </Text>
          {invoice.issuedAt && (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              开票时间：{invoice.issuedAt}
            </Text>
          )}
          {invoice.failReason && (
            <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>
              失败原因：{invoice.failReason}
            </Text>
          )}
        </View>

        {/* 抬头信息 */}
        <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.md }]}>
          <Text style={[typography.headingSm, { color: colors.text.primary, marginBottom: 10 }]}>发票抬头</Text>
          <InfoRow label="类型" value={snapshot.type === 'PERSONAL' ? '个人' : '企业'} colors={colors} typography={typography} />
          <InfoRow label="抬头" value={snapshot.title} colors={colors} typography={typography} />
          {snapshot.taxNo && <InfoRow label="税号" value={snapshot.taxNo} colors={colors} typography={typography} />}
          {snapshot.email && <InfoRow label="邮箱" value={snapshot.email} colors={colors} typography={typography} />}
          {snapshot.phone && <InfoRow label="手机" value={snapshot.phone} colors={colors} typography={typography} />}
          {snapshot.bankInfo?.bankName && (
            <InfoRow label="开户行" value={snapshot.bankInfo.bankName} colors={colors} typography={typography} />
          )}
          {snapshot.bankInfo?.accountNo && (
            <InfoRow label="账号" value={snapshot.bankInfo.accountNo} colors={colors} typography={typography} />
          )}
          {snapshot.address && <InfoRow label="地址" value={snapshot.address} colors={colors} typography={typography} />}
        </View>

        {/* 关联订单 */}
        <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.md }]}>
          <Text style={[typography.headingSm, { color: colors.text.primary, marginBottom: 10 }]}>关联订单</Text>
          <InfoRow label="订单号" value={invoice.orderId} colors={colors} typography={typography} />
        </View>

        {/* 查看 PDF */}
        {invoice.status === 'ISSUED' && invoice.pdfUrl && (
          <Pressable
            onPress={() => openPdf(invoice.pdfUrl)}
            style={[styles.primaryBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.lg, marginTop: spacing.lg }]}
          >
            <Text style={[typography.body, { color: '#fff', fontWeight: '600', textAlign: 'center' }]}>查看电子发票</Text>
          </Pressable>
        )}

        {/* 取消申请 */}
        {invoice.status === 'REQUESTED' && (
          <Pressable
            onPress={handleCancel}
            style={[styles.dangerBtn, { borderColor: colors.danger, borderRadius: radius.lg, marginTop: spacing.md }]}
          >
            <Text style={[typography.body, { color: colors.danger, fontWeight: '600', textAlign: 'center' }]}>取消申请</Text>
          </Pressable>
        )}

        <View style={{ height: spacing['2xl'] }} />
      </ScrollView>
    </Screen>
  );
}

/** 信息行 */
function InfoRow({ label, value, colors, typography }: { label: string; value: string; colors: any; typography: any }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[typography.caption, { color: colors.text.secondary, width: 60 }]}>{label}</Text>
      <Text style={[typography.bodySm, { color: colors.text.primary, flex: 1 }]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 },
  primaryBtn: { paddingVertical: 14 },
  dangerBtn: { paddingVertical: 14, borderWidth: 1 },
});
