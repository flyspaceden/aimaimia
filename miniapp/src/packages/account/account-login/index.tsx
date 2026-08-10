import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import { isMainlandPhone, isSmsCode } from '@/components/account-utils';
import {
  bindMiniappPhone,
  completeAuthNavigation,
  loginWithPhone,
  loginWithWechatMiniProgram,
  normalizeAuthReturnUrl,
  registerWithPhone,
  requestPhoneSmsCode,
  sendMiniappBindPhoneCode,
  type MiniappBindingRequired,
} from '@/platform/auth';
import { useAuthStore } from '@/store/auth';
import './index.scss';

type AuthTab = 'login' | 'register';
type LoginMode = 'code' | 'password';

export default function AccountLoginPage() {
  const router = useRouter();
  const returnUrl = normalizeAuthReturnUrl(
    typeof router.params.returnUrl === 'string' ? router.params.returnUrl : undefined,
  );
  const requireWechat = router.params.requireWechat === '1';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const loginMethod = useAuthStore((state) => state.loginMethod);
  const currentUserId = useAuthStore((state) => state.userId);
  const [binding, setBinding] = useState<MiniappBindingRequired>();
  const [tab, setTab] = useState<AuthTab>('login');
  const [loginMode, setLoginMode] = useState<LoginMode>('code');
  const [agreed, setAgreed] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const finish = (title = '登录成功') => {
    Taro.showToast({ title, icon: 'success' });
    setTimeout(() => { void completeAuthNavigation(returnUrl); }, 420);
  };

  const requireAgreement = (): boolean => {
    if (requireWechat && loggedIn) return true;
    if (agreed) return true;
    Taro.showToast({ title: '请先阅读并同意用户协议与隐私政策', icon: 'none' });
    return false;
  };

  const openLegal = (document: 'terms' | 'privacy') => {
    void Taro.navigateTo({
      url: `/packages/account/account-legal/index?document=${document}`,
    });
  };

  const sendCode = async () => {
    if (sending || countdown > 0) return;
    if (!isMainlandPhone(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    setSending(true);
    const result = binding
      ? await sendMiniappBindPhoneCode(binding.miniLoginTicket, phone.trim())
      : await requestPhoneSmsCode(phone.trim());
    setSending(false);
    if (!result.ok || !result.data.ok) {
      Taro.showToast({
        title: !result.ok ? result.error.displayMessage || '验证码发送失败' : '验证码发送失败',
        icon: 'none',
      });
      return;
    }
    setCountdown(60);
    Taro.showToast({ title: '验证码已发送', icon: 'success' });
  };

  const submitPhoneAuth = async () => {
    if (submitting || !requireAgreement()) return;
    if (!isMainlandPhone(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    if (tab === 'login' && loginMode === 'code' && !isSmsCode(code)) {
      Taro.showToast({ title: '请输入 6 位短信验证码', icon: 'none' });
      return;
    }
    if ((tab === 'register' || loginMode === 'password') && password.length < 6) {
      Taro.showToast({ title: '密码至少 6 位', icon: 'none' });
      return;
    }
    if (tab === 'register') {
      if (!isSmsCode(code)) {
        Taro.showToast({ title: '请输入 6 位短信验证码', icon: 'none' });
        return;
      }
      if (nickname.trim().length < 2 || nickname.trim().length > 12) {
        Taro.showToast({ title: '昵称需要 2-12 个字', icon: 'none' });
        return;
      }
    }

    setSubmitting(true);
    const result = tab === 'register'
      ? await registerWithPhone({
        phone: phone.trim(),
        code: code.trim(),
        name: nickname.trim(),
        password,
      })
      : await loginWithPhone({
        phone: phone.trim(),
        mode: loginMode,
        ...(loginMode === 'code' ? { code: code.trim() } : { password }),
      });
    setSubmitting(false);
    if (!result.ok) {
      Taro.showToast({ title: result.error.displayMessage || (tab === 'register' ? '注册失败' : '登录失败'), icon: 'none' });
      return;
    }
    finish(tab === 'register' ? '注册成功' : '登录成功');
  };

  const loginWechat = async () => {
    if (submitting || !requireAgreement()) return;
    if (requireWechat && (!loggedIn || !currentUserId)) {
      Taro.showToast({ title: '当前登录状态异常，请重新登录', icon: 'none' });
      return;
    }
    setSubmitting(true);
    const result = await loginWithWechatMiniProgram(requireWechat ? currentUserId : undefined);
    setSubmitting(false);
    if (!result.ok) {
      Taro.showToast({ title: result.error.displayMessage || '微信登录失败', icon: 'none' });
      return;
    }
    if ('bindRequired' in result.data && result.data.bindRequired) {
      setBinding(result.data);
      setPhone('');
      setCode('');
      setCountdown(0);
      Taro.showToast({ title: '请验证本人手机号', icon: 'none' });
      return;
    }
    finish(requireWechat ? '微信身份验证成功' : '登录成功');
  };

  const submitBinding = async () => {
    if (!binding || submitting) return;
    if (!isMainlandPhone(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    if (!isSmsCode(code)) {
      Taro.showToast({ title: '请输入 6 位短信验证码', icon: 'none' });
      return;
    }
    setSubmitting(true);
    const result = await bindMiniappPhone(binding.miniLoginTicket, phone.trim(), code.trim(), requireWechat ? currentUserId : undefined);
    setSubmitting(false);
    if (!result.ok) {
      Taro.showToast({ title: result.error.displayMessage || '手机号绑定失败', icon: 'none' });
      return;
    }
    finish(requireWechat ? '微信身份验证成功' : '登录成功');
  };

  if (!hydrated) return <View className='aim-page'><AccountFeedback kind='loading' /></View>;
  if (loggedIn && !binding && requireWechat && loginMethod !== 'wechat-miniapp') {
    return <View className='aim-page account-login-page'><View className='account-login-done aim-card'><View className='account-login-done__mark'>微</View><Text className='account-login-done__title'>请使用当前微信身份继续</Text><Text className='account-login-hero__description'>微信支付和提现需要将订单或到账身份与当前小程序微信匹配。验证后会自动返回原页面。</Text><Button className='account-login-done__button' loading={submitting} disabled={submitting} onClick={loginWechat}>{submitting ? '验证中...' : '使用微信身份继续'}</Button></View></View>;
  }
  if (loggedIn && !binding) {
    return <View className='aim-page account-login-page'><View className='account-login-done aim-card'><View className='account-login-done__mark'>✓</View><Text className='account-login-done__title'>当前账户已登录</Text><Button className='account-login-done__button' onClick={() => { void completeAuthNavigation(returnUrl); }}>继续访问</Button></View></View>;
  }

  return <View className='aim-page account-login-page'>
    <View className='account-login-hero'>
      <View className='account-login-hero__orbit'><View className='account-login-hero__core'>爱</View></View>
      <Text className='account-login-hero__title'>{binding ? '绑定你的手机号' : '欢迎来到爱买买'}</Text>
      <Text className='account-login-hero__description'>{binding ? '用短信验证码确认本人手机号；已注册号码会合并原账户。' : '手机号和微信都可登录，已有爱买买账号可直接使用。'}</Text>
    </View>

    {binding ? <View className='account-bind-card aim-card'>
      <View className='account-bind-field'><Text className='account-bind-field__label'>手机号</Text><Input className='account-bind-field__input' type='number' maxlength={11} value={phone} placeholder='请输入本人手机号' onInput={(event) => setPhone(event.detail.value.replace(/\D/g, '').slice(0, 11))} /></View>
      <View className='account-bind-field'><Text className='account-bind-field__label'>验证码</Text><View className='account-bind-code'><Input className='account-bind-field__input' type='number' maxlength={6} value={code} placeholder='6 位短信验证码' onInput={(event) => setCode(event.detail.value.replace(/\D/g, '').slice(0, 6))} /><Button className='account-bind-code__button' disabled={sending || countdown > 0} onClick={sendCode}>{sending ? '发送中' : countdown > 0 ? `${countdown}s` : '发送验证码'}</Button></View></View>
      <Button className='account-login-primary' loading={submitting} disabled={submitting} onClick={submitBinding}>{submitting ? '正在绑定...' : '确认绑定并登录'}</Button>
      <Text className='account-bind-tip'>{requireWechat ? '必须填写当前已登录爱买买账号的绑定手机号；绑定结果与原账号不一致时会立即阻止。' : '一个账户只能绑定一个手机号，请确认手机号属于本人。'}</Text>
      <Text className='account-bind-restart' onClick={() => { setBinding(undefined); setPhone(''); setCode(''); setCountdown(0); }}>重新微信登录</Text>
    </View> : <View className='account-login-card aim-card'>
      <View className='account-login-tabs'>
        {(['login', 'register'] as AuthTab[]).map((item) => <View key={item} className={tab === item ? 'account-login-tabs__item account-login-tabs__item--active' : 'account-login-tabs__item'} onClick={() => { setTab(item); setCode(''); setPassword(''); }}>{item === 'login' ? '登录' : '注册'}</View>)}
      </View>
      {tab === 'login' ? <View className='account-login-modes'><Text className={loginMode === 'code' ? 'account-login-modes__item account-login-modes__item--active' : 'account-login-modes__item'} onClick={() => { setLoginMode('code'); setPassword(''); }}>验证码登录</Text><Text className={loginMode === 'password' ? 'account-login-modes__item account-login-modes__item--active' : 'account-login-modes__item'} onClick={() => { setLoginMode('password'); setCode(''); }}>密码登录</Text></View> : null}
      <View className='account-bind-field'><Text className='account-bind-field__label'>手机号</Text><Input className='account-bind-field__input' type='number' maxlength={11} value={phone} placeholder='请输入手机号' onInput={(event) => setPhone(event.detail.value.replace(/\D/g, '').slice(0, 11))} /></View>
      {tab === 'register' ? <View className='account-bind-field'><Text className='account-bind-field__label'>昵称</Text><Input className='account-bind-field__input' maxlength={12} value={nickname} placeholder='2-12 个字' onInput={(event) => setNickname(event.detail.value.slice(0, 12))} /></View> : null}
      {(tab === 'register' || loginMode === 'code') ? <View className='account-bind-field'><Text className='account-bind-field__label'>验证码</Text><View className='account-bind-code'><Input className='account-bind-field__input' type='number' maxlength={6} value={code} placeholder='6 位短信验证码' onInput={(event) => setCode(event.detail.value.replace(/\D/g, '').slice(0, 6))} /><Button className='account-bind-code__button' disabled={sending || countdown > 0} onClick={sendCode}>{sending ? '发送中' : countdown > 0 ? `${countdown}s` : '获取验证码'}</Button></View></View> : null}
      {(tab === 'register' || loginMode === 'password') ? <View className='account-bind-field'><Text className='account-bind-field__label'>密码</Text><Input className='account-bind-field__input' password maxlength={128} value={password} placeholder='至少 6 位' onInput={(event) => setPassword(event.detail.value)} /></View> : null}
      {tab === 'login' && loginMode === 'password' ? <Text className='account-login-forgot' onClick={() => { if (!requireAgreement()) return; const query = returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''; void Taro.navigateTo({ url: `/packages/account/account-forgot-password/index${query}` }); }}>忘记密码？</Text> : null}
      <View className='account-login-agreement' onClick={() => setAgreed((value) => !value)}><View className={agreed ? 'account-login-agreement__box account-login-agreement__box--checked' : 'account-login-agreement__box'}>{agreed ? '✓' : ''}</View><Text>我已阅读并同意</Text><Text className='account-login-agreement__link' onClick={(event) => { event.stopPropagation(); openLegal('terms'); }}>《用户协议》</Text><Text>与</Text><Text className='account-login-agreement__link' onClick={(event) => { event.stopPropagation(); openLegal('privacy'); }}>《隐私政策》</Text></View>
      <Button className='account-login-primary' loading={submitting} disabled={submitting} onClick={submitPhoneAuth}>{submitting ? '请稍候...' : tab === 'register' ? '注册' : '登录'}</Button>
      <View className='account-login-divider'><View /><Text>或</Text><View /></View>
      <Button className='account-login-wechat' disabled={submitting} onClick={loginWechat}><Text className='account-login-wechat__mark'>微</Text>微信{tab === 'register' ? '注册' : '登录'}</Button>
      <Text className='account-login-security'>登录验证信息仅用于身份校验，不会作为公开资料展示</Text>
    </View>}
  </View>;
}
