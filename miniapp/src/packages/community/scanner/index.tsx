import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { useAuthStore } from '@/store/auth';
import { normalizeMiniProgramScanPath, parseScanTarget } from '../utils';
import './index.scss';

export default function ScannerPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const [manualValue, setManualValue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setManualValue(''); setBusy(false); }, [authRevision]);

  const openTarget = async (raw: string) => {
    const target = parseScanTarget(raw);
    if (!target) { await Taro.showModal({ title: '无法识别', content: '仅支持爱买买邀请码、团购码和团长码，外部网址不会自动打开。', showCancel: false, confirmText: '我知道了' }); return; }
    await Taro.navigateTo({ url: target.url });
  };
  const scan = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await Taro.scanCode({ onlyFromCamera: false });
      const miniProgramPath = result.scanType === 'WX_CODE'
        ? normalizeMiniProgramScanPath(result.path)
        : null;
      if (miniProgramPath) {
        await Taro.navigateTo({ url: miniProgramPath });
      } else if (result.scanType === 'WX_CODE') {
        await Taro.showModal({ title: '无法识别', content: '这不是有效的爱买买小程序码。', showCancel: false, confirmText: '我知道了' });
      } else if (result.result) {
        await openTarget(result.result);
      } else {
        await Taro.showToast({ title: '未识别到有效内容', icon: 'none' });
      }
    } catch (error) {
      const message = error && typeof error === 'object' && 'errMsg' in error ? String((error as { errMsg?: unknown }).errMsg || '') : '';
      if (!message.toLowerCase().includes('cancel')) await Taro.showToast({ title: '扫码失败，请重试', icon: 'none' });
    } finally { setBusy(false); }
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后可扫描邀请、团购与团长二维码' actionLabel='去登录' onRetry={() => Taro.redirectTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent('/packages/community/scanner/index')}` })} /></View>;
  return <View className='scanner-page'>
    <View className='scanner-stage'>
      <View className='scanner-frame'><View className='scanner-corner scanner-corner--a' /><View className='scanner-corner scanner-corner--b' /><View className='scanner-corner scanner-corner--c' /><View className='scanner-corner scanner-corner--d' /><View className='scanner-line' /><Text>对准爱买买二维码</Text></View>
      <Text className='scanner-stage__copy'>调用微信原生扫码，不在页面内伪造相机画面。相册与摄像头权限由微信管理。</Text>
      <Button className='scanner-primary' loading={busy} disabled={busy} onClick={scan}>{busy ? '正在打开...' : '开始扫码'}</Button>
    </View>
    <View className='scanner-manual aim-card'><Text>手动输入</Text><Text>可输入 8 位邀请码，或粘贴完整的爱买买分享链接。</Text><View><Input value={manualValue} maxlength={512} placeholder='邀请码 / 分享链接' onInput={(event) => setManualValue(event.detail.value)} /><Button disabled={!manualValue.trim()} onClick={() => openTarget(manualValue)}>识别</Button></View></View>
    <View className='scanner-safe'><Text>安全边界</Text><Text>只会跳转至小程序内已知的邀请、团购或团长页面；不会打开任意外部网址，也不会在扫码页面直接绑定关系。</Text></View>
  </View>;
}
