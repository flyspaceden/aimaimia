import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../src/components/layout';
import { useToast } from '../src/components/feedback';
import { AiBadge } from '../src/components/ui';
import { useTheme } from '../src/theme';

// 通知偏好类型
type NotificationPrefs = {
  push: boolean;
  promo: boolean;
  aiReminder: boolean;
};

export default function NotificationSettingsScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();

  // 通知开关状态（后续可持久化到 AsyncStorage 或后端）
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    push: true,
    promo: true,
    aiReminder: true,
  });

  const togglePref = useCallback((key: keyof NotificationPrefs) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // 关闭推送时同步关闭子项
      if (key === 'push' && !next.push) {
        next.promo = false;
        next.aiReminder = false;
      }
      return next;
    });
    show({ message: '设置已保存', type: 'success' });
  }, [show]);

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="通知设置" />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
        {/* 通知开关 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            {/* 推送通知（主开关） */}
            <View style={[styles.row, { borderBottomColor: colors.border }]}>
              <MaterialCommunityIcons name="bell-outline" size={20} color={colors.text.secondary} />
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <Text style={[typography.body, { color: colors.text.primary }]}>推送通知</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  接收订单状态、物流更新等消息
                </Text>
              </View>
              <Switch
                value={prefs.push}
                onValueChange={() => togglePref('push')}
                trackColor={{ false: colors.border, true: colors.brand.primary }}
                thumbColor="#fff"
              />
            </View>

            {/* 促销消息 */}
            <View style={[styles.row, { borderBottomColor: colors.border, opacity: prefs.push ? 1 : 0.4 }]}>
              <MaterialCommunityIcons name="tag-outline" size={20} color={colors.text.secondary} />
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <Text style={[typography.body, { color: colors.text.primary }]}>促销消息</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  优惠活动、限时折扣通知
                </Text>
              </View>
              <Switch
                value={prefs.promo}
                onValueChange={() => togglePref('promo')}
                disabled={!prefs.push}
                trackColor={{ false: colors.border, true: colors.brand.primary }}
                thumbColor="#fff"
              />
            </View>

            {/* AI 提醒 */}
            <View style={[styles.row, { borderBottomColor: 'transparent', opacity: prefs.push ? 1 : 0.4 }]}>
              <MaterialCommunityIcons name="robot-outline" size={20} color={colors.ai.start} />
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[typography.body, { color: colors.text.primary }]}>AI 提醒</Text>
                  <AiBadge variant="recommend" />
                </View>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  AI 个性化推荐、智能提醒
                </Text>
              </View>
              <Switch
                value={prefs.aiReminder}
                onValueChange={() => togglePref('aiReminder')}
                disabled={!prefs.push}
                trackColor={{ false: colors.border, true: colors.ai.start }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </Animated.View>

        {/* 说明文字 */}
        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <View style={{ marginTop: spacing.lg, paddingHorizontal: 4 }}>
            <Text style={[typography.caption, { color: colors.text.secondary, lineHeight: 20 }]}>
              关闭推送通知后，您将不会收到任何消息推送。促销消息和 AI 提醒可单独控制，但依赖推送通知主开关。
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
});
