import { ProductImageCandidateOcrVerificationService } from './product-image-candidate-ocr-verification.service';
const sharp = require('sharp') as typeof import('sharp').default;

async function image() {
  return sharp({ create: { width: 480, height: 480, channels: 3, background: '#d3c0a8' } }).jpeg().toBuffer();
}

function build(enabled = 'false') {
  const config = { get: jest.fn((_key: string, fallback?: string) => enabled ?? fallback) };
  const ocr = {
    reserveFactScanInvocation: jest.fn()
      .mockResolvedValueOnce({ invocationId: 'ocr-source', status: 'RESERVED' })
      .mockResolvedValueOnce({ invocationId: 'ocr-candidate', status: 'RESERVED' }),
    recognizeFactScan: jest.fn()
      .mockResolvedValueOnce({ kind: 'KNOWN', text: '型号 A-100  500ml' })
      .mockResolvedValueOnce({ kind: 'KNOWN', text: '型号A-100 500ML' }),
  };
  return { service: new ProductImageCandidateOcrVerificationService(config as any, ocr as any), ocr };
}

describe('ProductImageCandidateOcrVerificationService', () => {
  const input = async () => ({
    companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quoteId: 'quote-1',
    sourceBuffer: await image(), candidateBuffer: await image(), allowAutoPass: true,
  });

  it('does not reserve OCR work unless the explicit platform verification flag is enabled', async () => {
    const { service, ocr } = build('false');
    await expect(service.verify(await input())).resolves.toMatchObject({ state: 'SKIPPED_DISABLED', verdict: 'MANUAL_REVIEW' });
    expect(ocr.reserveFactScanInvocation).not.toHaveBeenCalled();
  });

  it('uses two controlled OCR reservations and keeps only a normalized equality summary', async () => {
    const { service, ocr } = build('true');
    const report = await service.verify(await input());
    expect(report).toMatchObject({ state: 'MATCHED', verdict: 'AUTO_PASS', normalizedTextMatch: true, sourceTextLength: expect.any(Number), candidateTextLength: expect.any(Number) });
    expect(ocr.reserveFactScanInvocation).toHaveBeenCalledTimes(2);
    expect(ocr.reserveFactScanInvocation).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: 'candidate-ocr:quote-1:source' }));
    expect(JSON.stringify(report)).not.toContain('A-100');
  });

  it('sends OCR mismatch and unavailable Provider outcomes to manual review rather than an automatic reject or pass', async () => {
    const mismatch = build('true');
    mismatch.ocr.recognizeFactScan.mockReset()
      .mockResolvedValueOnce({ kind: 'KNOWN', text: '型号 A-100' })
      .mockResolvedValueOnce({ kind: 'KNOWN', text: '型号 B-200' });
    await expect(mismatch.service.verify(await input())).resolves.toMatchObject({ state: 'MISMATCH', verdict: 'MANUAL_REVIEW', normalizedTextMatch: false });

    const unavailable = build('true');
    unavailable.ocr.reserveFactScanInvocation.mockReset().mockRejectedValue(new Error('provider unavailable'));
    await expect(unavailable.service.verify(await input())).resolves.toMatchObject({ state: 'UNAVAILABLE', verdict: 'MANUAL_REVIEW' });
  });
});
