import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { Prisma, ShippingRule } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';
import {
  ImportPreview,
  ImportShippingRuleDto,
  ImportShippingRuleResult,
} from './dto/import-shipping-rule.dto';
import { ShippingRuleCache } from './shipping-rule.cache';

const CSV_HEADERS = [
  'name',
  'regionCodes',
  'fee',
  'firstWeightKg',
  'firstFee',
  'additionalWeightKg',
  'additionalFee',
  'minChargeWeightKg',
  'priority',
  'minAmount',
  'maxAmount',
  'minWeight',
  'maxWeight',
] as const;

const GRAMS_PER_KG = 1000;

type ImportRow = {
  row: number;
  dto: CreateShippingRuleDto;
};

type RuleWriteData = {
  name: string;
  regionCodes: string[];
  fee: number;
  firstWeightKg: number;
  firstFee: number;
  additionalWeightKg: number;
  additionalFee: number;
  minChargeWeightKg: number;
  priority: number;
  minAmount: number | null;
  maxAmount: number | null;
  minWeight: number | null;
  maxWeight: number | null;
};

type PreparedImport = ImportPreview & {
  creates: RuleWriteData[];
  updates: Array<{ id: string; data: RuleWriteData }>;
};

@Injectable()
export class ShippingRuleImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ShippingRuleCache,
  ) {}

  async importRules(dto: ImportShippingRuleDto): Promise<ImportShippingRuleResult> {
    const parsed = await this.parseAndValidate(dto);
    if (parsed.errors.length > 0) {
      return {
        ...this.emptyPreview(parsed.errors),
        created: 0,
        updated: 0,
      };
    }

    const prepared = await this.prepare(parsed.rows);
    if (prepared.errors.length > 0 || dto.dryRun) {
      return {
        toCreate: prepared.toCreate,
        toUpdate: prepared.toUpdate,
        unchanged: prepared.unchanged,
        errors: prepared.errors,
        created: 0,
        updated: 0,
      };
    }

    if (prepared.toCreate === 0 && prepared.toUpdate === 0) {
      return {
        toCreate: prepared.toCreate,
        toUpdate: prepared.toUpdate,
        unchanged: prepared.unchanged,
        errors: [],
        created: 0,
        updated: 0,
      };
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const data of prepared.creates) {
          await tx.shippingRule.create({ data });
        }
        for (const update of prepared.updates) {
          await tx.shippingRule.update({
            where: { id: update.id },
            data: update.data,
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.cache.invalidate();

    return {
      toCreate: prepared.toCreate,
      toUpdate: prepared.toUpdate,
      unchanged: prepared.unchanged,
      errors: [],
      created: prepared.toCreate,
      updated: prepared.toUpdate,
    };
  }

  getCsvTemplate(): string {
    return `${CSV_HEADERS.join(',')}\n${[
      '全国默认',
      '',
      9.1,
      3,
      9.1,
      1,
      1.3,
      1,
      100,
      '',
      '',
      '',
      '',
    ].join(',')}`;
  }

  private async parseAndValidate(dto: ImportShippingRuleDto): Promise<{
    rows: ImportRow[];
    errors: Array<{ row: number; message: string }>;
  }> {
    const rawRows = dto.format === 'csv'
      ? this.parseCsvPayload(dto.payload)
      : this.parseJsonPayload(dto.payload);
    const errors: Array<{ row: number; message: string }> = [];
    const rows: ImportRow[] = [];
    const seenNames = new Map<string, number>();

    for (const rawRow of rawRows) {
      const instance = plainToInstance(CreateShippingRuleDto, rawRow.value);
      const validationErrors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      const messages = this.flattenValidationErrors(validationErrors);
      this.validateBusinessRules(instance, messages);

      const name = typeof instance.name === 'string' ? instance.name.trim() : '';
      if (name) {
        const previousRow = seenNames.get(name);
        if (previousRow !== undefined) {
          messages.push(`name 与第 ${previousRow} 行重复`);
        } else {
          seenNames.set(name, rawRow.row);
        }
      }

      if (messages.length > 0) {
        errors.push({ row: rawRow.row, message: messages.join('; ') });
      } else {
        rows.push({ row: rawRow.row, dto: instance });
      }
    }

    return { rows, errors };
  }

  private parseCsvPayload(payload: string): Array<{ row: number; value: Record<string, unknown> }> {
    const records = this.parseCsvRecords(payload);
    if (records.length === 0) {
      throw new BadRequestException('CSV 内容不能为空');
    }
    const headers = records[0];
    if (
      headers.length !== CSV_HEADERS.length ||
      !CSV_HEADERS.every((header, index) => headers[index] === header)
    ) {
      throw new BadRequestException(`CSV header 必须为：${CSV_HEADERS.join(',')}`);
    }

    return records.slice(1).map((record, index) => {
      const rowNumber = index + 2;
      if (record.length !== CSV_HEADERS.length) {
        throw new BadRequestException(
          `CSV 第 ${rowNumber} 行字段数量错误，应为 ${CSV_HEADERS.length} 个`,
        );
      }

      const value: Record<string, unknown> = {};
      CSV_HEADERS.forEach((header, columnIndex) => {
        const raw = record[columnIndex];
        if (header === 'regionCodes') {
          value[header] = raw === '' ? [] : raw.split('|');
        } else if (this.isNumberHeader(header)) {
          if (raw !== '') {
            value[header] = raw;
          }
        } else {
          value[header] = raw;
        }
      });

      return { row: rowNumber, value };
    });
  }

  private parseCsvRecords(payload: string): string[][] {
    const records: string[][] = [];
    let record: string[] = [];
    let field = '';
    let inQuotes = false;
    let fieldStarted = false;
    let justClosedQuote = false;

    for (let i = 0; i < payload.length; i += 1) {
      const char = payload[i];

      if (inQuotes) {
        if (char === '"') {
          if (payload[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
            justClosedQuote = true;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        if (fieldStarted || justClosedQuote) {
          throw new BadRequestException('CSV 引号只能出现在字段开头，字段内引号需用双引号转义');
        }
        inQuotes = true;
        fieldStarted = true;
        continue;
      }

      if (char === ',') {
        record.push(field);
        field = '';
        fieldStarted = false;
        justClosedQuote = false;
        continue;
      }

      if (char === '\r' || char === '\n') {
        record.push(field);
        records.push(record);
        record = [];
        field = '';
        fieldStarted = false;
        justClosedQuote = false;
        if (char === '\r' && payload[i + 1] === '\n') {
          i += 1;
        }
        continue;
      }

      if (justClosedQuote) {
        throw new BadRequestException('CSV 引号字段结束后只能跟逗号或换行');
      }
      field += char;
      fieldStarted = true;
    }

    if (inQuotes) {
      throw new BadRequestException('CSV 引号未闭合');
    }
    if (field !== '' || fieldStarted || record.length > 0) {
      record.push(field);
      records.push(record);
    }

    return records.filter((item) => item.some((fieldValue) => fieldValue !== ''));
  }

  private parseJsonPayload(payload: string): Array<{ row: number; value: Record<string, unknown> }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new BadRequestException('JSON 格式错误');
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('JSON payload 必须为数组');
    }

    return parsed.map((value, index) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new BadRequestException(`JSON 第 ${index + 1} 行必须为对象`);
      }
      return { row: index + 1, value: value as Record<string, unknown> };
    });
  }

  private async prepare(rows: ImportRow[]): Promise<PreparedImport> {
    const names = rows.map((row) => row.dto.name.trim());
    const existingRules = names.length === 0
      ? []
      : await this.prisma.shippingRule.findMany({
        where: { name: { in: names } },
      });
    const existingByName = new Map(
      existingRules.map((rule) => [rule.name, rule]),
    );
    const creates: RuleWriteData[] = [];
    const updates: Array<{ id: string; data: RuleWriteData }> = [];
    let unchanged = 0;

    for (const row of rows) {
      const data = this.toWriteData(row.dto);
      const existing = existingByName.get(data.name);
      if (!existing) {
        creates.push(data);
        continue;
      }
      if (this.isUnchanged(existing, data)) {
        unchanged += 1;
      } else {
        updates.push({ id: existing.id, data });
      }
    }

    return {
      toCreate: creates.length,
      toUpdate: updates.length,
      unchanged,
      errors: [],
      creates,
      updates,
    };
  }

  private toWriteData(dto: CreateShippingRuleDto): RuleWriteData {
    return {
      name: dto.name.trim(),
      regionCodes: dto.regionCodes ?? [],
      fee: dto.fee,
      firstWeightKg: dto.firstWeightKg,
      firstFee: dto.firstFee,
      additionalWeightKg: dto.additionalWeightKg,
      additionalFee: dto.additionalFee,
      minChargeWeightKg: dto.minChargeWeightKg,
      priority: dto.priority ?? 0,
      minAmount: dto.minAmount ?? null,
      maxAmount: dto.maxAmount ?? null,
      minWeight: dto.minWeight === undefined ? null : this.kgToGram(dto.minWeight),
      maxWeight: dto.maxWeight === undefined ? null : this.kgToGram(dto.maxWeight),
    };
  }

  private isUnchanged(existing: ShippingRule, data: RuleWriteData): boolean {
    return (
      existing.name === data.name &&
      this.sameStringArray(existing.regionCodes, data.regionCodes) &&
      this.sameNullableNumber(existing.fee, data.fee) &&
      this.sameNullableNumber(existing.firstWeightKg, data.firstWeightKg) &&
      this.sameNullableNumber(existing.firstFee, data.firstFee) &&
      this.sameNullableNumber(existing.additionalWeightKg, data.additionalWeightKg) &&
      this.sameNullableNumber(existing.additionalFee, data.additionalFee) &&
      this.sameNullableNumber(existing.minChargeWeightKg, data.minChargeWeightKg) &&
      existing.priority === data.priority &&
      this.sameNullableNumber(existing.minAmount, data.minAmount) &&
      this.sameNullableNumber(existing.maxAmount, data.maxAmount) &&
      this.sameNullableNumber(existing.minWeight, data.minWeight) &&
      this.sameNullableNumber(existing.maxWeight, data.maxWeight)
    );
  }

  private sameStringArray(left: string[], right: string[]): boolean {
    return left.length === right.length &&
      left.every((value, index) => value === right[index]);
  }

  private sameNullableNumber(
    left: number | null,
    right: number | null,
  ): boolean {
    return left === right;
  }

  private validateBusinessRules(
    dto: CreateShippingRuleDto,
    messages: string[],
  ) {
    if (this.hasFiniteNumbers(dto.minAmount, dto.maxAmount) && dto.minAmount! >= dto.maxAmount!) {
      messages.push('金额下限必须小于上限');
    }
    if (this.hasFiniteNumbers(dto.minWeight, dto.maxWeight) && dto.minWeight! >= dto.maxWeight!) {
      messages.push('重量下限必须小于上限');
    }
  }

  private hasFiniteNumbers(
    left: number | undefined,
    right: number | undefined,
  ): boolean {
    return Number.isFinite(left) && Number.isFinite(right);
  }

  private flattenValidationErrors(errors: ValidationError[]): string[] {
    return errors.flatMap((error) => [
      ...Object.values(error.constraints ?? {}),
      ...this.flattenValidationErrors(error.children ?? []),
    ]);
  }

  private isNumberHeader(header: string): boolean {
    return header !== 'name' && header !== 'regionCodes';
  }

  private kgToGram(weightKg: number): number {
    return Math.round(weightKg * GRAMS_PER_KG);
  }

  private emptyPreview(errors: Array<{ row: number; message: string }>): ImportPreview {
    return {
      toCreate: 0,
      toUpdate: 0,
      unchanged: 0,
      errors,
    };
  }
}
