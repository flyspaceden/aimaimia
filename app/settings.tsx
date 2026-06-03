import React, { useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../src/components/layout';
import { useToast } from '../src/components/feedback';
// import { AiBadge } from '../src/components/ui'; // AI 偏好部分已注释隐藏，恢复时一并解开
import { AuthRepo } from '../src/repos';
import { useAuthStore } from '../src/store';
import { useTheme } from '../src/theme';
import { logoutAndClearClientState } from '../src/utils/logout';
import { revokePrivacyConsent } from '../src/services/privacyConsent';

export default function SettingsScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  // 执行退出
  const performLogout = async () => {
    try {
      await AuthRepo.logout();
    } catch {
      // 服务端登出失败不影响本地登出
    }
    logoutAndClearClientState();
    show({ message: '已退出登录', type: 'success' });
    router.replace('/(tabs)/home');
  };

  // 撤回隐私同意（《个人信息保护法》第 15 条赋予用户随时撤回的权利）
  // 撤回后需重启 App 才会再次弹隐私同意弹窗（首启检查在 _layout.tsx）
  const handleRevokePrivacyConsent = () => {
    Alert.alert(
      '撤回隐私同意',
      '撤回后，下次启动 App 时会再次弹出《用户协议》和《隐私政策》同意页。\n\n是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认撤回',
          style: 'destructive',
          onPress: async () => {
            await revokePrivacyConsent();
            // Android 可直接退出 App；iOS 无法编程退出，只能提示用户手动重启
            if (Platform.OS === 'android') {
              Alert.alert(
                '已撤回',
                '已撤回您的隐私同意。\nApp 将退出，请重新打开以查看隐私政策。',
                [{ text: '退出', onPress: () => BackHandler.exitApp() }],
              );
            } else {
              Alert.alert('已撤回', '已撤回您的隐私同意。\n请手动关闭并重新打开 App。');
            }
          },
        },
      ],
    );
  };

  // 退出登录（直接执行，跳过确认弹窗避免平台兼容问题）
  const handleLogout = () => {
    performLogout();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="设置" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* 账号与安全 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={[styles.sectionCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>账号与安全</Text>
            <Pressable
              onPress={() => router.push('/account-security')}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="account-lock-outline" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>账号与安全</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/notification-settings')}
              style={styles.row}
            >
              <MaterialCommunityIcons name="bell-outline" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>通知设置</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
          </View>
        </Animated.View>

        {/* AI 偏好 Section — 已注释隐藏（保留代码以便恢复，恢复时一并解开顶部 AiBadge import） */}
        {/*
        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <View style={[styles.sectionCard, shadow.md, { backgroundColor: colors.ai.soft, borderRadius: radius.lg, marginTop: spacing.lg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>AI 偏好</Text>
              <AiBadge variant="analysis" />
            </View>
            <Pressable
              onPress={() => show({ message: 'AI 推荐频率设置即将上线', type: 'info' })}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="robot-outline" size={18} color={colors.ai.start} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>AI 推荐频率</Text>
              <View style={styles.spacer} />
              <Text style={[typography.caption, { color: colors.text.secondary, marginRight: 4 }]}>默认</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
            <Pressable
              onPress={() => show({ message: 'AI 语音唤醒设置即将上线', type: 'info' })}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="microphone-outline" size={18} color={colors.ai.start} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>AI 语音唤醒</Text>
              <View style={styles.spacer} />
              <Text style={[typography.caption, { color: colors.text.secondary, marginRight: 4 }]}>关闭</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
            <Pressable
              onPress={() => show({ message: 'AI 对话记录已清除', type: 'success' })}
              style={styles.row}
            >
              <MaterialCommunityIcons name="delete-sweep-outline" size={18} color={colors.ai.start} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>清除 AI 对话</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
          </View>
        </Animated.View>
        */}

        {/* 隐私与合规 */}
        <Animated.View entering={FadeInDown.duration(300).delay(160)}>
          <View style={[styles.sectionCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }]}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>隐私与合规</Text>
            <Pressable
              onPress={() => router.push('/terms')}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>用户协议</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/privacy')}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="shield-lock-outline" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>隐私政策</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: '/privacy', params: { section: 'appendix-sdk' } })}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="share-variant-outline" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>第三方 SDK 清单</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
            <Pressable
              onPress={handleRevokePrivacyConsent}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="undo-variant" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>撤回隐私同意</Text>
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
        </Animated.View>

        {/* 帮助与客服 */}
        <Animated.View entering={FadeInDown.duration(300).delay(240)}>
          <View style={[styles.sectionCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }]}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>帮助与客服</Text>
            <Pressable
              onPress={() => show({ message: '在线客服即将上线', type: 'info' })}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="headset" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>在线客服</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
            <Pressable
              onPress={() => show({ message: '帮助与反馈待接入', type: 'info' })}
              style={styles.row}
            >
              <MaterialCommunityIcons name="lifebuoy" size={18} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>帮助与反馈</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} />
            </Pressable>
          </View>
        </Animated.View>

        {/* 退出登录 */}
        {isLoggedIn && (
          <Animated.View entering={FadeInDown.duration(300).delay(320)}>
            <Pressable
              onPress={handleLogout}
              style={[styles.logoutButton, { marginTop: spacing.xl, borderColor: colors.danger, borderRadius: radius.lg }]}
            >
              <MaterialCommunityIcons name="logout" size={18} color={colors.danger} />
              <Text style={[typography.bodyStrong, { color: colors.danger, marginLeft: spacing.sm }]}>退出登录</Text>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
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
  logoutButton: {
    borderWidth: 1,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
