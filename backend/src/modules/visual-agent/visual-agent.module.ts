import { Module } from '@nestjs/common';
import { BailianWanImageProvider } from './providers/bailian-wan-image.provider';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { VisualAgentProviderRunnerService } from './visual-agent-provider-runner.service';

/**
 * Domain-neutral AI Visual Agent Core foundation. It is deliberately not
 * imported by a business module until task quarantine, verification and
 * call-level budgets are implemented.
 */
@Module({
  providers: [VisualAgentInvocationService, BailianWanImageProvider, VisualAgentProviderRunnerService],
})
export class VisualAgentModule {}
