import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

type EmptyStateProps = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// 空状态：用于列表无数据或搜索无结果
export const EmptyState = ({
  title = '暂无内容',
  description = '换个筛选条件试试',
  actionLabel,
  onAction,
}: EmptyStateProps) => {
  const { colors, spacing, typography, radius } = useTheme();

  return (
    <View style={[styles.container, { padding: spacing.xl }]} accessibilityRole="alert">
      <Text style={[typography.title3, { color: colors.text.primary }]}>{title}</Text>
      <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}> 
        {description}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={[
            styles.action,
            {
              marginTop: spacing.lg,
              backgroundColor: colors.brand.primary,
              borderRadius: radius.md,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}> 
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
});
