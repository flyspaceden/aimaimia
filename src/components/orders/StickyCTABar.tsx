import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { compactActionTextProps, useBottomInset, useResponsiveLayout, useTheme } from '../../theme';

interface CTAItem {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

interface Props {
  primary?: CTAItem;
  secondary?: CTAItem[];
  onHeightChange?: (height: number) => void;
}

// 订单详情/售后/售后详情共用底部 CTA 栏
// 必须吃底部 safe area，否则在 iOS home indicator / Android 虚拟键设备上
// 按钮会贴在系统栏上，影响点击。
// 详见 docs/architecture/responsive-design.md §3.3 / 原则 3
export function StickyCTABar({ primary, secondary, onHeightChange }: Props) {
  const { colors, radius, typography } = useTheme();
  const { isCompact, isLargeText } = useResponsiveLayout();
  const compact = isCompact || isLargeText;
  const paddingBottom = useBottomInset(10);
  const lastHeightRef = React.useRef(0);

  const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0 && Math.abs(lastHeightRef.current - nextHeight) > 1) {
      lastHeightRef.current = nextHeight;
      onHeightChange?.(nextHeight);
    }
  }, [onHeightChange]);

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.bar,
        compact && styles.barCompact,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom },
      ]}
    >
      {(secondary || []).map((cta, i) => (
        <Pressable
          key={i}
          onPress={cta.onPress}
          disabled={cta.disabled}
          accessibilityState={{ disabled: !!cta.disabled }}
          style={[
            styles.btn,
            { borderColor: colors.border, borderRadius: radius.pill },
            cta.disabled && styles.disabled,
          ]}
        >
          <Text {...compactActionTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
            {cta.label}
          </Text>
        </Pressable>
      ))}
      {primary ? (
        <Pressable
          onPress={primary.onPress}
          disabled={primary.disabled}
          accessibilityState={{ disabled: !!primary.disabled }}
          style={[
            styles.btnPrimary,
            { backgroundColor: colors.brand.primary, borderRadius: radius.pill },
            primary.disabled && styles.disabled,
          ]}
        >
          <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
            {primary.label}
          </Text>
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
  barCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  btn: { minHeight: 36, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { minHeight: 40, paddingHorizontal: 18, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
