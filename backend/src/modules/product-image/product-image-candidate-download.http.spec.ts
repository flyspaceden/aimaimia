import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import request = require('supertest');
import { AppExceptionFilter } from '../../common/filters/app-exception.filter';
import { ResultWrapperInterceptor } from '../../common/interceptors/result-wrapper.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { UploadService } from '../upload/upload.service';
import { ProductImageOptimizationService } from './product-image-optimization.service';
import { ProductImageOptimizationController } from './product-image-optimization.controller';
import { ProductImageCandidateDownloadService } from './product-image-candidate-download.service';

const COMPANY_ID = 'company-1';
const OTHER_COMPANY_ID = 'company-other';
const TASK_ID = 'optimization-1';
const ASSET_ID = 'asset-1';

const parseBinary = (
  response: any,
  callback: (error: Error | null, body?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error));
};

type DownloadHarnessOptions = {
  taskCompanyId?: string;
  assetStatus?: string;
};

async function buildHarness(options: DownloadHarnessOptions = {}) {
  const sharp = require('sharp') as typeof import('sharp').default;
  const buffer = await sharp({
    create: { width: 24, height: 16, channels: 3, background: '#994455' },
  }).png().toBuffer();
  const asset = {
    id: ASSET_ID,
    companyId: COMPANY_ID,
    purpose: 'PRODUCT_IMAGE',
    status: options.assetStatus ?? 'CANDIDATE',
    deletedAt: null,
    scanSummary: { needsReview: false },
    objectKey: 'seller-product-assets/candidate.png',
    canonicalSha256: createHash('sha256').update(buffer).digest('hex'),
    byteSize: buffer.length,
    mimeType: 'image/png',
    width: 24,
    height: 16,
  };
  const artifact = {
    id: 'artifact-1',
    assetId: ASSET_ID,
    objectKey: asset.objectKey,
    sha256: asset.canonicalSha256,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    asset,
  };
  const task = {
    companyId: options.taskCompanyId ?? COMPANY_ID,
    status: 'SUCCEEDED',
    artifacts: [artifact],
  };
  const prisma = {
    productImageOptimization: {
      findFirst: jest.fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce({
          id: TASK_ID,
          artifacts: [{ asset: { scanSummary: { needsReview: false } } }],
        }),
    },
  };
  const upload = { getBuffer: jest.fn().mockResolvedValue(buffer) };
  const sellerLoginGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization === 'Bearer company-1') {
        req.user = {
          type: 'seller',
          sub: 'staff-1',
          userId: 'staff-1',
          companyId: COMPANY_ID,
          role: 'OWNER',
        };
        return true;
      }
      throw new UnauthorizedException('需要登录');
    },
  };

  const moduleBuilder = Test.createTestingModule({
    controllers: [ProductImageOptimizationController],
    providers: [
      ProductImageCandidateDownloadService,
      { provide: ProductImageOptimizationService, useValue: {} },
      { provide: PrismaService, useValue: prisma },
      { provide: UploadService, useValue: upload },
      SellerAuthGuard,
      SellerRoleGuard,
      SellerAuditInterceptor,
      { provide: Reflector, useValue: new Reflector() },
    ],
  });
  const moduleRef = await moduleBuilder
    .overrideGuard(SellerAuthGuard)
    .useValue(sellerLoginGuard)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new ResultWrapperInterceptor());
  app.useGlobalFilters(new AppExceptionFilter());
  await app.init();

  return { app, buffer, prisma, upload };
}

async function closeHarness(app: INestApplication) {
  await app.close();
}

describe('ProductImageCandidateDownloadController real HTTP contract', () => {
  it('returns the managed PNG bytes as an attachment instead of a JSON-wrapped response', async () => {
    const harness = await buildHarness();
    try {
      const response = await request(harness.app.getHttpServer())
        .get(`/api/v1/seller/product-image-optimizations/${TASK_ID}/download`)
        .set('Authorization', 'Bearer company-1')
        .buffer(true)
        .parse(parseBinary);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^image\/png(?:;|$)/);
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="product-image-[a-f0-9]{16}\.png"$/);
      expect(response.headers['content-length']).toBe(String(harness.buffer.length));
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.equals(harness.buffer)).toBe(true);
      expect(response.body.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(harness.upload.getBuffer).toHaveBeenCalledWith('seller-product-assets/candidate.png');
      expect(harness.prisma.productImageOptimization.findFirst).toHaveBeenCalledTimes(2);
    } finally {
      await closeHarness(harness.app);
    }
  });

  it('returns the real error envelope and never reads storage without seller authentication', async () => {
    const harness = await buildHarness();
    try {
      const response = await request(harness.app.getHttpServer())
        .get(`/api/v1/seller/product-image-optimizations/${TASK_ID}/download`)
        .expect(401);

      expect(response.body).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', message: '需要登录', displayMessage: '需要登录' },
      });
      expect(harness.upload.getBuffer).not.toHaveBeenCalled();
      expect(harness.prisma.productImageOptimization.findFirst).not.toHaveBeenCalled();
    } finally {
      await closeHarness(harness.app);
    }
  });

  it.each([
    ['a task from another company', { taskCompanyId: OTHER_COMPANY_ID }],
    ['a retired managed asset', { assetStatus: 'RETIRED' }],
  ])('rejects %s before reading its bytes', async (_description, options) => {
    const harness = await buildHarness(options);
    try {
      const response = await request(harness.app.getHttpServer())
        .get(`/api/v1/seller/product-image-optimizations/${TASK_ID}/download`)
        .set('Authorization', 'Bearer company-1')
        .expect(404);

      expect(response.body).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      expect(harness.upload.getBuffer).not.toHaveBeenCalled();
      expect(harness.prisma.productImageOptimization.findFirst).toHaveBeenCalledTimes(1);
    } finally {
      await closeHarness(harness.app);
    }
  });
});
