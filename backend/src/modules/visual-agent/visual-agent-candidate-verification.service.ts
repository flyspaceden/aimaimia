import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library';
import { ImageContentScannerService } from '../upload/image-content-scanner.service';
const sharp = require('sharp') as typeof import('sharp').default;
import { VisualAgentClientPrincipal } from './visual-agent-client-key.service';
import { QwenOcrResult } from './providers/bailian-qwen-ocr.provider';
import { VisualProviderSource } from './providers/visual-image-edit.provider';
import { VisualAgentOcrRunnerService } from './visual-agent-ocr-runner.service';

type Verdict = 'PASS' | 'MANUAL_REVIEW' | 'REJECT';
type QrScan = { qrCodesDetected?: number; qrDetectionFailed?: boolean; details?: Array<{ type?: string; text?: string | null }> };
type BarcodeScan = { status: 'NONE' | 'DETECTED' | 'INCONCLUSIVE'; formats: string[] };

export type VisualAgentCandidateVerificationReport = {
  version: 'visual-agent-candidate-verification-v1';
  disposition: 'AUTO_PASS' | 'MANUAL_REVIEW' | 'REJECT';
  geometry: { aspectRatioDelta: number | null; verdict: Verdict };
  qr: { sourceCount: number; candidateCount: number; verdict: Verdict };
  barcode: { sourceStatus: BarcodeScan['status']; candidateStatus: BarcodeScan['status']; sourceFormats: string[]; candidateFormats: string[]; verdict: Verdict };
  ocr: { state: 'SKIPPED_DISABLED' | 'UNAVAILABLE' | 'INCONCLUSIVE' | 'MATCHED' | 'MISMATCH'; verdict: 'AUTO_PASS' | 'MANUAL_REVIEW'; sourceTextDetected: boolean | null; candidateTextDetected: boolean | null; sourceTextLength: number | null; candidateTextLength: number | null; normalizedTextMatch: boolean | null };
};

const MAX_SCAN_EDGE = 2048;
const OCR_TTL_MS = 15 * 60_000;

/**
 * Core verifier used by the public API. Every raw decoded value exists only
 * in process memory for one comparison; returned reports contain no OCR text,
 * QR payload or barcode payload. Ambiguity always blocks automatic adoption.
 */
@Injectable()
export class VisualAgentCandidateVerificationService {
  constructor(
    private readonly config: ConfigService,
    private readonly scanner: ImageContentScannerService,
    private readonly ocrRunner: VisualAgentOcrRunnerService,
  ) {}

  async verify(input: {
    principal: VisualAgentClientPrincipal;
    externalObjectId: string;
    actorId: string;
    verificationId: string;
    sourceBuffer: Buffer;
    candidateBuffer: Buffer;
    allowAutoPass: boolean;
  }): Promise<VisualAgentCandidateVerificationReport> {
    const [sourceMeta, candidateMeta, sourceQr, candidateQr, sourceBarcode, candidateBarcode] = await Promise.all([
      this.metadata(input.sourceBuffer), this.metadata(input.candidateBuffer),
      this.scanQr(input.sourceBuffer), this.scanQr(input.candidateBuffer),
      this.scanBarcode(input.sourceBuffer), this.scanBarcode(input.candidateBuffer),
    ]);
    const geometry = this.geometry(sourceMeta, candidateMeta);
    const qr = this.qr(sourceQr, candidateQr);
    const barcode = this.barcode(sourceBarcode, candidateBarcode);
    if ([geometry.verdict, qr.verdict, barcode.verdict].includes('REJECT')) {
      return { version: 'visual-agent-candidate-verification-v1', disposition: 'REJECT', geometry, qr, barcode, ocr: this.manualOcr('SKIPPED_DISABLED') };
    }
    const ocr = await this.ocr(input);
    const localPass = geometry.verdict === 'PASS' && qr.verdict === 'PASS' && barcode.verdict === 'PASS';
    return {
      version: 'visual-agent-candidate-verification-v1',
      disposition: input.allowAutoPass && localPass && ocr.verdict === 'AUTO_PASS' ? 'AUTO_PASS' : 'MANUAL_REVIEW',
      geometry, qr, barcode, ocr,
    };
  }

  private async ocr(input: { principal: VisualAgentClientPrincipal; externalObjectId: string; actorId: string; verificationId: string; sourceBuffer: Buffer; candidateBuffer: Buffer; allowAutoPass: boolean }) {
    if (!input.allowAutoPass || this.config.get('AI_VISUAL_AGENT_CANDIDATE_OCR_VERIFY_ENABLED', 'false') !== 'true') return this.manualOcr('SKIPPED_DISABLED');
    try {
      const [source, candidate] = await Promise.all([this.toOcrSource(input.sourceBuffer), this.toOcrSource(input.candidateBuffer)]);
      const sourceResult = await this.recognize(input, 'source', source);
      const candidateResult = await this.recognize(input, 'candidate', candidate);
      if (sourceResult.kind !== 'KNOWN' || candidateResult.kind !== 'KNOWN') return this.manualOcr('INCONCLUSIVE');
      const sourceText = this.normalize(sourceResult.text);
      const candidateText = this.normalize(candidateResult.text);
      const matched = sourceText === candidateText;
      return {
        state: matched ? 'MATCHED' as const : 'MISMATCH' as const,
        verdict: matched ? 'AUTO_PASS' as const : 'MANUAL_REVIEW' as const,
        sourceTextDetected: sourceText.length > 0,
        candidateTextDetected: candidateText.length > 0,
        sourceTextLength: sourceText.length,
        candidateTextLength: candidateText.length,
        normalizedTextMatch: matched,
      };
    } catch {
      return this.manualOcr('UNAVAILABLE');
    }
  }

