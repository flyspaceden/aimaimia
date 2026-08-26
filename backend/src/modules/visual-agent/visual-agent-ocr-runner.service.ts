import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BailianQwenOcrProvider,
  BAILIAN_QWEN_OCR_PROVIDER,
  QWEN_OCR_MODEL,
  QwenOcrResult,
} from './providers/bailian-qwen-ocr.provider';
import { VisualProviderSource } from './providers/visual-image-edit.provider';
import { normalizedSourceSha256 } from './visual-agent-integrity';
import { VisualAgentInvocationService } from './visual-agent-invocation.service';

const OCR_FACT_SCAN_MODE = 'OCR_FACT_SCAN';
const OCR_FACT_SCAN_PLAN_HASH = createHash('sha256').update('qwen-ocr-fact-scan-v1').digest('hex');

/**
 * Only Core code may call OCR. It binds bytes to the persisted invocation
 * before I/O and records every provider outcome before returning text to a
 * future private fact-scan service.
 */
@Injectable()
export class VisualAgentOcrRunnerService {
  constructor(
    private readonly invocations: VisualAgentInvocationService,
    private readonly qwenOcr: BailianQwenOcrProvider,
  ) {}

  async reserveFactScanInvocation(input: {
    tenantId: string;
    ownerClientId: string;
    adapterNamespace: string;
    externalObjectId: string;
    actorId: string;
    idempotencyKey: string;
    expiresAt: Date;
    source: VisualProviderSource;
  }) {
    await this.qwenOcr.preflight(input.source);
    const normalizedSourceHash = await normalizedSourceSha256(input.source);
    const invocation = await this.invocations.reserve({
      tenantId: input.tenantId,
      ownerClientId: input.ownerClientId,
      adapterNamespace: input.adapterNamespace,
      externalObjectId: input.externalObjectId,
      actorId: input.actorId,
      provider: BAILIAN_QWEN_OCR_PROVIDER,
      model: QWEN_OCR_MODEL,
      visualMode: OCR_FACT_SCAN_MODE,
      sourceHash: normalizedSourceHash,
      visualPlanHash: OCR_FACT_SCAN_PLAN_HASH,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
    });
    return { ...invocation, normalizedSourceHash };
  }

  async recognizeFactScan(input: { invocationId: string; source: VisualProviderSource }): Promise<QwenOcrResult> {
    await this.qwenOcr.preflight(input.source);
    const sourceHash = await normalizedSourceSha256(input.source);
    const authorization = await this.invocations.acquireForSubmit(
      input.invocationId,
      QWEN_OCR_MODEL,
      BAILIAN_QWEN_OCR_PROVIDER,
      sourceHash,
      OCR_FACT_SCAN_PLAN_HASH,
      OCR_FACT_SCAN_MODE,
    );
    let outcome: QwenOcrResult;
    try {
      outcome = await this.qwenOcr.recognize(input.source, authorization);
    } catch (error) {
      await this.invocations.recordSynchronousProviderOutcome(authorization, {
        kind: 'UNKNOWN', code: 'TRANSPORT_FAILURE', requiresReconciliation: true,
      });
      throw error;
    }
    await this.invocations.recordSynchronousProviderOutcome(authorization, this.toInvocationOutcome(outcome));
    return outcome;
  }

  private toInvocationOutcome(outcome: QwenOcrResult) {
    if (outcome.kind === 'KNOWN') {
      return {
        kind: 'KNOWN' as const,
        providerRequestId: outcome.providerRequestId,
        usage: outcome.usage,
      };
    }
    return outcome;
  }
}
