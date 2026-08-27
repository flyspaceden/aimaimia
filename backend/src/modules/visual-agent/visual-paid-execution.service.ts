import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { VisualAgentInvocationStatus, VisualCreditQuoteStatus } from '@prisma/client';
import { BailianWanImageProvider, BAILIAN_WAN_PROVIDER } from './providers/bailian-wan-image.provider';
import { VisualProviderServerPlan, VisualProviderSource } from './providers/visual-image-edit.provider';
import { normalizedSourceSha256, visualPlanSha256 } from './visual-agent-integrity';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { VisualAgentClientPrincipal } from './visual-agent-client-key.service';
import { VisualAgentProviderRunnerService } from './visual-agent-provider-runner.service';
import { VisualCreditService } from './visual-credit.service';

type PaidExecutionInput = {
  principal: VisualAgentClientPrincipal;
  quoteId: string;
  sourceAssetRef: string;
  sourceCanonicalHash: string;
  source: VisualProviderSource;
  visualPlan: VisualProviderServerPlan;
};

/**
 * Only a trusted Adapter may call this service after it has re-read the source
 * asset and the business object's current version. It is intentionally not an
 * HTTP controller: an API client cannot pass arbitrary bytes or prompt text.
 */
@Injectable()
export class VisualPaidExecutionService {
  constructor(
    private readonly credits: VisualCreditService,
    private readonly invocations: VisualAgentInvocationService,
    private readonly runner: VisualAgentProviderRunnerService,
    private readonly wan: BailianWanImageProvider,
  ) {}

  async executeReservedQuote(input: PaidExecutionInput) {
    const quote = await this.credits.getReservedQuoteForExecution({ principal: input.principal, quoteId: input.quoteId });
    if (quote.sourceAssetRef !== input.sourceAssetRef || quote.sourceHash !== input.sourceCanonicalHash) {
      throw new ConflictException('图片美化报价的原图证据已变化');
    }
    const quotePlan = quote.visualPlanSnapshot as Record<string, unknown>;
    const actualPlanHash = visualPlanSha256(input.visualPlan);
    if (!this.matchesPlan(quotePlan, input.visualPlan) || quote.visualPlanHash !== actualPlanHash) {
      throw new ConflictException('图片美化报价的视觉计划已变化');
    }
    if (quote.visualAgentInvocationId) {
      return {
        quoteId: quote.id,
        invocationId: quote.visualAgentInvocationId,
        status: 'ALREADY_BOUND' as const,
      };
    }
    if (quote.status === VisualCreditQuoteStatus.RECONCILING) {
      return { quoteId: quote.id, invocationId: null, status: 'RECONCILING' as const };
    }

    let model: 'wan2.7-image' | 'wan2.7-image-pro';
    try {
      model = this.modelForProfile(quote.rateCard.modelProfile);
      // This checks enable flags, workspace/key shape, source constraints and
      // fixed prompt template before the quote can become provider-billable.
      await this.wan.preflight({ source: input.source, visualPlan: input.visualPlan, model });
    } catch (error) {
      await this.credits.releaseReservedQuote(quote.id, 'PROVIDER_PREFLIGHT_DECLINED');
      throw error;
    }

    const sourceHash = await normalizedSourceSha256(input.source);
    let reservation;
    try {
      reservation = await this.invocations.reserve({
        tenantId: input.principal.tenantId,
        ownerClientId: input.principal.clientId,
        adapterNamespace: input.principal.adapterNamespace,
        externalObjectId: quote.externalObjectId,
        actorId: quote.actorId,
        provider: BAILIAN_WAN_PROVIDER,
        model,
        visualMode: input.visualPlan.direction,
        sourceHash,
        visualPlanHash: actualPlanHash,
        idempotencyKey: `quote:${quote.id}`,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
    } catch (error) {
      await this.credits.releaseReservedQuote(quote.id, 'CORE_RESERVATION_DECLINED');
      throw error;
    }
    try {
      await this.credits.attachInvocation({ principal: input.principal, quoteId: quote.id, invocationId: reservation.invocationId });
    } catch (error) {
      try {
        await this.invocations.releaseBeforeSubmit(reservation.invocationId, 'QUOTE_BIND_FAILED_BEFORE_PROVIDER_SUBMIT');
      } finally {
        await this.credits.releaseReservedQuote(quote.id, 'QUOTE_BIND_FAILED_BEFORE_PROVIDER_SUBMIT');
      }
      throw error;
    }
    if (reservation.status !== VisualAgentInvocationStatus.RESERVED) {
      await this.credits.markReconciliation(quote.id, `EXISTING_INVOCATION_${reservation.status}`);
      return { quoteId: quote.id, invocationId: reservation.invocationId, status: 'RECONCILING' as const };
    }

    try {
      const outcome = await this.runner.submitBailian({
        invocationId: reservation.invocationId,
        model,
        source: input.source,
        visualPlan: input.visualPlan,
      });
      if (outcome.kind === 'DECLINED') {
        await this.credits.releaseReservedQuote(quote.id, `PROVIDER_DECLINED:${outcome.code}`);
        return { quoteId: quote.id, invocationId: reservation.invocationId, status: 'RELEASED' as const };
      }
      if (outcome.kind === 'UNKNOWN') {
        await this.credits.markReconciliation(quote.id, `PROVIDER_UNKNOWN:${outcome.code}`);
        return { quoteId: quote.id, invocationId: reservation.invocationId, status: 'RECONCILING' as const };
      }
      return {
        quoteId: quote.id,
        invocationId: reservation.invocationId,
        providerTaskId: outcome.providerTaskId,
        status: outcome.state,
      };
    } catch (error) {
      await this.credits.markReconciliation(quote.id, 'PROVIDER_SUBMIT_EXCEPTION');
      throw error;
    }
  }

  private modelForProfile(profile: string): 'wan2.7-image' | 'wan2.7-image-pro' {
    if (profile === 'BAILIAN_WAN_STANDARD') return 'wan2.7-image';
    if (profile === 'BAILIAN_WAN_PRO') return 'wan2.7-image-pro';
    throw new ServiceUnavailableException('当前图片美化报价尚未配置可执行的百炼模型');
  }

  private matchesPlan(snapshot: Record<string, unknown>, plan: VisualProviderServerPlan) {
    const operations = snapshot.allowedOperations;
    return snapshot.direction === plan.direction
      && snapshot.riskProfile === plan.riskProfile
      && snapshot.protectedRegionVersion === plan.protectedRegionVersion
      && Array.isArray(operations)
      && operations.length === plan.allowedOperations.length
      && [...operations].sort().every((value, index) => value === [...plan.allowedOperations].sort()[index]);
  }
}
