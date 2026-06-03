import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Countdown } from '../ui/Countdown';
import { useTheme } from '../../theme';
import { OrderStatus } from '../../types';

interface Props {
  status: OrderStatus;
  isVipPackage?: boolean;
  subtitle?: string;
  countdownExpiresAt?: string;
  countdownPrefix?: string;
}

const STATUS_GRADIENTS: Record<OrderStatus, [string, string]> = {
  PAID: ['#3B82F6', '#60A5FA'],
  SHIPPED: ['#3B82F6', '#60A5FA'],
  DELIVERED: ['#3B82F6', '#60A5FA'],
  RECEIVED: ['#2E7D32', '#4CAF50'],
  CANCELED: ['#9CA3AF', '#D1D5DB'],
  REFUNDED: ['#DC2626', '#EF4444'],
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  PAID: '待发货',
  SHIPPED: '已发货',
  DELIVERED: '待收货',
  RECEIVED: '已完成',
  CANCELED: '已取消',
  REFUNDED: '已退款',
};

export function StatusHero({ status, isVipPackage, subtitle, countdownExpiresAt, countdownPrefix }: Props) {
  const { typography } = useTheme();
  const [from, to] = STATUS_GRADIENTS[status];

  return (
    <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.container}>
      <View style={styles.row}>
        <Text style={[typography.title3, { color: '#fff' }]}>{STATUS_LABEL[status]}</Text>
        {isVipPackage ? (
          <View style={styles.vipBadge}>
            <Text style={styles.vipBadgeText}>VIP 开通礼包</Text>
          </View>
        ) : null}
      </View>
      {countdownExpiresAt ? (
        <Countdown
          expiresAt={countdownExpiresAt}
          format={status === 'DELIVERED' ? 'days' : 'mm:ss'}
          prefix={countdownPrefix}
          style={[typography.caption, { color: 'rgba(255,255,255,0.9)', marginTop: 4 }]}
        />
      ) : null}
      {subtitle ? (
        <Text style={[typography.caption, { color: 'rgba(255,255,255,0.85)', marginTop: 2 }]}>{subtitle}</Text>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 18, paddingVertical: 18 },
  row: { flexDirection: 'row', alignItems: 'center' },
  vipBadge: { marginLeft: 8, backgroundColor: '#C9A96E', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  vipBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
});
