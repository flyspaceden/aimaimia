import Taro from '@tarojs/taro';
import type { PickupPass } from '@/types';

type PickupPassQrImage = Pick<
  PickupPass,
  'orderId' | 'qrImageMimeType' | 'qrImageBase64' | 'expiresAt'
>;

const PNG_BASE64_PREFIX = 'iVBORw0KGgo';
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_QR_BASE64_LENGTH = 300_000;

export function persistPickupPassQr(result: PickupPassQrImage): Promise<string> {
  const safeOrderId = result.orderId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const expiresAtMs = Date.parse(result.expiresAt);
  const imageBase64 = result.qrImageBase64;
  if (!safeOrderId
    || result.qrImageMimeType !== 'image/png'
    || typeof imageBase64 !== 'string'
    || imageBase64.length < 12
    || imageBase64.length > MAX_QR_BASE64_LENGTH
    || !imageBase64.startsWith(PNG_BASE64_PREFIX)
    || !BASE64_PATTERN.test(imageBase64)
    || !Number.isFinite(expiresAtMs)) {
    return Promise.reject(new Error('PICKUP_QR_IMAGE_INVALID'));
  }

  const filePath = `${Taro.env.USER_DATA_PATH}/aim-pickup-pass-${safeOrderId}-${expiresAtMs}.png`;
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().writeFile({
      filePath,
      data: imageBase64,
      encoding: 'base64',
      success: () => resolve(filePath),
      fail: () => reject(new Error('PICKUP_QR_IMAGE_WRITE_FAILED')),
    });
  });
}

export function removePersistedPickupPassQr(filePath: string): Promise<void> {
  if (!filePath) return Promise.resolve();
  return new Promise((resolve) => {
    Taro.getFileSystemManager().unlink({
      filePath,
      success: () => resolve(),
      fail: () => resolve(),
    });
  });
}
