import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

type StatusPillProps = {
  label: string;
  tone?: 'brand' | 'accent' | 'neutral';
  style?: StyleProp<ViewStyle>;
};

// 状态胶囊：用于展示状态标签（公共组件需中文注释）
export const StatusPill = ({ label, tone = 'brand', style }: StatusPillProps) => {
  const { colors, radius, typography } = useTheme();

  const toneStyle = {
    brand: { backgroundColor: colors.brand.primarySoft, color: colors.brand.primary },
    accent: { backgroundColor: colors.accent.blueSoft, color: colors.accent.blue },
    neutral: { backgroundColor: colors.border, color: colors.text.secondary },
  }[tone];

  return (
    <View style={[styles.pill, { borderRadius: radius.pill, backgroundColor: toneStyle.backgroundColor }, style]}>
      <Text style={[typography.caption, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
