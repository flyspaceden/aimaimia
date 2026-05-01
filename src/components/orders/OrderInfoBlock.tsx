import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';

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

function formatTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function OrderInfoBlock({ orderId, createdAt, paidAt, shippedAt, deliveredAt, paymentMethod, buyerNote, isVipPackage, onApplyInvoice }: Props) {
  const { colors, radius, typography } = useTheme();
  const { show } = useToast();

  const handleCopy = async () => {
    await Clipboard.setStringAsync(orderId);
    show({ message: '已复制', type: 'success' });
  };

  const Row = ({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) => (
    <View style={styles.row}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[typography.caption, { color: colors.text.primary }]}>{value}</Text>
        {action}
      </View>
    </View>
  );

  return (
    <View>
      <Row label="订单号" value={orderId} action={
        <Pressable onPress={handleCopy} style={[styles.copyBtn, { backgroundColor: colors.muted, borderRadius: radius.sm }]}>
          <Text style={[typography.caption, { color: colors.text.secondary, fontSize: 10 }]}>复制</Text>
        </Pressable>
      } />
      <Row label="下单时间" value={formatTime(createdAt)} />
      {paidAt ? <Row label="付款时间" value={formatTime(paidAt)} /> : null}
      {shippedAt ? <Row label="发货时间" value={formatTime(shippedAt)} /> : null}
      {deliveredAt ? <Row label="送达时间" value={formatTime(deliveredAt)} /> : null}
      {paymentMethod ? <Row label="付款方式" value={PAY_LABEL[paymentMethod] ?? paymentMethod} /> : null}
      {buyerNote ? <Row label="买家留言" value={buyerNote} /> : null}
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
  copyBtn: { paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 },
});
