import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { OrderNoReveal } from './OrderNoReveal';

interface Props {
  orderId: string;
  createdAt: string;
  paidAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  paymentMethod?: 'wechat' | 'alipay' | 'bankcard' | null;
  buyerNote?: string;
  isVipPackage?: boolean;
  onApplyInvoice?: () => void;
}

const PAY_LABEL: Record<string, string> = { wechat: '微信支付', alipay: '支付宝', bankcard: '银行卡' };

function formatTime(value?: string) {
  if (!value) return '—';
  // 后端 createdAt 可能是 "YYYY-MM-DD HH:mm" 已格式化字符串（非 ISO），直接返回
  // 后端 paidAt/shippedAt/deliveredAt 是 ISO 字符串，按 ISO 解析
  const looksFormatted = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value);
  if (looksFormatted && !value.includes('T')) {
    // 已是 "YYYY-MM-DD HH:mm" 格式
    return value;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;  // fallback：解析失败原样返回
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function OrderInfoBlock({ orderId, createdAt, paidAt, shippedAt, deliveredAt, paymentMethod, buyerNote, isVipPackage, onApplyInvoice }: Props) {
  const { colors, typography } = useTheme();

  const Row = ({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) => {
    const valueIsText = typeof value === 'string' || typeof value === 'number';
    return (
      <View style={styles.row}>
        <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
        <View style={styles.rowRight}>
          {valueIsText ? (
            <Text style={[typography.caption, { color: colors.text.primary }]}>{value}</Text>
          ) : (
            value
          )}
          {action}
        </View>
      </View>
    );
  };

  return (
    <View>
      <Row label="订单号" value={<OrderNoReveal orderNo={orderId} />} />
      <Row label="下单时间" value={formatTime(createdAt)} />
      {paidAt ? <Row label="付款时间" value={formatTime(paidAt)} /> : null}
      {shippedAt ? <Row label="发货时间" value={formatTime(shippedAt)} /> : null}
      {deliveredAt ? <Row label="送达时间" value={formatTime(deliveredAt)} /> : null}
      {paymentMethod ? <Row label="付款方式" value={PAY_LABEL[paymentMethod] ?? paymentMethod} /> : null}
      {buyerNote ? (
        <View style={styles.noteBlock}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>买家留言</Text>
          <Text style={[typography.caption, { color: colors.text.primary, marginTop: 4, lineHeight: 18 }]}>
            {buyerNote}
          </Text>
        </View>
      ) : null}
      {!isVipPackage && onApplyInvoice ? (
        <Row label="发票" value={
          <Pressable onPress={onApplyInvoice}>
            <Text style={[typography.caption, { color: colors.accent.blue }]}>申请发票 ›</Text>
          </Pressable>
        } />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
});
