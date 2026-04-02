import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

type BadgeProps = {
  value: number;
  style?: StyleProp<ViewStyle>;
};

// 角标：用于购物车数量/状态提示
export const Badge = ({ value, style }: BadgeProps) => {
  const { colors, typography } = useTheme();

  if (value <= 0) {
    return null;
  }

  const display = value > 99 ? '99+' : String(value);

  return (
    <View style={[styles.badge, { backgroundColor: colors.danger }, style]}>
      <Text style={[typography.caption, { color: colors.text.inverse }]}>{display}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
