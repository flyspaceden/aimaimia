import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BailianQwenImageProvider, BAILIAN_QWEN_IMAGE_PROVIDER } from './providers/bailian-qwen-image.provider';
import { BailianWanImageProvider, BAILIAN_WAN_PROVIDER } from './providers/bailian-wan-image.provider';
import {
  VisualImageEditProvider,
  VisualProviderModel,
  VisualProviderOutput,
  VisualProviderQueryResult,
  VisualProviderServerPlan,
  VisualProviderSource,
  VisualProviderSubmitResult,
} from './providers/visual-image-edit.provider';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { normalizedSourceSha256, visualPlanSha256 } from './visual-agent-integrity';

type SubmitProviderInvocationInput = {
  invocationId: string;
  provider: typeof BAILIAN_WAN_PROVIDER | typeof BAILIAN_QWEN_IMAGE_PROVIDER;
  model: VisualProviderModel;
  source: VisualProviderSource;
  visualPlan: VisualProviderServerPlan;
};

/**
 * The only Core path allowed to call an image Provider. Every provider gets
 * the same persisted lease and outcome recording; an Adapter cannot choose a
 * transport implementation, URL, prompt, budget or retry behavior.
 */
@Injectable()
export class VisualAgentProviderRunnerService {
  constructor(
    private readonly invocations: VisualAgentInvocationService,
    private readonly wan: BailianWanImageProvider,
    private readonly qwen: BailianQwenImageProvider,
  ) {}

  async preflightProvider(input: Omit<SubmitProviderInvocationInput, 'invocationId'>) {
    await this.providerFor(input.provider).preflight({ source: input.source, visualPlan: input.visualPlan, model: input.model });
  }

  isProviderRouteAvailable(provider: string, model: VisualProviderModel) {
    if (provider === BAILIAN_WAN_PROVIDER) return this.wan.isModelAvailable(model);
    if (provider === BAILIAN_QWEN_IMAGE_PROVIDER) return this.qwen.isModelAvailable(model);
    return false;
  }

  async submitProvider(input: SubmitProviderInvocationInput): Promise<VisualProviderSubmitResult> {
    const provider = this.providerFor(input.provider);
    await provider.preflight({ source: input.source, visualPlan: input.visualPlan, model: input.model });
    const [sourceHash, planHash] = await Promise.all([
      normalizedSourceSha256(input.source),
      Promise.resolve(visualPlanSha256(input.visualPlan)),
    ]);
    const authorization = await this.invocations.acquireForSubmit(
      input.invocationId,
      input.model,
      input.provider,
      sourceHash,
      planHash,
      input.visualPlan.direction,
    );
    let outcome: VisualProviderSubmitResult;
    try {
      outcome = await provider.submit({ source: input.source, visualPlan: input.visualPlan, model: input.model, authorization });
    } catch (error) {
      // Provider I/O may already have happened. Persist ambiguity first and
      // never infer that a new paid submission is safe.
      await this.invocations.recordSubmitOutcome(authorization, {
        kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
      });
      throw error;
    }
    await this.invocations.recordSubmitOutcome(authorization, outcome);
    return outcome;
  }

  async queryProvider(invocationId: string): Promise<VisualProviderQueryResult> {
    const authorization = await this.invocations.acquireForQuery(invocationId);
    const provider = this.providerFor(authorization.provider);
    let outcome: VisualProviderQueryResult;
    try {
      outcome = await provider.query(authorization.providerTaskId);
    } catch (error) {
      await this.invocations.recordQueryOutcome(authorization, {
        kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
      });
      throw error;
    }
    await this.invocations.recordQueryOutcome(authorization, outcome);
    return outcome;
  }

  async fetchProviderOutput(invocationId: string): Promise<VisualProviderOutput> {
    const invocation = await this.invocations.getOutputForVerification(invocationId);
    return this.providerFor(invocation.provider).fetchOutput(invocation.providerOutputUrl!);
  }

  // Compatibility aliases retain existing internal callers while all new
  // paths route explicitly by the persisted provider identity.
  async submitBailian(input: Omit<SubmitProviderInvocationInput, 'provider'> & { model: 'wan2.7-image' | 'wan2.7-image-pro' }) {
    return this.submitProvider({ ...input, provider: BAILIAN_WAN_PROVIDER });
  }

  async queryBailian(invocationId: string) {
    return this.queryProvider(invocationId);
  }

  async fetchBailianOutput(invocationId: string) {
    return this.fetchProviderOutput(invocationId);
  }

  private providerFor(provider: string): VisualImageEditProvider {
    if (provider === BAILIAN_WAN_PROVIDER) return this.wan;
    if (provider === BAILIAN_QWEN_IMAGE_PROVIDER) return this.qwen;
    throw new ServiceUnavailableException('AI Visual Agent 调用引用了未批准的图像 Provider');
  }
}
