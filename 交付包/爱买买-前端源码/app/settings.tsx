import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../src/components/layout';
import { useToast } from '../src/components/feedback';
import { useTheme } from '../src/theme';

export default function SettingsScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="设置" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={[styles.sectionCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>账号与安全</Text>
          <Pressable
            onPress={() => show({ message: '账号与安全功能待接入', type: 'info' })}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <MaterialCommunityIcons name="account-lock-outline" size={18} color={colors.text.secondary} />
            <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>账号与安全</Text>
            <View style={styles.spacer} />
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
          </Pressable>
          <Pressable
            onPress={() => show({ message: '通知设置待接入', type: 'info' })}
            style={styles.row}
          >
            <MaterialCommunityIcons name="bell-outline" size={18} color={colors.text.secondary} />
            <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>通知设置</Text>
            <View style={styles.spacer} />
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
          </Pressable>
        </View>

        <View style={[styles.sectionCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }]}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>隐私与合规</Text>
          <Pressable
            onPress={() => router.push('/privacy')}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <MaterialCommunityIcons name="shield-lock-outline" size={18} color={colors.text.secondary} />
            <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>隐私政策</Text>
            <View style={styles.spacer} />
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
          </Pressable>
          <Pressable onPress={() => router.push('/about')} style={styles.row}>
            <MaterialCommunityIcons name="information-outline" size={18} color={colors.text.secondary} />
            <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>关于爱买买</Text>
            <View style={styles.spacer} />
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
          </Pressable>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Pressable
            onPress={() => show({ message: '帮助与反馈待接入', type: 'info' })}
            style={[styles.helpCard, { borderColor: colors.border, borderRadius: radius.lg }]}
          >
            <MaterialCommunityIcons name="lifebuoy" size={18} color={colors.text.secondary} />
            <Text style={[typography.body, { color: colors.text.secondary, marginLeft: spacing.sm }]}>帮助与反馈</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  spacer: {
    flex: 1,
  },
  helpCard: {
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
