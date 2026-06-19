import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DeliveryUnitFieldConfig,
  DeliveryUnitFieldType,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UpdateUnitFieldConfigItemDto } from './dto/update-unit-field-config.dto';

type UnitFieldConfigView = {
  fieldKey: string;
  label: string;
  fieldType: DeliveryUnitFieldType;
  sortOrder: number;
  placeholder: string | null;
  options: unknown;
  isVisible: boolean;
  isRequired: boolean;
  showInApp: boolean;
  showInAdmin: boolean;
  includeInPdf: boolean;
  includeInExcel: boolean;
  includeInExport: boolean;
  isFixed: boolean;
};

const FIXED_UNIT_FIELDS: Record<string, Omit<UnitFieldConfigView, 'includeInExport'>> = {
  name: {
    fieldKey: 'name',
    label: '单位名称',
    fieldType: DeliveryUnitFieldType.TEXT,
    sortOrder: 10,
    placeholder: null,
    options: null,
    isVisible: true,
    isRequired: true,
    showInApp: true,
    showInAdmin: true,
    includeInPdf: true,
    includeInExcel: true,
    isFixed: true,
  },
  contactName: {
    fieldKey: 'contactName',
    label: '联系人姓名',
    fieldType: DeliveryUnitFieldType.TEXT,
    sortOrder: 20,
    placeholder: null,
    options: null,
    isVisible: true,
    isRequired: true,
    showInApp: true,
    showInAdmin: true,
    includeInPdf: true,
    includeInExcel: true,
    isFixed: true,
  },
  contactPhone: {
    fieldKey: 'contactPhone',
    label: '联系人手机号',
    fieldType: DeliveryUnitFieldType.TEXT,
    sortOrder: 30,
    placeholder: null,
    options: null,
    isVisible: true,
    isRequired: true,
    showInApp: true,
    showInAdmin: true,
    includeInPdf: true,
    includeInExcel: true,
    isFixed: true,
  },
  region: {
    fieldKey: 'region',
    label: '省 / 市 / 区',
    fieldType: DeliveryUnitFieldType.SELECT,
    sortOrder: 40,
    placeholder: null,
    options: null,
    isVisible: true,
    isRequired: true,
    showInApp: true,
    showInAdmin: true,
    includeInPdf: true,
    includeInExcel: true,
    isFixed: true,
  },
  detailAddress: {
    fieldKey: 'detailAddress',
    label: '详细地址',
    fieldType: DeliveryUnitFieldType.TEXTAREA,
    sortOrder: 50,
    placeholder: null,
    options: null,
    isVisible: true,
    isRequired: true,
    showInApp: true,
    showInAdmin: true,
    includeInPdf: true,
    includeInExcel: true,
    isFixed: true,
  },
};

@Injectable()
export class DeliveryUnitFieldConfigService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async getConfigs(): Promise<UnitFieldConfigView[]> {
    const rows = await this.deliveryPrisma.deliveryUnitFieldConfig.findMany({
      orderBy: [{ sortOrder: 'asc' }, { fieldKey: 'asc' }],
    });
    const rowMap = new Map(rows.map((row) => [row.fieldKey, row]));

    const fixedConfigs = Object.values(FIXED_UNIT_FIELDS).map((fixed) =>
      this.mergeFixedConfig(fixed, rowMap.get(fixed.fieldKey)),
    );

    const dynamicConfigs = rows
      .filter((row) => !Object.prototype.hasOwnProperty.call(FIXED_UNIT_FIELDS, row.fieldKey))
      .map((row) => this.mapDynamicConfig(row));

