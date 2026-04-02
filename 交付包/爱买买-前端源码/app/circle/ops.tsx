import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../src/components/layout';
import { useTheme } from '../../src/theme';

export default function CircleOpsScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="运营中心" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={[typography.title3, { color: colors.text.primary }]}>数据与运营</Text>
        <View style={{ marginTop: spacing.sm }}>
          <Pressable
            onPress={() => router.push('/circle/analytics')}
            style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <View style={styles.cardRow}>
              <MaterialCommunityIcons name="chart-box-outline" size={20} color={colors.brand.primary} />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>企业内容分析面板</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  内容表现、互动结构、趋势概览
                </Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            onPress={() => router.push('/circle/interests')}
            style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <View style={styles.cardRow}>
              <MaterialCommunityIcons name="brain" size={20} color={colors.accent.blue} />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>用户兴趣图谱</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  兴趣标签、行为信号、推荐依据
                </Text>
              </View>
            </View>
          </Pressable>
        </View>

        <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.xl }]}>风控与精华</Text>
        <View style={{ marginTop: spacing.sm }}>
          <Pressable
            onPress={() => router.push('/circle/featured')}
            style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <View style={styles.cardRow}>
              <MaterialCommunityIcons name="star-four-points" size={20} color={colors.accent.blue} />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>精华专区</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  精选内容集合，提升曝光
                </Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            onPress={() => router.push('/circle/rankings')}
            style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <View style={styles.cardRow}>
              <MaterialCommunityIcons name="trophy-outline" size={20} color={colors.brand.primary} />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>榜单与贡献值</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  创作者排行与贡献值激励
                </Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            onPress={() => router.push('/circle/moderation')}
            style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <View style={styles.cardRow}>
              <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.accent.blue} />
              <View style={{ marginLeft: spacing.sm }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>举报与审核</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>
                  举报记录与审核状态追踪
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
