import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { Prisma, ShippingRule } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';
import {
  ImportPreview,
  ImportShippingRuleRowDto,
  ImportShippingRuleDto,
  ImportShippingRuleResult,
} from './dto/import-shipping-rule.dto';
import { ShippingRuleCache } from './shipping-rule.cache';

const CSV_HEADERS_COMPACT = [
  'name',
  'regionCodes',
  'firstWeightKg',
  'firstFee',
  'additionalWeightKg',
  'additionalFee',
  'priority',
  'isActive',
] as const;

const CSV_HEADERS_EXTENDED = [
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
  'isActive',
] as const;

type CsvHeader = typeof CSV_HEADERS_COMPACT[number] | typeof CSV_HEADERS_EXTENDED[number];

const GRAMS_PER_KG = 1000;

type ImportRow = {
  row: number;
  dto: ImportShippingRuleRowDto;
  presentFields: Set<keyof RuleWriteData>;
};

type RawImportRow =
  | { row: number; value: Record<string, unknown>; message?: never }
  | { row: number; message: string; value?: never };

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
  isActive: boolean;
};

type PreparedImport = ImportPreview & {
  creates: RuleWriteData[];
  updates: Array<{ id: string; data: Partial<RuleWriteData> }>;
};

type ShippingRuleClient = Pick<PrismaService, 'shippingRule'>;

const REQUIRED_WRITE_FIELDS = [
  'name',
  'fee',
  'firstWeightKg',
  'firstFee',
  'additionalWeightKg',
  'additionalFee',
  'minChargeWeightKg',
] as const satisfies ReadonlyArray<keyof RuleWriteData>;

const BLANK_NULL_OPTIONAL_WRITE_FIELDS = [
  'regionCodes',
  'priority',
  'minAmount',
  'maxAmount',
  'minWeight',
  'maxWeight',
  'isActive',
] as const satisfies ReadonlyArray<keyof RuleWriteData>;

