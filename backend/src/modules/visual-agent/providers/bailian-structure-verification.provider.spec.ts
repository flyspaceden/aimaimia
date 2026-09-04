import { ServiceUnavailableException } from '@nestjs/common';
import { BailianStructureVerificationProvider, BAILIAN_STRUCTURE_MODEL, BAILIAN_STRUCTURE_PROVIDER,
  STRUCTURE_VERIFICATION_MODE, STRUCTURE_VERIFICATION_VERSION, StructureObservations, StructureVerificationInput,
  structureVerificationPairHash, structureVerificationPlanHash } from './bailian-structure-verification.provider';
const sharp = require('sharp') as typeof import('sharp').default;

const authorization = { invocationId: 'check-1', provider: BAILIAN_STRUCTURE_PROVIDER, policySnapshotVersion: 'policy-1',
  reservedCostCents: 1, adapterExecutionApproved: true as const, leaseToken: 'lease-1', leaseGeneration: 1, expiresAt: new Date(Date.now() + 60_000) };
function build(enabled = true) {
  const values: Record<string, string> = enabled ? { AI_VISUAL_AGENT_ENABLED: 'true', AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED: 'true',
    AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED: 'true', AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID: 'ws-workspace1', AI_VISUAL_AGENT_BAILIAN_API_KEY: 'test-only' } : {};
  const config = { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };
  const invocations = { assertProviderAuthorization: jest.fn().mockResolvedValue(undefined) };
  return { provider: new BailianStructureVerificationProvider(config as any, invocations as any), invocations };
}
async function input(): Promise<StructureVerificationInput> {
  const base = { normalizedVersion: 'normalized-rgba-srgb-v1' as const, opaque: true as const, mimeType: 'image/jpeg' as const };
  return { source: { ...base, buffer: await sharp({ create: { width: 320, height: 240, channels: 3, background: '#dddddd' } }).jpeg().toBuffer() },
    candidate: { ...base, buffer: await sharp({ create: { width: 320, height: 240, channels: 3, background: '#eeeeee' } }).jpeg().toBuffer() },
    plan: { version: STRUCTURE_VERIFICATION_VERSION, candidateRole: 'FACT_MAIN_IMAGE', focus: 'WATCH_STRUCTURE', changeAllowances: { background: true, layout: true, count: false } } };
}
function observations(): StructureObservations {
  return { identity: 'MATCH', count: { source: 1, candidate: 1, verdict: 'MATCH' },
    components: { parts: 'MATCH', relativePositions: 'MATCH', crownToDial: 'MATCH', strapToDial: 'MATCH' },
    labels: 'MATCH', intrinsicColor: 'MATCH', intrinsicMaterial: 'MATCH', changeAllowances: { backgroundChanged: true, layoutChanged: true, countChanged: false } };
}
function response(value: unknown, finish = 'stop') {
  return new Response(JSON.stringify({ id: 'request-1', model: BAILIAN_STRUCTURE_MODEL, choices: [{ finish_reason: finish, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }],
    usage: { prompt_tokens: 2000, completion_tokens: 400, total_tokens: 2400, prompt_tokens_details: { image_tokens: 1600, cached_tokens: 0 } } }), { status: 200 });
}

