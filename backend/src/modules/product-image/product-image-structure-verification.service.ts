import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { VisualAgentStructureRunnerService } from '../visual-agent/visual-agent-structure-runner.service';
import { STRUCTURE_VERIFICATION_VERSION, StructureVerificationPlan, StructureVerificationReport } from '../visual-agent/providers/bailian-structure-verification.provider';
import { VisualProviderSource } from '../visual-agent/providers/visual-image-edit.provider';
import { ProductVisualTestAccessService } from './product-visual-test-access.service';
import { AIMAI_VISUAL_CLIENT_ID, AIMAI_VISUAL_TENANT_ID } from './aimai-product-visual.constants';
const sharp = require('sharp') as typeof import('sharp').default;

export type ProductImageStructureVerificationResult = {
  /** Deliberately finite: no provider prose or transport detail reaches a candidate record. */
  state: 'PASS' | 'FAIL' | 'UNCERTAIN' | 'PENDING' | 'DISABLED';
  report: StructureVerificationReport | null;
  invocationId: string | null;
  /** Billing reconciliation is independent from the known structure verdict. */
  billingStatus?: 'BILLING_EXCEPTION';
};

/**
 * Product-domain boundary for the Core structure runner.  It owns only the
 * fixed, quote-derived comparison plan; it never accepts a seller prompt,
 * provider/model choice, or mutable billing fields.
 */
@Injectable()
export class ProductImageStructureVerificationService {
  constructor(
    private readonly runner: VisualAgentStructureRunnerService,
    private readonly testAccess: ProductVisualTestAccessService,
  ) {}

  async verify(input: {
    companyId: string;
    staffId: string;
    productId: string;
    quote: { id: string; visualPlanSnapshot: unknown; rateCardSnapshot: unknown };
    sourceBuffer: Buffer;
    candidateBuffer: Buffer;
  }): Promise<ProductImageStructureVerificationResult> {
    let source: VisualProviderSource;
    let candidate: VisualProviderSource;
    let plan: StructureVerificationPlan;
    // Unsupported/undecodable source evidence is a content limitation, not a
    // recoverable execution lease: it remains eligible only for human review.
    try {
      [source, candidate] = await Promise.all([
        this.toRunnerSource(input.sourceBuffer),
        this.toRunnerSource(input.candidateBuffer),
      ]);
    } catch {
      return { state: 'UNCERTAIN', report: null, invocationId: null };
    }
    plan = this.planFromQuote(input.quote.visualPlanSnapshot, input.quote.rateCardSnapshot);

    const runnerInput = {
      tenantId: AIMAI_VISUAL_TENANT_ID,
      ownerClientId: AIMAI_VISUAL_CLIENT_ID,
      adapterNamespace: 'aimai-product',
      externalObjectId: input.productId,
      actorId: input.staffId,
      // Fixed-size digest keeps even a normal cuid quote ID under Core's
      // idempotency-key limit while binding this exact ordered normalized pair.
      idempotencyKey: `paid-candidate-structure:${createHash('sha256').update(`${input.quote.id}:${STRUCTURE_VERIFICATION_VERSION}:${this.imageHash(source)}:${this.imageHash(candidate)}`).digest('hex')}`,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      source,
      candidate,
      plan,
    };

    // The runner checks a durable invocation before provider preflight. Thus,
    // after a route is paused, replay can still return an existing known FAIL
    // (or PASS) without bootstrap or provider I/O. A cache miss is disabled.
    if (!this.runner.isAvailable()) {
      try {
        return this.fromRunnerResult(await this.runner.verifyStructure(runnerInput));
      } catch (error) {
        // Cache miss reaches runner preflight after its durable replay lookup.
        // Do not turn DB/lease failures into a terminal content conclusion.
        return this.isDisabled(error)
          ? { state: 'DISABLED', report: null, invocationId: null }
          : { state: 'PENDING', report: null, invocationId: null };
      }
    }

    try {
      // This only provisions missing staging all-merchant scopes and never
      // overwrites an administrator's policy. It is before any new runner
      // reservation, so no provider call is made without Core budget policy.
      await this.testAccess.ensureStructureTestBudget({ companyId: input.companyId, staffId: input.staffId, productId: input.productId });
      return this.fromRunnerResult(await this.runner.verifyStructure(runnerInput));
    } catch (error) {
      // Budget/DB/lease/provider ambiguity has no content verdict. Preserve
      // the candidate as pending so an existing durable invocation can replay.
      return this.isDisabled(error)
        ? { state: 'DISABLED', report: null, invocationId: null }
        : { state: 'PENDING', report: null, invocationId: null };
    }
  }

