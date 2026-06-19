import { Injectable } from '@nestjs/common';
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
      const normalized = this.normalizeInput(item, fixed);
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
  ) {
    const includeInPdf = fixed ? true : item.includeInPdf ?? false;
    const includeInExcel = fixed ? true : item.includeInExcel ?? false;

    return {
      fieldKey: item.fieldKey,
      label: item.label?.trim() || fixed?.label || item.fieldKey,
      fieldType: item.fieldType ?? fixed?.fieldType ?? DeliveryUnitFieldType.TEXT,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : fixed?.sortOrder ?? 0,
      placeholder: item.placeholder?.trim() || fixed?.placeholder || null,
      options:
        item.options !== undefined
          ? (item.options as Prisma.InputJsonValue)
          : fixed?.options !== null && fixed?.options !== undefined
            ? (fixed.options as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      isVisible: fixed ? true : item.isVisible ?? true,
      isRequired: fixed ? true : item.isRequired ?? false,
      showInApp: fixed ? true : item.showInApp ?? true,
      showInAdmin: fixed ? true : item.showInAdmin ?? true,
      includeInPdf,
      includeInExcel,
      includeInExport: includeInPdf || includeInExcel,
    };
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