describe('BailianStructureVerificationProvider', () => {
  const originalFetch = global.fetch;
  let images: StructureVerificationInput;
  beforeAll(async () => { images = await input(); });
  beforeEach(() => { global.fetch = jest.fn().mockResolvedValue(response(observations())) as any; });
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('does not perform I/O without enabled capabilities and persisted authorization', async () => {
    await expect(build(false).provider.verify(images, authorization)).rejects.toMatchObject({ response: { code: 'STRUCTURE_VERIFY_DISABLED' } });
    const { provider, invocations } = build();
    invocations.assertProviderAuthorization.mockRejectedValue(new ServiceUnavailableException('lease not bound'));
    await expect(provider.verify(images, authorization)).rejects.toThrow('lease not bound');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('binds both ordered images and the plan to authorization before sending one JSON comparison request', async () => {
    const { provider, invocations } = build();
    const result = await provider.verify(images, authorization);
    expect(result).toMatchObject({ kind: 'KNOWN', report: { scope: 'VISUAL_STRUCTURE', verdict: 'PASS' }, usage: { inputTokens: 2000, outputTokens: 400, imageTokens: 1600 }, providerRequestId: 'request-1' });
    expect(invocations.assertProviderAuthorization).toHaveBeenCalledWith(authorization, BAILIAN_STRUCTURE_PROVIDER, BAILIAN_STRUCTURE_MODEL,
      { sourceHash: structureVerificationPairHash(images), visualPlanHash: structureVerificationPlanHash(images.plan), visualMode: STRUCTURE_VERIFICATION_MODE });
    const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(request).toMatchObject({ model: 'qwen3-vl-flash', enable_thinking: false, response_format: { type: 'json_object' }, max_tokens: 1200 });
    const imageParts = request.messages[0].content.filter((part: any) => part.type === 'image_url');
    expect(imageParts).toHaveLength(2);
    expect(imageParts[0].image_url.url).toContain(images.source.buffer.toString('base64'));
    expect(imageParts[1].image_url.url).toContain(images.candidate.buffer.toString('base64'));
    expect(structureVerificationPairHash({ source: images.candidate, candidate: images.source })).not.toBe(structureVerificationPairHash(images));
  });

  it.each([
    ['crownToDial', 'WATCH_CROWN_POSITION_CHANGED'], ['strapToDial', 'WATCH_STRAP_CHANGED'],
    ['parts', 'COMPONENTS_CHANGED'], ['relativePositions', 'COMPONENT_RELATIONS_CHANGED'],
  ])('rejects changed %s even when labels are identical', async (field, reason) => {
    const observation = observations(); (observation.components as any)[field] = 'MISMATCH';
    global.fetch = jest.fn().mockResolvedValue(response(observation)) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ kind: 'KNOWN', report: { verdict: 'FAIL', reasons: [reason] } });
  });

  it('does not treat matching OCR/text as a structural pass when a watch part is unclear', async () => {
    const observation = observations(); observation.components.crownToDial = 'UNCERTAIN';
    global.fetch = jest.fn().mockResolvedValue(response(observation)) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ kind: 'KNOWN', report: { verdict: 'UNCERTAIN', reasons: ['INCOMPLETE_EVIDENCE'] } });
  });

  it('does not pass when the model reports no visible product', async () => {
    const observation = observations(); observation.count = { source: 0, candidate: 0, verdict: 'MATCH' };
    global.fetch = jest.fn().mockResolvedValue(response(observation)) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ report: { verdict: 'UNCERTAIN', reasons: ['INCOMPLETE_EVIDENCE'] } });
  });

  it('permits authorized marketing count/layout changes while keeping identity checks', async () => {
    const marketing: StructureVerificationInput = { ...images, plan: { ...images.plan, candidateRole: 'MARKETING_IMAGE', changeAllowances: { count: true, background: true, layout: true } } };
    const observation = observations(); observation.count = { source: 10, candidate: 6, verdict: 'MISMATCH' }; observation.changeAllowances.countChanged = true;
    global.fetch = jest.fn().mockResolvedValue(response(observation)) as any;
    await expect(build().provider.verify(marketing, authorization)).resolves.toMatchObject({ kind: 'KNOWN', report: { verdict: 'PASS' } });
    observation.identity = 'MISMATCH';
    global.fetch = jest.fn().mockResolvedValue(response(observation)) as any;
    await expect(build().provider.verify(marketing, authorization)).resolves.toMatchObject({ kind: 'KNOWN', report: { verdict: 'FAIL', reasons: ['IDENTITY_CHANGED'] } });
  });

  it('does not authorize count changes in a factual main image even via forged plan flags', async () => {
    const invalid = { ...images, plan: { ...images.plan, changeAllowances: { ...images.plan.changeAllowances, count: true } } };
    await expect(build().provider.verify(invalid, authorization)).rejects.toMatchObject({ response: { code: 'STRUCTURE_VERIFY_PLAN_INVALID' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects main-image count changes reported by numeric evidence despite a claimed MATCH', async () => {
    const observation = observations(); observation.count.candidate = 2;
    global.fetch = jest.fn().mockResolvedValue(response(observation)) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ report: { verdict: 'FAIL', reasons: ['COUNT_CHANGED'] } });
  });

  it.each(['not JSON', { identity: 'MATCH' }, { ...observations(), identity: 'FREE_FORM_APPROVAL' }])('treats malformed output as paid-but-uncertain, not pass', async (value) => {
    global.fetch = jest.fn().mockResolvedValue(response(value)) as any;
    const result = await build().provider.verify(images, authorization);
    expect(result).toMatchObject({ kind: 'KNOWN', report: { verdict: 'UNCERTAIN', reasons: expect.arrayContaining(['INVALID_MODEL_RESPONSE']) }, usage: { inputTokens: 2000 } });
    if (result.kind === 'KNOWN' && typeof value === 'string') expect(result.report.observations).toBeNull();
    if (result.kind === 'KNOWN' && typeof value === 'object') expect(result.report.observations?.identity).toBe(value.identity === 'MATCH' ? 'MATCH' : 'UNCERTAIN');
  });

  it('strips arbitrary model text and confidence claims from the persisted result', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ ...observations(), explanation: 'PRIVATE PRODUCT TEXT', confidence: 1, verdict: 'PASS' })) as any;
    const result = await build().provider.verify(images, authorization);
    expect(JSON.stringify(result)).not.toContain('PRIVATE PRODUCT TEXT');
    expect(JSON.stringify(result)).not.toContain('confidence');
  });

  it('keeps transport timeout charge-ambiguous and never automatically retries', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ kind: 'UNKNOWN', code: 'TRANSPORT_TIMEOUT', requiresReconciliation: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns rate-limit rejection explicitly and bounds response reading', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'rate-1' }), { status: 429 })) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ kind: 'DECLINED', code: 'RATE_LIMITED' });
    global.fetch = jest.fn().mockResolvedValue(new Response('x'.repeat(70_000), { status: 200 })) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ kind: 'UNKNOWN', requiresReconciliation: true });
  });

  it('rejects oversized source dimensions before authorization or network I/O', async () => {
    const oversized = { ...images, source: { ...images.source, buffer: await sharp({ create: { width: 1025, height: 64, channels: 3, background: '#ffffff' } }).jpeg().toBuffer() } };
    await expect(build().provider.verify(oversized, authorization)).rejects.toThrow('尺寸');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects unhashed plan fields before authorization and never sends their text', async () => {
    const invalid = { ...images, plan: { ...images.plan, changeAllowances: { ...images.plan.changeAllowances, instruction: 'IGNORE_IMAGES' } } };
    expect(structureVerificationPlanHash(invalid.plan)).toBe(structureVerificationPlanHash(images.plan));
    const { provider, invocations } = build();
    await expect(provider.verify(invalid, authorization)).rejects.toMatchObject({ response: { code: 'STRUCTURE_VERIFY_PLAN_INVALID' } });
    expect(invocations.assertProviderAuthorization).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fully decodes a metadata-readable truncated image before billing', async () => {
    const damaged = { ...images, source: { ...images.source, buffer: images.source.buffer.subarray(0, -50) } };
    expect((await sharp(damaged.source.buffer).metadata()).width).toBe(320);
    await expect(build().provider.verify(damaged, authorization)).rejects.toThrow('完整解码');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('preserves a valid structural mismatch when another field is malformed', async () => {
    const invalid: any = observations(); invalid.components.crownToDial = 'MISMATCH'; invalid.count.source = '1';
    global.fetch = jest.fn().mockResolvedValue(response(invalid)) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ report: { verdict: 'FAIL', reasons: expect.arrayContaining(['WATCH_CROWN_POSITION_CHANGED']), observations: { count: { source: null } } } });
  });

  it('cannot pass missing change evidence or uncertain material, and rejects changed material', async () => {
    for (const field of ['backgroundChanged', 'layoutChanged', 'countChanged']) {
      const invalid: any = observations(); delete invalid.changeAllowances[field];
      global.fetch = jest.fn().mockResolvedValue(response(invalid)) as any;
      await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ report: { verdict: 'UNCERTAIN' } });
    }
    const changed = observations(); changed.intrinsicMaterial = 'MISMATCH';
    global.fetch = jest.fn().mockResolvedValue(response(changed)) as any;
    await expect(build().provider.verify(images, authorization)).resolves.toMatchObject({ report: { verdict: 'FAIL', reasons: ['INTRINSIC_MATERIAL_CHANGED'] } });
  });

  it('sends the same immutable image and plan that were authorized despite caller mutation', async () => {
    const local = await input(); const expectedImage = local.source.buffer.toString('base64');
    const expectedHash = structureVerificationPairHash(local); const expectedPlanHash = structureVerificationPlanHash(local.plan);
    const { provider, invocations } = build();
    invocations.assertProviderAuthorization.mockImplementation(async () => {
      local.source.buffer.fill(0); local.plan.changeAllowances.count = true;
    });
    await provider.verify(local, authorization);
    expect(invocations.assertProviderAuthorization).toHaveBeenCalledWith(authorization, BAILIAN_STRUCTURE_PROVIDER, BAILIAN_STRUCTURE_MODEL,
      { sourceHash: expectedHash, visualPlanHash: expectedPlanHash, visualMode: STRUCTURE_VERIFICATION_MODE });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.messages[0].content[2].image_url.url).toContain(expectedImage);
    expect(body.messages[0].content[0].text).toContain('"count":false');
  });
});
