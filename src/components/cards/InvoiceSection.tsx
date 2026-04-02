import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { Invoice, InvoiceStatus, OrderStatus } from '../../types';

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

// 允许申请发票的订单状态（已收货 / 已完成）
const canRequestInvoice = (orderStatus: OrderStatus): boolean =>
  orderStatus === 'delivered' || orderStatus === 'completed';

type InvoiceSectionProps = {
  orderId: string;
  orderStatus: OrderStatus;
  invoice?: Invoice;
};

/**
 * 发票区块组件 — 用于订单详情页
 *
 * - 无发票且订单已收货/完成：显示"申请发票"按钮
 * - 有发票：显示发票状态
 * - ISSUED：显示"查看发票"链接
 * - REQUESTED：显示"取消申请"链接
 */
export const InvoiceSection = ({ orderId, orderStatus, invoice }: InvoiceSectionProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();

  // 无发票时判断是否可以申请
  if (!invoice) {
    if (!canRequestInvoice(orderStatus)) return null;
    return (
      <View style={[styles.container, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
        <View style={styles.row}>
          <Text style={[typography.bodySm, { color: colors.text.primary }]}>发票</Text>
          <Pressable
            onPress={() => router.push({ pathname: '/invoices/request', params: { orderId } })}
            style={[styles.btn, { borderColor: colors.brand.primary, borderRadius: radius.pill }]}
          >
            <Text style={[typography.caption, { color: colors.brand.primary, fontWeight: '600' }]}>申请发票</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // 有发票记录
  const statusColor = getStatusColor(invoice.status, colors);
  return (
    <View style={[styles.container, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
      <View style={styles.row}>
        <Text style={[typography.bodySm, { color: colors.text.primary }]}>发票</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '18', borderRadius: radius.pill }]}>
          <Text style={[typography.captionSm, { color: statusColor }]}>
            {invoiceStatusLabels[invoice.status]}
          </Text>
        </View>
      </View>

      {/* 抬头信息 */}
      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
        {invoice.profileSnapshot.type === 'PERSONAL' ? '个人' : '企业'} · {invoice.profileSnapshot.title}
      </Text>

      {/* 操作链接 */}
      <View style={styles.actionRow}>
        {invoice.status === 'ISSUED' && invoice.pdfUrl ? (
          <Pressable
            onPress={() => router.push({ pathname: '/invoices/[id]' as any, params: { id: invoice.id } })}
            style={{ marginTop: 8 }}
          >
            <Text style={[typography.caption, { color: colors.accent.blue, fontWeight: '600' }]}>查看发票</Text>
          </Pressable>
        ) : null}
        {invoice.status === 'REQUESTED' ? (
          <Pressable
            onPress={() => router.push({ pathname: '/invoices/[id]' as any, params: { id: invoice.id } })}
            style={{ marginTop: 8 }}
          >
            <Text style={[typography.caption, { color: colors.danger, fontWeight: '600' }]}>取消申请</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
