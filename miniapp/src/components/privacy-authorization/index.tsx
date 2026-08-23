import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import {
  getMiniappPrivacyContractName,
  MINIAPP_PRIVACY_AGREE_BUTTON_ID,
  openMiniappPrivacyContract,
  registerMiniappPrivacyAuthorization,
  resolveMiniappPrivacyRequest,
  type MiniappPrivacyRequest,
} from '@/platform/privacy';
import './index.scss';

export function MiniappPrivacyAuthorization() {
  const [request, setRequest] = useState<MiniappPrivacyRequest | null>(null);
  const [contractName, setContractName] = useState('AI爱买买小程序隐私保护指引');
  const requestRef = useRef<MiniappPrivacyRequest | null>(null);
  const generation = useRef(0);

  useEffect(() => registerMiniappPrivacyAuthorization((nextRequest) => {
    if (requestRef.current) resolveMiniappPrivacyRequest(requestRef.current, 'disagree');
    requestRef.current = nextRequest;
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    setRequest(nextRequest);
    void getMiniappPrivacyContractName().then((name) => {
      if (generation.current === currentGeneration && requestRef.current === nextRequest) setContractName(name);
    });
  }), []);

  useEffect(() => () => {
    generation.current += 1;
    if (requestRef.current) resolveMiniappPrivacyRequest(requestRef.current, 'disagree');
    requestRef.current = null;
  }, []);

  if (!request) return null;

  const decide = (decision: 'agree' | 'disagree') => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    generation.current += 1;
    setRequest(null);
    resolveMiniappPrivacyRequest(current, decision);
  };

  const openContract = async () => {
    try {
      await openMiniappPrivacyContract();
    } catch {
      await Taro.showToast({ title: '暂时无法打开微信隐私保护指引', icon: 'none' });
    }
  };

  return <View className='privacy-authorization' catchMove>
    <View className='privacy-authorization__mask' />
    <View className='privacy-authorization__panel'>
      <View className='privacy-authorization__mark'>隐</View>
      <Text className='privacy-authorization__title'>使用功能前请确认隐私授权</Text>
      <Text className='privacy-authorization__copy'>你正在使用相机、相册、麦克风、扫码或保存图片等微信隐私能力。我们只会在你主动使用的范围内处理必要信息。</Text>
      <Text className='privacy-authorization__contract' onClick={() => { void openContract(); }}>查看《{contractName}》</Text>
      <View className='privacy-authorization__actions'>
        <Button className='privacy-authorization__secondary' onClick={() => decide('disagree')}>暂不同意</Button>
        <Button
          id={MINIAPP_PRIVACY_AGREE_BUTTON_ID}
          className='privacy-authorization__primary'
          openType='agreePrivacyAuthorization'
          onAgreePrivacyAuthorization={() => decide('agree')}
        >同意并继续</Button>
      </View>
      <Text className='privacy-authorization__hint'>拒绝只会取消本次功能，不影响浏览和其他不需要该权限的服务。</Text>
    </View>
  </View>;
}
