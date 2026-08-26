import { Injectable } from '@nestjs/common';
import { BailianWanImageProvider } from './providers/bailian-wan-image.provider';
import { BAILIAN_WAN_PROVIDER } from './providers/bailian-wan-image.provider';
import {
  VisualProviderQueryResult,
  VisualProviderServerPlan,
  VisualProviderSource,
  VisualProviderSubmitResult,
} from './providers/visual-image-edit.provider';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { normalizedSourceSha256, visualPlanSha256 } from './visual-agent-integrity';

type SubmitBailianInvocationInput = {
  invocationId: string;
  model: 'wan2.7-image' | 'wan2.7-image-pro';
  source: VisualProviderSource;
  visualPlan: VisualProviderServerPlan;
};

/**
 * The only Core path allowed to call a Provider. It claims a persisted,
 * single-use lease first and durably records every accepted/declined/unknown
 * result before returning it to a future worker.
 */
@Injectable()
export class VisualAgentProviderRunnerService {
  constructor(
    private readonly invocations: VisualAgentInvocationService,
    private readonly bailian: BailianWanImageProvider,
  ) {}

  async submitBailian(input: SubmitBailianInvocationInput): Promise<VisualProviderSubmitResult> {
    await this.bailian.preflight({ source: input.source, visualPlan: input.visualPlan, model: input.model });
    const [sourceHash, planHash] = await Promise.all([
      normalizedSourceSha256(input.source),
      Promise.resolve(visualPlanSha256(input.visualPlan)),
    ]);
    const authorization = await this.invocations.acquireForSubmit(
      input.invocationId,
      input.model,
      BAILIAN_WAN_PROVIDER,
      sourceHash,
      planHash,
      input.visualPlan.direction,
    );
    let outcome: VisualProviderSubmitResult;
    try {
      outcome = await this.bailian.submit({
        source: input.source,
        visualPlan: input.visualPlan,
        model: input.model,
        authorization,
      });
    } catch (error) {
      // No catch path may infer that Provider I/O did not happen. Preserve
      // the reservation and lock the invocation in RECONCILING; a future
      // operator may explicitly release a proven preflight-only failure.
      await this.invocations.recordSubmitOutcome(authorization, {
        kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
      });
      throw error;
    }
    await this.invocations.recordSubmitOutcome(authorization, outcome);
    return outcome;
  }

  async queryBailian(invocationId: string): Promise<VisualProviderQueryResult> {
    const authorization = await this.invocations.acquireForQuery(invocationId);
    let outcome: VisualProviderQueryResult;
    try {
      outcome = await this.bailian.query(authorization.providerTaskId);
    } catch (error) {
      await this.invocations.recordQueryOutcome(authorization, {
        kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
      });
      throw error;
    }
    await this.invocations.recordQueryOutcome(authorization, outcome);
    return outcome;
  }
}
