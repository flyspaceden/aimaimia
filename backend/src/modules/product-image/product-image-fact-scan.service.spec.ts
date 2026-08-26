import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ProductImageFactScanStatus } from '@prisma/client';
import { ProductImageFactScanService } from './product-image-fact-scan.service';

const source = {
  id: 'asset-1', companyId: 'company-1', purpose: 'PRODUCT_IMAGE', status: 'AVAILABLE', deletedAt: null,
  objectKey: 'seller-product-assets/asset-1.jpg', canonicalSha256: 'canonical-a', mimeType: 'image/jpeg',
  scanSummary: { needsReview: false, qrCodesDetected: 0 },
};

function scanningRecord() {
  return {
    id: 'scan-1', companyId: 'company-1', productId: 'product-1', sourceAssetId: 'asset-1',
    sourceCanonicalHash: 'canonical-a', normalizedSourceHash: 'n'.repeat(64), invocationId: 'invocation-1',
    status: ProductImageFactScanStatus.SCANNING, model: 'qwen-vl-ocr-2025-11-20', policyVersion: 'product-image-fact-scan-v1',
    requestedByStaffId: 'staff-1', textDetected: false, qrCodesDetected: 0, barcodeStatus: 'NOT_IMPLEMENTED',
    emptyTextQrVerified: false, failureCode: null, completedAt: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
  };
}

