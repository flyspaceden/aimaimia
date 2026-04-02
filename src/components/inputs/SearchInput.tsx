import React from 'react';
import { Pressable, StyleProp, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

type SearchInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
};

// 搜索输入框：用于页面内实时筛选（公共组件需中文注释）
export const SearchInput = ({ value, onChangeText, placeholder = '搜索企业/城市/认证/距离', style }: SearchInputProps) => {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
        },
        style,
      ]}
    >
      <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, typography.body, { color: colors.text.primary }]}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} style={styles.clear}>
          <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    marginLeft: 8,
    paddingVertical: 0,
  },
  clear: {
    marginLeft: 8,
  },
});
