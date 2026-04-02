import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../src/components/layout';
import { useToast } from '../src/components/feedback';
import { AuthRepo, UserRepo } from '../src/repos';
import { useAuthStore } from '../src/store';
import { useTheme } from '../src/theme';
import { logoutAndClearClientState } from '../src/utils/logout';

// 手机号脱敏：138****5678
const maskPhone = (phone?: string) => {
  if (!phone || phone.length < 7) return undefined;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
};

// 邮箱脱敏：l****e@example.com
const maskEmail = (email?: string) => {
  if (!email) return undefined;
  const [local, domain] = email.split('@');
  if (!domain || local.length < 2) return email;
  return `${local[0]}****${local[local.length - 1]}@${domain}`;
};

export default function AccountSecurityScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  // 用户资料
  const { data: profileResult } = useQuery({
    queryKey: ['profile'],
    queryFn: () => UserRepo.profile(),
    enabled: isLoggedIn,
  });
  const profile = profileResult?.ok ? profileResult.data : undefined;

  // 修改密码表单
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);

  const handleChangePassword = async () => {
    if (!oldPwd.trim()) {
      show({ message: '请输入旧密码', type: 'info' });
      return;
    }
    if (newPwd.length < 6) {
      show({ message: '新密码至少6位', type: 'info' });
      return;
    }
    if (newPwd !== confirmPwd) {
      show({ message: '两次密码不一致', type: 'info' });
      return;
    }
    setChangingPwd(true);
    const result = await AuthRepo.changePassword({ oldPassword: oldPwd, newPassword: newPwd });
    setChangingPwd(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '修改失败', type: 'error' });
      return;
    }
    show({ message: '密码修改成功', type: 'success' });
    setShowPasswordForm(false);
    setOldPwd('');
    setNewPwd('');
    setConfirmPwd('');
  };

  // 退出登录（直接执行，跳过确认弹窗避免平台兼容问题）
  const handleLogout = async () => {
    try {
      await AuthRepo.logout();
    } catch {
      // 服务端登出失败不影响本地登出
    }
    logoutAndClearClientState();
    show({ message: '已退出登录', type: 'success' });
    router.replace('/(tabs)/home');
  };

  // 注销账号（直接执行，跳过确认弹窗避免平台兼容问题）
  const handleDeleteAccount = async () => {
    const result = await AuthRepo.deleteAccount();
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '注销失败', type: 'error' });
      return;
    }
    logoutAndClearClientState();
    show({ message: '账号已注销', type: 'success' });
    router.replace('/(tabs)/home');
  };

  const phoneMasked = maskPhone(profile?.phone);
  const emailMasked = maskEmail(profile?.email);
  const wechatName = profile?.wechatNickname;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="账号与安全" />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>

        {/* 绑定账号 */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.sm }]}>绑定账号</Text>
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            {/* 手机号 */}
            <Pressable
              onPress={() => show({ message: phoneMasked ? '换绑手机号功能即将上线' : '绑定手机号功能即将上线', type: 'info' })}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="cellphone" size={20} color={colors.brand.primary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>手机号</Text>
              <View style={styles.spacer} />
              {phoneMasked ? (
                <View style={[styles.badge, { backgroundColor: colors.brand.primary + '18' }]}>
                  <Text style={[typography.caption, { color: colors.brand.primary }]}>{phoneMasked}</Text>
                </View>
              ) : (
                <Text style={[typography.caption, { color: colors.text.secondary }]}>未绑定</Text>
              )}
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} style={{ marginLeft: 6 }} />
            </Pressable>

            {/* 邮箱 */}
            <Pressable
              onPress={() => show({ message: emailMasked ? '换绑邮箱功能即将上线' : '绑定邮箱功能即将上线', type: 'info' })}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <MaterialCommunityIcons name="email-outline" size={20} color="#1976D2" />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>邮箱</Text>
              <View style={styles.spacer} />
              {emailMasked ? (
                <View style={[styles.badge, { backgroundColor: '#1976D218' }]}>
                  <Text style={[typography.caption, { color: '#1976D2' }]}>{emailMasked}</Text>
                </View>
              ) : (
                <Text style={[typography.caption, { color: colors.text.secondary }]}>未绑定</Text>
              )}
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} style={{ marginLeft: 6 }} />
            </Pressable>

            {/* 微信 */}
            <Pressable
              onPress={() => show({ message: wechatName ? '换绑微信功能即将上线' : '绑定微信功能即将上线', type: 'info' })}
              style={styles.row}
            >
              <MaterialCommunityIcons name="wechat" size={20} color="#07C160" />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>微信</Text>
              <View style={styles.spacer} />
              {wechatName ? (
                <View style={[styles.badge, { backgroundColor: '#07C16018' }]}>
                  <Text style={[typography.caption, { color: '#07C160' }]}>{wechatName}</Text>
                </View>
              ) : (
                <Text style={[typography.caption, { color: colors.text.secondary }]}>未绑定</Text>
              )}
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text.secondary} style={{ marginLeft: 6 }} />
            </Pressable>
          </View>
        </Animated.View>

        {/* 安全设置 */}
        <Animated.View entering={FadeInDown.duration(300).delay(80)}>
          <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.lg, marginBottom: spacing.sm }]}>
            安全设置
          </Text>
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            {/* 修改密码 */}
            <Pressable
              onPress={() => setShowPasswordForm(!showPasswordForm)}
              style={[styles.row, { borderBottomColor: showPasswordForm ? 'transparent' : colors.border }]}
            >
              <MaterialCommunityIcons name="lock-outline" size={20} color={colors.text.secondary} />
              <Text style={[typography.body, { color: colors.text.primary, marginLeft: spacing.sm }]}>修改密码</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons
                name={showPasswordForm ? 'chevron-up' : 'chevron-right'}
                size={18}
                color={colors.text.secondary}
              />
            </Pressable>

            {/* 修改密码表单 */}
            {showPasswordForm && (
              <View style={[styles.passwordForm, { borderBottomColor: colors.border }]}>
                <View style={[styles.inputRow, { borderColor: colors.border, borderRadius: radius.md }]}>
                  <TextInput
                    style={[typography.body, styles.input, { color: colors.text.primary }]}
                    placeholder="旧密码"
                    placeholderTextColor={colors.text.secondary}
                    secureTextEntry={!showOldPwd}
                    value={oldPwd}
                    onChangeText={setOldPwd}
                  />
                  <Pressable onPress={() => setShowOldPwd(!showOldPwd)} hitSlop={8}>
                    <MaterialCommunityIcons
                      name={showOldPwd ? 'eye-outline' : 'eye-off-outline'}
                      size={18}
                      color={colors.text.secondary}
                    />
                  </Pressable>
                </View>

                <View style={[styles.inputRow, { borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.sm }]}>
                  <TextInput
                    style={[typography.body, styles.input, { color: colors.text.primary }]}
                    placeholder="新密码（至少6位）"
                    placeholderTextColor={colors.text.secondary}
                    secureTextEntry={!showNewPwd}
                    value={newPwd}
                    onChangeText={setNewPwd}
                  />
                  <Pressable onPress={() => setShowNewPwd(!showNewPwd)} hitSlop={8}>
                    <MaterialCommunityIcons
                      name={showNewPwd ? 'eye-outline' : 'eye-off-outline'}
                      size={18}
                      color={colors.text.secondary}
                    />
                  </Pressable>
                </View>

                <View style={[styles.inputRow, { borderColor: colors.border, borderRadius: radius.md, marginTop: spacing.sm }]}>
                  <TextInput
                    style={[typography.body, styles.input, { color: colors.text.primary }]}
                    placeholder="确认新密码"
                    placeholderTextColor={colors.text.secondary}
                    secureTextEntry={!showNewPwd}
                    value={confirmPwd}
                    onChangeText={setConfirmPwd}
                  />
                </View>

                <Pressable
                  onPress={handleChangePassword}
                  disabled={changingPwd}
                  style={[
                    styles.submitButton,
                    {
                      backgroundColor: changingPwd ? colors.border : colors.brand.primary,
                      borderRadius: radius.pill,
                      marginTop: spacing.md,
                    },
                  ]}
                >
                  <Text style={[typography.bodyStrong, { color: '#fff' }]}>
                    {changingPwd ? '提交中...' : '确认修改'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* 注销账号 */}
            <Pressable onPress={handleDeleteAccount} style={styles.row}>
              <MaterialCommunityIcons name="account-remove-outline" size={20} color={colors.danger} />
              <Text style={[typography.body, { color: colors.danger, marginLeft: spacing.sm }]}>注销账号</Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.danger} />
            </Pressable>
          </View>
        </Animated.View>

        {/* 退出登录 */}
        <Animated.View entering={FadeInDown.duration(300).delay(160)}>
          <Pressable
            onPress={handleLogout}
            style={[styles.logoutButton, { marginTop: spacing.xl, borderColor: colors.danger, borderRadius: radius.lg }]}
          >
            <MaterialCommunityIcons name="logout" size={18} color={colors.danger} />
            <Text style={[typography.bodyStrong, { color: colors.danger, marginLeft: spacing.sm }]}>退出登录</Text>
          </Pressable>
        </Animated.View>

        {/* 安全提示 */}
        <Animated.View entering={FadeInDown.duration(300).delay(240)}>
          <View style={{ marginTop: spacing.lg, paddingHorizontal: 4 }}>
            <Text style={[typography.caption, { color: colors.text.secondary, lineHeight: 20 }]}>
              为保障账号安全，建议定期修改密码，且不要使用与其他平台相同的密码。注销账号后，所有关联数据将被永久删除。
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
  spacer: {
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  passwordForm: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  input: {
    flex: 1,
    height: 44,
    padding: 0,
  },
  submitButton: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButton: {
    borderWidth: 1,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
