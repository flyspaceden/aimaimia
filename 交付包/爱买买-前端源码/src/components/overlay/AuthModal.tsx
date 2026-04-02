import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';
import { AuthRepo } from '../../repos';
import { AuthSession, LoginMode } from '../../types';

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: (session: AuthSession) => void;
};

// 登录/注册弹窗：未登录时的统一入口（公共组件需中文注释）
export const AuthModal = ({ open, onClose, onSuccess }: AuthModalProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [mode, setMode] = useState<LoginMode>('code');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const isCode = mode === 'code';

  const primaryLabel = tab === 'login' ? '登录' : '注册';
  const title = tab === 'login' ? '登录/注册' : '注册新账号';

  const helperText = useMemo(() => {
    if (isCode) {
      return '验证码已发送后请在 5 分钟内完成验证';
    }
    return '密码建议至少 6 位，包含字母与数字';
  }, [isCode]);

  const resetFields = () => {
    setPhone('');
    setCode('');
    setPassword('');
    setMode('code');
    setTab('login');
  };

  const handleClose = () => {
    resetFields();
    onClose();
  };

  const validate = () => {
    if (phone.trim().length < 6) {
      show({ message: '请输入有效手机号', type: 'error' });
      return false;
    }
    if (isCode && code.trim().length < 4) {
      show({ message: '请输入验证码', type: 'error' });
      return false;
    }
    if (!isCode && password.trim().length < 6) {
      show({ message: '请输入至少 6 位密码', type: 'error' });
      return false;
    }
    return true;
  };

  const handleSendCode = async () => {
    if (phone.trim().length < 6) {
      show({ message: '请先输入手机号', type: 'error' });
      return;
    }
    const result = await AuthRepo.requestSmsCode(phone);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '发送失败', type: 'error' });
      return;
    }
    show({ message: '验证码已发送（占位）', type: 'success' });
  };

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }
    // 后端接入点：登录/注册接口（手机号/邮箱 + 验证码/密码）
    const result =
      tab === 'login'
        ? await AuthRepo.loginWithPhone({ phone, code, password, mode })
        : await AuthRepo.registerWithPhone({ phone, code, password, mode });
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '操作失败', type: 'error' });
      return;
    }
    show({ message: `${primaryLabel}成功（占位）`, type: 'success' });
    onSuccess?.(result.data);
    handleClose();
  };

  const handleThirdParty = async (provider: 'wechat' | 'apple') => {
    const result = provider === 'wechat' ? await AuthRepo.loginWithWeChat() : await AuthRepo.loginWithApple();
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '登录失败', type: 'error' });
      return;
    }
    show({ message: '第三方登录成功（占位）', type: 'success' });
    onSuccess?.(result.data);
    handleClose();
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.xl,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.headerRow}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>{title}</Text>
              <Pressable onPress={handleClose}>
                <MaterialCommunityIcons name="close" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            <View style={[styles.segmentRow, { borderColor: colors.border }]}>
              {(['login', 'register'] as const).map((item) => {
                const active = tab === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setTab(item)}
                    style={[
                      styles.segmentButton,
                      {
                        backgroundColor: active ? colors.brand.primarySoft : 'transparent',
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary }]}>
                      {item === 'login' ? '登录' : '注册'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.switchRow, { marginTop: spacing.sm }]}>
              {(['code', 'password'] as const).map((item) => {
                const active = mode === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setMode(item)}
                    style={[
                      styles.switchButton,
                      {
                        borderColor: active ? colors.accent.blue : colors.border,
                        backgroundColor: active ? colors.accent.blueSoft : 'transparent',
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: active ? colors.accent.blue : colors.text.secondary }]}>
                      {item === 'code' ? '验证码' : '密码'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                手机号
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="请输入手机号"
                placeholderTextColor={colors.text.secondary}
                keyboardType="phone-pad"
                autoCapitalize="none"
                style={[styles.input, { borderColor: colors.border, color: colors.text.primary }]}
              />
            </View>

            <View style={{ marginTop: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.text.secondary }]}>
                {isCode ? '验证码' : '密码'}
              </Text>
              <View style={styles.codeRow}>
                <TextInput
                  value={isCode ? code : password}
                  onChangeText={(value) => (isCode ? setCode(value) : setPassword(value))}
                  placeholder={isCode ? '请输入验证码' : '请输入密码'}
                  placeholderTextColor={colors.text.secondary}
                  secureTextEntry={!isCode}
                  keyboardType={isCode ? 'number-pad' : 'default'}
                  style={[styles.input, styles.codeInput, { borderColor: colors.border, color: colors.text.primary }]}
                />
                {isCode ? (
                  <Pressable
                    onPress={handleSendCode}
                    style={[styles.codeButton, { borderColor: colors.border, borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.caption, { color: colors.text.secondary }]} numberOfLines={1}>
                      获取验证码
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                {helperText}
              </Text>
            </View>

            <Pressable
              onPress={handleSubmit}
              style={[styles.primaryButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>{primaryLabel}</Text>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[typography.caption, { color: colors.text.secondary, marginHorizontal: 8 }]}>
                其他方式
              </Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            <View style={styles.thirdRow}>
              <Pressable
                onPress={() => handleThirdParty('wechat')}
                style={[styles.thirdButton, { borderColor: colors.border, borderRadius: radius.pill }]}
              >
                <MaterialCommunityIcons name="wechat" size={18} color={colors.text.secondary} />
                <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6 }]}>微信登录</Text>
              </Pressable>
              <Pressable
                onPress={() => handleThirdParty('apple')}
                style={[styles.thirdButton, { borderColor: colors.border, borderRadius: radius.pill, marginRight: 0 }]}
              >
                <MaterialCommunityIcons name="apple" size={18} color={colors.text.secondary} />
                <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6 }]}>Apple</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 320,
    maxWidth: '88%',
    borderWidth: 1,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  segmentRow: {
    flexDirection: 'row',
    padding: 4,
    borderWidth: 1,
    borderRadius: 999,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  switchButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  codeInput: {
    flex: 1,
    minWidth: 180,
  },
  codeButton: {
    marginLeft: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: 140,
  },
  primaryButton: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  thirdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  thirdButton: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginRight: 8,
  },
});
