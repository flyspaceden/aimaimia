import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppHeader, Screen } from '../src/components/layout';
import { useTheme } from '../src/theme';

export default function PrivacyScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="隐私政策" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>隐私摘要</Text>
          <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
            我们会在你授权的情况下收集必要信息，用于账号服务与体验优化。当前为前端占位文案。
          </Text>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>信息收集</Text>
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.body, { color: colors.text.secondary }]}>
              · 基础账号信息：昵称、头像、联系方式（占位）
            </Text>
            <Text style={[typography.body, { color: colors.text.secondary, marginTop: 6 }]}>
              · 使用日志：用于改进推荐与稳定性（占位）
            </Text>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>权限说明</Text>
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.body, { color: colors.text.secondary }]}>
              · 相机/相册：用于发布内容或更换头像（占位）
            </Text>
            <Text style={[typography.body, { color: colors.text.secondary, marginTop: 6 }]}>
              · 通知：用于提醒订单/活动与互动（占位）
            </Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
});

