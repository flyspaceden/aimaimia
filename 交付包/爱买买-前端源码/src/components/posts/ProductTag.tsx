import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

type ProductTagProps = {
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

// 商品浮层标签：用于帖子图片上的“即看即买”入口（公共组件需中文注释）
export const ProductTag = ({ label, onPress, style }: ProductTagProps) => {
  const { colors, radius, typography } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tag,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.pill,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <MaterialCommunityIcons name="shopping-outline" size={14} color={colors.brand.primary} />
      <Text style={[typography.caption, { color: colors.text.primary, marginLeft: 6 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  tag: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
