import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { CsMessage } from '../../types';

interface CsMessageBubbleProps {
  message: CsMessage;
  /** 是否显示时间戳（通常每组消息首条显示） */
  showTimestamp?: boolean;
}

/**
 * 客服聊天气泡
 * - USER: 右对齐品牌绿气泡 + 发送状态图标（U2）
 * - AI: 左对齐，绿色机器人头像
 * - AGENT: 左对齐，靛蓝色首字母头像
 * - SYSTEM: 居中灰色标签
 * - 时间戳显示（U11）：showTimestamp=true 时在气泡上方居中显示
 */
export function CsMessageBubble({ message, showTimestamp }: CsMessageBubbleProps) {
  const { colors, radius, typography, shadow, spacing } = useTheme();

  const status = (message as any)._status as 'sending' | 'sent' | 'failed' | undefined;

  const renderTimestamp = () => {
    if (!showTimestamp || !message.createdAt) return null;
    return (
      <View style={styles.timestampRow}>
        <Text style={[typography.caption, { color: colors.text.tertiary, fontSize: 11 }]}>
          {formatRelativeTime(message.createdAt)}
        </Text>
      </View>
    );
  };

  // 系统消息：居中灰色标签
  if (message.senderType === 'SYSTEM') {
    return (
      <>
        {renderTimestamp()}
        <Animated.View entering={FadeInDown.duration(200)} style={styles.systemRow}>
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
      </>
    );
  }

  // 用户消息：右对齐，品牌绿色背景 + 发送状态
  if (message.senderType === 'USER') {
    return (
      <>
        {renderTimestamp()}
        <Animated.View
          entering={FadeInDown.duration(250)}
          style={[styles.row, { justifyContent: 'flex-end' }]}
        >
          {/* U2: 发送状态图标（在气泡左侧） */}
          <View style={styles.statusIcon}>
            {status === 'sending' && (
              <MaterialCommunityIcons name="clock-outline" size={14} color={colors.text.tertiary} />
            )}
            {status === 'failed' && (
              <MaterialCommunityIcons name="alert-circle" size={14} color="#EF4444" />
            )}
            {(status === 'sent' || !status) && (
              <MaterialCommunityIcons name="check" size={14} color={colors.text.tertiary} />
            )}
          </View>
          <View
            style={[
              styles.userBubble,
              shadow.sm,
              {
                backgroundColor: '#2E7D32',
                borderRadius: radius.lg,
                borderBottomRightRadius: 4,
                opacity: status === 'sending' ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[typography.body, { color: '#FFFFFF' }]}>{message.content}</Text>
          </View>
        </Animated.View>
      </>
    );
  }

  // AI 消息：左对齐，绿色圆形机器人图标头像
  if (message.senderType === 'AI') {
    return (
      <>
        {renderTimestamp()}
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
            <Text style={[typography.body, { color: colors.text.primary }]}>{message.content}</Text>
          </View>
        </Animated.View>
      </>
    );
  }

  // AGENT 消息：左对齐，靛蓝色圆形头像
  const agentInitial = message.senderId ? message.senderId.charAt(0).toUpperCase() : '客';
  return (
    <>
      {renderTimestamp()}
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
          <Text style={[typography.body, { color: colors.text.primary }]}>{message.content}</Text>
        </View>
      </Animated.View>
    </>
  );
}

/**
 * U11: 格式化相对时间
 * - < 1 分钟 → "刚刚"
 * - < 1 小时 → "N 分钟前"
 * - 今天 → "HH:mm"
 * - 昨天 → "昨天 HH:mm"
 * - 今年 → "MM-DD HH:mm"
 * - 其他 → "YYYY-MM-DD HH:mm"
 */
function formatRelativeTime(iso: string): string {
  const now = new Date();
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const isToday =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  const hh = then.getHours().toString().padStart(2, '0');
  const mm = then.getMinutes().toString().padStart(2, '0');

  if (isToday) return `${hh}:${mm}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === then.getFullYear() &&
    yesterday.getMonth() === then.getMonth() &&
    yesterday.getDate() === then.getDate();
  if (isYesterday) return `昨天 ${hh}:${mm}`;

  const month = (then.getMonth() + 1).toString().padStart(2, '0');
  const day = then.getDate().toString().padStart(2, '0');
  if (now.getFullYear() === then.getFullYear()) return `${month}-${day} ${hh}:${mm}`;

  return `${then.getFullYear()}-${month}-${day} ${hh}:${mm}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 4,
    alignItems: 'flex-end',
  },
  timestampRow: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 6,
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
  statusIcon: {
    width: 20,
    marginRight: 4,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  userBubble: {
    maxWidth: '72%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  otherBubble: {
    maxWidth: '72%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
