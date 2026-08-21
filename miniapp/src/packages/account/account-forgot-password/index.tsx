import { Button, Image, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isMainlandPhone, isSmsCode } from '@/components/account-utils';
import {
  getForgotPasswordCaptcha,
  normalizeAuthReturnUrl,
  resetForgotPassword,
  sendForgotPasswordCode,
} from '@/platform/auth';
import { logoutAndClearClientState } from '@/session/clientState';
import './index.scss';

type Captcha = { captchaId: string; svg: string };

function captchaDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function AccountForgotPasswordPage() {
  const router = useRouter();
  const returnUrl = normalizeAuthReturnUrl(typeof router.params.returnUrl === 'string' ? router.params.returnUrl : undefined);
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [captcha, setCaptcha] = useState<Captcha>();
  const [captchaCode, setCaptchaCode] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const loadingCaptchaRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const loadCaptcha = useCallback(async () => {
    if (loadingCaptchaRef.current) return;
    loadingCaptchaRef.current = true;
    setLoadingCaptcha(true);
    try {
      const result = await getForgotPasswordCaptcha();
      if (!result.ok) {
        Taro.showToast({ title: result.error.displayMessage || '图形验证码加载失败', icon: 'none' });
        return;
      }
      setCaptcha(result.data);
      setCaptchaCode('');
    } finally {
      loadingCaptchaRef.current = false;
      setLoadingCaptcha(false);
    }
  }, []);

  useEffect(() => { void loadCaptcha(); }, [loadCaptcha]);

  const sendCode = async () => {
    if (!isMainlandPhone(phone)) { Taro.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
    if (!captcha || captchaCode.trim().length < 4) { Taro.showToast({ title: '请输入图形验证码', icon: 'none' }); return; }
    if (submitting) return;
    setSubmitting(true);
    const result = await sendForgotPasswordCode({
      phone: phone.trim(),
      captchaId: captcha.captchaId,
      captchaCode: captchaCode.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      Taro.showToast({ title: result.error.displayMessage || '验证码发送失败', icon: 'none' });
      await loadCaptcha();
      return;
    }
    setStep(2);
    setCountdown(60);
    Taro.showToast({ title: '短信验证码已发送', icon: 'success' });
  };

  const resetPassword = async () => {
    if (!isSmsCode(smsCode)) { Taro.showToast({ title: '请输入 6 位短信验证码', icon: 'none' }); return; }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/.test(newPassword)) {
      Taro.showToast({ title: '密码需包含大小写字母和数字', icon: 'none' });
      return;
    }
    if (newPassword !== confirmPassword) { Taro.showToast({ title: '两次密码不一致', icon: 'none' }); return; }
    if (submitting) return;
    setSubmitting(true);
    const result = await resetForgotPassword({ phone: phone.trim(), code: smsCode.trim(), newPassword });
    setSubmitting(false);
    if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '密码重置失败', icon: 'none' }); return; }
    // 服务端已撤销包括当前设备在内的所有会话；同步清理本地 token，避免登录页误判“已登录”。
    logoutAndClearClientState();
    Taro.showToast({ title: '密码已重置', icon: 'success' });
    const loginUrl = `/packages/account/account-login/index${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`;
    setTimeout(() => { void Taro.redirectTo({ url: loginUrl }); }, 420);
  };

  return <View className='aim-page account-forgot-page'>
    <View className='account-forgot-hero'>
      <Text className='account-forgot-hero__step'>安全验证 · {step}/2</Text>
      <Text className='account-forgot-hero__title'>{step === 1 ? '验证你的手机号' : '设置新密码'}</Text>
      <Text className='account-forgot-hero__description'>{step === 1 ? '先完成图形验证，我们再向已注册手机号发送短信。' : `验证码已发送至 ${phone.slice(0, 3)}****${phone.slice(-4)}。`}</Text>
    </View>
    <View className='account-forgot-card aim-card'>
      {step === 1 ? <>
        <View className='account-forgot-field'><Text className='account-forgot-field__label'>手机号</Text><Input className='account-forgot-field__input' type='number' maxlength={11} value={phone} placeholder='请输入已注册手机号' onInput={(event) => setPhone(event.detail.value.replace(/\D/g, '').slice(0, 11))} /></View>
        <View className='account-forgot-field'><Text className='account-forgot-field__label'>图形验证码</Text><View className='account-forgot-captcha-row'><Input className='account-forgot-field__input' maxlength={8} value={captchaCode} placeholder='请输入图中字符' onInput={(event) => setCaptchaCode(event.detail.value)} />{captcha ? <Image className='account-forgot-captcha' src={captchaDataUri(captcha.svg)} mode='aspectFit' onClick={loadCaptcha} /> : <View className='account-forgot-captcha' />}</View><Text className='account-forgot-refresh' onClick={loadCaptcha}>{loadingCaptcha ? '正在加载...' : '看不清，换一张'}</Text></View>
        <Button className='account-forgot-primary' loading={submitting} disabled={submitting} onClick={sendCode}>发送短信验证码</Button>
      </> : <>
        <View className='account-forgot-field'><Text className='account-forgot-field__label'>短信验证码</Text><Input className='account-forgot-field__input' type='number' maxlength={6} value={smsCode} placeholder='6 位验证码' onInput={(event) => setSmsCode(event.detail.value.replace(/\D/g, '').slice(0, 6))} /></View>
        <View className='account-forgot-field'><Text className='account-forgot-field__label'>新密码</Text><Input className='account-forgot-field__input' password maxlength={128} value={newPassword} placeholder='至少 6 位，包含大小写字母和数字' onInput={(event) => setNewPassword(event.detail.value)} /></View>
        <View className='account-forgot-field'><Text className='account-forgot-field__label'>确认新密码</Text><Input className='account-forgot-field__input' password maxlength={128} value={confirmPassword} placeholder='再输入一次新密码' onInput={(event) => setConfirmPassword(event.detail.value)} /></View>
        <Button className='account-forgot-primary' loading={submitting} disabled={submitting} onClick={resetPassword}>确认重置</Button>
        <Button className='account-forgot-secondary' disabled={countdown > 0} onClick={() => { setStep(1); setSmsCode(''); void loadCaptcha(); }}>{countdown > 0 ? `${countdown}s 后可重新发送` : '重新获取验证码'}</Button>
      </>}
      <Text className='account-forgot-tip'>重置成功后，旧设备上的登录会话将失效。</Text>
    </View>
  </View>;
}
