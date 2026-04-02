import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback';
import { AiBadge, AiCardGlow, AiDivider } from '../../src/components/ui';
import { AiOrb } from '../../src/components/effects';
import { useTheme } from '../../src/theme';

export default function AiAssistantScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [promptInput, setPromptInput] = useState('');
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  const scenarios = useMemo(
    () => [
      {
        id: 'support',
        title: '智能客服',
        subtitle: '查物流 / 退款售后 / 订单问题',
        description: '连接订单与消息中心，快速定位最近问题订单。',
        icon: 'headset',
        emoji: '🎧',
        tone: 'brand',
        cta: '去咨询',
      },
      {
        id: 'health',
        title: '健康饮食顾问',
        subtitle: '家庭健康摄入报告',
        description: '基于购买记录与偏好，生成可解释饮食建议。',
        icon: 'food-apple-outline',
        emoji: '🍎',
        tone: 'accent',
        cta: '生成报告',
      },
      {
        id: 'restock',
        title: '补货提醒',
        subtitle: '常购商品消耗预测',
        description: '学习你的消耗周期，提前提醒补货并推送优惠。',
        icon: 'bell-ring-outline',
        emoji: '🔔',
        tone: 'brand',
        cta: '设置提醒',
      },
      {
        id: 'calendar',
        title: '农事日历订阅',
        subtitle: '关注农户种植/收获节奏',
        description: '将农户动态转成日历订阅，感知食物生长节奏。',
        icon: 'calendar-month-outline',
        emoji: '📅',
        tone: 'accent',
        cta: '订阅日历',
      },
    ],
    []
  );

  const defaultPrompts = useMemo(
    () => ['我的订单到哪了', '推荐低糖水果', '本周适合补货什么', '查看考察进度'],
    []
  );
  const [quickPrompts, setQuickPrompts] = useState(defaultPrompts);

  const handleAddPrompt = () => {
    const value = promptInput.trim();
    if (!value) {
      show({ message: '请输入问题内容', type: 'info' });
      return;
    }
    if (quickPrompts.includes(value)) {
      show({ message: '该问题已存在', type: 'info' });
      return;
    }
    if (quickPrompts.length >= 8) {
      show({ message: '最多保留 8 条快捷问题', type: 'info' });
      return;
    }
    setQuickPrompts((prev) => [...prev, value]);
    setPromptInput('');
  };

  const handleRemovePrompt = (value: string) => {
    setQuickPrompts((prev) => prev.filter((item) => item !== value));
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="AI 农管家" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* Hero 卡片 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[styles.heroCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' }]}>
            {/* 顶部 3px 渐变装饰条 */}
            <LinearGradient
              colors={[colors.ai.start, colors.ai.end]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.topGradient}
            />
            <View style={styles.heroContent}>
              {/* AiOrb 居中顶部 */}
              <View style={styles.heroOrbRow}>
                <AiOrb size="small" />
              </View>
              <View style={styles.heroHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.title2, { color: colors.text.primary }]}>你的专属 AI 农管家</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                    连接订单、健康、农事与内容的智能助手
                  </Text>
                </View>
                <AiBadge variant="recommend" />
              </View>
              <View style={styles.heroActions}>
                <Pressable
                  onPress={() => router.push('/ai/chat')}
                  style={{ borderRadius: radius.pill, overflow: 'hidden', marginRight: 10 }}
                >
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primaryButton, { borderRadius: radius.pill }]}
                  >
                    <MaterialCommunityIcons name="message-text-outline" size={16} color={colors.text.inverse} />
                    <Text style={[typography.bodyStrong, { color: colors.text.inverse, marginLeft: 6 }]}>文本咨询</Text>
                  </LinearGradient>
                </Pressable>
                <Pressable
                  onPress={() => show({ message: '语音入口待接入', type: 'info' })}
                  style={[
                    styles.secondaryButton,
                    { borderColor: colors.ai.start, borderRadius: radius.pill },
                  ]}
                >
                  <MaterialCommunityIcons name="microphone-outline" size={16} color={colors.ai.start} />
                  <Text style={[typography.bodyStrong, { color: colors.ai.start, marginLeft: 6 }]}>
                    语音入口
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* 快捷问题区 */}
        <Animated.View entering={FadeInDown.duration(300).delay(100)} style={{ marginTop: spacing.lg }}>
          <AiDivider style={{ marginBottom: spacing.md }} />
          <View style={styles.promptHeader}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>快捷问题</Text>
            <View style={styles.promptActions}>
              {editingPrompts ? (
                <>
                  <Pressable
                    onPress={() => setQuickPrompts(defaultPrompts)}
                    style={[styles.promptAction, { borderColor: colors.border, borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.caption, { color: colors.text.secondary }]}>重置</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditingPrompts(false)}
                    style={[styles.promptAction, { borderColor: colors.ai.start, borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.caption, { color: colors.ai.start }]}>完成</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => setEditingPrompts(true)}
                  style={[styles.promptAction, { borderColor: colors.border, borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>编辑</Text>
                </Pressable>
              )}
            </View>
          </View>
          {editingPrompts ? (
            <View style={styles.promptInputRow}>
              <TextInput
                value={promptInput}
                onChangeText={setPromptInput}
                placeholder="添加一个常用问题"
                placeholderTextColor={colors.text.secondary}
                style={[styles.promptInput, { borderColor: colors.border, color: colors.text.primary, backgroundColor: colors.surface }]}
              />
              <Pressable
                onPress={handleAddPrompt}
                style={{ borderRadius: radius.pill, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.promptAdd, { borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: colors.text.inverse }]}>添加</Text>
                </LinearGradient>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.promptRow}>
            {quickPrompts.map((item, index) => (
              <Animated.View
                key={item}
                entering={FadeInDown.duration(300).delay(50 + index * 30)}
              >
                <Pressable
                  onPress={() =>
                    editingPrompts
                      ? handleRemovePrompt(item)
                      : router.push({ pathname: '/ai/chat', params: { prompt: item } })
                  }
                  style={{ borderRadius: radius.pill, overflow: 'hidden', marginRight: 8, marginBottom: 8 }}
                >
                  <LinearGradient
                    colors={[colors.brand.primarySoft, colors.ai.soft]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.promptChip,
                      {
                        borderRadius: radius.pill,
                        paddingRight: editingPrompts ? 6 : 12,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: colors.ai.start }]}>{item}</Text>
                    {editingPrompts ? (
                      <MaterialCommunityIcons
                        name="close-circle"
                        size={14}
                        color={colors.ai.start}
                        style={{ marginLeft: 6 }}
                      />
                    ) : null}
                  </LinearGradient>
                </Pressable>
              </Animated.View>
            ))}
          </View>
          {editingPrompts ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
              点击问题即可移除
            </Text>
          ) : null}
        </Animated.View>

        {/* 核心场景 */}
        <View style={{ marginTop: spacing.lg }}>
          <View style={styles.sectionHeader}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>核心场景</Text>
            <AiBadge variant="analysis" style={{ marginLeft: 8 }} />
          </View>
          <AiDivider style={{ marginTop: spacing.xs, marginBottom: spacing.sm }} />
          {scenarios.map((item, index) => {
            const accentColor = item.tone === 'accent' ? colors.accent.blue : colors.brand.primary;
            return (
              <Animated.View
                key={item.id}
                entering={FadeInDown.duration(300).delay(100 + index * 50)}
              >
                <AiCardGlow
                  style={[
                    shadow.md,
                    { marginTop: 12, borderRadius: radius.lg },
                  ]}
                >
                  <View style={styles.sceneCardContent}>
                    <View style={styles.sceneHeader}>
                      <View style={[styles.sceneIcon, { backgroundColor: colors.ai.soft }]}>
                        <Text style={{ fontSize: 18 }}>{item.emoji}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.title}</Text>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                          {item.subtitle}
                        </Text>
                      </View>
                      <AiBadge variant="recommend" />
                    </View>
                    <Text style={[typography.body, { color: colors.text.secondary, marginTop: 8 }]}>
                      {item.description}
                    </Text>
                    <Pressable
                      onPress={() => show({ message: `${item.title} 入口待接入`, type: 'info' })}
                      style={{ borderRadius: radius.pill, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 12 }}
                    >
                      <LinearGradient
                        colors={[colors.brand.primary, colors.ai.start]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.sceneCta, { borderRadius: radius.pill }]}
                      >
                        <Text style={[typography.caption, { color: colors.text.inverse }]}>{item.cta}</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                </AiCardGlow>
              </Animated.View>
            );
          })}
        </View>

        {/* 底部提示卡 */}
        <Animated.View entering={FadeInDown.duration(300).delay(400)}>
          <View style={[styles.noticeCard, { backgroundColor: colors.ai.soft, borderRadius: radius.lg }]}>
            <MaterialCommunityIcons name="star-four-points" size={18} color={colors.ai.start} />
            <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 8, flex: 1 }]}>
              AI 农管家当前为前端占位，后续接入后端后可实现智能对话与自动化服务。
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    borderWidth: 0,
  },
  topGradient: {
    height: 3,
  },
  heroContent: {
    padding: 16,
  },
  heroOrbRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  promptActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  promptAction: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  promptInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  promptInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  promptAdd: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroActions: {
    flexDirection: 'row',
    marginTop: 16,
  },
  primaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  secondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  promptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  promptChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sceneCardContent: {
    padding: 14,
  },
  sceneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sceneIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sceneCta: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  noticeCard: {
    marginTop: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
