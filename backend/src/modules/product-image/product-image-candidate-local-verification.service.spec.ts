import { ProductImageCandidateLocalVerificationService } from './product-image-candidate-local-verification.service';
const sharp = require('sharp') as typeof import('sharp').default;

async function image(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#8c7456' } }).jpeg().toBuffer();
}

function scanner(results: Array<unknown>) {
  return { scan: jest.fn().mockImplementation(async () => results.shift()) };
}

function barcode(results: Array<unknown>) {
  return { scan: jest.fn().mockImplementation(async () => results.shift()) };
}

describe('ProductImageCandidateLocalVerificationService', () => {
  it('keeps a matched QR and matching geometry in manual review rather than pretending local checks prove facts', async () => {
    const service = new ProductImageCandidateLocalVerificationService(
      scanner([{ qrCodesDetected: 1, details: [{ type: 'qrcode', text: 'trace-qr' }] }, { qrCodesDetected: 1, details: [{ type: 'qrcode', text: 'trace-qr' }] }] as any) as any,
      barcode([{ status: 'INCONCLUSIVE', formats: [] }, { status: 'INCONCLUSIVE', formats: [] }] as any) as any,
    );
    const result = await service.verify(await image(800, 1000), await image(800, 1000));

    expect(result).toMatchObject({ disposition: 'MANUAL_REVIEW', geometry: { verdict: 'PASS' }, qr: { verdict: 'PASS' } });
    expect(JSON.stringify(result)).not.toContain('trace-qr');
  });

  it('rejects a candidate that loses or changes an observed QR code', async () => {
    const service = new ProductImageCandidateLocalVerificationService(
      scanner([{ qrCodesDetected: 1, details: [{ type: 'qrcode', text: 'trace-qr' }] }, { qrCodesDetected: 0, details: [] }] as any) as any,
      barcode([{ status: 'NONE', formats: [] }, { status: 'NONE', formats: [] }] as any) as any,
    );
    const result = await service.verify(await image(800, 1000), await image(800, 1000));
    expect(result).toMatchObject({ disposition: 'REJECT', qr: { verdict: 'REJECT' } });
  });

  it('rejects destructive geometry and a changed barcode format without retaining barcode payloads', async () => {
    const service = new ProductImageCandidateLocalVerificationService(
      scanner([{ qrCodesDetected: 0, details: [] }, { qrCodesDetected: 0, details: [] }] as any) as any,
      barcode([{ status: 'DETECTED', formats: ['EAN_13'] }, { status: 'DETECTED', formats: ['CODE_128'] }] as any) as any,
    );
    const result = await service.verify(await image(1200, 800), await image(400, 1200));
    expect(result).toMatchObject({ disposition: 'REJECT', geometry: { verdict: 'REJECT' }, barcode: { verdict: 'REJECT' } });
    expect(JSON.stringify(result)).not.toContain('payload');
  });

  it('treats a local scanner failure as manual review instead of failing open', async () => {
    const service = new ProductImageCandidateLocalVerificationService(
      { scan: jest.fn().mockRejectedValue(new Error('qr decoder unavailable')) } as any,
      barcode([{ status: 'NONE', formats: [] }, { status: 'NONE', formats: [] }] as any) as any,
    );
    await expect(service.verify(await image(800, 1000), await image(800, 1000))).resolves.toMatchObject({
      disposition: 'MANUAL_REVIEW', qr: { verdict: 'MANUAL_REVIEW' },
    });
  });
});
