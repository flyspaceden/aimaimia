import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, ProductImageFactScanStatus, SellerMediaAssetStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { BAILIAN_QWEN_OCR_PROVIDER, QwenOcrResult } from '../visual-agent/providers/bailian-qwen-ocr.provider';
import { VisualProviderSource } from '../visual-agent/providers/visual-image-edit.provider';
import { VisualAgentOcrRunnerService } from '../visual-agent/visual-agent-ocr-runner.service';
import { VisualAgentInvocationService } from '../visual-agent/visual-agent-invocation.service';
import { RequestProductImageFactScanDto } from './product-image-fact-scan.dto';
import { ProductImageBarcodeScannerService } from './product-image-barcode-scanner.service';

const AIMAI_PRODUCT_ADAPTER_CLIENT = 'aimai-product-adapter-v1';
const AIMAI_PRODUCT_ADAPTER_NAMESPACE = 'aimai-product';
const FACT_SCAN_POLICY_VERSION = 'product-image-fact-scan-v1';
const FACT_SCAN_TTL_MS = 30 * 60_000;

type ScanSummary = { needsReview?: boolean; qrCodesDetected?: number };

/**
 * Explicit, merchant-triggered OCR scan. No OCR text is persisted or returned;
 * its only durable output is a private risk summary bound to the exact source.
 */
