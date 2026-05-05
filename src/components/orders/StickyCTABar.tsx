import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBottomInset, useTheme } from '../../theme';

interface CTAItem {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface Props {
  primary?: CTAItem;
  secondary?: CTAItem[];
}

// 订单详情/售后/售后详情共用底部 CTA 栏
// 必须吃底部 safe area，否则在 iOS home indicator / Android 虚拟键设备上
// 按钮会贴在系统栏上，影响点击。
// 详见 docs/architecture/responsive-design.md §3.3 / 原则 3
export function StickyCTABar({ primary, secondary }: Props) {
  const { colors, radius, typography } = useTheme();
  const paddingBottom = useBottomInset(10);
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom },
      ]}
    >
      {(secondary || []).map((cta, i) => (
        <Pressable key={i} onPress={cta.onPress} style={[styles.btn, { borderColor: colors.border, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>{cta.label}</Text>
        </Pressable>
      ))}
      {primary ? (
        <Pressable onPress={primary.onPress} style={[styles.btnPrimary, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}>
          <Text style={[typography.caption, { color: colors.text.inverse, fontWeight: '600' }]}>{primary.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  btn: { paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1 },
  btnPrimary: { paddingHorizontal: 18, paddingVertical: 8 },
});
