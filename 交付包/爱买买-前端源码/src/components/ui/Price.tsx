import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { formatPrice } from '../../utils';

type PriceProps = {
  value: number;
  unit?: string;
  strikeValue?: number;
  style?: StyleProp<ViewStyle>;
};

// 价格展示：统一货币符号与单位样式
export const Price = ({ value, unit, strikeValue, style }: PriceProps) => {
  const { colors, typography } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>¥{formatPrice(value)}</Text>
      {unit ? (
        <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 4 }]}>/{unit}</Text>
      ) : null}
      {typeof strikeValue === 'number' ? (
        <Text style={[typography.caption, styles.strike, { color: colors.muted }]}>¥{formatPrice(strikeValue)}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  strike: {
    marginLeft: 6,
    textDecorationLine: 'line-through',
  },
});
