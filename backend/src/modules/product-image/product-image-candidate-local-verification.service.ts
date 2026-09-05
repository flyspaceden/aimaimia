import { Injectable } from '@nestjs/common';
import { ImageContentScannerService } from '../upload/image-content-scanner.service';
import { ProductImageBarcodeScannerService } from './product-image-barcode-scanner.service';
const sharp = require('sharp') as typeof import('sharp').default;

export type LocalCandidateVerificationDisposition = 'REJECT' | 'MANUAL_REVIEW';

export type LocalCandidateVerificationReport = {
  version: 'candidate-local-verification-v1';
  disposition: LocalCandidateVerificationDisposition;
  geometry: {
    sourceWidth: number | null;
    sourceHeight: number | null;
    candidateWidth: number | null;
    candidateHeight: number | null;
    aspectRatioDelta: number | null;
    verdict: 'PASS' | 'MANUAL_REVIEW' | 'REJECT';
  };
  qr: {
    sourceCount: number;
    candidateCount: number;
    verdict: 'PASS' | 'MANUAL_REVIEW' | 'REJECT';
  };
  barcode: {
    sourceStatus: 'NONE' | 'DETECTED' | 'INCONCLUSIVE';
    candidateStatus: 'NONE' | 'DETECTED' | 'INCONCLUSIVE';
    sourceFormats: string[];
    candidateFormats: string[];
    verdict: 'PASS' | 'MANUAL_REVIEW' | 'REJECT';
  };
  nextStep: 'QWEN_OCR_OR_HUMAN_FACT_REVIEW';
};

type QrScan = {
  qrCodesDetected?: number;
  qrDetectionFailed?: boolean;
  details?: Array<{ type?: string; text?: string | null }>;
};

/**
 * Zero-model-cost preflight for a generated candidate. It deliberately does
 * not claim that a decode miss proves a code is absent. Only strong evidence
 * of a changed QR/barcode or destructive crop is rejected; every other case
 * proceeds to protected OCR or human fact review.
 */
@Injectable()
export class ProductImageCandidateLocalVerificationService {
  constructor(
    private readonly scanner: ImageContentScannerService,
    private readonly barcodes: ProductImageBarcodeScannerService,
  ) {}

  async verify(sourceBuffer: Buffer, candidateBuffer: Buffer): Promise<LocalCandidateVerificationReport> {
    const [sourceMeta, candidateMeta, sourceQr, candidateQr, sourceBarcode, candidateBarcode] = await Promise.all([
      this.metadata(sourceBuffer),
      this.metadata(candidateBuffer),
      this.scanQr(sourceBuffer),
      this.scanQr(candidateBuffer),
      this.scanBarcode(sourceBuffer),
      this.scanBarcode(candidateBuffer),
    ]);
    const geometry = this.verifyGeometry(sourceMeta, candidateMeta);
    const qr = this.verifyQr(sourceQr, candidateQr);
    const barcode = this.verifyBarcode(sourceBarcode, candidateBarcode);
    const disposition = [geometry.verdict, qr.verdict, barcode.verdict].includes('REJECT')
      ? 'REJECT'
      : 'MANUAL_REVIEW';
    return {
      version: 'candidate-local-verification-v1',
      disposition,
      geometry,
      qr,
      barcode,
      nextStep: 'QWEN_OCR_OR_HUMAN_FACT_REVIEW',
    };
  }

  private async metadata(buffer: Buffer) {
    try {
      const value = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
      return value.width && value.height ? { width: value.width, height: value.height } : null;
    } catch {
      return null;
    }
  }

  private async scanQr(buffer: Buffer): Promise<QrScan> {
    try {
      return await this.scanner.scan(buffer) as QrScan;
    } catch {
      return { qrCodesDetected: 0, qrDetectionFailed: true, details: [] };
    }
  }

  private async scanBarcode(buffer: Buffer) {
    try {
      return await this.barcodes.scan(buffer);
    } catch {
      return { status: 'INCONCLUSIVE' as const, detectedCount: 0, formats: [] };
    }
  }

