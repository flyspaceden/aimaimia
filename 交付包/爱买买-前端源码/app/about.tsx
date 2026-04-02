import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppHeader, Screen } from '../src/components/layout';
import { useTheme } from '../src/theme';

export default function AboutScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
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
        <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.title2, { color: colors.text.primary }]}>爱买买</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
            AI 赋能农业，夯实健康之路
          </Text>
          <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
            我们致力于连接消费者与生产者，打造可信赖的农业内容与电商生态。当前为前端占位内容。
          </Text>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>版本信息</Text>
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.body, { color: colors.text.secondary }]}>App 版本：0.1.0 (Mock)</Text>
            <Text style={[typography.body, { color: colors.text.secondary, marginTop: 6 }]}>
              构建版本：2025.01
            </Text>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>联系我们</Text>
          <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.body, { color: colors.text.secondary }]}>邮箱：support@nongmai.ai</Text>
            <Text style={[typography.body, { color: colors.text.secondary, marginTop: 6 }]}>
              微信客服：爱买买助手（占位）
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

