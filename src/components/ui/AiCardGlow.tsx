import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';

interface AiCardGlowProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// AI 卡片辉光包裹器：左侧 2px 渐变条 + 内容
// 使用绝对定位渐变条，避免 flexDirection: 'row' 在 React Native Yoga 中导致内容区宽度坍缩
export function AiCardGlow({ children, style }: AiCardGlowProps) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={[
        {
          borderRadius: radius.lg,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* 左侧 AI 渐变条（绝对定位） */}
      <LinearGradient
        colors={[colors.ai.start, colors.ai.end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2 }}
      />
      {/* 内容区，左侧留 2px 给渐变条 */}
      <View style={{ marginLeft: 2 }}>{children}</View>
    </View>
  );
}
