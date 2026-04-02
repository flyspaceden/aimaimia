import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';

type SearchBarProps = {
  placeholder?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

// 搜索条：用于跳转搜索页的入口
export const SearchBar = ({ placeholder = '搜索农产品/企业', onPress, style }: SearchBarProps) => {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <Text style={[typography.body, { color: colors.muted }]}>{placeholder}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
  },
});