  private verifyGeometry(
    source: { width: number; height: number } | null,
    candidate: { width: number; height: number } | null,
  ): LocalCandidateVerificationReport['geometry'] {
    if (!source || !candidate) {
      return { sourceWidth: source?.width ?? null, sourceHeight: source?.height ?? null, candidateWidth: candidate?.width ?? null, candidateHeight: candidate?.height ?? null, aspectRatioDelta: null, verdict: 'MANUAL_REVIEW' };
    }
    const sourceRatio = source.width / source.height;
    const candidateRatio = candidate.width / candidate.height;
    const aspectRatioDelta = Math.abs(candidateRatio / sourceRatio - 1);
    const sourcePixels = source.width * source.height;
    const candidatePixels = candidate.width * candidate.height;
    const verdict = aspectRatioDelta > 0.25 || candidatePixels < Math.min(sourcePixels * 0.35, 240 * 240)
      ? 'REJECT'
      : aspectRatioDelta > 0.08
        ? 'MANUAL_REVIEW'
        : 'PASS';
    return { sourceWidth: source.width, sourceHeight: source.height, candidateWidth: candidate.width, candidateHeight: candidate.height, aspectRatioDelta: Number(aspectRatioDelta.toFixed(6)), verdict };
  }

  private verifyQr(source: QrScan, candidate: QrScan): LocalCandidateVerificationReport['qr'] {
    const sourceValues = this.qrValues(source);
    const candidateValues = this.qrValues(candidate);
    const sourceCount = Number(source.qrCodesDetected ?? sourceValues.length);
    const candidateCount = Number(candidate.qrCodesDetected ?? candidateValues.length);
    if (source.qrDetectionFailed || candidate.qrDetectionFailed) {
      return { sourceCount, candidateCount, verdict: 'MANUAL_REVIEW' };
    }
    if (sourceCount > 0 && (sourceCount !== candidateCount || !this.sameStrings(sourceValues, candidateValues))) {
      return { sourceCount, candidateCount, verdict: 'REJECT' };
    }
    if (sourceCount === 0 && candidateCount > 0) {
      return { sourceCount, candidateCount, verdict: 'MANUAL_REVIEW' };
    }
    return { sourceCount, candidateCount, verdict: 'PASS' };
  }

  private verifyBarcode(
    source: { status: 'NONE' | 'DETECTED' | 'INCONCLUSIVE'; formats: string[] },
    candidate: { status: 'NONE' | 'DETECTED' | 'INCONCLUSIVE'; formats: string[] },
  ): LocalCandidateVerificationReport['barcode'] {
    const sourceFormats = [...source.formats].sort();
    const candidateFormats = [...candidate.formats].sort();
    if (source.status === 'DETECTED' && candidate.status === 'DETECTED' && !this.sameStrings(sourceFormats, candidateFormats)) {
      return { sourceStatus: source.status, candidateStatus: candidate.status, sourceFormats, candidateFormats, verdict: 'REJECT' };
    }
    if (source.status === 'DETECTED' && candidate.status !== 'DETECTED') {
      return { sourceStatus: source.status, candidateStatus: candidate.status, sourceFormats, candidateFormats, verdict: 'MANUAL_REVIEW' };
    }
    if (source.status === 'INCONCLUSIVE' || candidate.status === 'INCONCLUSIVE') {
      return { sourceStatus: source.status, candidateStatus: candidate.status, sourceFormats, candidateFormats, verdict: 'MANUAL_REVIEW' };
    }
    return { sourceStatus: source.status, candidateStatus: candidate.status, sourceFormats, candidateFormats, verdict: 'PASS' };
  }

  private qrValues(scan: QrScan) {
    return (scan.details ?? [])
      .filter((detail) => detail.type === 'qrcode' && typeof detail.text === 'string')
      .map((detail) => detail.text!)
      .sort();
  }

  private sameStrings(left: string[], right: string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
}
