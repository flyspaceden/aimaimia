import { Module } from '@nestjs/common';
import { BailianWanImageProvider } from './providers/bailian-wan-image.provider';
import { BailianQwenImageProvider } from './providers/bailian-qwen-image.provider';
import { BailianQwenOcrProvider } from './providers/bailian-qwen-ocr.provider';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { VisualAgentProviderRunnerService } from './visual-agent-provider-runner.service';
import { VisualAgentOcrRunnerService } from './visual-agent-ocr-runner.service';
import { VisualAgentClientKeyService } from './visual-agent-client-key.service';
import { VisualAgentClientKeyGuard } from './visual-agent-client-key.guard';
import { VisualAgentSessionController } from './visual-agent-session.controller';
import { VisualAgentTrustedAdapterService } from './visual-agent-trusted-adapter.service';
import { VisualCreditService } from './visual-credit.service';
import { VisualPaidExecutionService } from './visual-paid-execution.service';

/**
 * Domain-neutral AI Visual Agent Core. Business modules may use only the
 * exported, scoped services; direct public provider execution remains absent
 * until a trusted domain adapter and full verification path are enabled.
 */
@Module({
  controllers: [VisualAgentSessionController],
  providers: [VisualAgentInvocationService, BailianWanImageProvider, BailianQwenImageProvider, BailianQwenOcrProvider, VisualAgentProviderRunnerService, VisualAgentOcrRunnerService, VisualAgentClientKeyService, VisualAgentClientKeyGuard, VisualAgentTrustedAdapterService, VisualCreditService, VisualPaidExecutionService],
  exports: [VisualAgentOcrRunnerService, VisualAgentInvocationService, VisualAgentClientKeyService, VisualAgentTrustedAdapterService, VisualCreditService, VisualPaidExecutionService],
})
export class VisualAgentModule {}
