import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, VisualAgentInvocation, VisualAgentInvocationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { VisualProviderAuthorization, VisualProviderSource } from './providers/visual-image-edit.provider';
import {
  BailianStructureVerificationProvider, BAILIAN_STRUCTURE_MODEL, BAILIAN_STRUCTURE_PROVIDER,
  STRUCTURE_VERIFICATION_MODE, STRUCTURE_VERIFICATION_VERSION, StructureVerificationInput,
  StructureVerificationReport, StructureVerificationResult, structureVerificationPairHash,
  structureVerificationPlanHash, deriveStructureVerificationReport,
} from './providers/bailian-structure-verification.provider';
const sharp = require('sharp') as typeof import('sharp').default;

export type VerifyStructureInput = StructureVerificationInput & {
  tenantId: string; ownerClientId: string; adapterNamespace: string; externalObjectId: string;
  actorId: string; idempotencyKey: string; expiresAt: Date;
};
export type VerifyStructureResult = StructureVerificationResult & { invocationId: string; billingStatus?: 'BILLING_EXCEPTION' };
const REASONS = new Set(['IDENTITY_CHANGED', 'COUNT_CHANGED', 'COMPONENTS_CHANGED', 'COMPONENT_RELATIONS_CHANGED',
  'WATCH_CROWN_POSITION_CHANGED', 'WATCH_STRAP_CHANGED', 'LABELS_CHANGED', 'INTRINSIC_COLOR_CHANGED', 'INTRINSIC_MATERIAL_CHANGED',
  'UNAUTHORIZED_BACKGROUND_CHANGE', 'UNAUTHORIZED_LAYOUT_CHANGE', 'INCOMPLETE_EVIDENCE', 'INVALID_MODEL_RESPONSE',
  'INCONSISTENT_MODEL_RESPONSE', 'NO_MATERIAL_CONFLICT']);

/** 同步结构检查的持久化边界。检查结论与供应商账单分开，不把 token 估算写成实际成本。 */
@Injectable()
export class VisualAgentStructureRunnerService {
  private readonly logger = new Logger(VisualAgentStructureRunnerService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly invocations: VisualAgentInvocationService,
    private readonly provider: BailianStructureVerificationProvider,
  ) {}

  isAvailable() { return this.provider.isAvailable(); }

  async verifyStructure(input: VerifyStructureInput): Promise<VerifyStructureResult> {
    // Copy the plan and image bytes before the first I/O, so caller mutation cannot change the reserved identity.
    const plan = this.copyPlan(input.plan);
    const sourceCopy = { ...input.source, buffer: Buffer.from(input.source.buffer) };
    const candidateCopy = { ...input.candidate, buffer: Buffer.from(input.candidate.buffer) };
    const scope = { tenantId: input.tenantId, ownerClientId: input.ownerClientId, adapterNamespace: input.adapterNamespace,
      externalObjectId: input.externalObjectId, actorId: input.actorId, idempotencyKey: input.idempotencyKey };
    const expiresAt = new Date(input.expiresAt);
    const [source, candidate] = await Promise.all([this.normalize(sourceCopy), this.normalize(candidateCopy)]);
    const normalized = { source, candidate, plan };
    const binding = { ...scope, sourceHash: structureVerificationPairHash(normalized), visualPlanHash: structureVerificationPlanHash(plan),
      provider: BAILIAN_STRUCTURE_PROVIDER, model: BAILIAN_STRUCTURE_MODEL, visualMode: STRUCTURE_VERIFICATION_MODE };
    const read = () => this.prisma.visualAgentInvocation.findUnique({ where: {
      tenantId_ownerClientId_adapterNamespace_idempotencyKey: { tenantId: scope.tenantId, ownerClientId: scope.ownerClientId,
        adapterNamespace: scope.adapterNamespace, idempotencyKey: scope.idempotencyKey },
    } });
    // Completed results remain recoverable even after the route is paused or the original expiry passes.
    const existing = await read();
    if (existing) {
      this.assertBinding(existing, binding);
      if (existing.status !== VisualAgentInvocationStatus.RESERVED) return this.replay(existing, binding, plan);
    }
    await this.provider.preflight(normalized);
    const reserved = await this.invocations.reserve({ ...binding, expiresAt });
    const current = await read();
    if (!current || current.id !== reserved.invocationId) throw new ConflictException('商品结构检查调用不存在');
    this.assertBinding(current, binding);
    if (current.status !== VisualAgentInvocationStatus.RESERVED) return this.replay(current, binding, plan);
    let authorization: VisualProviderAuthorization;
    try {
      authorization = await this.invocations.acquireForSubmit(current.id, BAILIAN_STRUCTURE_MODEL, BAILIAN_STRUCTURE_PROVIDER,
        binding.sourceHash, binding.visualPlanHash, STRUCTURE_VERIFICATION_MODE);
    } catch (error) {
      const raced = await read();
      if (raced && raced.status !== VisualAgentInvocationStatus.RESERVED) {
        this.assertBinding(raced, binding);
        return this.replay(raced, binding, plan);
      }
      throw error;
    }
    let outcome: StructureVerificationResult;
    try { outcome = await this.provider.verify(normalized, authorization); }
    catch { outcome = this.unknown('TRANSPORT_FAILURE'); }
    if (outcome.kind !== 'KNOWN') {
      const recorded = await this.recordUncertainOutcome(authorization, outcome);
      return { ...(recorded ? outcome : this.unknown('AMBIGUOUS_PROVIDER_RESPONSE')), invocationId: current.id };
    }
    const report = this.cleanReport(outcome.report, binding, plan);
    const providerRequestId = this.requestId(outcome.providerRequestId);
    if (!report || !providerRequestId) {
      const unknown = this.unknown('AMBIGUOUS_PROVIDER_RESPONSE', providerRequestId);
      await this.recordUncertainOutcome(authorization, unknown);
      return { ...unknown, invocationId: current.id };
    }
    const usage = this.cleanUsage(outcome.usage);
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.visualAgentInvocation.updateMany({
          where: { id: current.id, ...binding, status: VisualAgentInvocationStatus.SUBMITTING,
            leaseToken: authorization.leaseToken, leaseGeneration: authorization.leaseGeneration,
            leaseExpiresAt: { gt: new Date() } },
          data: { verificationReport: report as Prisma.InputJsonValue, providerRequestId,
            providerUsage: usage, status: VisualAgentInvocationStatus.SUCCEEDED,
            leaseToken: null, leaseExpiresAt: null, reconciliationReason: null },
        });
        if (updated.count !== 1) throw new ConflictException('商品结构检查提交租约已失效');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch {
      // Includes ambiguous COMMIT acknowledgements. Never invoke the model again after a report write fails.
      const unknown = this.unknown('AMBIGUOUS_PROVIDER_RESPONSE', providerRequestId);
      await this.recordUncertainOutcome(authorization, unknown);
      return { ...unknown, invocationId: current.id };
    }
    return { kind: 'KNOWN', invocationId: current.id, report, providerRequestId, usage };
  }

