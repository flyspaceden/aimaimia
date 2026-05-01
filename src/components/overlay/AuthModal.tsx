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
import { SvgXml } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';
import { AuthRepo } from '../../repos';
import { requestWechatAuth } from '../../services/wechat';
import { AuthSession, LoginMode } from '../../types';

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: (session: AuthSession) => void | Promise<void>;
};

// 登录/注册弹窗：手机号为主要方式，微信为底部快捷入口
export const AuthModal = ({ open, onClose, onSuccess }: AuthModalProps) => {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const { show: showToast } = useToast();
  const router = useRouter();

  // 状态
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loginMode, setLoginMode] = useState<LoginMode>('code');
  const [phone, setPhone] = useState('');
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

  // 忘记密码流程状态（方案 A：内嵌 3 步向导，不新增路由）
  const [flowMode, setFlowMode] = useState<'auth' | 'forgotPassword'>('auth');
  const [fpStep, setFpStep] = useState<1 | 2 | 3>(1);
  const [fpCaptcha, setFpCaptcha] = useState<{ captchaId: string; svg: string } | null>(null);
  const [fpCaptchaCode, setFpCaptchaCode] = useState('');
  const [fpCode, setFpCode] = useState('');
  const [fpNewPwd, setFpNewPwd] = useState('');
  const [fpConfirmPwd, setFpConfirmPwd] = useState('');

  // 组件卸载时清理所有定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (cdRef.current) clearInterval(cdRef.current);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  const isLogin = tab === 'login';

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
    setPhone(''); setCode(''); setPassword('');
    setNickname(''); setAgreed(false); setShowPwd(false);
    setLoginMode('code'); setTab('login');
    setSubmitting(false); setCodeSending(false);
    setErrorMsg(''); setSuccessMsg('');
    if (cdRef.current) clearInterval(cdRef.current);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    if (successTimer.current) clearTimeout(successTimer.current);
    setCountdown(0);
    // 忘记密码向导状态同步清理
    setFlowMode('auth'); setFpStep(1);
    setFpCaptcha(null); setFpCaptchaCode('');
    setFpCode(''); setFpNewPwd(''); setFpConfirmPwd('');
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

  // 发送短信验证码
  const handleSendCode = useCallback(async () => {
    if (!/^1\d{10}$/.test(phone.trim())) { showError('请输入有效的手机号'); return; }
    setCodeSending(true);
    const r = await AuthRepo.requestSmsCode(phone);
    setCodeSending(false);
    if (!r.ok) { showError(r.error.displayMessage ?? '发送失败'); return; }
    showSuccess('验证码已发送');
    startCountdown();
  }, [phone, showError, showSuccess, startCountdown]);

  // 微信授权（登录/注册通用，后端自动创建账号）
  // C40c4: react-native-wechat-lib 真实 SDK 集成 + Mock 回退（USE_MOCK / Expo Go 返回假 code）
  const handleWeChat = useCallback(async () => {
    setSubmitting(true);
    try {
      let wxCode: string;
      try {
        wxCode = await requestWechatAuth();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '微信授权失败';
        showError(msg);
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

    // 手机号验证
    if (!/^1\d{10}$/.test(phone.trim())) { showError('请输入有效的手机号'); return; }

    // 登录
    if (isLogin) {
      if (loginMode === 'password') {
        if (password.trim().length < 6) { showError('请输入至少 6 位密码'); return; }
      } else {
        if (code.trim().length < 4) { showError('请输入验证码'); return; }
      }
      setSubmitting(true);
      try {
        const r = await AuthRepo.loginWithPhone({ phone, code, password, mode: loginMode });
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
      const r = await AuthRepo.registerWithPhone({ phone, code, name: nickname, password });
      if (!r.ok) { showError(r.error.displayMessage ?? '注册失败'); return; }
      await onAuthSuccess(r.data, '注册成功');
    } finally {
      setSubmitting(false);
    }
  }, [isLogin, phone, code, password, nickname, agreed, loginMode, showError, onAuthSuccess]);

  // ---- 忘记密码向导 ----

  // 加载图形验证码
  const fetchFpCaptcha = useCallback(async () => {
    const r = await AuthRepo.getCaptcha();
    if (r.ok) setFpCaptcha(r.data);
    else showError(r.error.displayMessage ?? '加载图形验证码失败');
  }, [showError]);

  // 打开忘记密码向导
  const handleOpenForgotPassword = useCallback(() => {
    setErrorMsg(''); setSuccessMsg('');
    setFpStep(1);
    setFpCaptchaCode(''); setFpCode('');
    setFpNewPwd(''); setFpConfirmPwd('');
    if (cdRef.current) { clearInterval(cdRef.current); setCountdown(0); }
    setFlowMode('forgotPassword');
    fetchFpCaptcha();
  }, [fetchFpCaptcha]);

  // 返回登录态（从向导任意步骤点"返回"触发）
  const handleFpBackToAuth = useCallback(() => {
    setFlowMode('auth');
    setErrorMsg(''); setSuccessMsg('');
    setFpStep(1);
    setFpCaptchaCode(''); setFpCode('');
    setFpNewPwd(''); setFpConfirmPwd('');
    if (cdRef.current) { clearInterval(cdRef.current); setCountdown(0); }
  }, []);

  // Step 1 → Step 2：提交手机号 + 图形码，触发发送短信
  const handleFpSubmitStep1 = useCallback(async () => {
    if (!/^1\d{10}$/.test(phone.trim())) { showError('请输入有效的手机号'); return; }
    if (!fpCaptchaCode.trim()) { showError('请输入图形验证码'); return; }
    if (!fpCaptcha) { showError('图形验证码未加载'); return; }
    setSubmitting(true);
    try {
      const r = await AuthRepo.sendForgotPasswordCode({
        phone: phone.trim(),
        captchaId: fpCaptcha.captchaId,
        captchaCode: fpCaptchaCode.trim(),
      });
      if (!r.ok) {
        const bc = r.error.businessCode;
        showError(r.error.displayMessage ?? '验证码发送失败');
        // 图形验证码错误：自动刷新图形码 + 清空输入，用户无需手动点刷新
        if (bc === 'CAPTCHA_INVALID') {
          fetchFpCaptcha();
          setFpCaptchaCode('');
        }
        return;
      }
      setFpStep(2);
      startCountdown();
      showSuccess('验证码已发送');
    } finally {
      setSubmitting(false);
    }
  }, [phone, fpCaptcha, fpCaptchaCode, fetchFpCaptcha, showError, showSuccess, startCountdown]);

  // Step 2 倒计时结束后重发：回到 Step 1 重新走图形码（防短信炸弹）
  const handleFpResendCode = useCallback(() => {
    setFpStep(1);
    setFpCode('');
    fetchFpCaptcha();
    setFpCaptchaCode('');
  }, [fetchFpCaptcha]);

  // Step 2 → Step 3：短信验证码输入完成
  const handleFpSubmitStep2 = useCallback(() => {
    if (fpCode.trim().length < 4) { showError('请输入验证码'); return; }
    setErrorMsg('');
    setFpStep(3);
  }, [fpCode, showError]);

  // Step 3：提交新密码
  const handleFpSubmitStep3 = useCallback(async () => {
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/.test(fpNewPwd)) {
      showError('密码至少 6 位，且需包含大写、小写字母和数字');
      return;
    }
    if (fpNewPwd !== fpConfirmPwd) { showError('两次密码不一致'); return; }

    setSubmitting(true);
    try {
      const r = await AuthRepo.resetForgotPassword({
        phone: phone.trim(),
        code: fpCode.trim(),
        newPassword: fpNewPwd,
      });
      if (!r.ok) {
        showError(r.error.displayMessage ?? '密码重置失败');
        return;
      }
      // 成功：回到登录态，预填手机号到密码登录表单
      setFlowMode('auth');
      setTab('login');
      setLoginMode('password');
      setPassword('');
      setFpStep(1); setFpCaptchaCode(''); setFpCode(''); setFpNewPwd(''); setFpConfirmPwd('');
      setErrorMsg('');
      showSuccess('密码已重置，请用新密码登录');
    } finally {
      setSubmitting(false);
    }
  }, [phone, fpCode, fpNewPwd, fpConfirmPwd, showError, showSuccess]);

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
    <Modal transparent visible={open} animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
        {/* KAV 用 padding 模式（两平台一致），flex:1 占满 Modal Window，alignItems/justifyContent
            让卡片始终居中。键盘弹起时 KAV 加 padding-bottom = 键盘高度，居中位置自然上移。
            ⚠️ 之前包了 ScrollView 反而更糟：ScrollView 的 auto-scroll-to-focused-input
            会把聚焦的输入框滚到接近底部，导致卡片顶部"欢迎回来"被推出可见区。
            卡片本身 ~440dp 在键盘上方 ~530dp 完全装得下，不需要内层滚动。 */}
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.kavFill}
          pointerEvents="box-none"
        >
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
              {flowMode === 'forgotPassword' ? (
                <>
                  {/* 忘记密码 - 头部：返回 + 标题 + 关闭 */}
                  <View style={styles.headerRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Pressable
                        onPress={handleFpBackToAuth}
                        hitSlop={12}
                        style={[styles.closeBtn, { backgroundColor: colors.bgSecondary, marginRight: 10 }]}
                      >
                        <MaterialCommunityIcons name="arrow-left" size={16} color={colors.text.secondary} />
                      </Pressable>
                      <View>
                        <Text style={[typography.title3, { color: colors.text.primary }]}>找回密码</Text>
                        <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 2 }]}>
                          第 {fpStep} / 3 步
                        </Text>
                      </View>
                    </View>
                    <Pressable onPress={handleClose} hitSlop={12} style={[styles.closeBtn, { backgroundColor: colors.bgSecondary }]}>
                      <MaterialCommunityIcons name="close" size={16} color={colors.text.secondary} />
                    </Pressable>
                  </View>

                  {/* Step 1：手机号 + 图形验证码 */}
                  {fpStep === 1 && (
                    <>
                      {renderInput({
                        label: '手机号',
                        value: phone,
                        onChange: setPhone,
                        placeholder: '请输入 11 位手机号',
                        kbType: 'phone-pad',
                        maxLen: 11,
                      })}
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={[typography.captionSm, { color: colors.text.secondary, marginBottom: 3, marginLeft: 2 }]}>
                          图形验证码
                        </Text>
                        <View style={[styles.inputRow, { backgroundColor: colors.bgSecondary, borderRadius: radius.lg }]}>
                          <TextInput
                            value={fpCaptchaCode}
                            onChangeText={setFpCaptchaCode}
                            placeholder="请输入图中字符"
                            placeholderTextColor={colors.muted}
                            autoCapitalize="none"
                            maxLength={8}
                            style={[styles.inputField, typography.bodySm, { color: colors.text.primary }]}
                          />
                          <Pressable onPress={fetchFpCaptcha} style={styles.captchaBox}>
                            {/* 仅当 svg 字段合法（包含 <svg 标签且非空标签）时才渲染，避免 SvgXml 解析空/畸形字符串崩溃 */}
                            {fpCaptcha && fpCaptcha.svg && /<svg[\s>]/.test(fpCaptcha.svg) && !/<svg\s*\/>/.test(fpCaptcha.svg) ? (
                              <SvgXml xml={fpCaptcha.svg} width="100%" height="100%" />
                            ) : (
                              <ActivityIndicator size="small" color={colors.brand.primary} />
                            )}
                          </Pressable>
                        </View>
                      </View>
                    </>
                  )}

                  {/* Step 2：短信验证码 */}
                  {fpStep === 2 && (
                    <>
                      <View style={{ marginTop: spacing.sm, paddingHorizontal: 2 }}>
                        <Text style={[typography.captionSm, { color: colors.text.secondary }]}>
                          短信已发送至 {phone.slice(0, 3)}****{phone.slice(-4)}
                        </Text>
                      </View>
                      {renderInput({
                        label: '短信验证码',
                        value: fpCode,
                        onChange: setFpCode,
                        placeholder: '请输入 6 位短信验证码',
                        kbType: 'number-pad',
                        maxLen: 6,
                        right: (
                          <Pressable
                            onPress={handleFpResendCode}
                            disabled={countdown > 0}
                            style={[styles.codeBtn, { backgroundColor: countdown > 0 ? colors.bgSecondary : colors.brand.primarySoft, borderRadius: radius.md }]}
                          >
                            <Text style={[typography.captionSm, { color: countdown > 0 ? colors.muted : colors.brand.primary }]}>
                              {countdown > 0 ? `${countdown}s` : '重新发送'}
                            </Text>
                          </Pressable>
                        ),
                      })}
                    </>
                  )}

                  {/* Step 3：新密码 */}
                  {fpStep === 3 && (
                    <>
                      {renderInput({
                        label: '新密码',
                        value: fpNewPwd,
                        onChange: setFpNewPwd,
                        placeholder: '至少 6 位，含大小写字母和数字',
                        secure: !showPwd,
                        right: eyeButton,
                      })}
                      {renderInput({
                        label: '确认密码',
                        value: fpConfirmPwd,
                        onChange: setFpConfirmPwd,
                        placeholder: '再次输入新密码',
                        secure: !showPwd,
                      })}
                      {/* 密码规则提示 */}
                      <View style={{ marginTop: spacing.sm, paddingHorizontal: 2 }}>
                        <Text style={[typography.captionSm, { color: colors.text.secondary, lineHeight: 16 }]}>
                          {/^.{6,}$/.test(fpNewPwd) ? '✓' : '○'} ≥6 位    {/[A-Z]/.test(fpNewPwd) ? '✓' : '○'} 大写字母    {/[a-z]/.test(fpNewPwd) ? '✓' : '○'} 小写字母    {/\d/.test(fpNewPwd) ? '✓' : '○'} 数字
                        </Text>
                      </View>
                    </>
                  )}

                  {/* 内联提示 */}
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

                  {/* 主按钮 */}
                  <Pressable
                    onPress={
                      fpStep === 1 ? handleFpSubmitStep1
                        : fpStep === 2 ? handleFpSubmitStep2
                        : handleFpSubmitStep3
                    }
                    disabled={submitting}
                    style={{ marginTop: (errorMsg || successMsg) ? spacing.sm : spacing.md }}
                  >
                    <LinearGradient
                      colors={[colors.brand.primary, colors.brand.primaryLight]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={[styles.primaryBtn, { borderRadius: radius.pill, opacity: submitting ? 0.7 : 1 }]}
                    >
                      {submitting
                        ? <ActivityIndicator size="small" color={colors.text.inverse} />
                        : <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                            {fpStep === 3 ? '重置密码' : '下一步'}
                          </Text>
                      }
                    </LinearGradient>
                  </Pressable>
                </>
              ) : (
                <>
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

              {/* ===== 表单区域 ===== */}

              {/* 验证码/密码模式切换（仅登录时显示） */}
              {isLogin && (
                <View style={[styles.loginModeRow, { marginTop: spacing.md }]}>
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

              {/* 手机号输入 */}
              {renderInput({ label: '手机号', value: phone, onChange: setPhone, placeholder: '请输入 11 位手机号', kbType: 'phone-pad', maxLen: 11 })}

              {/* 验证码 / 密码 */}
              {isLogin && loginMode === 'password'
                ? renderInput({ label: '密码', value: password, onChange: setPassword, placeholder: '请输入密码', secure: !showPwd, right: eyeButton })
                : renderInput({ label: '验证码', value: code, onChange: setCode, placeholder: '请输入短信验证码', kbType: 'number-pad', maxLen: 6, right: codeButton })
              }

              {/* 忘记密码？链接（仅密码登录模式显示） */}
              {isLogin && loginMode === 'password' && (
                <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
                  <Pressable onPress={handleOpenForgotPassword} hitSlop={6}>
                    <Text style={[typography.captionSm, { color: colors.brand.primary }]}>忘记密码？</Text>
                  </Pressable>
                </View>
              )}

              {/* 注册额外字段：昵称 + 密码 + 协议 */}
              {!isLogin && (
                <>
                  {renderInput({ label: '昵称', value: nickname, onChange: setNickname, placeholder: '2-12 个字', maxLen: 12 })}
                  {renderInput({ label: '设置密码', value: password, onChange: setPassword, placeholder: '至少 6 位', secure: !showPwd, right: eyeButton })}
                  <View style={[styles.agreementRow, { marginTop: spacing.sm }]}>
                    <Pressable onPress={() => setAgreed(!agreed)} hitSlop={6}>
                      <MaterialCommunityIcons
                        name={agreed ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={16}
                        color={agreed ? colors.brand.primary : colors.muted}
                      />
                    </Pressable>
                    <Text
                      style={[
                        typography.captionSm,
                        { color: colors.text.secondary, marginLeft: 5, flex: 1, lineHeight: 18 },
                      ]}
                    >
                      <Text onPress={() => setAgreed(!agreed)}>我已阅读并同意</Text>
                      <Text
                        style={{ color: colors.brand.primary }}
                        onPress={() => {
                          handleClose();
                          router.push('/terms');
                        }}
                      >
                        《用户协议》
                      </Text>
                      <Text onPress={() => setAgreed(!agreed)}>和</Text>
                      <Text
                        style={{ color: colors.brand.primary }}
                        onPress={() => {
                          handleClose();
                          router.push('/privacy');
                        }}
                      >
                        《隐私政策》
                      </Text>
                    </Text>
                  </View>
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
                </>
              )}
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
  // KAV 必须 flex:1 + center 才能让卡片居中且键盘 padding 触发上移
  kavFill: {
    flex: 1,
    width: '100%',
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
  captchaBox: {
    width: 100,
    height: 38,
    marginLeft: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
