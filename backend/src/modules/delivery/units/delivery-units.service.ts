import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CreateDeliveryUnitDto } from './dto/create-delivery-unit.dto';
import { UpdateDeliveryUnitDto } from './dto/update-delivery-unit.dto';

@Injectable()
export class DeliveryUnitsService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async listUnits(deliveryUserId: string) {
    const [user, items] = await Promise.all([
      this.deliveryPrisma.deliveryUser.findUnique({
        where: { id: deliveryUserId },
        select: { currentUnitId: true },
      }),
      this.deliveryPrisma.deliveryUnit.findMany({
        where: { userId: deliveryUserId },
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);

    return {
      currentUnitId: user?.currentUnitId ?? null,
      items,
    };
  }

  async createUnit(deliveryUserId: string, dto: CreateDeliveryUnitDto) {
    return this.deliveryPrisma.$transaction(
      async (tx) => {
        const user = await tx.deliveryUser.findUnique({
          where: { id: deliveryUserId },
          select: {
            id: true,
            currentUnitId: true,
            _count: {
              select: {
                units: true,
              },
            },
          },
        });

        if (!user) {
          throw new NotFoundException('配送用户不存在');
        }

        const unit = await tx.deliveryUnit.create({
          data: {
            id: randomUUID(),
            userId: deliveryUserId,
            name: dto.name.trim(),
            contactName: dto.contactName.trim(),
            contactPhone: dto.contactPhone.trim(),
            provinceCode: dto.provinceCode.trim(),
            provinceName: dto.provinceName.trim(),
            cityCode: dto.cityCode.trim(),
            cityName: dto.cityName.trim(),
            districtCode: dto.districtCode.trim(),
            districtName: dto.districtName.trim(),
            detailAddress: dto.detailAddress.trim(),
            extraFields:
              dto.extraFields !== undefined
                ? (dto.extraFields as Prisma.InputJsonValue)
                : Prisma.JsonNull,
          },
        });

        const shouldSelect = !user.currentUnitId || user._count.units === 0;
        const currentUnitId = shouldSelect ? unit.id : user.currentUnitId;

        if (shouldSelect) {
          await tx.deliveryUser.update({
            where: { id: deliveryUserId },
            data: {
              currentUnitId: unit.id,
            },
          });
        }

        return {
          unit,
          currentUnitId,
          requiresUnit: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async updateUnit(deliveryUserId: string, unitId: string, dto: UpdateDeliveryUnitDto) {
    const unit = await this.deliveryPrisma.deliveryUnit.findUnique({
      where: { id: unitId },
    });

    if (!unit) {
      throw new NotFoundException('配送单位不存在');
    }
    if (unit.userId !== deliveryUserId) {
      throw new ForbiddenException('无权修改该配送单位');
    }

    return {
      unit: await this.deliveryPrisma.deliveryUnit.update({
        where: { id: unitId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.contactName !== undefined ? { contactName: dto.contactName.trim() } : {}),
          ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone.trim() } : {}),
          ...(dto.provinceCode !== undefined ? { provinceCode: dto.provinceCode.trim() } : {}),
          ...(dto.provinceName !== undefined ? { provinceName: dto.provinceName.trim() } : {}),
          ...(dto.cityCode !== undefined ? { cityCode: dto.cityCode.trim() } : {}),
          ...(dto.cityName !== undefined ? { cityName: dto.cityName.trim() } : {}),
          ...(dto.districtCode !== undefined ? { districtCode: dto.districtCode.trim() } : {}),
          ...(dto.districtName !== undefined ? { districtName: dto.districtName.trim() } : {}),
          ...(dto.detailAddress !== undefined
            ? { detailAddress: dto.detailAddress.trim() }
            : {}),
          ...(dto.extraFields !== undefined
            ? { extraFields: dto.extraFields as Prisma.InputJsonValue }
            : {}),
        },
      }),
    };
  }

  async selectUnit(deliveryUserId: string, unitId: string) {
    const unit = await this.deliveryPrisma.deliveryUnit.findUnique({
      where: { id: unitId },
    });

    if (!unit) {
      throw new NotFoundException('配送单位不存在');
    }
    if (unit.userId !== deliveryUserId) {
      throw new ForbiddenException('无权切换到该配送单位');
    }
    if (unit.status !== 'ACTIVE') {
      throw new ForbiddenException('该配送单位当前不可用');
    }

    await this.deliveryPrisma.deliveryUser.update({
      where: { id: deliveryUserId },
      data: {
        currentUnitId: unitId,
      },
    });

    return {
      currentUnitId: unitId,
      requiresUnit: false,
    };
  }
}
