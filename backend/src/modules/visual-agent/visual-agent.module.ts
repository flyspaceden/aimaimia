import { Module } from '@nestjs/common';
import { BailianWanImageProvider } from './providers/bailian-wan-image.provider';
import { BailianQwenOcrProvider } from './providers/bailian-qwen-ocr.provider';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';
import { VisualAgentProviderRunnerService } from './visual-agent-provider-runner.service';
import { VisualAgentOcrRunnerService } from './visual-agent-ocr-runner.service';

/**
 * Domain-neutral AI Visual Agent Core foundation. It is deliberately not
 * imported by a business module until task quarantine, verification and
 * call-level budgets are implemented.
 */
@Module({
  providers: [VisualAgentInvocationService, BailianWanImageProvider, BailianQwenOcrProvider, VisualAgentProviderRunnerService, VisualAgentOcrRunnerService],
  exports: [VisualAgentOcrRunnerService, VisualAgentInvocationService],
})
export class VisualAgentModule {}
