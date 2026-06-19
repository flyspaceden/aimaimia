import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryProductAuditStatus,
  DeliveryProductStatus,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import {
  CreateAdminDeliveryProductDto,
  CreateDeliveryProductDto,
  CreateDeliveryProductSkuDto,
} from './dto/create-delivery-product.dto';
import { ListDeliveryProductsQueryDto } from './dto/list-delivery-products.query.dto';
import { UpdateDeliveryProductDto, UpdateDeliveryProductSkuDto } from './dto/update-delivery-product.dto';

const adminProductInclude = {
  merchant: {
    select: {
      id: true,
      name: true,
      status: true,
      defaultMarkupBps: true,
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  productUnit: {
    select: {
      id: true,
      name: true,
    },
  },
  skus: {
    orderBy: [{ createdAt: 'asc' }],
  },
} satisfies Prisma.DeliveryProductInclude;

type AdminProductPayload = Prisma.DeliveryProductGetPayload<{
  include: typeof adminProductInclude;
}>;

@Injectable()
export class DeliveryProductsService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryIdService: DeliveryIdService,
  ) {}

  async listSellerProducts(merchantId: string, query: ListDeliveryProductsQueryDto = {}) {
    const items = await this.deliveryPrisma.deliveryProduct.findMany({
      where: this.buildOwnedProductWhere(merchantId, query),
      include: adminProductInclude,
      orderBy: [{ updatedAt: 'desc' }],
    });

    return {
      items: items.map((item) => this.mapSellerProduct(item)),
    };
  }

  async createSellerProduct(
    merchantId: string,
    deliverySellerStaffId: string,
    dto: CreateDeliveryProductDto,
  ) {
    const product = await this.deliveryPrisma.deliveryProduct.create({
      data: {
        id: await this.deliveryIdService.next('PSSP'),
        merchantId,
        createdByStaffId: deliverySellerStaffId,
        submissionCount: 0,
        ...this.buildCreateProductData(dto),
      },
      include: adminProductInclude,
    });

    return this.mapSellerProduct(product);
  }

  async updateSellerProduct(merchantId: string, productId: string, dto: UpdateDeliveryProductDto) {
    const product = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const existing = await tx.deliveryProduct.findUnique({
          where: { id: productId },
          select: {
            id: true,
            merchantId: true,
          },
        });
        if (!existing) {
          throw new NotFoundException('配送商品不存在');
        }
        if (existing.merchantId !== merchantId) {
          throw new ForbiddenException('无权修改该配送商品');
        }

        return tx.deliveryProduct.update({
          where: { id: productId },
          data: this.buildUpdateProductData(dto),
          include: adminProductInclude,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return this.mapSellerProduct(product);
  }

  async submitSellerProduct(merchantId: string, productId: string) {
    const product = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const existing = await tx.deliveryProduct.findUnique({
          where: { id: productId },
          include: {
            skus: {
              where: { isActive: true },
              select: { id: true },
            },
          },
        });
        if (!existing) {
          throw new NotFoundException('配送商品不存在');
        }
        if (existing.merchantId !== merchantId) {
          throw new ForbiddenException('无权提交该配送商品');
        }
        if (!existing.skus.length) {
          throw new BadRequestException('配送商品至少需要一个启用中的 SKU 才能提审');
        }

        const result = await tx.deliveryProduct.updateMany({
          where: {
            id: productId,
            merchantId,
            status: existing.status,
            auditStatus: existing.auditStatus,
          },
          data: {
            status: DeliveryProductStatus.ACTIVE,
            auditStatus: DeliveryProductAuditStatus.PENDING,
            auditNote: null,
            submissionCount: {
              increment: 1,
            },
          },
        });
        if (result.count !== 1) {
          throw new ConflictException('配送商品状态已变更，请刷新后重试');
        }

        return tx.deliveryProduct.findUnique({
          where: { id: productId },
          include: adminProductInclude,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (!product) {
      throw new NotFoundException('配送商品不存在');
    }
    return this.mapSellerProduct(product);
  }

  async listAdminProducts(query: ListDeliveryProductsQueryDto = {}) {
    return {
      items: await this.deliveryPrisma.deliveryProduct.findMany({
        where: this.buildAdminProductWhere(query),
        include: adminProductInclude,
        orderBy: [{ updatedAt: 'desc' }],
      }),
    };
  }

  async createAdminProduct(dto: CreateAdminDeliveryProductDto) {
    return this.deliveryPrisma.deliveryProduct.create({
      data: {
        id: await this.deliveryIdService.next('PSSP'),
        merchantId: dto.merchantId,
        ...this.buildCreateProductData(dto),
      },
      include: adminProductInclude,
    });
  }

  async updateAdminProduct(productId: string, dto: UpdateDeliveryProductDto) {
    const existing = await this.deliveryPrisma.deliveryProduct.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('配送商品不存在');
    }

    return this.deliveryPrisma.deliveryProduct.update({
      where: { id: productId },
      data: this.buildUpdateProductData(dto),
      include: adminProductInclude,
    });
  }

  async approveAdminProduct(productId: string, note?: string) {
    return this.transitionAdminProduct(productId, {
      status: DeliveryProductStatus.ACTIVE,
      auditStatus: DeliveryProductAuditStatus.APPROVED,
      auditNote: note?.trim() || null,
    });
  }

  async rejectAdminProduct(productId: string, note?: string) {
    return this.transitionAdminProduct(productId, {
      status: DeliveryProductStatus.INACTIVE,
      auditStatus: DeliveryProductAuditStatus.REJECTED,
      auditNote: note?.trim() || null,
    });
  }

  private async transitionAdminProduct(
    productId: string,
    data: Pick<Prisma.DeliveryProductUpdateInput, 'status' | 'auditStatus' | 'auditNote'>,
  ) {
    return this.deliveryPrisma.$transaction(
      async (tx) => {
        const existing = await tx.deliveryProduct.findUnique({
          where: { id: productId },
          select: {
            id: true,
            status: true,
            auditStatus: true,
          },
        });
        if (!existing) {
          throw new NotFoundException('配送商品不存在');
        }

        const result = await tx.deliveryProduct.updateMany({
          where: {
            id: productId,
            status: existing.status,
            auditStatus: existing.auditStatus,
          },
          data,
        });
        if (result.count !== 1) {
          throw new ConflictException('配送商品状态已变更，请刷新后重试');
        }

        return tx.deliveryProduct.findUnique({
          where: { id: productId },
          include: adminProductInclude,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private buildOwnedProductWhere(merchantId: string, query: ListDeliveryProductsQueryDto) {
    return {
      merchantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.auditStatus ? { auditStatus: query.auditStatus } : {}),
      ...this.buildKeywordWhere(query.keyword),
    } satisfies Prisma.DeliveryProductWhereInput;
  }

  private buildAdminProductWhere(query: ListDeliveryProductsQueryDto) {
    return {
      ...(query.merchantId ? { merchantId: query.merchantId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.auditStatus ? { auditStatus: query.auditStatus } : {}),
      ...this.buildKeywordWhere(query.keyword),
    } satisfies Prisma.DeliveryProductWhereInput;
  }

  private buildKeywordWhere(keyword?: string) {
    const normalized = keyword?.trim();
    if (!normalized) {
      return {};
    }
    return {
      OR: [
        {
          title: {
            contains: normalized,
            mode: 'insensitive' as const,
          },
        },
        {
          subtitle: {
            contains: normalized,
            mode: 'insensitive' as const,
          },
        },
        {
          searchKeywords: {
            has: normalized,
          },
        },
      ],
    };
  }

  private buildCreateProductData(dto: CreateDeliveryProductDto) {
    return {
      categoryId: dto.categoryId?.trim() || null,
      productUnitId: dto.productUnitId?.trim() || null,
      title: dto.title.trim(),
      subtitle: dto.subtitle?.trim() || null,
      description: dto.description?.trim() || null,
      detailRich: this.toJsonValue(dto.detailRich),
      media: this.toJsonValue(dto.media),
      attributes: this.toJsonValue(dto.attributes),
      searchKeywords: this.normalizeSearchKeywords(dto.searchKeywords),
      unitName: dto.unitName.trim(),
      minOrderQuantity: dto.minOrderQuantity ?? 1,
      orderStepQuantity: dto.orderStepQuantity ?? 1,
      status: DeliveryProductStatus.DRAFT,
      auditStatus: DeliveryProductAuditStatus.PENDING,
      skus: {
        create: dto.skus.map((sku) => this.buildCreateSkuData(sku)),
      },
    };
  }

  private buildUpdateProductData(dto: UpdateDeliveryProductDto) {
    const data: Prisma.DeliveryProductUpdateInput = {};

    if (dto.categoryId !== undefined) {
      data.category =
        dto.categoryId?.trim()
          ? { connect: { id: dto.categoryId.trim() } }
          : { disconnect: true };
    }
    if (dto.productUnitId !== undefined) {
      data.productUnit =
        dto.productUnitId?.trim()
          ? { connect: { id: dto.productUnitId.trim() } }
          : { disconnect: true };
    }
    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }
    if (dto.subtitle !== undefined) {
      data.subtitle = dto.subtitle?.trim() || null;
    }
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.detailRich !== undefined) {
      data.detailRich = this.toJsonValue(dto.detailRich) ?? Prisma.JsonNull;
    }
    if (dto.media !== undefined) {
      data.media = this.toJsonValue(dto.media) ?? Prisma.JsonNull;
    }
    if (dto.attributes !== undefined) {
      data.attributes = this.toJsonValue(dto.attributes) ?? Prisma.JsonNull;
    }
    if (dto.searchKeywords !== undefined) {
      data.searchKeywords = this.normalizeSearchKeywords(dto.searchKeywords);
    }
    if (dto.unitName !== undefined) {
      data.unitName = dto.unitName.trim();
    }
    if (dto.minOrderQuantity !== undefined) {
      data.minOrderQuantity = dto.minOrderQuantity;
    }
    if (dto.orderStepQuantity !== undefined) {
      data.orderStepQuantity = dto.orderStepQuantity;
    }
    if (dto.skus?.length) {
      const createItems = dto.skus.filter((sku) => !sku.id);
      const updateItems = dto.skus.filter((sku) => sku.id);
      data.skus = {
        ...(createItems.length
          ? {
              create: createItems.map((sku) =>
                this.buildCreateSkuData(sku as CreateDeliveryProductSkuDto),
              ),
            }
          : {}),
        ...(updateItems.length
          ? {
              update: updateItems.map((sku) => ({
                where: { id: sku.id! },
                data: this.buildUpdateSkuData(sku),
              })),
            }
          : {}),
      };
    }

    return data;
  }

  private buildCreateSkuData(dto: CreateDeliveryProductSkuDto) {
    return {
      title: dto.title.trim(),
      imageUrl: dto.imageUrl?.trim() || null,
      supplyPriceCents: dto.supplyPriceCents,
      basePriceCents: dto.basePriceCents,
      stock: dto.stock,
      minOrderQuantity: dto.minOrderQuantity ?? 1,
      orderStepQuantity: dto.orderStepQuantity ?? 1,
      weightGram: dto.weightGram,
      isActive: true,
    } satisfies Prisma.DeliveryProductSkuUncheckedCreateWithoutProductInput;
  }

  private buildUpdateSkuData(dto: UpdateDeliveryProductSkuDto) {
    const data: Prisma.DeliveryProductSkuUpdateWithoutProductInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }
    if (dto.imageUrl !== undefined) {
      data.imageUrl = dto.imageUrl?.trim() || null;
    }
    if (dto.supplyPriceCents !== undefined) {
      data.supplyPriceCents = dto.supplyPriceCents;
    }
    if (dto.basePriceCents !== undefined) {
      data.basePriceCents = dto.basePriceCents;
    }
    if (dto.stock !== undefined) {
      data.stock = dto.stock;
    }
    if (dto.minOrderQuantity !== undefined) {
      data.minOrderQuantity = dto.minOrderQuantity;
    }
    if (dto.orderStepQuantity !== undefined) {
      data.orderStepQuantity = dto.orderStepQuantity;
    }
    if (dto.weightGram !== undefined) {
      data.weightGram = dto.weightGram;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    return data;
  }

  private toJsonValue(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return Prisma.JsonNull;
    }
    return value as Prisma.InputJsonValue;
  }

  private normalizeSearchKeywords(keywords?: string[]) {
    if (!keywords?.length) {
      return [];
    }
    return [...new Set(keywords.map((item) => item.trim()).filter(Boolean))];
  }

  private mapSellerProduct(product: AdminProductPayload) {
    return {
      id: product.id,
      merchantId: product.merchantId,
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      unitName: product.unitName,
      status: product.status,
      auditStatus: product.auditStatus,
      auditNote: product.auditNote,
      submissionCount: product.submissionCount,
      minOrderQuantity: product.minOrderQuantity,
      orderStepQuantity: product.orderStepQuantity,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      category: product.category,
      productUnit: product.productUnit,
      skus: product.skus.map((sku) => ({
        id: sku.id,
        title: sku.title,
        imageUrl: sku.imageUrl,
        supplyPriceCents: sku.supplyPriceCents,
        basePriceCents: sku.basePriceCents,
        stock: sku.stock,
        minOrderQuantity: sku.minOrderQuantity,
        orderStepQuantity: sku.orderStepQuantity,
        weightGram: sku.weightGram,
        isActive: sku.isActive,
        createdAt: sku.createdAt,
        updatedAt: sku.updatedAt,
      })),
    };
  }
}