    return [...fixedConfigs, ...dynamicConfigs].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.fieldKey.localeCompare(b.fieldKey),
    );
  }

  async updateConfigs(items: UpdateUnitFieldConfigItemDto[]): Promise<UnitFieldConfigView[]> {
    const results: UnitFieldConfigView[] = [];

    for (const item of items) {
      const fixed = FIXED_UNIT_FIELDS[item.fieldKey];
      const existing = await this.deliveryPrisma.deliveryUnitFieldConfig.findUnique({
        where: { fieldKey: item.fieldKey },
      });
      const normalized = this.normalizeInput(item, fixed, existing);
      const row = await this.deliveryPrisma.deliveryUnitFieldConfig.upsert({
        where: { fieldKey: item.fieldKey },
        create: normalized,
        update: normalized,
      });

      results.push(
        fixed ? this.mergeFixedConfig(fixed, row) : this.mapDynamicConfig(row),
      );
    }

    return results.sort((a, b) => a.sortOrder - b.sortOrder || a.fieldKey.localeCompare(b.fieldKey));
  }

  private normalizeInput(
    item: UpdateUnitFieldConfigItemDto,
    fixed?: Omit<UnitFieldConfigView, 'includeInExport'>,
    existing?: DeliveryUnitFieldConfig | null,
  ) {
    const fieldType =
      item.fieldType ?? existing?.fieldType ?? fixed?.fieldType ?? DeliveryUnitFieldType.TEXT;
    const sortOrder =
      typeof item.sortOrder === 'number'
        ? item.sortOrder
        : existing?.sortOrder ?? fixed?.sortOrder ?? 0;
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
      throw new BadRequestException('sortOrder 必须是 0 到 999 之间的整数');
    }

    const includeInPdf = fixed ? true : item.includeInPdf ?? existing?.includeInPdf ?? false;
    const includeInExcel = fixed ? true : item.includeInExcel ?? existing?.includeInExcel ?? false;
    const normalizedOptions = this.normalizeOptions(
      item.options,
      fieldType,
      existing?.options ?? fixed?.options ?? null,
      Boolean(fixed),
    );

    return {
      fieldKey: item.fieldKey,
      label: item.label?.trim() || fixed?.label || item.fieldKey,
      fieldType,
      sortOrder,
      placeholder: item.placeholder?.trim() || existing?.placeholder || fixed?.placeholder || null,
      options: normalizedOptions,
      isVisible: fixed ? true : item.isVisible ?? existing?.isVisible ?? true,
      isRequired: fixed ? true : item.isRequired ?? existing?.isRequired ?? false,
      showInApp: fixed ? true : item.showInApp ?? existing?.showInApp ?? true,
      showInAdmin: fixed ? true : item.showInAdmin ?? existing?.showInAdmin ?? true,
      includeInPdf,
      includeInExcel,
      includeInExport: includeInPdf || includeInExcel,
    };
  }

  private normalizeOptions(
    rawOptions: unknown,
    fieldType: DeliveryUnitFieldType,
    existingOptions: unknown,
    isFixed: boolean,
  ): Prisma.InputJsonValue {
    if (rawOptions === undefined) {
      if (existingOptions !== null && existingOptions !== undefined) {
        return existingOptions as Prisma.InputJsonValue;
      }
      if (fieldType === DeliveryUnitFieldType.SELECT && !isFixed) {
        throw new BadRequestException('SELECT 字段必须提供 options');
      }
      return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
    }

    if (fieldType !== DeliveryUnitFieldType.SELECT) {
      throw new BadRequestException('只有 SELECT 字段允许配置 options');
    }
    if (!Array.isArray(rawOptions)) {
      throw new BadRequestException('SELECT 字段的 options 必须是数组');
    }

    const normalized = rawOptions.map((item) => {
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException('SELECT 字段的 options 格式不正确');
      }

      const option = item as Record<string, unknown>;
      if (
        typeof option.label !== 'string' ||
        !option.label.trim() ||
        typeof option.value !== 'string' ||
        !option.value.trim()
      ) {
        throw new BadRequestException('SELECT 字段的 options 必须包含非空 label/value');
      }

      return {
        label: option.label.trim(),
        value: option.value.trim(),
      };
    });

    return normalized as Prisma.InputJsonValue;
  }

  private mergeFixedConfig(
    fixed: Omit<UnitFieldConfigView, 'includeInExport'>,
    row?: DeliveryUnitFieldConfig,
  ): UnitFieldConfigView {
    return {
      ...fixed,
      label: row?.label || fixed.label,
      sortOrder: row?.sortOrder ?? fixed.sortOrder,
      placeholder: row?.placeholder ?? fixed.placeholder,
      options: row?.options ?? fixed.options,
      includeInExport: true,
    };
  }

  private mapDynamicConfig(row: DeliveryUnitFieldConfig): UnitFieldConfigView {
    return {
      fieldKey: row.fieldKey,
      label: row.label,
      fieldType: row.fieldType,
      sortOrder: row.sortOrder,
      placeholder: row.placeholder,
      options: row.options,
      isVisible: row.isVisible,
      isRequired: row.isRequired,
      showInApp: row.showInApp,
      showInAdmin: row.showInAdmin,
      includeInPdf: row.includeInPdf,
      includeInExcel: row.includeInExcel,
      includeInExport: row.includeInExport,
      isFixed: false,
    };
  }
}
