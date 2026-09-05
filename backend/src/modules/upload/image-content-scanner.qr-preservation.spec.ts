const QRCode = require('qrcode') as typeof import('qrcode');
const sharp = require('sharp') as typeof import('sharp').default;
import { ImageContentScannerService } from './image-content-scanner.service';

async function composeQrImage(values: string[]) {
  const qrBuffers = await Promise.all(values.map((value) => QRCode.toBuffer(value, { type: 'png', width: 180, margin: 1 })));
  return sharp({ create: { width: 220 * values.length, height: 220, channels: 4, background: '#ffffff' } })
    .composite(qrBuffers.map((input, index) => ({ input, left: index * 220 + 20, top: 20 })))
    .png()
    .toBuffer();
}

describe('ImageContentScannerService product QR preservation', () => {
  const createService = () => new ImageContentScannerService({ get: jest.fn((_key: string, fallback?: unknown) => fallback) } as any);

  it('preserves a decoded non-contact package QR for managed product images', async () => {
    const result = await createService().scanAndProcess(
      await composeQrImage(['https://brand.example/verify']),
      { preserveQrCodes: true },
    );

    expect(result.safe).toBe(true);
    expect(result.qrCodesDetected).toBe(1);
    expect(result.contactInfoDetected).toBe(false);
  });

  it('rejects a decoded contact QR instead of redacting product evidence', async () => {
    const result = await createService().scanAndProcess(
      await composeQrImage(['wx: unsafe_contact']),
      { preserveQrCodes: true },
    );

    expect(result.safe).toBe(false);
    expect(result.contactInfoDetected).toBe(true);
  });

  it('rejects a mixed package image when any decoded QR contains contact information', async () => {
    const result = await createService().scanAndProcess(
      await composeQrImage(['https://brand.example/verify', 'wx: unsafe_contact']),
      { preserveQrCodes: true },
    );

    expect(result.qrCodesDetected).toBeGreaterThanOrEqual(2);
    expect(result.contactInfoDetected).toBe(true);
    expect(result.safe).toBe(false);
  });

  it('fails closed for managed product images when QR detection fails', async () => {
    const service = createService();
    jest.spyOn(service as any, 'detectQrCodes').mockResolvedValue({ details: [], failed: true });

    const result = await service.scanAndProcess(Buffer.from('source'), { preserveQrCodes: true });

    expect(result.qrDetectionFailed).toBe(true);
    expect(result.safe).toBe(false);
    expect(result.needsReview).toBe(false);
  });

  it('fails closed when the bounded decoder finds a ninth QR code', async () => {
    const service = createService();
    const corner = { x: 10, y: 10 };
    const decodedQr = {
      data: 'https://brand.example/verify',
      location: { topLeftCorner: corner, topRightCorner: { x: 30, y: 10 }, bottomLeftCorner: { x: 10, y: 30 }, bottomRightCorner: { x: 30, y: 30 } },
    };
    jest.spyOn(service as any, 'decodeQr')
      .mockReturnValueOnce(decodedQr).mockReturnValueOnce(decodedQr).mockReturnValueOnce(decodedQr).mockReturnValueOnce(decodedQr)
      .mockReturnValueOnce(decodedQr).mockReturnValueOnce(decodedQr).mockReturnValueOnce(decodedQr).mockReturnValueOnce(decodedQr)
      .mockReturnValueOnce(decodedQr);

    const result = await service.scanAndProcess(
      await sharp({ create: { width: 80, height: 80, channels: 4, background: '#ffffff' } }).png().toBuffer(),
      { preserveQrCodes: true },
    );

    expect(result.qrDetectionFailed).toBe(true);
    expect(result.safe).toBe(false);
  });
});
