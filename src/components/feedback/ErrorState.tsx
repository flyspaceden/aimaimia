import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

type ErrorStateProps = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// 错误状态：用于请求失败或异常页面
export const ErrorState = ({
  title = '加载失败',
  description = '请稍后重试',
  actionLabel = '重新加载',
  onAction,
}: ErrorStateProps) => {
  const { colors, spacing, typography, radius } = useTheme();

  return (
    <View style={[styles.container, { padding: spacing.xl }]} accessibilityRole="alert">
      <Text style={[typography.title3, { color: colors.text.primary }]}>{title}</Text>
      <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}> 
        {description}
      </Text>
      {onAction ? (
        <Pressable
          onPress={onAction}
          style={[
            styles.action,
            {
              marginTop: spacing.lg,
              borderColor: colors.brand.primary,
              borderWidth: 1,
              borderRadius: radius.md,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}> 
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
