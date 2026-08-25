import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import {
  completeAuthNavigation,
  bindWechatMiniappPhone,
  completeWechatMiniappRegistration,
  loginWithWechatMiniProgram,
  normalizeAuthReturnUrl,
  sendWechatMiniappBindPhoneCode,
  supersedePendingMiniappAuthAttempts,
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
  const [allowWechatOnlyRegistration, setAllowWechatOnlyRegistration] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => () => {
    supersedePendingMiniappAuthAttempts();
  }, []);

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
    if ('requiresPhoneBinding' in result.data) {
      setPendingTicket(result.data.miniLoginTicket);
      setAllowWechatOnlyRegistration(result.data.allowWechatOnlyRegistration);
      return;
    }

    Taro.showToast({
      title: '登录成功',
      icon: 'success',
    });
    setTimeout(() => { void completeAuthNavigation(returnUrl); }, 420);
  };

  const createAccount = async () => {
    if (submitting || !pendingTicket || !allowWechatOnlyRegistration) return;
    setSubmitting(true);
    try {
      const result = await completeWechatMiniappRegistration(pendingTicket);
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '创建账号失败', icon: 'none' }); return; }
      void completeAuthNavigation(returnUrl);
    } finally {
      setSubmitting(false);
    }
  };

  const sendMergeCode = async () => {
    if (submitting || countdown > 0 || !pendingTicket) return;
    if (!isMainlandPhone(phone)) { Taro.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
    setSubmitting(true);
    try {
      const result = await sendWechatMiniappBindPhoneCode(pendingTicket, phone.trim());
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '验证码发送失败', icon: 'none' }); return; }
      setCountdown(60);
      const timer = setInterval(() => setCountdown((value) => { if (value <= 1) { clearInterval(timer); return 0; } return value - 1; }), 1000);
    } finally {
      setSubmitting(false);
    }
  };
  const mergeAccount = async () => {
    if (submitting || !pendingTicket) return;
    if (!isMainlandPhone(phone) || !isSmsCode(smsCode)) { Taro.showToast({ title: '请输入手机号和 6 位验证码', icon: 'none' }); return; }
    setSubmitting(true);
    try {
      const result = await bindWechatMiniappPhone(pendingTicket, phone.trim(), smsCode.trim());
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '账号合并失败', icon: 'none' }); return; }
      void completeAuthNavigation(returnUrl);
    } finally {
      setSubmitting(false);
    }
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

  if (pendingTicket) return <View className='aim-page account-login-page'>
    <View className='account-login-bind aim-card'>
      <View className='account-login-bind__verified'>
        <View className='account-login-bind__verified-mark'>微</View>
        <View>
          <Text className='account-login-bind__verified-title'>微信身份已确认</Text>
          <Text className='account-login-bind__verified-copy'>继续验证手机号，避免和 AI爱买买 App 账号重复</Text>
        </View>
      </View>

      <Text className='account-login-bind__title'>绑定手机号并登录</Text>
      <Text className='account-login-bind__copy'>{allowWechatOnlyRegistration
        ? '如果你曾在 AI爱买买 App 使用手机号登录，请先验证该手机号，避免产生重复账号。未注册手机号会创建一个同时绑定微信和手机号的新账号。'
        : '为了避免和 App 里的原账号重复，当前微信必须先验证手机号。已注册手机号会登录原账号；未注册手机号会创建一个同时绑定微信和手机号的新账号。'}</Text>

      <View className='account-login-bind__field'>
        <Text className='account-login-bind__label'>手机号</Text>
        <Input className='account-login-bind__input' type='number' maxlength={11} value={phone} placeholder='请输入本人手机号' onInput={(event) => setPhone(event.detail.value.replace(/\D/g, '').slice(0, 11))} />
      </View>
      <View className='account-login-bind__field'>
        <Text className='account-login-bind__label'>短信验证码</Text>
        <View className='account-login-bind__code'>
          <Input className='account-login-bind__input' type='number' maxlength={6} value={smsCode} placeholder='请输入 6 位验证码' onInput={(event) => setSmsCode(event.detail.value.replace(/\D/g, '').slice(0, 6))} />
          <Button className='account-login-bind__send' disabled={submitting || countdown > 0 || !isMainlandPhone(phone)} onClick={sendMergeCode}>{countdown ? `${countdown}s 后重发` : '发送验证码'}</Button>
        </View>
      </View>

      <Button className='account-login-bind__submit' loading={submitting} disabled={submitting || !isMainlandPhone(phone) || !isSmsCode(smsCode)} onClick={mergeAccount}>{submitting ? '正在绑定...' : '绑定手机号并登录'}</Button>
      <Text className='account-login-bind__note'>一个手机号只对应一个 AI爱买买账号；验证成功后，App 与小程序将使用同一账号。</Text>
      {allowWechatOnlyRegistration ? <View className='account-login-bind__new'>
        <Text className='account-login-bind__new-divider'>没有使用手机号注册过 AI爱买买？</Text>
        <Button className='account-login-bind__new-button' loading={submitting} disabled={submitting} onClick={createAccount}>直接使用微信创建账号</Button>
      </View> : null}
      <Text className='account-login-bind__back' onClick={() => { if (!submitting) { setPendingTicket(''); setAllowWechatOnlyRegistration(false); } }}>重新验证微信身份</Text>
    </View>
  </View>;

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
