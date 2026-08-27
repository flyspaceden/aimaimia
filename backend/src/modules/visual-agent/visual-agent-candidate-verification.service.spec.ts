import { VisualAgentCandidateVerificationService } from './visual-agent-candidate-verification.service';
const sharp = require('sharp') as typeof import('sharp').default;

async function image(width = 800, height = 1000) {
  return sharp({ create: { width, height, channels: 3, background: '#d6bea0' } }).jpeg().toBuffer();
}

function build(enabled = 'false') {
  const config = { get: jest.fn((_key: string, fallback?: string) => enabled ?? fallback) };
  const scanner = { scan: jest.fn().mockResolvedValue({ qrCodesDetected: 0, details: [] }) };
  const ocr = {
    reserveFactScanInvocation: jest.fn().mockResolvedValueOnce({ invocationId: 'source-ocr', status: 'RESERVED' }).mockResolvedValueOnce({ invocationId: 'candidate-ocr', status: 'RESERVED' }),
    recognizeFactScan: jest.fn().mockResolvedValueOnce({ kind: 'KNOWN', text: 'SKU-A100 500ml' }).mockResolvedValueOnce({ kind: 'KNOWN', text: 'sku-a100500ML' }),
  };
  const service = new VisualAgentCandidateVerificationService(config as any, scanner as any, ocr as any);
  jest.spyOn(service as any, 'scanBarcode').mockResolvedValueOnce({ status: 'NONE', formats: [] }).mockResolvedValueOnce({ status: 'NONE', formats: [] });
  return { service, scanner, ocr };
}

describe('VisualAgentCandidateVerificationService', () => {
  const input = async () => ({
    principal: { tenantId: 'tenant-1', clientId: 'client-1', adapterNamespace: 'external', allowedAdapterTypes: [], keyId: 'key-1' },
    externalObjectId: 'object-1', actorId: 'actor-1', verificationId: 'quote-1', sourceBuffer: await image(), candidateBuffer: await image(), allowAutoPass: true,
  });

  it('does not spend OCR budget while deep verification is disabled', async () => {
    const { service, ocr } = build('false');
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'MANUAL_REVIEW', ocr: { state: 'SKIPPED_DISABLED' } });
    expect(ocr.reserveFactScanInvocation).not.toHaveBeenCalled();
  });

  it('allows automatic pass only after local code checks and both scoped OCR results agree', async () => {
    const { service, ocr } = build('true');
    const report = await service.verify(await input());
    expect(report).toMatchObject({ disposition: 'AUTO_PASS', geometry: { verdict: 'PASS' }, qr: { verdict: 'PASS' }, barcode: { verdict: 'PASS' }, ocr: { state: 'MATCHED', verdict: 'AUTO_PASS' } });
    expect(ocr.reserveFactScanInvocation).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: 'candidate-ocr:quote-1:source' }));
    expect(JSON.stringify(report)).not.toContain('SKU-A100');
  });

  it('rejects an observed QR mismatch before it can reserve OCR work', async () => {
    const { service, scanner, ocr } = build('true');
    scanner.scan.mockReset().mockResolvedValueOnce({ qrCodesDetected: 1, details: [{ type: 'qrcode', text: 'source-qr' }] }).mockResolvedValueOnce({ qrCodesDetected: 0, details: [] });
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'REJECT', qr: { verdict: 'REJECT' } });
    expect(ocr.reserveFactScanInvocation).not.toHaveBeenCalled();
  });
});