  private async normalize(source: VisualProviderSource): Promise<VisualProviderSource> {
    if (!source || !Buffer.isBuffer(source.buffer) || !source.buffer.length || source.buffer.length > 20 * 1024 * 1024
      || source.normalizedVersion !== 'normalized-rgba-srgb-v1' || source.opaque !== true) throw new ConflictException('商品结构检查图片输入无效');
    const image = sharp(source.buffer, { failOn: 'error', limitInputPixels: 64_000_000 });
    const meta = await image.metadata();
    const mime = meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : null;
    if (mime !== source.mimeType || !meta.width || !meta.height || meta.width < 64 || meta.height < 64
      || meta.width > 8000 || meta.height > 8000 || meta.width / meta.height > 8 || meta.height / meta.width > 8
      || meta.hasAlpha || (meta.pages ?? 1) > 1) throw new ConflictException('商品结构检查图片尺寸、透明度或格式无效');
    return { buffer: await image.rotate().toColourspace('srgb')
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).removeAlpha().png().toBuffer(),
    mimeType: 'image/png', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true };
  }

  private copyPlan(plan: StructureVerificationInput['plan']): StructureVerificationInput['plan'] {
    if (plan?.version !== STRUCTURE_VERIFICATION_VERSION
      || !['FACT_MAIN_IMAGE', 'DETAIL_IMAGE', 'MARKETING_IMAGE'].includes(plan.candidateRole)
      || !['WATCH_STRUCTURE', 'GENERAL_PRODUCT'].includes(plan.focus)
      || !plan.changeAllowances || (['background', 'layout', 'count'] as const).some((key) => typeof plan.changeAllowances[key] !== 'boolean')
      || (plan.candidateRole !== 'MARKETING_IMAGE' && plan.changeAllowances.count)) throw new ConflictException('商品结构检查方案无效');
    return { version: plan.version, candidateRole: plan.candidateRole, focus: plan.focus,
      changeAllowances: { background: plan.changeAllowances.background, layout: plan.changeAllowances.layout, count: plan.changeAllowances.count } };
  }

  private assertBinding(row: VisualAgentInvocation, binding: Record<string, string>) {
    if (Object.entries(binding).some(([key, value]) => row[key as keyof VisualAgentInvocation] !== value)) throw new ConflictException('商品结构检查幂等键已绑定到其他图片、方案或业务范围');
  }

  private replay(row: VisualAgentInvocation, binding: Record<string, string>, plan: StructureVerificationInput['plan']): VerifyStructureResult {
    const report = this.cleanReport(row.verificationReport, binding, plan);
    const providerRequestId = this.requestId(row.providerRequestId);
    if ((row.status === VisualAgentInvocationStatus.SUCCEEDED || row.status === VisualAgentInvocationStatus.BILLING_EXCEPTION) && report && providerRequestId) {
      return { kind: 'KNOWN', invocationId: row.id, report, providerRequestId, usage: this.cleanUsage(row.providerUsage),
        ...(row.status === VisualAgentInvocationStatus.BILLING_EXCEPTION ? { billingStatus: 'BILLING_EXCEPTION' as const } : {}) };
    }
    if (row.status === VisualAgentInvocationStatus.RELEASED) {
      return { kind: 'DECLINED', invocationId: row.id, code: row.reconciliationReason === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'INVALID_REQUEST', providerRequestId };
    }
    return { ...this.unknown('AMBIGUOUS_PROVIDER_RESPONSE', providerRequestId), invocationId: row.id };
  }

  private async recordUncertainOutcome(authorization: VisualProviderAuthorization, outcome: Exclude<StructureVerificationResult, { kind: 'KNOWN' }>) {
    try { await this.invocations.recordSynchronousProviderOutcome(authorization, outcome); return true; }
    catch {
      // The persisted SUBMITTING fence still forbids resubmission; the existing expiry worker reconciles it.
      this.logger.warn(`Structure verification outcome pending reconciliation: ${authorization.invocationId}`);
      return false;
    }
  }

  private unknown(code: 'TRANSPORT_FAILURE' | 'AMBIGUOUS_PROVIDER_RESPONSE', providerRequestId?: string) {
    return { kind: 'UNKNOWN' as const, code, requiresReconciliation: true as const, ...(providerRequestId ? { providerRequestId } : {}) };
  }
  private requestId(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : undefined; }
  private cleanUsage(value: unknown): Record<string, number> {
    const usage: Record<string, number> = {};
    if (value && typeof value === 'object') for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'imageTokens', 'cachedTokens']) {
      const count = (value as Record<string, unknown>)[key];
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) usage[key] = count;
    }
    return usage;
  }

  /** 白名单重建报告，数据库重放也不将自由模型文本暴露给调用方。 */
  private cleanReport(value: unknown, binding: Record<string, string>, plan: StructureVerificationInput['plan']): StructureVerificationReport | null {
    if (!value || typeof value !== 'object') return null;
    const report = value as StructureVerificationReport;
    if (report.version !== STRUCTURE_VERIFICATION_VERSION || report.scope !== 'VISUAL_STRUCTURE'
      || !['PASS', 'FAIL', 'UNCERTAIN'].includes(report.verdict) || report.sourcePairHash !== binding.sourceHash
      || report.planHash !== binding.visualPlanHash || !Array.isArray(report.reasons) || report.reasons.length < 1
      || report.reasons.length > REASONS.size || report.reasons.some((reason) => !REASONS.has(reason))) return null;
    const o = report.observations;
    const comparison = (v: unknown) => ['MATCH', 'MISMATCH', 'UNCERTAIN'].includes(v as string);
    const optional = (v: unknown) => comparison(v) || v === 'NOT_APPLICABLE';
    const count = (v: unknown) => v === null || (Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10000);
    if (o !== null && (!o || !comparison(o.identity) || !comparison(o.intrinsicColor) || !comparison(o.intrinsicMaterial) || !optional(o.labels)
      || !o.count || !count(o.count.source) || !count(o.count.candidate) || !comparison(o.count.verdict)
      || !o.components || !comparison(o.components.parts) || !comparison(o.components.relativePositions)
      || !optional(o.components.crownToDial) || !optional(o.components.strapToDial) || !o.changeAllowances
      || (['backgroundChanged', 'layoutChanged', 'countChanged'] as const).some((key) => o.changeAllowances[key] !== null && typeof o.changeAllowances[key] !== 'boolean'))) return null;
    if (!o && report.verdict !== 'UNCERTAIN') return null;
    const cleaned: StructureVerificationReport = { version: report.version, scope: report.scope, verdict: report.verdict, reasons: [...new Set(report.reasons)],
      sourcePairHash: report.sourcePairHash, planHash: report.planHash,
      observations: o ? { identity: o.identity, count: { source: o.count.source, candidate: o.count.candidate, verdict: o.count.verdict },
        components: { parts: o.components.parts, relativePositions: o.components.relativePositions, crownToDial: o.components.crownToDial, strapToDial: o.components.strapToDial },
        labels: o.labels, intrinsicColor: o.intrinsicColor, intrinsicMaterial: o.intrinsicMaterial, changeAllowances: { backgroundChanged: o.changeAllowances.backgroundChanged,
          layoutChanged: o.changeAllowances.layoutChanged, countChanged: o.changeAllowances.countChanged } } : null };
    if (!cleaned.observations) return cleaned;
    const derived = deriveStructureVerificationReport(cleaned.observations, plan, binding.sourceHash, binding.visualPlanHash);
    // Never trust a stored PASS that contradicts its observations, or upgrade an
    // earlier uncertainty/failure merely because current fields appear complete.
    const severity = { PASS: 0, UNCERTAIN: 1, FAIL: 2 };
    const verdict = severity[cleaned.verdict] >= severity[derived.verdict] ? cleaned.verdict : derived.verdict;
    if (verdict === 'PASS') return derived;
    const reasons = [...new Set([...cleaned.reasons, ...derived.reasons].filter((reason) => reason !== 'NO_MATERIAL_CONFLICT'))];
    if (cleaned.verdict !== derived.verdict) reasons.push('INCONSISTENT_MODEL_RESPONSE');
    return { ...cleaned, verdict, reasons: [...new Set(reasons.length ? reasons : ['INCOMPLETE_EVIDENCE' as const])] };
  }
}
