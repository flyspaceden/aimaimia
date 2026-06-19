import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DeliveryUnitFieldType, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CreateDeliveryUnitDto } from './dto/create-delivery-unit.dto';
import { UpdateDeliveryUnitDto } from './dto/update-delivery-unit.dto';

const FIXED_REQUIRED_FIELDS = [
  'name',
  'contactName',
  'contactPhone',
  'provinceCode',
  'provinceName',
  'cityCode',
  'cityName',
  'districtCode',
  'districtName',
  'detailAddress',
] as const;

type FixedRequiredField = (typeof FIXED_REQUIRED_FIELDS)[number];
type DynamicRequiredConfig = {
  fieldKey: string;
  fieldType: DeliveryUnitFieldType;
  isRequired: boolean;
};

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
        const normalizedFixedFields = this.normalizeCreateFixedFields(dto);
        const requiredDynamicConfigs = await tx.deliveryUnitFieldConfig.findMany({
          where: {
            isRequired: true,
          },
          select: {
            fieldKey: true,
            fieldType: true,
            isRequired: true,
          },
        });
        const normalizedExtraFields = this.normalizeExtraFields(dto.extraFields);
        this.assertRequiredDynamicFields(requiredDynamicConfigs, normalizedExtraFields);

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
            ...normalizedFixedFields,
            extraFields:
              normalizedExtraFields !== undefined
                ? (normalizedExtraFields as Prisma.InputJsonValue)
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

    const normalizedFixedFields = this.normalizePatchFixedFields(dto);
    const existingExtraFields = this.normalizeExtraFields(unit.extraFields);
    const incomingExtraFields = this.normalizeExtraFields(dto.extraFields);
    const mergedExtraFields =
      incomingExtraFields === undefined
        ? undefined
        : {
            ...(existingExtraFields ?? {}),
            ...incomingExtraFields,
          };
    const requiredDynamicConfigs = await this.deliveryPrisma.deliveryUnitFieldConfig.findMany({
      where: {
        isRequired: true,
      },
      select: {
        fieldKey: true,
        fieldType: true,
        isRequired: true,
      },
    });
    this.assertRequiredDynamicFields(
      requiredDynamicConfigs,
      mergedExtraFields ?? existingExtraFields ?? undefined,
    );

    return {
      unit: await this.deliveryPrisma.deliveryUnit.update({
        where: { id: unitId },
        data: {
          ...normalizedFixedFields,
          ...(mergedExtraFields !== undefined
            ? { extraFields: mergedExtraFields as Prisma.InputJsonValue }
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

  private normalizeCreateFixedFields(dto: Record<FixedRequiredField, string>) {
    const normalized = this.normalizePatchFixedFields(dto);

    for (const field of FIXED_REQUIRED_FIELDS) {
      if (!normalized[field]) {
        throw new BadRequestException(`配送单位字段 ${field} 不能为空`);
      }
    }

    return normalized as Record<FixedRequiredField, string>;
  }

  private normalizePatchFixedFields(dto: Partial<Record<FixedRequiredField, string>>) {
    const normalized: Partial<Record<FixedRequiredField, string>> = {};

    for (const field of FIXED_REQUIRED_FIELDS) {
      const rawValue = dto[field];
      if (rawValue === undefined) {
        continue;
      }

      const value = rawValue.trim();
      if (!value) {
        throw new BadRequestException(`配送单位字段 ${field} 不能为空`);
      }

      normalized[field] = value;
    }

    return normalized;
  }

  private normalizeExtraFields(value: unknown): Record<string, unknown> | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('配送单位扩展字段格式不正确');
    }
    return { ...(value as Record<string, unknown>) };
  }

  private assertRequiredDynamicFields(
    configs: DynamicRequiredConfig[],
    extraFields: Record<string, unknown> | undefined,
  ) {
    const dynamicRequiredConfigs = configs.filter(
      (config) =>
        config.isRequired &&
        !FIXED_REQUIRED_FIELDS.includes(config.fieldKey as FixedRequiredField),
    );

    for (const config of dynamicRequiredConfigs) {
      const value = extraFields?.[config.fieldKey];
      if (this.isMissingRequiredValue(value, config.fieldType)) {
        throw new BadRequestException(`配送单位扩展字段 ${config.fieldKey} 不能为空`);
      }
    }
  }

  private isMissingRequiredValue(value: unknown, fieldType: DeliveryUnitFieldType) {
    if (value === undefined || value === null) {
      return true;
    }
    if (typeof value === 'string') {
      return value.trim().length === 0;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    if (fieldType === DeliveryUnitFieldType.NUMBER) {
      return Number.isNaN(Number(value));
    }
    return false;
  }
}
