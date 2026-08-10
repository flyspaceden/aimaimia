import { Button, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { AccountFeedback } from '@/components/account-feedback';
import {
  completeAuthNavigation,
  loginWithWechatMiniProgram,
  normalizeAuthReturnUrl,
} from '@/platform/auth';
import { useAuthStore } from '@/store/auth';
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

    Taro.showToast({
      title: '登录成功',
      icon: 'success',
    });
    setTimeout(() => { void completeAuthNavigation(returnUrl); }, 420);
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

  return <View className='aim-page account-login-page'>
    <View className='account-login-hero'>
      <View className='account-login-hero__orbit'><View className='account-login-hero__core'>爱</View></View>
      <Text className='account-login-hero__eyebrow'>WECHAT · AIMAI</Text>
      <Text className='account-login-hero__title'>微信一键进入爱买买</Text>
      <Text className='account-login-hero__description'>已有微信身份直接登录，首次使用自动创建爱买买账号。</Text>
    </View>

    <View className='account-login-card aim-card'>
      <View className='account-login-benefit'>
        <View className='account-login-benefit__mark'>同</View>
        <View><Text className='account-login-benefit__title'>一个微信身份</Text><Text className='account-login-benefit__text'>订单、会员、钱包与爱买买 App 共用同一套服务数据</Text></View>
      </View>
      <View className='account-login-benefit'>
        <View className='account-login-benefit__mark'>快</View>
        <View><Text className='account-login-benefit__title'>无需填写手机号</Text><Text className='account-login-benefit__text'>微信验证完成后自动登录或注册，不再填写验证码和密码</Text></View>
      </View>

      <View className='account-login-agreement' onClick={() => setAgreed((value) => !value)}>
        <View className={agreed ? 'account-login-agreement__box account-login-agreement__box--checked' : 'account-login-agreement__box'}>{agreed ? '✓' : ''}</View>
        <Text>我已阅读并同意</Text>
        <Text className='account-login-agreement__link' onClick={(event) => { event.stopPropagation(); openLegal('terms'); }}>《用户协议》</Text>
        <Text>与</Text>
        <Text className='account-login-agreement__link' onClick={(event) => { event.stopPropagation(); openLegal('privacy'); }}>《隐私政策》</Text>
      </View>

      <Button className='account-login-wechat' loading={submitting} disabled={submitting} onClick={loginWechat}>
        <Text className='account-login-wechat__mark'>微</Text>{submitting ? '正在进入...' : '微信一键登录'}
      </Button>
      <Text className='account-login-security'>微信登录仅用于确认账号身份；昵称和头像可在登录后自愿完善</Text>
    </View>
  </View>;
}
