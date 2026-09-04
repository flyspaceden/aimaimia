import { ProductImageStructureVerificationService } from './product-image-structure-verification.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { STRUCTURE_VERIFICATION_VERSION } from '../visual-agent/providers/bailian-structure-verification.provider';
const sharp = require('sharp') as typeof import('sharp').default;

async function image() {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: '#8e6d4d' } }).png().toBuffer();
}

function report(verdict: 'PASS' | 'FAIL' | 'UNCERTAIN') {
  return {
    version: STRUCTURE_VERIFICATION_VERSION, scope: 'VISUAL_STRUCTURE', verdict,
    reasons: verdict === 'PASS' ? ['NO_MATERIAL_CONFLICT'] : ['COMPONENTS_CHANGED'],
    observations: null, sourcePairHash: 'a'.repeat(64), planHash: 'b'.repeat(64),
  } as any;
}

function build(available = true) {
  const runner = {
    isAvailable: jest.fn().mockReturnValue(available),
    verifyStructure: jest.fn().mockResolvedValue({ kind: 'KNOWN', invocationId: 'structure-1', report: report('PASS'), usage: {} }),
  };
  const testAccess = { ensureStructureTestBudget: jest.fn().mockResolvedValue(undefined) };
  return { service: new ProductImageStructureVerificationService(runner as any, testAccess as any), runner, testAccess };
}

describe('ProductImageStructureVerificationService', () => {
  const quote = {
    id: 'quote-1',
    visualPlanSnapshot: { direction: 'MARKETING_SCENE', allowedOperations: ['SCENE_RESTAGE', 'COMPOSITION'] },
    rateCardSnapshot: { candidateRole: 'MARKETING_IMAGE' },
  };

  it('does not provision budget while disabled and reports a disabled cache miss', async () => {
    const { service, runner, testAccess } = build(false);
    runner.verifyStructure.mockRejectedValue(new ServiceUnavailableException({ code: 'STRUCTURE_VERIFY_DISABLED' }));
    const bytes = await image();
    await expect(service.verify({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quote, sourceBuffer: bytes, candidateBuffer: bytes }))
      .resolves.toEqual({ state: 'DISABLED', report: null, invocationId: null });
    expect(testAccess.ensureStructureTestBudget).not.toHaveBeenCalled();
    expect(runner.verifyStructure).toHaveBeenCalledTimes(1);
  });

  it('derives a fixed marketing plan and stable quote/pair idempotency key', async () => {
    const { service, runner, testAccess } = build();
    const bytes = await image();
    const input = { companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quote: { ...quote, id: 'ckzv8zc5h0000qzrmn831m1ab' }, sourceBuffer: bytes, candidateBuffer: bytes };
    await expect(service.verify(input)).resolves.toMatchObject({ state: 'PASS', invocationId: 'structure-1' });
    await service.verify(input);
    expect(testAccess.ensureStructureTestBudget).toHaveBeenCalledWith({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1' });
    const [first, second] = runner.verifyStructure.mock.calls.map(([value]) => value);
    expect(first.plan).toEqual({ version: STRUCTURE_VERIFICATION_VERSION, candidateRole: 'MARKETING_IMAGE', focus: 'GENERAL_PRODUCT', changeAllowances: { background: true, layout: true, count: true } });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(first.idempotencyKey).toMatch(/^paid-candidate-structure:[a-f0-9]{64}$/);
    expect(first.idempotencyKey.length).toBeLessThanOrEqual(200);
  });

  it('never allows a real-scene quote to replace the background or change count', async () => {
    const { service, runner } = build();
    const bytes = await image();
    await service.verify({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceBuffer: bytes, candidateBuffer: bytes,
      quote: { id: 'quote-1', visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE', allowedOperations: ['BACKGROUND_REPLACE', 'COMPOSITION'] }, rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE' } },
    });
    expect(runner.verifyStructure).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({
      changeAllowances: { background: false, layout: true, count: false },
    }) }));
  });

  it('does not treat catalog background simplification as a scene replacement allowance', async () => {
    const { service, runner } = build();
    const bytes = await image();
    await service.verify({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceBuffer: bytes, candidateBuffer: bytes,
      quote: { id: 'quote-1', visualPlanSnapshot: { direction: 'CATALOG_STUDIO', allowedOperations: ['BACKGROUND_SIMPLIFY'] }, rateCardSnapshot: { candidateRole: 'FACT_MAIN_IMAGE' } },
    });
    expect(runner.verifyStructure).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({
      changeAllowances: { background: false, layout: false, count: false },
    }) }));
  });

  it('keeps unknown structure execution pending rather than treating it as an inconclusive comparison', async () => {
    const { service, runner } = build();
    runner.verifyStructure.mockResolvedValue({ kind: 'UNKNOWN', invocationId: 'structure-1', requiresReconciliation: true });
    const bytes = await image();
    await expect(service.verify({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quote, sourceBuffer: bytes, candidateBuffer: bytes }))
      .resolves.toEqual({ state: 'PENDING', report: null, invocationId: 'structure-1' });
  });

  it('replays a cached FAIL after the provider route is paused', async () => {
    const { service, runner, testAccess } = build(false);
    runner.verifyStructure.mockResolvedValue({ kind: 'KNOWN', invocationId: 'structure-old', report: report('FAIL'), usage: {} });
    const bytes = await image();
    await expect(service.verify({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quote, sourceBuffer: bytes, candidateBuffer: bytes }))
      .resolves.toMatchObject({ state: 'FAIL', invocationId: 'structure-old' });
    expect(testAccess.ensureStructureTestBudget).not.toHaveBeenCalled();
    expect(runner.verifyStructure).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ focus: 'GENERAL_PRODUCT' }) }));
  });

  it('uses the immutable WATCH_STRUCTURE snapshot focus rather than product text', async () => {
    const { service, runner } = build();
    const bytes = await image();
    await service.verify({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceBuffer: bytes, candidateBuffer: bytes,
      quote: { ...quote, visualPlanSnapshot: { ...quote.visualPlanSnapshot, structureFocus: 'WATCH_STRUCTURE' } },
    });
    expect(runner.verifyStructure).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ focus: 'WATCH_STRUCTURE' }) }));
  });

  it('rejects an invalid new focus instead of silently treating it as legacy GENERAL', async () => {
    const { service, runner } = build();
    const bytes = await image();
    await expect(service.verify({
      companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', sourceBuffer: bytes, candidateBuffer: bytes,
      quote: { ...quote, visualPlanSnapshot: { ...quote.visualPlanSnapshot, structureFocus: 'NOT_A_FOCUS' } },
    })).rejects.toThrow('焦点快照无效');
    expect(runner.verifyStructure).not.toHaveBeenCalled();
  });

  it('bounds large source images before passing them to the runner', async () => {
    const { service, runner } = build();
    const large = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: '#4578aa' } }).jpeg({ quality: 95 }).toBuffer();
    await service.verify({ companyId: 'company-1', staffId: 'staff-1', productId: 'product-1', quote, sourceBuffer: large, candidateBuffer: large });
    const runnerInput = runner.verifyStructure.mock.calls[0][0];
    const metadata = await sharp(runnerInput.source.buffer).metadata();
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1024);
    expect(runnerInput.source.buffer.length).toBeLessThanOrEqual(20 * 1024 * 1024);
    expect(runnerInput.source).toMatchObject({ mimeType: 'image/png', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true });
  });
});
