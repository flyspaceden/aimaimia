import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { CsMessage } from '../../types';

interface CsMessageBubbleProps {
  message: CsMessage;
}

// 客服聊天气泡：根据 senderType 渲染不同样式
// USER: 右对齐绿色气泡 | AI: 左对齐机器人头像 | AGENT: 左对齐客服头像 | SYSTEM: 居中标签
export function CsMessageBubble({ message }: CsMessageBubbleProps) {
  const { colors, radius, typography, shadow, spacing } = useTheme();

  // 系统消息：居中灰色标签
  if (message.senderType === 'SYSTEM') {
    return (
      <Animated.View
        entering={FadeInDown.duration(200)}
        style={styles.systemRow}
      >
        <View
          style={[
            styles.systemBadge,
            {
              backgroundColor: colors.bgSecondary,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            },
          ]}
        >
          <Text style={[typography.caption, { color: colors.text.tertiary }]}>
            {message.content}
          </Text>
        </View>
      </Animated.View>
    );
  }

  // 用户消息：右对齐，品牌绿色背景
  if (message.senderType === 'USER') {
    return (
      <Animated.View
        entering={FadeInDown.duration(250)}
        style={[styles.row, { justifyContent: 'flex-end' }]}
      >
        <View
          style={[
            styles.userBubble,
            shadow.sm,
            {
              backgroundColor: '#2E7D32',
              borderRadius: radius.lg,
              borderBottomRightRadius: 4,
            },
          ]}
        >
          <Text style={[typography.body, { color: '#FFFFFF' }]}>
            {message.content}
          </Text>
        </View>
      </Animated.View>
    );
  }

  // AI 消息：左对齐，绿色圆形机器人图标头像
  if (message.senderType === 'AI') {
    return (
      <Animated.View
        entering={FadeInDown.duration(250)}
        style={[styles.row, { justifyContent: 'flex-start' }]}
      >
        <View style={[styles.avatar, { backgroundColor: '#E8F5E9' }]}>
          <MaterialCommunityIcons name="robot-outline" size={18} color="#2E7D32" />
        </View>
        <View
          style={[
            styles.otherBubble,
            shadow.sm,
            {
              backgroundColor: colors.bgSecondary,
              borderRadius: radius.lg,
              borderBottomLeftRadius: 4,
            },
          ]}
        >
          <Text style={[typography.body, { color: colors.text.primary }]}>
            {message.content}
          </Text>
        </View>
      </Animated.View>
    );
  }

  // AGENT 消息：左对齐，靛蓝色圆形头像带客服首字母
  const agentInitial = message.senderId ? message.senderId.charAt(0).toUpperCase() : '客';
  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      style={[styles.row, { justifyContent: 'flex-start' }]}
    >
      <View style={[styles.avatar, { backgroundColor: '#E8EAF6' }]}>
        <Text style={[typography.caption, { color: '#3F51B5', fontWeight: '700' }]}>
          {agentInitial}
        </Text>
      </View>
      <View
        style={[
          styles.otherBubble,
          shadow.sm,
          {
            backgroundColor: colors.bgSecondary,
            borderRadius: radius.lg,
            borderBottomLeftRadius: 4,
            borderWidth: 1,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[typography.body, { color: colors.text.primary }]}>
          {message.content}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 4,
    alignItems: 'flex-end',
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: 12,
  },
  systemBadge: {
    alignSelf: 'center',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  userBubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  otherBubble: {
    maxWidth: '72%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
