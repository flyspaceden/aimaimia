import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistPickupPassQr, removePersistedPickupPassQr } from '../pickupPassQr';

const unlink = vi.hoisted(() => vi.fn());
const writeFile = vi.hoisted(() => vi.fn());

vi.mock('@tarojs/taro', () => ({
  default: {
    env: { USER_DATA_PATH: '/tmp' },
    getFileSystemManager: () => ({ unlink, writeFile }),
  },
}));

describe('pickup pass QR image persistence', () => {
  beforeEach(() => {
    unlink.mockReset();
    writeFile.mockReset();
  });

  it('writes only a validated PNG response to a per-expiry temporary path', async () => {
    writeFile.mockImplementation(({ success }) => success());
    const pass = {
      orderId: 'order_123',
      status: 'READY' as const,
      pickupCode: '12345678',
      qrPayload: 'AIMMPICKUP.1.signed',
      qrImageMimeType: 'image/png' as const,
      qrImageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAE=',
      expiresAt: '2026-08-17T12:48:00.000Z',
      pickupPoint: { name: '中心仓', regionText: '深圳市', detail: '1号', businessHours: '09:00-18:00' },
      recipient: { name: '张*', phoneMasked: '138****0000' },
    };

    await expect(persistPickupPassQr(pass)).resolves.toBe('/tmp/aim-pickup-pass-order_123-1786970880000.png');
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/aim-pickup-pass-order_123-1786970880000.png',
      data: pass.qrImageBase64,
      encoding: 'base64',
    }));
  });

  it('rejects malformed image data and best-effort removes old files', async () => {
    await expect(persistPickupPassQr({
      orderId: 'order-1',
      qrImageMimeType: 'image/png',
      qrImageBase64: '<html>',
      expiresAt: '2026-08-17T12:48:00.000Z',
    })).rejects.toThrow('PICKUP_QR_IMAGE_INVALID');

    unlink.mockImplementation(({ success }) => success());
    await expect(removePersistedPickupPassQr('/tmp/old-pickup.png')).resolves.toBeUndefined();
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/old-pickup.png' }));
  });
});
