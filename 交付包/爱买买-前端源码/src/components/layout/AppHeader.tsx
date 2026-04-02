import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  tone?: 'light' | 'dark';
  showBack?: boolean;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

// 顶部标题栏：统一返回/标题/右侧操作区（公共组件需中文注释）
export const AppHeader = ({
  title,
  subtitle,
  tone = 'dark',
  showBack = true,
  onBack,
  rightSlot,
  leftSlot,
  style,
}: AppHeaderProps) => {
  const { colors, typography } = useTheme();
  const router = useRouter();
  const isLight = tone === 'light';
  const textColor = isLight ? colors.text.inverse : colors.text.primary;
  const secondaryColor = isLight ? colors.text.inverse : colors.text.secondary;
  const iconColor = textColor;

  return (
    <View
      style={[
        styles.container,
        {
          borderBottomColor: isLight ? 'transparent' : colors.border,
          backgroundColor: isLight ? 'transparent' : colors.background,
        },
        style,
      ]}
    >
      <View style={styles.side}>
        {showBack ? (
          <Pressable
            onPress={() => (onBack ? onBack() : router.back())}
            hitSlop={10}
            style={styles.backButton}
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color={iconColor} />
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        {leftSlot}
      </View>

      <View style={styles.center}>
        <Text style={[typography.bodyStrong, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.caption, { color: secondaryColor, marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={[styles.side, styles.rightSide]}>{rightSlot}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
  },
  side: {
    width: 72,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rightSide: {
    justifyContent: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
