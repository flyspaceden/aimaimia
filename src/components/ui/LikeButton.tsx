import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

type LikeButtonProps = {
  liked: boolean;
  count: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

// 点赞按钮：用于心愿/评论点赞（公共组件需中文注释）
export const LikeButton = ({ liked, count, onPress, style }: LikeButtonProps) => {
  const { colors, typography } = useTheme();

  return (
    <Pressable onPress={onPress} style={[styles.container, style]} hitSlop={8}>
      <MaterialCommunityIcons
        name={liked ? 'heart' : 'heart-outline'}
        size={16}
        color={liked ? colors.danger : colors.text.secondary}
      />
      <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 4 }]}>{count}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
