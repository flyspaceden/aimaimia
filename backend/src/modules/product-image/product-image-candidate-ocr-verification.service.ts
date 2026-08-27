import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const sharp = require('sharp') as typeof import('sharp').default;
import { QwenOcrResult } from '../visual-agent/providers/bailian-qwen-ocr.provider';
import { VisualProviderSource } from '../visual-agent/providers/visual-image-edit.provider';
import { VisualAgentOcrRunnerService } from '../visual-agent/visual-agent-ocr-runner.service';

export type CandidateOcrVerificationReport = {
  version: 'candidate-ocr-verification-v1';
  state: 'SKIPPED_DISABLED' | 'UNAVAILABLE' | 'INCONCLUSIVE' | 'MATCHED' | 'MISMATCH';
  verdict: 'AUTO_PASS' | 'MANUAL_REVIEW';
  sourceTextDetected: boolean | null;
  candidateTextDetected: boolean | null;
  sourceTextLength: number | null;
  candidateTextLength: number | null;
  normalizedTextMatch: boolean | null;
};

const AIMAI_VISUAL_TENANT_ID = 'aimai-product-agent';
const AIMAI_VISUAL_CLIENT_ID = 'aimai-product-adapter-v1';
const AIMAI_VISUAL_ADAPTER_NAMESPACE = 'aimai-product';
const OCR_TTL_MS = 15 * 60_000;

/**
 * Optional deep verification for a paid candidate. It is intentionally
 * disabled unless the platform explicitly enables it for an auto-pass rate
 * card. OCR output remains ephemeral: only equality and length summaries are
 * persisted, never packaging text, codes, or model output.
 */
@Injectable()
export class ProductImageCandidateOcrVerificationService {
  constructor(
    private readonly config: ConfigService,
    private readonly ocrRunner: VisualAgentOcrRunnerService,
  ) {}

  async verify(input: {
    companyId: string;
    staffId: string;
    productId: string;
    quoteId: string;
    sourceBuffer: Buffer;
    candidateBuffer: Buffer;
    allowAutoPass: boolean;
  }): Promise<CandidateOcrVerificationReport> {
    if (!input.allowAutoPass || this.config.get('AI_VISUAL_AGENT_CANDIDATE_OCR_VERIFY_ENABLED', 'false') !== 'true') {
      return this.manual('SKIPPED_DISABLED');
    }
    let source: VisualProviderSource;
    let candidate: VisualProviderSource;
    try {
      [source, candidate] = await Promise.all([
        this.toOcrSource(input.sourceBuffer),
        this.toOcrSource(input.candidateBuffer),
      ]);
    } catch {
      return this.manual('INCONCLUSIVE');
    }
    try {
      const sourceResult = await this.recognize(input, 'source', source);
      const candidateResult = await this.recognize(input, 'candidate', candidate);
      return this.compare(sourceResult, candidateResult);
    } catch {
      // Provider preflight, disabled budget, timeout, and existing leased
      // calls all preserve the image candidate for manual review. They must
      // never be misreported as empty text or an automatic pass.
      return this.manual('UNAVAILABLE');
    }
  }

  private async recognize(
    input: { staffId: string; productId: string; quoteId: string },
    role: 'source' | 'candidate',
    source: VisualProviderSource,
  ): Promise<QwenOcrResult> {
    const reservation = await this.ocrRunner.reserveFactScanInvocation({
      tenantId: AIMAI_VISUAL_TENANT_ID,
      ownerClientId: AIMAI_VISUAL_CLIENT_ID,
      adapterNamespace: AIMAI_VISUAL_ADAPTER_NAMESPACE,
      externalObjectId: input.productId,
      actorId: input.staffId,
      idempotencyKey: `candidate-ocr:${input.quoteId}:${role}`,
      expiresAt: new Date(Date.now() + OCR_TTL_MS),
      source,
    });
    if (reservation.status !== 'RESERVED') throw new Error('OCR_INVOCATION_NOT_RESERVED');
    return this.ocrRunner.recognizeFactScan({ invocationId: reservation.invocationId, source });
  }

  private compare(source: QwenOcrResult, candidate: QwenOcrResult): CandidateOcrVerificationReport {
    if (source.kind !== 'KNOWN' || candidate.kind !== 'KNOWN') return this.manual('INCONCLUSIVE');
    const sourceText = this.normalize(source.text);
    const candidateText = this.normalize(candidate.text);
    const normalizedTextMatch = sourceText === candidateText;
    return {
      version: 'candidate-ocr-verification-v1',
      state: normalizedTextMatch ? 'MATCHED' : 'MISMATCH',
      verdict: normalizedTextMatch ? 'AUTO_PASS' : 'MANUAL_REVIEW',
      sourceTextDetected: sourceText.length > 0,
      candidateTextDetected: candidateText.length > 0,
      sourceTextLength: sourceText.length,
      candidateTextLength: candidateText.length,
      normalizedTextMatch,
    };
  }

  private manual(state: CandidateOcrVerificationReport['state']): CandidateOcrVerificationReport {
    return {
      version: 'candidate-ocr-verification-v1',
      state,
      verdict: 'MANUAL_REVIEW',
      sourceTextDetected: null,
      candidateTextDetected: null,
      sourceTextLength: null,
      candidateTextLength: null,
      normalizedTextMatch: null,
    };
  }

  private normalize(text: string) {
    return text.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
  }

  private async toOcrSource(buffer: Buffer): Promise<VisualProviderSource> {
    const normalized = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toBuffer();
    return { buffer: normalized, mimeType: 'image/jpeg', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true };
  }
}