  private planFromQuote(visualPlanSnapshot: unknown, rateCardSnapshot: unknown): StructureVerificationPlan {
    const visualPlan = visualPlanSnapshot as { direction?: unknown; allowedOperations?: unknown; structureFocus?: unknown } | null;
    const rateCard = rateCardSnapshot as { candidateRole?: unknown } | null;
    const direction = visualPlan?.direction;
    const role = rateCard?.candidateRole;
    if (!['PRESERVE_REAL_SCENE', 'CATALOG_STUDIO', 'PRODUCT_RETOUCH', 'MARKETING_SCENE'].includes(direction as string)
      || !['FACT_MAIN_IMAGE', 'DETAIL_IMAGE', 'MARKETING_IMAGE'].includes(role as string)) {
      throw new Error('invalid quote snapshot');
    }
    // The product provider plan is server-authored. We only use its fixed
    // operation list to express the already-authorized layout/background
    // allowances; no browser text can influence this comparison plan.
    const operations = Array.isArray(visualPlan?.allowedOperations) ? visualPlan.allowedOperations : [];
    const marketing = direction === 'MARKETING_SCENE';
    if (marketing !== (role === 'MARKETING_IMAGE')) throw new Error('incompatible quote role');
    // Quotes from before the focus field existed are explicitly GENERAL. A
    // malformed new snapshot is not silently downgraded to that legacy mode.
    const focus = visualPlan?.structureFocus === undefined ? 'GENERAL_PRODUCT'
      : visualPlan.structureFocus === 'WATCH_STRUCTURE' || visualPlan.structureFocus === 'GENERAL_PRODUCT'
        ? visualPlan.structureFocus
        : null;
    if (!focus) throw new ConflictException('图片美化报价的结构检查焦点快照无效');
    return {
      version: STRUCTURE_VERIFICATION_VERSION,
      candidateRole: role as StructureVerificationPlan['candidateRole'],
      focus,
      changeAllowances: {
        // This permits a substantive scene replacement only. Background
        // cleanup/simplification is still checked as a protected real scene.
        background: direction !== 'PRESERVE_REAL_SCENE' && operations.some((item) => item === 'BACKGROUND_REPLACE' || item === 'SCENE_RESTAGE'),
        layout: marketing || operations.includes('COMPOSITION'),
        // Only marketing output may change displayed count.
        count: marketing,
      },
    };
  }

  private async toRunnerSource(buffer: Buffer): Promise<VisualProviderSource> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('empty image');
    // This is a format/opacity normalization for the runner, not an edit:
    // preserve the actual pixels and colourspace, never flatten onto a new
    // background or apply colour/scene transformations.
    const image = sharp(buffer, { failOn: 'error', limitInputPixels: 64_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64
      || metadata.width > 8000 || metadata.height > 8000 || metadata.width / metadata.height > 8 || metadata.height / metadata.width > 8
      || (metadata.pages ?? 1) > 1) throw new Error('invalid image dimensions');
    // Match the runner's bounded canonicalization before making its request:
    // this is not a new visual transformation, background replacement, or
    // colour adjustment; it only produces the opaque input contract it needs.
    const normalized = await image.rotate().toColourspace('srgb')
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .removeAlpha().png().toBuffer();
    return { buffer: normalized, mimeType: 'image/png', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true };
  }

  private imageHash(source: VisualProviderSource) {
    return createHash('sha256').update(source.buffer).digest('hex');
  }

  private fromRunnerResult(result: Awaited<ReturnType<VisualAgentStructureRunnerService['verifyStructure']>>): ProductImageStructureVerificationResult {
    // UNKNOWN means the runner has a durable SUBMITTING/reconciliation fence.
    // It is not a content conclusion and must never let this candidate settle.
    if (result.kind === 'UNKNOWN') return { state: 'PENDING', report: null, invocationId: result.invocationId ?? null };
    if (result.kind !== 'KNOWN') return { state: 'UNCERTAIN', report: null, invocationId: result.invocationId ?? null };
    return {
      state: result.report.verdict,
      report: result.report,
      invocationId: result.invocationId,
      ...(result.billingStatus === 'BILLING_EXCEPTION' ? { billingStatus: 'BILLING_EXCEPTION' as const } : {}),
    };
  }

  private isDisabled(error: unknown) {
    return error instanceof ServiceUnavailableException
      && (error.getResponse() as { code?: unknown })?.code === 'STRUCTURE_VERIFY_DISABLED';
  }
}
