import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface Props {
  goodsAmount: number;
  shippingFee: number;
  vipDiscountAmount?: number;
  discountAmount?: number;
  totalCouponDiscount?: number;
  totalPrice: number;
}

export function AmountSummary({ goodsAmount, shippingFee, vipDiscountAmount, discountAmount, totalCouponDiscount, totalPrice }: Props) {
  const { colors, typography } = useTheme();
  const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <View style={styles.row}>
      <Text style={[typography.bodySm, { color: colors.text.secondary }]}>{label}</Text>
      <Text style={[typography.bodySm, { color: color || colors.text.primary }]}>{value}</Text>
    </View>
  );
  return (
    <View>
      <Row label="商品金额" value={`¥${goodsAmount.toFixed(2)}`} />
      <Row label="运费" value={shippingFee === 0 ? '免运费' : `¥${shippingFee.toFixed(2)}`} color={shippingFee === 0 ? colors.brand.primary : undefined} />
      {vipDiscountAmount && vipDiscountAmount > 0 ? <Row label="VIP折扣" value={`-¥${vipDiscountAmount.toFixed(2)}`} color={colors.brand.primary} /> : null}
      {discountAmount && discountAmount > 0 ? <Row label="奖励抵扣" value={`-¥${discountAmount.toFixed(2)}`} color={colors.brand.primary} /> : null}
      {totalCouponDiscount && totalCouponDiscount > 0 ? <Row label="红包抵扣" value={`-¥${totalCouponDiscount.toFixed(2)}`} color={colors.danger} /> : null}
      <View style={[styles.row, { marginTop: 8 }]}>
        <Text style={[typography.body, { color: colors.text.secondary }]}>实付</Text>
        <Text style={[typography.title3, { color: '#FF6B35', fontWeight: '600' }]}>¥{totalPrice.toFixed(2)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