function build() {
  const scan = scanningRecord();
  const tx = {
    productImageFactScan: {
      findFirst: jest.fn().mockResolvedValue(scan),
      update: jest.fn().mockResolvedValue({
        ...scan, status: ProductImageFactScanStatus.FACTS_DETECTED, textDetected: true, ocrTextHash: 'hash', ocrTextLength: 11,
        resultSummary: { hasText: true }, completedAt: new Date(),
      }),
    },
    sellerMediaAsset: {
      findFirst: jest.fn().mockResolvedValue({ id: 'asset-1', scanSummary: source.scanSummary }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    sellerMediaAsset: {
      findFirst: jest.fn().mockResolvedValue(source),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1' }) },
    productImageFactScan: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(scan),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((work: (tx: any) => unknown) => work(tx)),
  };
  const upload = { getBuffer: jest.fn().mockResolvedValue(Buffer.from('source')) };
  const ocrRunner = {
    reserveFactScanInvocation: jest.fn().mockResolvedValue({ invocationId: 'invocation-1', status: 'RESERVED', normalizedSourceHash: 'n'.repeat(64) }),
    recognizeFactScan: jest.fn().mockResolvedValue({ kind: 'KNOWN', text: 'PRODUCT-123', providerRequestId: 'request-1', usage: { totalTokens: 237 } }),
  };
  const invocations = { completeSynchronousVerification: jest.fn().mockResolvedValue(undefined) };
  const barcodeScanner = { scan: jest.fn().mockResolvedValue({ status: 'INCONCLUSIVE', detectedCount: 0, formats: [] }) };
  const config = { get: jest.fn((key: string, fallback?: string) => key === 'AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET' ? 'test-hmac-secret' : fallback) };
  return { service: new ProductImageFactScanService(prisma as any, upload as any, ocrRunner as any, invocations as any, config as any, barcodeScanner as any), prisma, tx, upload, ocrRunner, invocations, config, barcodeScanner };
}

describe('ProductImageFactScanService', () => {
  it('creates a private fact scan only for an attached managed asset and never returns OCR plaintext', async () => {
    const { service, tx, ocrRunner, invocations } = build();

    const result = await service.request('company-1', 'staff-1', 'asset-1', { productId: 'product-1', idempotencyKey: 'scan-1' });

    expect(ocrRunner.reserveFactScanInvocation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'company-1', externalObjectId: 'product-1', actorId: 'staff-1', idempotencyKey: expect.stringMatching(/^factscan:product-1:asset-1:canonical-a:/),
    }));
    expect(tx.productImageFactScan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageFactScanStatus.FACTS_DETECTED, ocrTextLength: 11, textDetected: true }),
    }));
    expect(result).toMatchObject({ status: ProductImageFactScanStatus.FACTS_DETECTED, textDetected: true, freeTuneEligible: false });
    expect(JSON.stringify(result)).not.toContain('PRODUCT-123');
    expect(invocations.completeSynchronousVerification).toHaveBeenCalledWith('invocation-1', 'BAILIAN_QWEN_OCR');
  });

  it('keeps an empty OCR plus no QR result inconclusive when barcode absence is not proven', async () => {
    const { service, tx } = build();
    tx.productImageFactScan.update.mockResolvedValue({
      ...scanningRecord(), status: ProductImageFactScanStatus.INCONCLUSIVE, emptyTextQrVerified: false,
      textDetected: false, completedAt: new Date(),
    });
    (service as any).ocrRunner.recognizeFactScan.mockResolvedValue({ kind: 'KNOWN', text: '', usage: { totalTokens: 10 } });

    const result = await service.request('company-1', 'staff-1', 'asset-1', { productId: 'product-1', idempotencyKey: 'scan-empty' });

    expect(tx.productImageFactScan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ProductImageFactScanStatus.INCONCLUSIVE, emptyTextQrVerified: false, barcodeStatus: 'INCONCLUSIVE' }),
    }));
    expect(result).toMatchObject({ status: ProductImageFactScanStatus.INCONCLUSIVE, emptyTextQrVerified: false, freeTuneEligible: false });
  });

  it('exposes free-tune eligibility only for a completed server-side verified-empty scan', async () => {
    const { service, tx } = build();
    tx.productImageFactScan.update.mockResolvedValue({
      ...scanningRecord(), status: ProductImageFactScanStatus.VERIFIED_EMPTY, emptyTextQrVerified: true,
      textDetected: false, completedAt: new Date(),
    });
    (service as any).ocrRunner.recognizeFactScan.mockResolvedValue({ kind: 'KNOWN', text: '', usage: { totalTokens: 10 } });
    (service as any).barcodeScanner.scan.mockResolvedValue({ status: 'NONE', detectedCount: 0, formats: [] });

    const result = await service.request('company-1', 'staff-1', 'asset-1', { productId: 'product-1', idempotencyKey: 'scan-verified-empty' });

    expect(result).toMatchObject({ status: ProductImageFactScanStatus.VERIFIED_EMPTY, emptyTextQrVerified: true, freeTuneEligible: true });
  });

  it('does not create a scan or model reservation when the OCR runner is disabled by policy', async () => {
    const { service, prisma, ocrRunner } = build();
    ocrRunner.reserveFactScanInvocation.mockRejectedValue(new ServiceUnavailableException('OCR disabled'));

    await expect(service.request('company-1', 'staff-1', 'asset-1', { productId: 'product-1', idempotencyKey: 'scan-disabled' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.productImageFactScan.create).not.toHaveBeenCalled();
    expect(ocrRunner.recognizeFactScan).not.toHaveBeenCalled();
  });

  it('fails before OCR reservation when the private HMAC key is not configured', async () => {
    const { service, prisma, ocrRunner, config } = build();
    config.get.mockImplementation((_key: string, fallback?: string) => fallback);

    await expect(service.request('company-1', 'staff-1', 'asset-1', { productId: 'product-1', idempotencyKey: 'scan-no-hmac' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.productImageFactScan.create).not.toHaveBeenCalled();
    expect(ocrRunner.reserveFactScanInvocation).not.toHaveBeenCalled();
  });

  it('does not allow an idempotency key to cross-bind a different product asset', async () => {
    const { service, prisma, ocrRunner } = build();
    prisma.productImageFactScan.findUnique.mockResolvedValue({
      ...scanningRecord(), productId: 'product-other', sourceAssetId: 'asset-other', sourceCanonicalHash: 'other',
    });

    await expect(service.request('company-1', 'staff-1', 'asset-1', { productId: 'product-1', idempotencyKey: 'scan-reused' })).rejects.toBeInstanceOf(ConflictException);
    expect(ocrRunner.reserveFactScanInvocation).not.toHaveBeenCalled();
  });

  it('uses one new, stable Core attempt key after an older same-source scan has expired', async () => {
    const { service, prisma, ocrRunner } = build();
    const expiredCreatedAt = new Date('2026-08-24T12:00:00.000Z');
    prisma.productImageFactScan.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'expired-scan-1', createdAt: expiredCreatedAt });

    await service.request('company-1', 'staff-1', 'asset-1', { productId: 'product-1', idempotencyKey: 'scan-retry-after-expiry' });

    expect(ocrRunner.reserveFactScanInvocation).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringContaining(`after-${expiredCreatedAt.getTime()}-expired-scan-1`),
    }));
  });

  it('expires a stuck scanning record instead of allowing it to look reusable forever', async () => {
    const { service, prisma } = build();
    prisma.productImageFactScan.updateMany = jest.fn().mockResolvedValue({ count: 1 });

    await expect(service.expireStaleScans()).resolves.toEqual({ count: 1 });
    expect(prisma.productImageFactScan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: expect.arrayContaining([ProductImageFactScanStatus.SCANNING, ProductImageFactScanStatus.VERIFIED_EMPTY]) }, expiresAt: { lte: expect.any(Date) } }),
      data: expect.objectContaining({ status: ProductImageFactScanStatus.EXPIRED, failureCode: 'SCAN_EXPIRED' }),
    }));
  });
});
