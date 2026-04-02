import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { AiChatMessageExtended, AiSuggestedAction } from '../../types';
import { AiCardGlow } from './AiCardGlow';
import { AiOrb } from '../effects/AiOrb';
import { AiTypingEffect } from '../effects/AiTypingEffect';

interface AiChatBubbleProps {
  message: AiChatMessageExtended;
  isNew?: boolean;
  onTypingComplete?: () => void;
  onFollowUpPress?: (question: string) => void;
  style?: ViewStyle;
}

// AI 聊天气泡：AI 消息带渐变左条 + mini Orb 头像，用户消息右对齐
export function AiChatBubble({ message, isNew, onTypingComplete, onFollowUpPress, style }: AiChatBubbleProps) {
  const { colors, radius, typography, shadow } = useTheme();
  const router = useRouter();
  const isUser = message.role === 'user';
  const [typingDone, setTypingDone] = useState(!isNew);

  // Phase 2: 操作类型对应的图标
  const actionIconMap: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
    search: 'magnify',
    navigate: 'compass-outline',
    company: 'store-outline',
    transaction: 'receipt',
    recommend: 'star-outline',
  };

  // Phase 2: 处理 suggestedAction 点击导航
  const handleActionPress = (action: AiSuggestedAction) => {
    const r = action.resolved || {};
    switch (action.type) {
      case 'search':
        router.push({ pathname: '/search', params: { q: r.query || action.label } });
        break;
      case 'navigate':
        if (r.target === 'cart') router.push('/cart');
        else if (r.target === 'orders') router.push('/orders');
        else if (r.target === 'discover') router.push('/(tabs)/museum');
        else if (r.target === 'me') router.push('/(tabs)/me');
        else if (r.target === 'home') router.push('/(tabs)/home');
        else if (r.target === 'checkout') router.push('/checkout');
        else if (r.target === 'settings') router.push('/settings');
        else if (r.target === 'search') router.push('/search');
        else if (r.target === 'ai-chat') router.push('/ai/chat');
        else router.push('/(tabs)/home');
        break;
      case 'company':
        if (r.companyId) router.push({ pathname: '/company/[id]', params: { id: r.companyId } });
        else router.push({ pathname: '/company/search', params: { q: r.name || action.label } });
        break;
      case 'recommend':
        router.push({
          pathname: '/ai/recommend',
          params: {
            q: r.query,
            maxPrice: r.budget?.toString(),
            constraints: r.constraints?.join(','),
          },
        });
        break;
      default:
        break;
    }
  };

  const handleTypingComplete = useCallback(() => {
    setTypingDone(true);
    onTypingComplete?.();
  }, [onTypingComplete]);

  // 用户气泡：右对齐，primarySoft 背景
  if (isUser) {
    return (
      <Animated.View
        entering={FadeInDown.duration(250)}
        style={[styles.row, { justifyContent: 'flex-end' }, style]}
      >
        <View
          style={[
            styles.userBubble,
            shadow.sm,
            {
              backgroundColor: colors.brand.primary,
              borderRadius: radius.lg,
              borderBottomRightRadius: 4,
            },
          ]}
        >
          <Text style={[typography.body, { color: colors.text.inverse }]}>
            {message.content}
          </Text>
        </View>
      </Animated.View>
    );
  }

  // AI 气泡：AiCardGlow 包裹 + mini AiOrb 头像
  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      style={[styles.row, { justifyContent: 'flex-start' }, style]}
    >
      <View style={styles.avatarCol}>
        <AiOrb size="mini" state={isNew && !typingDone ? 'thinking' : 'idle'} />
      </View>
      <View style={{ flex: 1 }}>
        <AiCardGlow
          style={[
            shadow.sm,
            {
              maxWidth: '78%',
              borderRadius: radius.lg,
              borderBottomLeftRadius: 4,
            },
          ]}
        >
          <View style={styles.aiBubbleContent}>
            {isNew && !typingDone ? (
              <AiTypingEffect
                text={message.content}
                speed={50}
                onComplete={handleTypingComplete}
                style={{ color: colors.text.primary }}
              />
            ) : (
              <Text style={[typography.body, { color: colors.text.primary }]}>
                {message.content}
              </Text>
            )}
          </View>
        </AiCardGlow>

        {/* suggestedActions 卡片 */}
        {message.suggestedActions && message.suggestedActions.length > 0 && (
          <View style={styles.actionsContainer}>
            {message.suggestedActions.map((action, index) => (
              <Pressable
                key={`action-${index}`}
                onPress={() => handleActionPress(action)}
                style={({ pressed }) => [
                  styles.actionCard,
                  {
                    backgroundColor: pressed ? colors.ai.soft : colors.bgSecondary,
                    borderColor: colors.ai.start,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={actionIconMap[action.type] || 'arrow-right'}
                  size={16}
                  color={colors.ai.start}
                />
                <Text style={[typography.caption, { color: colors.ai.start, marginLeft: 6, flex: 1 }]}>
                  {action.label}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={14} color={colors.ai.start} />
              </Pressable>
            ))}
          </View>
        )}

        {/* followUpQuestions 芯片 */}
        {message.followUpQuestions && message.followUpQuestions.length > 0 && (
          <View style={styles.followUpContainer}>
            {message.followUpQuestions.map((question, index) => (
              <Pressable
                key={`followup-${index}`}
                onPress={() => onFollowUpPress?.(question)}
                style={[styles.followUpChip, { borderColor: colors.border }]}
              >
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  {question}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  avatarCol: {
    marginRight: 8,
    paddingTop: 4,
  },
  userBubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiBubbleContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionsContainer: {
    marginTop: 8,
    gap: 6,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  followUpContainer: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  followUpChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
});
