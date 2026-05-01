import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface CTAItem {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface Props {
  primary?: CTAItem;
  secondary?: CTAItem[];
}

export function StickyCTABar({ primary, secondary }: Props) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
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
  bar: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', padding: 10, borderTopWidth: 1, gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1 },
  btnPrimary: { paddingHorizontal: 18, paddingVertical: 8 },
});