  private async recognize(input: { principal: VisualAgentClientPrincipal; externalObjectId: string; actorId: string; verificationId: string }, role: 'source' | 'candidate', source: VisualProviderSource): Promise<QwenOcrResult> {
    const reservation = await this.ocrRunner.reserveFactScanInvocation({
      tenantId: input.principal.tenantId,
      ownerClientId: input.principal.clientId,
      adapterNamespace: input.principal.adapterNamespace,
      externalObjectId: input.externalObjectId,
      actorId: input.actorId,
      idempotencyKey: `candidate-ocr:${input.verificationId}:${role}`,
      expiresAt: new Date(Date.now() + OCR_TTL_MS),
      source,
    });
    if (reservation.status !== 'RESERVED') throw new Error('OCR_INVOCATION_NOT_RESERVED');
    return this.ocrRunner.recognizeFactScan({ invocationId: reservation.invocationId, source });
  }

  private async metadata(buffer: Buffer) {
    try {
      const value = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
      return value.width && value.height ? { width: value.width, height: value.height } : null;
    } catch { return null; }
  }

  private geometry(source: { width: number; height: number } | null, candidate: { width: number; height: number } | null) {
    if (!source || !candidate) return { aspectRatioDelta: null, verdict: 'MANUAL_REVIEW' as const };
    const delta = Math.abs((candidate.width / candidate.height) / (source.width / source.height) - 1);
    const sourcePixels = source.width * source.height;
    const candidatePixels = candidate.width * candidate.height;
    return {
      aspectRatioDelta: Number(delta.toFixed(6)),
      verdict: delta > 0.25 || candidatePixels < Math.min(sourcePixels * 0.35, 240 * 240) ? 'REJECT' as const : delta > 0.08 ? 'MANUAL_REVIEW' as const : 'PASS' as const,
    };
  }

  private async scanQr(buffer: Buffer): Promise<QrScan> {
    try { return await this.scanner.scan(buffer) as QrScan; } catch { return { qrCodesDetected: 0, qrDetectionFailed: true, details: [] }; }
  }

  private qr(source: QrScan, candidate: QrScan) {
    const sourceValues = this.qrValues(source);
    const candidateValues = this.qrValues(candidate);
    const sourceCount = Number(source.qrCodesDetected ?? sourceValues.length);
    const candidateCount = Number(candidate.qrCodesDetected ?? candidateValues.length);
    const verdict = source.qrDetectionFailed || candidate.qrDetectionFailed ? 'MANUAL_REVIEW' as const
      : sourceCount > 0 && (sourceCount !== candidateCount || !this.same(sourceValues, candidateValues)) ? 'REJECT' as const
        : sourceCount === 0 && candidateCount > 0 ? 'MANUAL_REVIEW' as const : 'PASS' as const;
    return { sourceCount, candidateCount, verdict };
  }

  private async scanBarcode(buffer: Buffer): Promise<BarcodeScan> {
    try {
      const { data, info } = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .resize({ width: MAX_SCAN_EDGE, height: MAX_SCAN_EDGE, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (!info.width || !info.height || info.channels !== 3) return { status: 'INCONCLUSIVE', formats: [] };
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
      const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.ITF, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]], [DecodeHintType.TRY_HARDER, true]]);
      try {
        const result = new MultiFormatReader().decode(bitmap, hints);
        return { status: 'DETECTED', formats: [BarcodeFormat[result.getBarcodeFormat()] ?? String(result.getBarcodeFormat())] };
      } catch { return { status: 'INCONCLUSIVE', formats: [] }; }
    } catch { return { status: 'INCONCLUSIVE', formats: [] }; }
  }

  private barcode(source: BarcodeScan, candidate: BarcodeScan) {
    const sourceFormats = [...source.formats].sort();
    const candidateFormats = [...candidate.formats].sort();
    const verdict = source.status === 'DETECTED' && candidate.status === 'DETECTED' && !this.same(sourceFormats, candidateFormats) ? 'REJECT' as const
      : source.status === 'DETECTED' && candidate.status !== 'DETECTED' ? 'MANUAL_REVIEW' as const
        : source.status === 'INCONCLUSIVE' || candidate.status === 'INCONCLUSIVE' ? 'MANUAL_REVIEW' as const : 'PASS' as const;
    return { sourceStatus: source.status, candidateStatus: candidate.status, sourceFormats, candidateFormats, verdict };
  }

  private qrValues(scan: QrScan) { return (scan.details ?? []).filter((entry) => entry.type === 'qrcode' && typeof entry.text === 'string').map((entry) => entry.text!).sort(); }
  private same(left: string[], right: string[]) { return left.length === right.length && left.every((value, index) => value === right[index]); }
  private manualOcr(state: 'SKIPPED_DISABLED' | 'UNAVAILABLE' | 'INCONCLUSIVE') { return { state, verdict: 'MANUAL_REVIEW' as const, sourceTextDetected: null, candidateTextDetected: null, sourceTextLength: null, candidateTextLength: null, normalizedTextMatch: null }; }
  private normalize(text: string) { return text.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('zh-CN'); }
  private async toOcrSource(buffer: Buffer): Promise<VisualProviderSource> {
    const normalized = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
    return { buffer: normalized, mimeType: 'image/jpeg', normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true };
  }
}
