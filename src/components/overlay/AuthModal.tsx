import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';
import { AuthRepo } from '../../repos';
import { USE_MOCK } from '../../repos/http/config';
import { AuthSession, LoginMode } from '../../types';

// 主要方式：手机号 / 邮箱（顶部切换），微信放在底部"其他方式"
type AuthChannel = 'phone' | 'email';

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: (session: AuthSession) => void | Promise<void>;
};

// 登录/注册弹窗：手机号/邮箱为主要方式，微信为底部快捷入口
export const AuthModal = ({ open, onClose, onSuccess }: AuthModalProps) => {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const { show: showToast } = useToast();

  // 状态
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [channel, setChannel] = useState<AuthChannel>('phone');
  const [loginMode, setLoginMode] = useState<LoginMode>('code');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  // 内联错误提示（Modal 内显示，不依赖全局 Toast）
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理所有定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (cdRef.current) clearInterval(cdRef.current);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  const isLogin = tab === 'login';
  const isPhone = channel === 'phone';

  // 内联错误展示（3 秒后自动消失）
  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setErrorMsg(''), 3000);
  }, []);

  // 内联成功展示（1.5 秒后自动消失）
  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccessMsg(''), 1500);
  }, []);

  const resetFields = useCallback(() => {
    setPhone(''); setEmail(''); setCode(''); setPassword('');
    setNickname(''); setAgreed(false); setShowPwd(false);
    setLoginMode('code'); setTab('login'); setChannel('phone');
    setSubmitting(false); setCodeSending(false);
    setErrorMsg(''); setSuccessMsg('');
    if (cdRef.current) clearInterval(cdRef.current);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    if (successTimer.current) clearTimeout(successTimer.current);
    setCountdown(0);
  }, []);

  const handleClose = useCallback(() => { resetFields(); onClose(); }, [resetFields, onClose]);

  // 成功：先关弹窗，再用全局 Toast 提示（此时 Modal 已关闭，Toast 可见）
  const onAuthSuccess = useCallback(async (session: AuthSession, msg: string) => {
    await onSuccess?.(session);
    handleClose();
    // 延迟一帧让 Modal 完全关闭后再显示 Toast
    setTimeout(() => showToast({ message: msg, type: 'success' }), 100);
  }, [showToast, onSuccess, handleClose]);

  // 倒计时
  const startCountdown = useCallback(() => {
    setCountdown(60);
    cdRef.current = setInterval(() => {
      setCountdown((p) => {
        if (p <= 1) { if (cdRef.current) clearInterval(cdRef.current); return 0; }
        return p - 1;
      });
    }, 1000);
  }, []);

  // 发送验证码（手机或邮箱）
  const handleSendCode = useCallback(async () => {
    if (isPhone) {
      if (!/^1\d{10}$/.test(phone.trim())) { showError('请输入有效的手机号'); return; }
      setCodeSending(true);
      const r = await AuthRepo.requestSmsCode(phone);
      setCodeSending(false);
      if (!r.ok) { showError(r.error.displayMessage ?? '发送失败'); return; }
      showSuccess('验证码已发送');
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { showError('请输入有效邮箱地址'); return; }
      setCodeSending(true);
      const r = await AuthRepo.requestEmailCode(email);
      setCodeSending(false);
      if (!r.ok) { showError(r.error.displayMessage ?? '发送失败'); return; }
      showSuccess('验证码已发送');
    }
    startCountdown();
  }, [isPhone, phone, email, showError, showSuccess, startCountdown]);

  // 微信授权（登录/注册通用，后端自动创建账号）
  // B02修复：区分 Mock 和真实微信授权流程
  const handleWeChat = useCallback(async () => {
    setSubmitting(true);
    try {
      let wxCode: string;
      if (USE_MOCK) {
        // Mock 模式：生成模拟授权码
        wxCode = `wx_auth_${Date.now()}`;
      } else {
        // 真实模式：调用微信 SDK 获取授权码
        // TODO: 接入 expo-auth-session 或 react-native-wechat-lib
        // const result = await WechatLib.sendAuthRequest('snsapi_userinfo');
        // wxCode = result.code;
        showError('微信授权 SDK 尚未集成，请使用手机号登录');
        return;
      }
      const r = await AuthRepo.loginWithWeChat(wxCode);
      if (!r.ok) { showError(r.error.displayMessage ?? '微信授权失败'); return; }
      await onAuthSuccess(r.data, '微信授权成功');
    } finally {
      setSubmitting(false);
    }
  }, [showError, onAuthSuccess]);

  // 主表单提交
  const handleSubmit = useCallback(async () => {
    setErrorMsg('');

    // 账号验证
    if (isPhone && !/^1\d{10}$/.test(phone.trim())) { showError('请输入有效的手机号'); return; }
    if (!isPhone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { showError('请输入有效邮箱地址'); return; }

    // 登录
    if (isLogin) {
      if (loginMode === 'password') {
        if (password.trim().length < 6) { showError('请输入至少 6 位密码'); return; }
      } else {
        if (code.trim().length < 4) { showError('请输入验证码'); return; }
      }
      setSubmitting(true);
      try {
        const r = isPhone
          ? await AuthRepo.loginWithPhone({ phone, code, password, mode: loginMode })
          : await AuthRepo.loginWithEmail({ email, code, password, mode: loginMode });
        if (!r.ok) { showError(r.error.displayMessage ?? '登录失败'); return; }
        await onAuthSuccess(r.data, '登录成功');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // 注册验证
    if (code.trim().length < 4) { showError('请输入验证码'); return; }
    if (nickname.trim().length < 2 || nickname.trim().length > 12) { showError('昵称需要 2-12 个字'); return; }
    if (password.trim().length < 6) { showError('密码至少 6 位'); return; }
    if (!agreed) { showError('请阅读并同意用户协议'); return; }

    setSubmitting(true);
    try {
      const r = isPhone
        ? await AuthRepo.registerWithPhone({ phone, code, name: nickname, password })
        : await AuthRepo.registerWithEmail({ email, code, name: nickname, password });
      if (!r.ok) { showError(r.error.displayMessage ?? '注册失败'); return; }
      await onAuthSuccess(r.data, '注册成功');
    } finally {
      setSubmitting(false);
    }
  }, [isPhone, isLogin, phone, email, code, password, nickname, agreed, loginMode, showError, onAuthSuccess]);

  // ---- 渲染辅助 ----

  // 输入框行
  const renderInput = (cfg: {
    label: string; value: string; onChange: (t: string) => void; placeholder: string;
    kbType?: 'default' | 'phone-pad' | 'number-pad' | 'email-address';
    secure?: boolean; maxLen?: number; right?: React.ReactNode;
  }) => (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={[typography.captionSm, { color: colors.text.secondary, marginBottom: 3, marginLeft: 2 }]}>{cfg.label}</Text>
      <View style={[styles.inputRow, { backgroundColor: colors.bgSecondary, borderRadius: radius.lg }]}>
        <TextInput
          key={`${cfg.label}-${cfg.secure ?? false}`}
          value={cfg.value} onChangeText={cfg.onChange} placeholder={cfg.placeholder}
          placeholderTextColor={colors.muted} keyboardType={cfg.kbType ?? 'default'}
          secureTextEntry={cfg.secure} maxLength={cfg.maxLen} autoCapitalize="none"
          style={[styles.inputField, typography.bodySm, { color: colors.text.primary }]}
        />
        {cfg.right}
      </View>
    </View>
  );

  // 发送验证码按钮
  const codeButton = (
    <Pressable
      onPress={handleSendCode}
      disabled={countdown > 0 || codeSending}
      style={[styles.codeBtn, { backgroundColor: countdown > 0 ? colors.bgSecondary : colors.brand.primarySoft, borderRadius: radius.md }]}
    >
      {codeSending
        ? <ActivityIndicator size="small" color={colors.brand.primary} />
        : <Text style={[typography.captionSm, { color: countdown > 0 ? colors.muted : colors.brand.primary }]}>
            {countdown > 0 ? `${countdown}s` : '获取验证码'}
          </Text>
      }
    </Pressable>
  );

  // 密码可见切换
  const eyeButton = (
    <Pressable onPress={() => setShowPwd(!showPwd)} hitSlop={8} style={styles.eyeBtn}>
      <MaterialCommunityIcons name={showPwd ? 'eye-outline' : 'eye-off-outline'} size={18} color={colors.text.secondary} />
    </Pressable>
  );

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            entering={FadeIn.duration(200)}
            style={[styles.card, shadow.lg, { backgroundColor: colors.surface, borderRadius: radius['2xl'] ?? 20 }]}
          >
            {/* 顶部渐变装饰条 */}
            <LinearGradient
              colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[styles.topStripe, { borderTopLeftRadius: radius['2xl'] ?? 20, borderTopRightRadius: radius['2xl'] ?? 20 }]}
            />

            <View style={styles.cardContent}>
              {/* 标题 + 关闭 */}
              <View style={styles.headerRow}>
                <View>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>
                    {isLogin ? '欢迎回来' : '加入爱买买'}
                  </Text>
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                    {isLogin ? '登录后享受完整服务' : '注册成为爱买买会员'}
                  </Text>
                </View>
                <Pressable onPress={handleClose} hitSlop={12} style={[styles.closeBtn, { backgroundColor: colors.bgSecondary }]}>
                  <MaterialCommunityIcons name="close" size={16} color={colors.text.secondary} />
                </Pressable>
              </View>

              {/* 登录/注册 Tab */}
              <View style={[styles.tabRow, { backgroundColor: colors.bgSecondary, borderRadius: radius.lg }]}>
                {(['login', 'register'] as const).map((t) => {
                  const active = tab === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => { setTab(t); setCode(''); setPassword(''); setNickname(''); setAgreed(false); setErrorMsg(''); }}
                      style={[styles.tabBtn, { backgroundColor: active ? colors.surface : 'transparent', borderRadius: radius.md }, active && shadow.sm]}
                    >
                      <Text style={[typography.bodySm, { color: active ? colors.brand.primary : colors.text.secondary, fontWeight: active ? '600' : '400' }]}>
                        {t === 'login' ? '登录' : '注册'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* 手机号 / 邮箱 切换 */}
              <View style={[styles.channelRow, { marginTop: spacing.md }]}>
                {([
                  { key: 'phone' as const, icon: 'cellphone' as const, label: '手机号' },
                  { key: 'email' as const, icon: 'email-outline' as const, label: '邮箱' },
                ]).map((opt) => {
                  const active = channel === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => { setChannel(opt.key); setCode(''); setLoginMode('code'); setCountdown(0); setErrorMsg(''); if (cdRef.current) clearInterval(cdRef.current); }}
                      style={[
                        styles.channelChip,
                        {
                          borderColor: active ? colors.brand.primary : colors.border,
                          backgroundColor: active ? colors.brand.primarySoft : 'transparent',
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons name={opt.icon} size={15} color={active ? colors.brand.primary : colors.muted} style={{ marginRight: 4 }} />
                      <Text style={[typography.captionSm, { color: active ? colors.brand.primary : colors.text.secondary }]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* ===== 表单区域 ===== */}

              {/* 手机号登录：验证码/密码模式切换 */}
              {isLogin && (
                <View style={[styles.loginModeRow, { marginTop: spacing.sm }]}>
                  {(['code', 'password'] as const).map((m) => (
                    <Pressable key={m} onPress={() => setLoginMode(m)}>
                      <Text style={[typography.captionSm, {
                        color: loginMode === m ? colors.brand.primary : colors.muted,
                        fontWeight: loginMode === m ? '600' : '400',
                      }]}>
                        {m === 'code' ? '验证码登录' : '密码登录'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* 账号输入 */}
              {isPhone
                ? renderInput({ label: '手机号', value: phone, onChange: setPhone, placeholder: '请输入 11 位手机号', kbType: 'phone-pad', maxLen: 11 })
                : renderInput({ label: '邮箱地址', value: email, onChange: setEmail, placeholder: '请输入邮箱', kbType: 'email-address' })
              }

              {/* 验证码 / 密码 */}
              {isLogin && loginMode === 'password'
                ? renderInput({ label: '密码', value: password, onChange: setPassword, placeholder: '请输入密码', secure: !showPwd, right: eyeButton })
                : renderInput({ label: '验证码', value: code, onChange: setCode, placeholder: isPhone ? '请输入短信验证码' : '请输入邮箱验证码', kbType: 'number-pad', maxLen: 6, right: codeButton })
              }

              {/* 注册额外字段：昵称 + 密码 + 协议 */}
              {!isLogin && (
                <>
                  {renderInput({ label: '昵称', value: nickname, onChange: setNickname, placeholder: '2-12 个字', maxLen: 12 })}
                  {renderInput({ label: '设置密码', value: password, onChange: setPassword, placeholder: '至少 6 位', secure: !showPwd, right: eyeButton })}
                  <Pressable onPress={() => setAgreed(!agreed)} style={[styles.agreementRow, { marginTop: spacing.sm }]}>
                    <MaterialCommunityIcons name={agreed ? 'checkbox-marked' : 'checkbox-blank-outline'} size={16} color={agreed ? colors.brand.primary : colors.muted} />
                    <Text style={[typography.captionSm, { color: colors.text.secondary, marginLeft: 5, flex: 1, lineHeight: 18 }]}>
                      我已阅读并同意<Text style={{ color: colors.brand.primary }}>《用户协议》</Text>和<Text style={{ color: colors.brand.primary }}>《隐私政策》</Text>
                    </Text>
                  </Pressable>
                </>
              )}

              {/* 内联提示（错误/成功，显示在按钮上方） */}
              {(errorMsg || successMsg) ? (
                <View style={[styles.inlineMsg, { backgroundColor: errorMsg ? `${colors.danger}10` : `${colors.success}10`, borderRadius: radius.md, marginTop: spacing.sm }]}>
                  <MaterialCommunityIcons
                    name={errorMsg ? 'alert-circle-outline' : 'check-circle-outline'}
                    size={14}
                    color={errorMsg ? colors.danger : colors.success}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[typography.captionSm, { color: errorMsg ? colors.danger : colors.success, flex: 1 }]}>
                    {errorMsg || successMsg}
                  </Text>
                </View>
              ) : null}

              {/* 主提交按钮 */}
              <Pressable onPress={handleSubmit} disabled={submitting} style={{ marginTop: (errorMsg || successMsg) ? spacing.sm : spacing.md }}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.brand.primaryLight]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={[styles.primaryBtn, { borderRadius: radius.pill, opacity: submitting ? 0.7 : 1 }]}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color={colors.text.inverse} />
                    : <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>{isLogin ? '登录' : '注册'}</Text>
                  }
                </LinearGradient>
              </Pressable>

              {/* ===== 底部：微信快捷登录/注册 ===== */}
              <View style={{ marginTop: spacing.lg }}>
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                  <Text style={[typography.captionSm, { color: colors.muted, marginHorizontal: 10 }]}>其他方式</Text>
                  <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                </View>

                <Pressable
                  onPress={handleWeChat}
                  disabled={submitting}
                  style={[styles.wechatRow, { marginTop: spacing.md }]}
                >
                  <View style={[styles.wechatIcon, { backgroundColor: '#07C16015' }]}>
                    <MaterialCommunityIcons name="wechat" size={22} color="#07C160" />
                  </View>
                  <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 4 }]}>
                    微信{isLogin ? '登录' : '注册'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 340,
    maxWidth: '90%',
    overflow: 'hidden',
  },
  topStripe: {
    height: 4,
  },
  cardContent: {
    padding: 20,
    paddingTop: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
  },
  channelRow: {
    flexDirection: 'row',
    gap: 8,
  },
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  loginModeRow: {
    flexDirection: 'row',
    gap: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 42,
  },
  inputField: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
  },
  codeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
    minWidth: 76,
    alignItems: 'center',
  },
  eyeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  inlineMsg: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  primaryBtn: {
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  wechatRow: {
    alignItems: 'center',
  },
  wechatIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
