import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves the public-read boundary for truth-locked product media. Opaque
 * object keys are not capabilities: an asset becomes public only while it is
 * actually referenced by an active, approved product.
 */
@Injectable()
export class ProductMediaAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertPublicReadable(key: string): Promise<void> {
    const asset = await this.prisma.sellerMediaAsset.findFirst({
      where: {
        objectKey: key,
        purpose: 'PRODUCT_IMAGE',
        deletedAt: null,
        productMedia: {
          some: {
            product: { status: 'ACTIVE', auditStatus: 'APPROVED' },
          },
        },
      },
      select: { scanSummary: true },
    });

    if (!asset || (asset.scanSummary as { needsReview?: boolean } | null)?.needsReview === true) {
      // Treat every non-public state alike so the endpoint cannot be used to
      // enumerate pending, rejected, or deleted merchant assets.
      throw new NotFoundException('商品图片不存在');
    }
  }
}
