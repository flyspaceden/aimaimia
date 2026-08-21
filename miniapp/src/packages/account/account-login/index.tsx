import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import {
  completeAuthNavigation,
  bindWechatMiniappPhone,
  completeWechatMiniappRegistration,
  loginWithWechatMiniProgram,
  normalizeAuthReturnUrl,
  sendWechatMiniappBindPhoneCode,
} from '@/platform/auth';
import { useAuthStore } from '@/store/auth';
import { isMainlandPhone, isSmsCode } from '@/components/account-utils';
import './index.scss';

export default function AccountLoginPage() {
  const router = useRouter();
  const returnUrl = normalizeAuthReturnUrl(
    typeof router.params.returnUrl === 'string' ? router.params.returnUrl : undefined,
  );
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingTicket, setPendingTicket] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  const openLegal = (document: 'terms' | 'privacy') => {
    void Taro.navigateTo({
      url: `/packages/account/account-legal/index?document=${document}`,
    });
  };

  const requireAgreement = (): boolean => {
    if (agreed) return true;
    Taro.showToast({ title: '请先阅读并同意用户协议与隐私政策', icon: 'none' });
    return false;
  };

  const loginWechat = async () => {
    if (submitting || !requireAgreement()) return;

    setSubmitting(true);
    const result = await loginWithWechatMiniProgram();
    setSubmitting(false);
    if (!result.ok) {
      Taro.showToast({ title: result.error.displayMessage || '微信登录失败，请稍后重试', icon: 'none' });
      return;
    }
    if ('requiresAccountChoice' in result.data) {
      setPendingTicket(result.data.miniLoginTicket);
      return;
    }

    Taro.showToast({
      title: '登录成功',
      icon: 'success',
    });
    setTimeout(() => { void completeAuthNavigation(returnUrl); }, 420);
  };

  const createAccount = async () => {
    setSubmitting(true);
    const result = await completeWechatMiniappRegistration(pendingTicket);
    setSubmitting(false);
    if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '创建账号失败', icon: 'none' }); return; }
    void completeAuthNavigation(returnUrl);
  };
  const sendMergeCode = async () => {
    if (!isMainlandPhone(phone)) { Taro.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
    const result = await sendWechatMiniappBindPhoneCode(pendingTicket, phone.trim());
    if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '验证码发送失败', icon: 'none' }); return; }
    setCountdown(60);
    const timer = setInterval(() => setCountdown((value) => { if (value <= 1) { clearInterval(timer); return 0; } return value - 1; }), 1000);
  };
  const mergeAccount = async () => {
    if (!isMainlandPhone(phone) || !isSmsCode(smsCode)) { Taro.showToast({ title: '请输入手机号和 6 位验证码', icon: 'none' }); return; }
    setSubmitting(true);
    const result = await bindWechatMiniappPhone(pendingTicket, phone.trim(), smsCode.trim());
    setSubmitting(false);
    if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '账号合并失败', icon: 'none' }); return; }
    void completeAuthNavigation(returnUrl);
  };

  if (!hydrated) {
    return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  }

  if (loggedIn) {
    return <View className='aim-page account-login-page'>
      <View className='account-login-done aim-card'>
        <View className='account-login-done__mark'>✓</View>
        <Text className='account-login-done__title'>当前账户已登录</Text>
        <Button className='account-login-done__button' onClick={() => { void completeAuthNavigation(returnUrl); }}>继续访问</Button>
      </View>
    </View>;
  }

  if (pendingTicket) return <View className='aim-page account-login-page'><View className='account-login-card aim-card'>
    <Text className='account-login-hero__title'>选择账号方式</Text>
    <Text>这个微信尚未关联爱买买账号。可新建微信账号，或验证手机号合并既有账号。</Text>
    <Button className='account-login-wechat' loading={submitting} onClick={createAccount}>作为新用户继续</Button>
    <View className='account-login-agreement'><Input type='number' maxlength={11} value={phone} placeholder='已有账号的手机号' onInput={(event) => setPhone(event.detail.value.replace(/\D/g, '').slice(0, 11))} /></View>
    <View className='account-login-agreement'><Input type='number' maxlength={6} value={smsCode} placeholder='6 位短信验证码' onInput={(event) => setSmsCode(event.detail.value.replace(/\D/g, '').slice(0, 6))} /><Button disabled={countdown > 0} onClick={sendMergeCode}>{countdown ? `${countdown}s` : '发验证码'}</Button></View>
    <Button className='account-login-done__button' loading={submitting} onClick={mergeAccount}>合并已有手机号账号</Button>
    <Text onClick={() => setPendingTicket('')}>返回重新选择微信</Text>
  </View></View>;

  return <View className='aim-page account-login-page'>
    <View className='account-login-hero'>
      <View className='account-login-hero__orbit'><View className='account-login-hero__core'>爱</View></View>
      <Text className='account-login-hero__title'>微信登录AI爱买买</Text>
    </View>

    <View className='account-login-card aim-card'>
      <View className='account-login-agreement' onClick={() => setAgreed((value) => !value)}>
        <View className={agreed ? 'account-login-agreement__box account-login-agreement__box--checked' : 'account-login-agreement__box'}>{agreed ? '✓' : ''}</View>
        <Text>我已阅读并同意</Text>
        <Text className='account-login-agreement__link' onClick={(event) => { event.stopPropagation(); openLegal('terms'); }}>《用户协议》</Text>
        <Text>与</Text>
        <Text className='account-login-agreement__link' onClick={(event) => { event.stopPropagation(); openLegal('privacy'); }}>《隐私政策》</Text>
      </View>

      <Button className='account-login-wechat' loading={submitting} disabled={submitting} onClick={loginWechat}>
        <Text className='account-login-wechat__mark'>微</Text>{submitting ? '正在登录...' : '微信登录'}
      </Button>
    </View>
  </View>;
}
