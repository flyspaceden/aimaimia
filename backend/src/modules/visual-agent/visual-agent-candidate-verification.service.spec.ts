import { VisualAgentCandidateVerificationService } from './visual-agent-candidate-verification.service';
import { productEan13Fixture } from '../../../test/fixtures/product-ean13';
import { ServiceUnavailableException } from '@nestjs/common';
const sharp = require('sharp') as typeof import('sharp').default;

async function image(width = 800, height = 1000) {
  return sharp({ create: { width, height, channels: 3, background: '#d6bea0' } }).jpeg().toBuffer();
}

async function transparentRed(alpha: number) {
  const data = Buffer.alloc(64 * 64 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = alpha;
  }
  return sharp(data, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
}

function build(enabled = 'false') {
  const config = { get: jest.fn((_key: string, fallback?: string) => enabled ?? fallback) };
  const scanner = { scan: jest.fn().mockResolvedValue({ qrCodesDetected: 0, details: [] }) };
  const ocr = {
    reserveFactScanInvocation: jest.fn().mockResolvedValueOnce({ invocationId: 'source-ocr', status: 'RESERVED' }).mockResolvedValueOnce({ invocationId: 'candidate-ocr', status: 'RESERVED' }),
    recognizeFactScan: jest.fn().mockResolvedValueOnce({ kind: 'KNOWN', text: 'SKU-A100 500ml' }).mockResolvedValueOnce({ kind: 'KNOWN', text: 'sku-a100500ML' }),
  };
  const structure = {
    isAvailable: jest.fn().mockReturnValue(true),
    verifyStructure: jest.fn().mockResolvedValue({
      kind: 'KNOWN', invocationId: 'structure-1', usage: {},
      report: { version: 'product-structure-compare-v1', scope: 'VISUAL_STRUCTURE', verdict: 'PASS',
        reasons: ['NO_MATERIAL_CONFLICT'], observations: null, sourcePairHash: 'a'.repeat(64), planHash: 'b'.repeat(64) },
    }),
  };
  const service = new VisualAgentCandidateVerificationService(config as any, scanner as any, ocr as any, structure as any);
  jest.spyOn(service as any, 'scanBarcode').mockResolvedValueOnce({ status: 'NONE', formats: [] }).mockResolvedValueOnce({ status: 'NONE', formats: [] });
  return { service, scanner, ocr, structure };
}

const quote = {
  id: 'quote-1',
  visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', allowedOperations: ['LIGHTING'], structureFocus: 'GENERAL_PRODUCT' },
  rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE' },
};

describe('VisualAgentCandidateVerificationService', () => {
  it('detects real EAN pixels in both source and candidate through the public verification path', async () => {
    const { service } = build('false');
    (service as any).scanBarcode.mockRestore();
    const buffer = await productEan13Fixture();
    const result = await service.verify({
      principal: { tenantId: 'tenant-1', clientId: 'client-1', adapterNamespace: 'external', allowedAdapterTypes: [], keyId: 'key-1' },
      externalObjectId: 'object-1', actorId: 'actor-1', verificationId: 'quote-1',
      sourceBuffer: buffer, candidateBuffer: buffer, allowAutoPass: false, quote,
    });
    expect(result.barcode).toMatchObject({ sourceStatus: 'DETECTED', candidateStatus: 'DETECTED', sourceFormats: ['EAN_13'], candidateFormats: ['EAN_13'] });
  });
  const input = async () => ({
    principal: { tenantId: 'tenant-1', clientId: 'client-1', adapterNamespace: 'external', allowedAdapterTypes: [], keyId: 'key-1' },
    externalObjectId: 'object-1', actorId: 'actor-1', verificationId: 'quote-1', sourceBuffer: await image(), candidateBuffer: await image(), allowAutoPass: true, quote,
  });

  it('does not spend OCR budget while deep verification is disabled', async () => {
    const { service, ocr } = build('false');
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'MANUAL_REVIEW', ocr: { state: 'SKIPPED_DISABLED' } });
    expect(ocr.reserveFactScanInvocation).not.toHaveBeenCalled();
  });

  it('allows automatic pass only after local code checks and both scoped OCR results agree', async () => {
    const { service, ocr } = build('true');
    const report = await service.verify(await input());
    expect(report).toMatchObject({ version: 'visual-agent-candidate-verification-v2', disposition: 'AUTO_PASS', geometry: { verdict: 'PASS' }, qr: { verdict: 'PASS' }, barcode: { verdict: 'PASS' }, ocr: { state: 'MATCHED', verdict: 'AUTO_PASS' }, structure: { state: 'PASS', invocationId: 'structure-1' } });
    expect(ocr.reserveFactScanInvocation).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: 'candidate-ocr:quote-1:source' }));
    expect(JSON.stringify(report)).not.toContain('SKU-A100');
  });

  it('hard-rejects an explicit OCR text mismatch after structure passes', async () => {
    const { service, ocr } = build('true');
    ocr.recognizeFactScan.mockReset()
      .mockResolvedValueOnce({ kind: 'KNOWN', text: 'SKU-A100 500ml' })
      .mockResolvedValueOnce({ kind: 'KNOWN', text: 'SKU-B200 250ml' });
    await expect(service.verify(await input())).resolves.toMatchObject({
      disposition: 'REJECT', ocr: { state: 'MISMATCH' }, structure: { state: 'PASS' },
    });
  });

  it('rejects an observed QR mismatch before it can reserve OCR work', async () => {
    const { service, scanner, ocr, structure } = build('true');
    scanner.scan.mockReset().mockResolvedValueOnce({ qrCodesDetected: 1, details: [{ type: 'qrcode', text: 'source-qr' }] }).mockResolvedValueOnce({ qrCodesDetected: 0, details: [] });
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'REJECT', qr: { verdict: 'REJECT' } });
    expect(ocr.reserveFactScanInvocation).not.toHaveBeenCalled();
    expect(structure.verifyStructure).not.toHaveBeenCalled();
  });

  it('keeps an UNKNOWN structure invocation pending instead of turning it into adoptable uncertainty', async () => {
    const { service, structure } = build('true');
    structure.verifyStructure.mockResolvedValue({ kind: 'UNKNOWN', invocationId: 'structure-1', code: 'TRANSPORT_FAILURE', requiresReconciliation: true });
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'PENDING', structure: { state: 'PENDING', invocationId: 'structure-1' } });
  });

  it('hard-rejects a cached known structure FAIL even while new structure execution is disabled', async () => {
    const { service, structure, ocr } = build('true');
    structure.isAvailable.mockReturnValue(false);
    structure.verifyStructure.mockResolvedValue({
      kind: 'KNOWN', invocationId: 'structure-cached', usage: {},
      report: { version: 'product-structure-compare-v1', scope: 'VISUAL_STRUCTURE', verdict: 'FAIL', reasons: ['IDENTITY_CHANGED'],
        observations: null, sourcePairHash: 'a'.repeat(64), planHash: 'b'.repeat(64) },
    });
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'REJECT', structure: { state: 'FAIL', invocationId: 'structure-cached' } });
    expect(structure.verifyStructure).toHaveBeenCalledTimes(1);
    expect(ocr.reserveFactScanInvocation).not.toHaveBeenCalled();
  });

  it('marks a disabled cache miss as non-automatic DISABLED', async () => {
    const { service, structure } = build('true');
    structure.verifyStructure.mockRejectedValue(new ServiceUnavailableException({ code: 'STRUCTURE_VERIFY_DISABLED' }));
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'MANUAL_REVIEW', structure: { state: 'DISABLED', invocationId: null } });
  });

  it('keeps missing generic budget policy pending and never borrows product test access', async () => {
    const { service, structure, ocr } = build('true');
    structure.verifyStructure.mockRejectedValue(new ServiceUnavailableException('AI Visual Agent 缺少或存在冲突的 ACTOR 预算策略'));
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'PENDING', ocr: { state: 'SKIPPED_STRUCTURE_PENDING' }, structure: { state: 'PENDING' } });
    expect(ocr.reserveFactScanInvocation).not.toHaveBeenCalled();
  });

  it('treats durable provider DECLINED as terminal uncertainty instead of an endless retry', async () => {
    const { service, structure } = build('true');
    structure.verifyStructure.mockResolvedValue({ kind: 'DECLINED', invocationId: 'structure-declined', code: 'RATE_LIMITED' });
    await expect(service.verify(await input())).resolves.toMatchObject({ disposition: 'MANUAL_REVIEW', structure: { state: 'UNCERTAIN', invocationId: 'structure-declined' } });
  });

  it.each([
    { alpha: 0, expected: [255, 255, 255], label: 'fully transparent hidden RGB' },
    { alpha: 128, expected: [255, 127, 127], label: 'half-transparent red' },
  ])('flattens $label onto white in the structure view used by the image generator', async ({ alpha, expected }) => {
    const { service } = build('false');
    const result = await (service as any).toStructureSource(await transparentRed(alpha));
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect([...data.subarray(0, 3)]).toEqual(expected);
    expect(result).toMatchObject({ mimeType: 'image/png', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true });
  });
});
