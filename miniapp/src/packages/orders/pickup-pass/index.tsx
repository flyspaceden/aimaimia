import { Button, Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatPickupBusinessHours } from '@/components/pickup-utils';
import { persistPickupPassQr, removePersistedPickupPassQr } from '@/platform/pickupPassQr';
import { OrderRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { formatOrderTime } from '../_components/order-utils';
import './index.scss';

export default function PickupPassPage() {
  const router = useRouter();
  const orderId = typeof router.params.orderId === 'string' ? router.params.orderId : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [clock, setClock] = useState(() => Date.now());
  const [qrState, setQrState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [qrFilePath, setQrFilePath] = useState('');
  const [qrRetryVersion, setQrRetryVersion] = useState(0);
  const qrFilePathRef = useRef('');
  const qrGenerationRef = useRef(0);
  const passQuery = useQuery({
    queryKey: ['order', orderId, 'pickup-pass'],
    queryFn: () => OrderRepo.getPickupPass(orderId),
    enabled: hydrated && loggedIn && Boolean(orderId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 15_000,
  });
  useDidShow(() => {
    if (orderId && useAuthStore.getState().accessToken) void passQuery.refetch();
  });
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => () => {
    qrGenerationRef.current += 1;
    const currentPath = qrFilePathRef.current;
    qrFilePathRef.current = '';
    if (currentPath) void removePersistedPickupPassQr(currentPath);
  }, []);
  const rawPickupPass = passQuery.data?.ok ? passQuery.data.data : undefined;
  const pickupPass = rawPickupPass && new Date(rawPickupPass.expiresAt).getTime() > clock
    ? rawPickupPass
    : undefined;
  const qrOrderId = pickupPass?.orderId;
  const qrExpiresAt = pickupPass?.expiresAt;
  const qrImageMimeType = pickupPass?.qrImageMimeType ?? null;
  const qrImageBase64 = pickupPass?.qrImageBase64 ?? null;

  useEffect(() => {
    const generation = qrGenerationRef.current + 1;
    qrGenerationRef.current = generation;
    if (!qrOrderId || !qrExpiresAt) {
      setQrState('loading');
      return;
    }
    setQrState('loading');
    void persistPickupPassQr({
      orderId: qrOrderId,
      expiresAt: qrExpiresAt,
      qrImageMimeType,
      qrImageBase64,
    })
      .then(async (filePath) => {
        if (qrGenerationRef.current !== generation) {
          await removePersistedPickupPassQr(filePath);
          return;
        }
        const previousPath = qrFilePathRef.current;
        qrFilePathRef.current = filePath;
        setQrFilePath(filePath);
        setQrState('ready');
        if (previousPath && previousPath !== filePath) {
          await removePersistedPickupPassQr(previousPath);
        }
      })
      .catch(() => {
        if (qrGenerationRef.current !== generation) return;
        console.warn('[pickup-pass] QR image persistence failed');
        setQrFilePath('');
        setQrState('failed');
      });
  }, [qrExpiresAt, qrImageBase64, qrImageMimeType, qrOrderId, qrRetryVersion]);

  const retryQr = () => {
    setQrState('loading');
    setQrRetryVersion((version) => version + 1);
    void passQuery.refetch();
  };

  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!loggedIn) return <View className='aim-page'><CatalogFeedback kind='empty' title='请先登录' description='登录后才能读取本人取货凭证' /></View>;
  if (!orderId) return <View className='aim-page'><CatalogFeedback kind='error' title='订单信息缺失' description='请从订单详情重新进入' /></View>;
  if (passQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!pickupPass) return <View className='aim-page'><CatalogFeedback kind='empty' title={rawPickupPass ? '二维码已过期，正在刷新' : '取货凭证暂不可用'} description={passQuery.data && !passQuery.data.ok ? passQuery.data.error.displayMessage || '商品尚未备好，或凭证已经核销失效。' : rawPickupPass ? '请稍候，页面会自动申请新的短时二维码。' : '商品尚未备好，或凭证已经核销失效。'} actionLabel={rawPickupPass ? '立即刷新' : '返回订单'} onRetry={() => rawPickupPass ? passQuery.refetch() : Taro.navigateBack()} /></View>;

  const point = pickupPass.pickupPoint;
  const location = point.location;
  const openLocation = () => {
    if (!location) { Taro.showToast({ title: '门店暂未配置地图位置', icon: 'none' }); return; }
    void Taro.openLocation({ latitude: location.lat, longitude: location.lng, name: point.name, address: `${point.regionText} ${point.detail}`.trim() });
  };

  return <View className='pickup-pass-page'>
    <Text className='pickup-pass-eyebrow'>PICKUP PASS · 一次性凭证</Text>
    <Text className='pickup-pass-title'>商品已备好</Text>
    <Text className='pickup-pass-copy'>到店后请出示二维码或短码，由商家核销完成取货。</Text>
    <View className='pickup-pass-ticket'>
      <View className='pickup-pass-ticket__top'>
        <Text>{point.name}</Text>
        <Text>待自提</Text>
      </View>
      <View className='pickup-pass-qr-wrap'>
        {qrFilePath && qrState === 'ready' ? <Image className='pickup-pass-qr' src={qrFilePath} mode='aspectFit' onError={() => { console.warn('[pickup-pass] QR image load failed'); setQrState('failed'); }} /> : null}
        {qrState === 'loading' ? <Text className='pickup-pass-qr-status'>正在生成一次性二维码…</Text> : null}
        {qrState === 'failed' ? <View className='pickup-pass-qr-fallback'>
          <Text>二维码未能显示</Text>
          <Text>请向商家出示下方 8 位取货码</Text>
          <Text className='pickup-pass-qr-retry' onClick={retryQr}>重新生成二维码</Text>
        </View> : null}
      </View>
      <Text className='pickup-pass-code-label'>人工取货码</Text>
      <Text className='pickup-pass-code' onClick={() => Taro.setClipboardData({ data: pickupPass.pickupCode })}>{pickupPass.pickupCode}</Text>
      <Text className='pickup-pass-code-hint'>点击短码可复制 · 仅本订单一次有效</Text>
      <View className='pickup-pass-tear'><View /><Text>到店核销</Text><View /></View>
      <View className='pickup-pass-details'>
        <View><Text>自提人</Text><Text>{pickupPass.recipient.name}　{pickupPass.recipient.phoneMasked}</Text></View>
        <View><Text>自提地址</Text><Text>{point.regionText} {point.detail}</Text></View>
        <View><Text>营业时间</Text><Text>{formatPickupBusinessHours(point.businessHours)}</Text></View>
        <View><Text>凭证有效期</Text><Text>{formatOrderTime(pickupPass.expiresAt)}</Text></View>
        {point.pickupNotice ? <View><Text>取货须知</Text><Text>{point.pickupNotice}</Text></View> : null}
      </View>
    </View>
    {location ? <Button className='pickup-pass-primary' onClick={openLocation}>导航到自提点</Button> : null}
    <Button className='pickup-pass-secondary' onClick={() => Taro.navigateBack()}>返回订单详情</Button>
    <Text className='pickup-pass-security'>请勿把二维码转发给他人。核销后凭证立即失效，页面不会保存长期取货链接。</Text>
  </View>;
}