@Injectable()
export class ShippingRuleImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ShippingRuleCache,
  ) {}

  async importRules(dto: ImportShippingRuleDto): Promise<ImportShippingRuleResult> {
    const parsed = await this.parseAndValidate(dto);
    const prepared = await this.prepare(parsed.rows);
    const errors = [...parsed.errors, ...prepared.errors];
    if (errors.length > 0 || dto.dryRun) {
      return {
        toCreate: prepared.toCreate,
        toUpdate: prepared.toUpdate,
        unchanged: prepared.unchanged,
        errors,
        created: 0,
        updated: 0,
      };
    }

    const persisted = await this.prisma.$transaction(
      async (tx) => {
        const txPrepared = await this.prepare(parsed.rows, tx);
        if (txPrepared.errors.length > 0) {
          return { prepared: txPrepared, wrote: false };
        }
        if (txPrepared.toCreate === 0 && txPrepared.toUpdate === 0) {
          return { prepared: txPrepared, wrote: false };
        }
        for (const data of txPrepared.creates) {
          await tx.shippingRule.create({ data });
        }
        for (const update of txPrepared.updates) {
          await tx.shippingRule.update({
            where: { id: update.id },
            data: update.data,
          });
        }
        return { prepared: txPrepared, wrote: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (persisted.prepared.errors.length > 0) {
      return {
        toCreate: persisted.prepared.toCreate,
        toUpdate: persisted.prepared.toUpdate,
        unchanged: persisted.prepared.unchanged,
        errors: persisted.prepared.errors,
        created: 0,
        updated: 0,
      };
    }

    if (persisted.wrote) {
      await this.cache.invalidate();
    }

    return {
      toCreate: persisted.prepared.toCreate,
      toUpdate: persisted.prepared.toUpdate,
      unchanged: persisted.prepared.unchanged,
      errors: [],
      created: persisted.prepared.toCreate,
      updated: persisted.prepared.toUpdate,
    };
  }

  getCsvTemplate(): string {
    return `${CSV_HEADERS_COMPACT.join(',')}\n${[
      '全国默认',
      '',
      3,
      9.1,
      1,
      1.3,
      100,
      true,
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
      if (rawRow.message !== undefined) {
        errors.push({ row: rawRow.row, message: rawRow.message });
        continue;
      }
      const defaultedValue = this.applyImportDefaults(rawRow.value);
      const normalizedValue = this.omitBlankNullOptionalFields(defaultedValue);
      const presentFields = this.getPresentFields(normalizedValue);
      const instance = plainToInstance(ImportShippingRuleRowDto, normalizedValue);
      const validationErrors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      const messages = [
        ...this.validateRequiredFields(defaultedValue),
        ...this.flattenValidationErrors(validationErrors),
      ];
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
        rows.push({ row: rawRow.row, dto: instance, presentFields });
      }
    }

    return { rows, errors };
  }

  private parseCsvPayload(payload: string): RawImportRow[] {
    const records = this.parseCsvRecords(payload);
    if (records.length === 0) {
      throw new BadRequestException('CSV 内容不能为空');
    }
    const headers = records[0];
    const matchedHeaders = this.matchCsvHeaders(headers);
    if (!matchedHeaders) {
      throw new BadRequestException(
        `CSV header 必须为：${CSV_HEADERS_COMPACT.join(',')} 或 ${CSV_HEADERS_EXTENDED.join(',')}`,
      );
    }

    return records.slice(1).map((record, index) => {
      const rowNumber = index + 2;
      if (record.length !== matchedHeaders.length) {
        return {
          row: rowNumber,
          message: `CSV 第 ${rowNumber} 行字段数量错误，应为 ${matchedHeaders.length} 个`,
        };
      }

      const value: Record<string, unknown> = {};
      matchedHeaders.forEach((header, columnIndex) => {
        const raw = record[columnIndex];
        if (header === 'regionCodes') {
          value[header] = raw === '' ? [] : raw.split('|');
        } else if (this.isNumberHeader(header)) {
          if (raw !== '') {
            value[header] = raw;
          }
        } else if (header === 'isActive') {
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

  private matchCsvHeaders(headers: string[]): CsvHeader[] | null {
    if (this.sameStringArray(headers, [...CSV_HEADERS_COMPACT])) {
      return [...CSV_HEADERS_COMPACT];
    }
    if (this.sameStringArray(headers, [...CSV_HEADERS_EXTENDED])) {
      return [...CSV_HEADERS_EXTENDED];
    }
    return null;
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

  private parseJsonPayload(payload: string): RawImportRow[] {
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
        return {
          row: index + 1,
          message: `JSON 第 ${index + 1} 行必须为对象`,
        };
      }
      return { row: index + 1, value: value as Record<string, unknown> };
    });
  }

  private async prepare(
    rows: ImportRow[],
    client: ShippingRuleClient = this.prisma,
  ): Promise<PreparedImport> {
    const names = rows.map((row) => row.dto.name.trim());
    const existingRules = names.length === 0
      ? []
      : await client.shippingRule.findMany({
        where: { name: { in: names } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
    const existingByName = this.groupByName(existingRules);
    const creates: RuleWriteData[] = [];
    const updates: Array<{ id: string; data: Partial<RuleWriteData> }> = [];
    const errors: Array<{ row: number; message: string }> = [];
    let unchanged = 0;

    for (const row of rows) {
      const data = this.toWriteData(row.dto);
      const existingMatches = existingByName.get(data.name) ?? [];
      if (existingMatches.length >= 2) {
        errors.push({
          row: row.row,
          message: '数据库存在多个同名运费规则，请先清理后导入',
        });
        continue;
      }
      const existing = existingMatches[0];
      if (existing === undefined) {
        creates.push(this.toCreateData(row.dto));
        continue;
      }
      const patch = this.toUpdatePatch(row.dto, row.presentFields);
      const effective = { ...this.toComparableData(existing), ...patch };
      if (this.isUnchanged(existing, effective)) {
        unchanged += 1;
      } else {
        updates.push({ id: existing.id, data: patch });
      }
    }

    return {
      toCreate: creates.length,
      toUpdate: updates.length,
      unchanged,
      errors,
      creates,
      updates,
    };
  }

  private groupByName(rules: ShippingRule[]): Map<string, ShippingRule[]> {
    const grouped = new Map<string, ShippingRule[]>();
    for (const rule of rules) {
      grouped.set(rule.name, [...(grouped.get(rule.name) ?? []), rule]);
    }
    return grouped;
  }

  private toWriteData(dto: ImportShippingRuleRowDto): RuleWriteData {
    return {
      name: dto.name.trim(),
      regionCodes: dto.regionCodes ?? [],
      fee: dto.firstFee,
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
      isActive: dto.isActive ?? true,
    };
  }

  private toCreateData(dto: ImportShippingRuleRowDto): RuleWriteData {
    return this.toWriteData(dto);
  }

  private toUpdatePatch(
    dto: ImportShippingRuleRowDto,
    presentFields: Set<keyof RuleWriteData>,
  ): Partial<RuleWriteData> {
    const data = this.toWriteData(dto);
    const patch: Partial<RuleWriteData> = {};

    for (const field of REQUIRED_WRITE_FIELDS) {
      patch[field] = data[field] as never;
    }

    for (const field of presentFields) {
      if (REQUIRED_WRITE_FIELDS.includes(field as typeof REQUIRED_WRITE_FIELDS[number])) {
        continue;
      }
      patch[field] = data[field] as never;
    }

    return patch;
  }

  private toComparableData(rule: ShippingRule): RuleWriteData {
    return {
      name: rule.name,
      regionCodes: rule.regionCodes,
      fee: rule.fee,
      firstWeightKg: rule.firstWeightKg,
      firstFee: rule.firstFee,
      additionalWeightKg: rule.additionalWeightKg,
      additionalFee: rule.additionalFee,
      minChargeWeightKg: rule.minChargeWeightKg,
      priority: rule.priority,
      minAmount: rule.minAmount,
      maxAmount: rule.maxAmount,
      minWeight: rule.minWeight,
      maxWeight: rule.maxWeight,
      isActive: rule.isActive,
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
      this.sameNullableNumber(existing.maxWeight, data.maxWeight) &&
      existing.isActive === data.isActive
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
    if (dto.priority !== undefined && dto.priority !== null && !Number.isInteger(dto.priority)) {
      messages.push('priority 必须为整数');
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
    return header !== 'name' && header !== 'regionCodes' && header !== 'isActive';
  }

  private getPresentFields(value: Record<string, unknown>): Set<keyof RuleWriteData> {
    const fields = new Set<keyof RuleWriteData>();
    for (const key of Object.keys(value)) {
      if (this.isWriteField(key)) {
        fields.add(key);
      }
    }
    return fields;
  }

  private validateRequiredFields(value: Record<string, unknown>): string[] {
    return REQUIRED_WRITE_FIELDS
      .filter((field) => value[field] === '' || value[field] === null)
      .map((field) => `${field} 不能为空`);
  }

  private isWriteField(key: string): key is keyof RuleWriteData {
    return [
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
      'isActive',
    ].includes(key);
  }

  private omitBlankNullOptionalFields(value: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...value };
    for (const field of BLANK_NULL_OPTIONAL_WRITE_FIELDS) {
      if (normalized[field] === '' || normalized[field] === null) {
        delete normalized[field];
      }
    }
    return normalized;
  }

  private applyImportDefaults(value: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...value };
    if (
      (normalized.fee === undefined || normalized.fee === '' || normalized.fee === null) &&
      normalized.firstFee !== undefined &&
      normalized.firstFee !== '' &&
      normalized.firstFee !== null
    ) {
      normalized.fee = normalized.firstFee;
    }
    if (
      normalized.minChargeWeightKg === undefined ||
      normalized.minChargeWeightKg === '' ||
      normalized.minChargeWeightKg === null
    ) {
      normalized.minChargeWeightKg = 1;
    }
    return normalized;
  }

  private kgToGram(weightKg: number): number {
    return Math.round(weightKg * GRAMS_PER_KG);
  }
}
