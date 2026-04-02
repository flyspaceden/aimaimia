import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

type IconButtonProps = {
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

// 图标按钮：用于头部/卡片的轻量交互入口
export const IconButton = ({ label, onPress, style, textStyle }: IconButtonProps) => {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.button,
        {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radius.pill,
          backgroundColor: colors.brand.primarySoft,
        },
        style,
      ]}
    >
      <Text style={[typography.bodyStrong, { color: colors.brand.primary }, textStyle]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
