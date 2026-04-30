import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { AppHeader, Screen } from '../src/components/layout';
import { useTheme } from '../src/theme';

export default function AboutScreen() {
  const { colors, radius, shadow, spacing, typography, gradients } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  // 真实版本信息（动态读取，避免硬编码字符串误导测试）
  // - appVersion: app.json 里的 version（=APK 版本）
  // - runtimeVersion: OTA runtime 版本（=能拿到哪批 OTA）
  // - updateId: 当前生效的 OTA group ID 短串（验证 OTA 是否到位）
  const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '未知';
  const runtimeVersion = (Updates.runtimeVersion as string) ?? '未知';
  const updateId = (Updates.updateId ?? '').slice(0, 8) || 'embedded(无 OTA)';
  const channel = (Updates.channel as string | undefined) ?? '未知';
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="关于爱买买" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' }]}>
            <LinearGradient
              colors={[...gradients.aiGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ height: 3 }}
            />
            <View style={{ padding: 16 }}>
              <Text style={[typography.title2, { color: colors.text.primary }]}>爱买买</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                AI 赋能农业，夯实健康之路
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                我们致力于连接消费者与生产者，打造可信赖的农业内容与电商生态。当前为前端占位内容。
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(80)} style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>版本信息</Text>
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={{ padding: 16 }}>
              <Text style={[typography.body, { color: colors.text.secondary }]}>App 版本：{appVersion}</Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: 6 }]}>
                Runtime：{runtimeVersion}
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: 6 }]}>
                OTA 渠道：{channel}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                OTA 版本：{updateId}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(160)} style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>联系我们</Text>
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={{ padding: 16 }}>
              <Text style={[typography.body, { color: colors.text.secondary }]}>邮箱：support@nongmai.ai</Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: 6 }]}>
                微信客服：爱买买助手（占位）
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(240)} style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          <Text style={[typography.caption, { color: colors.text.secondary, textAlign: 'center' }]}>
            © 2026 深圳华海农业科技集团有限公司
          </Text>
          <Text style={[typography.caption, { color: colors.text.secondary, textAlign: 'center', marginTop: 4 }]}>
            粤ICP备2023047684号-5
          </Text>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0,
  },
});
