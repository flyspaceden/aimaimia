import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

type TagProps = {
  label: string;
  tone?: 'brand' | 'accent' | 'neutral';
  style?: StyleProp<ViewStyle>;
};

// 标签组件：用于展示可信/品类等轻量信息
export const Tag = ({ label, tone = 'brand', style }: TagProps) => {
  const { colors, radius, spacing, typography } = useTheme();

  const toneStyle = {
    brand: { backgroundColor: colors.brand.primarySoft, color: colors.brand.primary },
    accent: { backgroundColor: colors.accent.blueSoft, color: colors.accent.blue },
    neutral: { backgroundColor: colors.border, color: colors.text.secondary },
  }[tone];

  return (
    <View style={[styles.tag, { borderRadius: radius.pill, paddingHorizontal: spacing.sm }, style, { backgroundColor: toneStyle.backgroundColor }]}>
      <Text style={[typography.caption, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  tag: {
    paddingVertical: 4,
  },
});