@Injectable()
export class ProductImageFactScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly ocrRunner: VisualAgentOcrRunnerService,
    private readonly invocations: VisualAgentInvocationService,
    private readonly config: ConfigService,
    private readonly barcodeScanner: ProductImageBarcodeScannerService,
  ) {}

  async request(companyId: string, staffId: string, sourceAssetId: string, dto: RequestProductImageFactScanDto) {
    const source = await this.prisma.sellerMediaAsset.findFirst({
      where: { id: sourceAssetId, companyId, purpose: 'PRODUCT_IMAGE', status: SellerMediaAssetStatus.AVAILABLE, deletedAt: null },
    });
    if (!source) throw new NotFoundException('商品图片资产不存在');
    if ((source.scanSummary as ScanSummary | null)?.needsReview) {
      throw new ConflictException('图片仍需人工安全复核，不能发起 OCR 事实扫描');
    }
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, media: { some: { assetId: source.id } } },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('关联商品不存在，或该原图尚未用于该商品');
    this.assertTextHashSecretConfigured();

    const now = new Date();
    await this.prisma.productImageFactScan.updateMany({
      where: {
        companyId,
        productId: product.id,
        sourceAssetId: source.id,
        sourceCanonicalHash: source.canonicalSha256,
        status: { in: [ProductImageFactScanStatus.SCANNING, ProductImageFactScanStatus.FACTS_DETECTED, ProductImageFactScanStatus.VERIFIED_EMPTY, ProductImageFactScanStatus.INCONCLUSIVE, ProductImageFactScanStatus.RECONCILING] },
        expiresAt: { lte: now },
      },
      data: { status: ProductImageFactScanStatus.EXPIRED, failureCode: 'SCAN_EXPIRED', completedAt: now },
    });

    const existing = await this.prisma.productImageFactScan.findUnique({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existing) {
      if (existing.productId !== product.id || existing.sourceAssetId !== source.id || existing.sourceCanonicalHash !== source.canonicalSha256) {
        throw new ConflictException('幂等键已用于另一张商品图片或商品');
      }
      return this.toResponse(existing);
    }

    const active = await this.prisma.productImageFactScan.findFirst({
      where: {
        companyId,
        productId: product.id,
        sourceAssetId: source.id,
        sourceCanonicalHash: source.canonicalSha256,
        status: { in: [ProductImageFactScanStatus.SCANNING, ProductImageFactScanStatus.FACTS_DETECTED, ProductImageFactScanStatus.VERIFIED_EMPTY, ProductImageFactScanStatus.INCONCLUSIVE, ProductImageFactScanStatus.RECONCILING] },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return this.toResponse(active);

    // An active scan is uniquely constrained above. Once every prior scan is
    // terminal/expired, derive one stable attempt token from the latest audit
    // row so concurrent retry clicks still share a Core invocation, while a
    // genuine later retry is not trapped by the old terminal invocation.
    const latest = await this.prisma.productImageFactScan.findFirst({
      where: {
        companyId,
        productId: product.id,
        sourceAssetId: source.id,
        sourceCanonicalHash: source.canonicalSha256,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
    });
    const attemptToken = latest ? `after-${latest.createdAt.getTime()}-${latest.id}` : 'initial';

    const buffer = await this.uploadService.getBuffer(source.objectKey);
    const ocrSource = this.toOcrSource(buffer, source.mimeType);
    const reservation = await this.ocrRunner.reserveFactScanInvocation({
      tenantId: companyId,
      ownerClientId: AIMAI_PRODUCT_ADAPTER_CLIENT,
      adapterNamespace: AIMAI_PRODUCT_ADAPTER_NAMESPACE,
      externalObjectId: product.id,
      actorId: staffId,
      idempotencyKey: this.coreIdempotencyKey(product.id, source.id, source.canonicalSha256, attemptToken),
      expiresAt: new Date(now.getTime() + FACT_SCAN_TTL_MS),
      source: ocrSource,
    });
    if (reservation.status !== 'RESERVED') {
      throw new ConflictException('该 OCR 事实扫描已存在且不能重新提交');
    }

    let scan;
    try {
      scan = await this.prisma.productImageFactScan.create({
        data: {
          companyId,
          productId: product.id,
          sourceAssetId: source.id,
          sourceCanonicalHash: source.canonicalSha256,
          normalizedSourceHash: reservation.normalizedSourceHash,
          invocationId: reservation.invocationId,
          model: 'qwen-vl-ocr-2025-11-20',
          policyVersion: FACT_SCAN_POLICY_VERSION,
          requestedByStaffId: staffId,
          idempotencyKey: dto.idempotencyKey,
          expiresAt: new Date(now.getTime() + FACT_SCAN_TTL_MS),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.productImageFactScan.findUnique({
          where: { companyId_idempotencyKey: { companyId, idempotencyKey: dto.idempotencyKey } },
        });
        if (raced && raced.productId === product.id && raced.sourceAssetId === source.id && raced.sourceCanonicalHash === source.canonicalSha256) {
          return this.toResponse(raced);
        }
        const activeAfterRace = await this.prisma.productImageFactScan.findFirst({
          where: {
            companyId,
            productId: product.id,
            sourceAssetId: source.id,
            sourceCanonicalHash: source.canonicalSha256,
            status: { in: [ProductImageFactScanStatus.SCANNING, ProductImageFactScanStatus.FACTS_DETECTED, ProductImageFactScanStatus.VERIFIED_EMPTY, ProductImageFactScanStatus.INCONCLUSIVE, ProductImageFactScanStatus.RECONCILING] },
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (activeAfterRace) return this.toResponse(activeAfterRace);
      }
      throw error;
    }

    let outcome: QwenOcrResult;
    try {
      outcome = await this.ocrRunner.recognizeFactScan({ invocationId: reservation.invocationId, source: ocrSource });
    } catch (error) {
      await this.markReconciliation(scan.id, 'OCR_RUNNER_ERROR');
      throw error;
    }
    try {
      return await this.persistOutcome(scan.id, source, buffer, outcome);
    } catch (error) {
      await this.markReconciliation(scan.id, 'FACT_SCAN_PERSISTENCE_CONFLICT');
      try {
        await this.invocations.moveVerificationToReconciliation(scan.invocationId, BAILIAN_QWEN_OCR_PROVIDER, 'FACT_SCAN_PERSISTENCE_CONFLICT');
      } catch {
        // The Core may already be terminal or reconciled; do not mask the
        // original fact-scan persistence error.
      }
      throw error;
    }
  }

  async get(companyId: string, scanId: string) {
    const scan = await this.prisma.productImageFactScan.findFirst({ where: { id: scanId, companyId } });
    if (!scan) throw new NotFoundException('商品图片事实扫描不存在');
    return this.toResponse(scan);
  }

  private async persistOutcome(scanId: string, source: { id: string; companyId: string; canonicalSha256: string; scanSummary: unknown }, buffer: Buffer, outcome: QwenOcrResult) {
    if (outcome.kind === 'UNKNOWN') return this.markReconciliation(scanId, outcome.code);
    if (outcome.kind === 'DECLINED') {
      const scan = await this.prisma.productImageFactScan.update({
        where: { id: scanId },
        data: { status: ProductImageFactScanStatus.FAILED, failureCode: outcome.code, completedAt: new Date() },
      });
      return this.toResponse(scan);
    }
    const text = outcome.text.trim();
    const textDetected = text.length > 0;
    const qrCodesDetected = Number((source.scanSummary as ScanSummary | null)?.qrCodesDetected ?? 0);
    const barcode = await this.barcodeScanner.scan(buffer);
    const emptyTextQrVerified = !textDetected && qrCodesDetected === 0 && barcode.status === 'NONE';
    const status = textDetected || qrCodesDetected > 0 || barcode.status === 'DETECTED'
      ? ProductImageFactScanStatus.FACTS_DETECTED
      : emptyTextQrVerified
        ? ProductImageFactScanStatus.VERIFIED_EMPTY
        : ProductImageFactScanStatus.INCONCLUSIVE;
    const scan = await this.prisma.$transaction(async (tx) => {
      const current = await tx.productImageFactScan.findFirst({
        where: { id: scanId, status: ProductImageFactScanStatus.SCANNING, sourceCanonicalHash: source.canonicalSha256 },
      });
      if (!current) throw new ConflictException('OCR 事实扫描状态已变化');
      const updated = await tx.productImageFactScan.update({
        where: { id: current.id },
        data: {
          status,
          ocrTextHash: this.textHmac(text),
          ocrTextHashKeyVersion: this.textHashKeyVersion(),
          ocrTextLength: text.length,
          textDetected,
          qrCodesDetected,
          barcodeStatus: barcode.status,
          emptyTextQrVerified,
          resultSummary: {
            hasText: textDetected,
            qrCodesDetected,
            barcodeStatus: barcode.status,
            barcodeFormats: barcode.formats,
            providerRequestId: outcome.providerRequestId ?? null,
            usage: outcome.usage ?? null,
          } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    try {
      await this.invocations.completeSynchronousVerification(scan.invocationId, BAILIAN_QWEN_OCR_PROVIDER);
    } catch (error) {
      await this.markReconciliation(scan.id, 'INVOCATION_COMPLETION_CONFLICT');
      throw error;
    }
    if (emptyTextQrVerified) {
      try {
        await this.persistFreeTuneEvidence(source, scan.id);
      } catch {
        return this.markReconciliation(scan.id, 'FREE_TUNE_EVIDENCE_WRITE_FAILED');
      }
    }
    return this.toResponse(scan);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStaleScans() {
    return this.prisma.productImageFactScan.updateMany({
      where: {
        status: { in: [ProductImageFactScanStatus.SCANNING, ProductImageFactScanStatus.FACTS_DETECTED, ProductImageFactScanStatus.VERIFIED_EMPTY, ProductImageFactScanStatus.INCONCLUSIVE, ProductImageFactScanStatus.RECONCILING] },
        expiresAt: { lte: new Date() },
      },
      data: { status: ProductImageFactScanStatus.EXPIRED, failureCode: 'SCAN_EXPIRED', completedAt: new Date() },
    });
  }

  private coreIdempotencyKey(productId: string, sourceAssetId: string, sourceCanonicalHash: string, attemptToken: string) {
    return `factscan:${productId}:${sourceAssetId}:${sourceCanonicalHash}:${FACT_SCAN_POLICY_VERSION}:${attemptToken}`;
  }

  private assertTextHashSecretConfigured() {
    if (!this.config.get<string>('AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET')) {
      throw new ServiceUnavailableException('OCR 事实扫描哈希密钥尚未配置，不能发送商家图片');
    }
  }

  private textHmac(text: string) {
    const secret = this.config.get<string>('AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET');
    if (!secret) throw new ServiceUnavailableException('OCR 事实扫描哈希密钥尚未配置');
    return createHmac('sha256', secret).update(text).digest('hex');
  }

  private textHashKeyVersion() {
    return this.config.get<string>('AI_VISUAL_AGENT_FACT_SCAN_HASH_KEY_VERSION', 'v1');
  }

  private async markReconciliation(scanId: string, code: string) {
    const scan = await this.prisma.productImageFactScan.update({
      where: { id: scanId },
      data: { status: ProductImageFactScanStatus.RECONCILING, failureCode: code, completedAt: new Date() },
    });
    return this.toResponse(scan);
  }

  private async persistFreeTuneEvidence(source: { id: string; companyId: string; canonicalSha256: string; scanSummary: unknown }, scanId: string) {
    await this.prisma.$transaction(async (tx) => {
      const scan = await tx.productImageFactScan.findFirst({
        where: {
          id: scanId,
          companyId: source.companyId,
          sourceAssetId: source.id,
          sourceCanonicalHash: source.canonicalSha256,
          status: ProductImageFactScanStatus.VERIFIED_EMPTY,
          emptyTextQrVerified: true,
          policyVersion: FACT_SCAN_POLICY_VERSION,
          expiresAt: { gt: new Date() },
          invocation: { is: { provider: BAILIAN_QWEN_OCR_PROVIDER, status: 'SUCCEEDED' } },
        },
        select: { id: true },
      });
      if (!scan) throw new ConflictException('OCR 事实扫描尚未完成可用验真');
      const asset = await tx.sellerMediaAsset.findFirst({
        where: {
          id: source.id,
          companyId: source.companyId,
          canonicalSha256: source.canonicalSha256,
          status: SellerMediaAssetStatus.AVAILABLE,
          deletedAt: null,
        },
        select: { id: true, scanSummary: true },
      });
      if (!asset) throw new ConflictException('OCR 证据写入时原图状态已变化');
      const updated = await tx.sellerMediaAsset.updateMany({
        where: { id: asset.id, canonicalSha256: source.canonicalSha256, status: SellerMediaAssetStatus.AVAILABLE },
        data: {
          scanSummary: {
            ...((asset.scanSummary ?? {}) as Record<string, unknown>),
            ocrTextVerifiedEmpty: true,
            ocrFactScanId: scan.id,
            ocrFactScanSourceHash: source.canonicalSha256,
            ocrFactScanPolicyVersion: FACT_SCAN_POLICY_VERSION,
          } as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) throw new ConflictException('OCR 证据写入时原图状态已变化');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private toOcrSource(buffer: Buffer, mimeType: string): VisualProviderSource {
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
      throw new BadRequestException('OCR 事实扫描仅支持静态 JPEG、PNG 或 WebP 商品图片');
    }
    return { buffer, mimeType, normalizedVersion: 'normalized-rgba-srgb-v1', opaque: true };
  }

  private toResponse(scan: {
    id: string; status: ProductImageFactScanStatus; productId: string | null; sourceAssetId: string;
    textDetected: boolean; qrCodesDetected: number; barcodeStatus: string; emptyTextQrVerified: boolean;
    failureCode: string | null; completedAt: Date | null; createdAt: Date;
  }) {
    return {
      id: scan.id,
      status: scan.status,
      productId: scan.productId,
      sourceAssetId: scan.sourceAssetId,
      textDetected: scan.textDetected,
      qrCodesDetected: scan.qrCodesDetected,
      barcodeStatus: scan.barcodeStatus,
      // Always false until barcode detection is implemented and merged with
      // this evidence. Never expose raw OCR text/hash to a seller browser.
      freeTuneEligible: false,
      emptyTextQrVerified: scan.emptyTextQrVerified,
      failureCode: scan.failureCode,
      completedAt: scan.completedAt,
      createdAt: scan.createdAt,
    };
  }
}
