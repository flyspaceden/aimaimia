import { Button, Canvas, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { formatPickupBusinessHours } from '@/components/pickup-utils';
import { OrderRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import { formatOrderTime } from '../_components/order-utils';
import './index.scss';

const QR_CANVAS_ID = 'pickup-pass-qr';
const QR_CANVAS_SELECTOR = `.pickup-pass-page >>> #${QR_CANVAS_ID}`;

type QrCanvasField = {
  node?: {
    width: number;
    height: number;
    getContext: (kind: '2d') => CanvasRenderingContext2D | null;
  };
  width?: number;
  height?: number;
};

type QrCanvasFailureCode = 'NODE_UNAVAILABLE' | 'CONTEXT_UNAVAILABLE' | 'DRAW_FAILED';

function qrCanvasFailureCode(error: unknown): QrCanvasFailureCode {
  if (!(error instanceof Error)) return 'DRAW_FAILED';
  if (error.message === 'QR_CANVAS_NODE_UNAVAILABLE') return 'NODE_UNAVAILABLE';
  if (error.message === 'QR_CANVAS_CONTEXT_UNAVAILABLE') return 'CONTEXT_UNAVAILABLE';
  return 'DRAW_FAILED';
}

/**
 * 使用新版 canvas node API 画二维码。这个 Promise 必须在画布节点存在且绘制成功后才 resolve；
 * 真机失败时页面会展示取货码和重试操作，而不是留下一个没有内容的白框。
 */
function drawPickupQr(payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Taro.nextTick(() => {
      try {
        const query = Taro.createSelectorQuery();
        query.select(QR_CANVAS_SELECTOR).fields({ node: true, size: true }, (fieldResult) => {
          try {
            const field = fieldResult as QrCanvasField | undefined;
            const canvas = field?.node;
            const cssSize = Math.min(field?.width || 224, field?.height || 224);
            if (!canvas || !cssSize) {
              reject(new Error('QR_CANVAS_NODE_UNAVAILABLE'));
              return;
            }
            const context = canvas.getContext('2d');
            if (!context) {
              reject(new Error('QR_CANVAS_CONTEXT_UNAVAILABLE'));
              return;
            }
            const ratio = Taro.getWindowInfo().pixelRatio || 1;
            // 每次刷新凭证都重新设置像素尺寸，避免旧的 scale 叠加导致二维码空白或变形。
            canvas.width = Math.floor(cssSize * ratio);
            canvas.height = Math.floor(cssSize * ratio);
            if (typeof context.setTransform === 'function') {
              context.setTransform(ratio, 0, 0, ratio, 0, 0);
            } else {
              context.scale(ratio, ratio);
            }
            context.fillStyle = '#FFFFFF';
            context.fillRect(0, 0, cssSize, cssSize);
            const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
            const quietZone = 4;
            const moduleSize = cssSize / (qr.modules.size + quietZone * 2);
            context.fillStyle = '#142C1A';
            for (let row = 0; row < qr.modules.size; row += 1) {
              for (let column = 0; column < qr.modules.size; column += 1) {
                if (!qr.modules.get(row, column)) continue;
                const left = Math.round((column + quietZone) * moduleSize);
                const top = Math.round((row + quietZone) * moduleSize);
                const right = Math.ceil((column + quietZone + 1) * moduleSize);
                const bottom = Math.ceil((row + quietZone + 1) * moduleSize);
                context.fillRect(left, top, right - left, bottom - top);
              }
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        }).exec();
      } catch (error) {
        reject(error);
      }
    });
  });
}

export default function PickupPassPage() {
  const router = useRouter();
  const orderId = typeof router.params.orderId === 'string' ? router.params.orderId : '';
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [clock, setClock] = useState(() => Date.now());
  const [qrState, setQrState] = useState<'loading' | 'ready' | 'failed'>('loading');
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
  const rawPickupPass = passQuery.data?.ok ? passQuery.data.data : undefined;
  const pickupPass = rawPickupPass && new Date(rawPickupPass.expiresAt).getTime() > clock
    ? rawPickupPass
    : undefined;

  useEffect(() => {
    let mounted = true;
    if (!pickupPass?.qrPayload) {
      setQrState('loading');
      return () => { mounted = false; };
    }
    setQrState('loading');
    void drawPickupQr(pickupPass.qrPayload)
      .then(() => { if (mounted) setQrState('ready'); })
      .catch((error) => {
        console.warn('[pickup-pass] QR canvas draw failed', { code: qrCanvasFailureCode(error) });
        if (mounted) setQrState('failed');
      });
    return () => { mounted = false; };
  }, [pickupPass?.qrPayload]);

  const retryQr = () => {
    if (!pickupPass?.qrPayload) return;
    setQrState('loading');
    void drawPickupQr(pickupPass.qrPayload)
      .then(() => setQrState('ready'))
      .catch((error) => {
        console.warn('[pickup-pass] QR canvas draw failed', { code: qrCanvasFailureCode(error) });
        setQrState('failed');
      });
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
        <Canvas type='2d' id={QR_CANVAS_ID} canvasId={QR_CANVAS_ID} className={`pickup-pass-qr ${qrState === 'failed' ? 'pickup-pass-qr--hidden' : ''}`} />
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
