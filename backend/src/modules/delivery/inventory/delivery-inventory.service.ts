import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UpdateDeliverySkuStockDto } from './dto/update-delivery-sku-stock.dto';

@Injectable()
export class DeliveryInventoryService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async updateSellerSkuStock(
    merchantId: string,
    deliverySellerStaffId: string,
    skuId: string,
    dto: UpdateDeliverySkuStockDto,
  ) {
    return this.deliveryPrisma.$transaction(
      async (tx) => {
        const existing = await tx.deliveryProductSku.findUnique({
          where: { id: skuId },
          select: {
            id: true,
            stock: true,
            product: {
              select: {
                merchantId: true,
              },
            },
          },
        });
        if (!existing) {
          throw new NotFoundException('配送 SKU 不存在');
        }
        if (existing.product.merchantId !== merchantId) {
          throw new ForbiddenException('无权修改该配送 SKU 库存');
        }

        const beforeStock = existing.stock;
        const afterStock = dto.stock;
        const delta = afterStock - beforeStock;

        if (delta !== 0) {
          const updated = await tx.deliveryProductSku.updateMany({
            where: {
              id: skuId,
              stock: beforeStock,
            },
            data: {
              stock: afterStock,
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException('配送 SKU 库存已变化，请刷新后重试');
          }
        }

        const ledger = await tx.deliveryInventoryLedger.create({
          data: {
            skuId,
            type: 'ADJUST',
            quantity: delta,
            beforeStock,
            afterStock,
            refType: 'SELLER_STOCK_UPDATE',
            refId: skuId,
            remark: dto.remark?.trim() || null,
            createdByType: 'SELLER',
            createdById: deliverySellerStaffId,
          },
        });

        const sku = await tx.deliveryProductSku.findFirst({
          where: { id: skuId },
          select: {
            id: true,
            stock: true,
            updatedAt: true,
          },
        });

        return {
          sku,
          ledger,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }
}
