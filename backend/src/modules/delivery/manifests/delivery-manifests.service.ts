import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DeliveryManifestFormat,
  DeliveryManifestStatus,
  DeliveryManifestTemplateType,
  DeliveryManifestVersionStatus,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UploadService } from '../../upload/upload.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import {
  DeliveryFinanceExportContext,
  DeliveryFulfillmentManifestContext,
  DeliveryOrderManifestContext,
  DeliveryOrdersService,
} from '../orders/delivery-orders.service';
import {
  DELIVERY_MANIFEST_TEMPLATES,
  DeliveryManifestApiType,
  DeliveryManifestColumnDefinition,
  DeliveryManifestTemplateDefinition,
  findManifestDefinitionByDbType,
} from './delivery-manifest.definitions';
import { UpsertDeliveryManifestCustomizationDto } from './dto/manifest-target-customization.dto';
import { buildSimplePdf, buildSpreadsheetXml } from './delivery-manifest.renderers';
import { RegenerateDeliveryManifestDto } from './dto/regenerate-delivery-manifest.dto';

type OrderManifestViewer =
  | { kind: 'buyer'; deliveryUserId: string }
  | { kind: 'admin'; deliveryAdminUserId: string };

type ManifestTemplateConfig = {
  columns: DeliveryManifestColumnDefinition[];
  customizations: Partial<Record<'order' | 'subOrder', Record<string, ManifestTargetCustomization>>>;
};

type ManifestRenderedTable = {
  headers: string[];
  rows: string[][];
};

type ManifestTargetCustomizationEntry = {
  key: string;
  label: string;
  value: string;
  sortOrder: number;
  visible: boolean;
};

type ManifestTargetCustomization = {
  targetId: string;
  entries: ManifestTargetCustomizationEntry[];
  updatedAt?: string;
  updatedByAdminId?: string;
};

@Injectable()
export class DeliveryManifestsService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryOrdersService: DeliveryOrdersService,
    private readonly deliveryIdService: DeliveryIdService,
    private readonly uploadService: UploadService,
  ) {}

  async listBuyerManifests(deliveryUserId: string) {
    const rows = await this.deliveryPrisma.deliveryManifest.findMany({
      where: { userId: deliveryUserId },
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.mapManifestRow(row));
  }

  async getOrderManifest(input: { orderId: string; viewer: OrderManifestViewer }) {
    const definition = DELIVERY_MANIFEST_TEMPLATES.BUYER_FULL;
    const context =
      input.viewer.kind === 'buyer'
        ? await this.deliveryOrdersService.getOrderManifestContextForBuyer(
            input.viewer.deliveryUserId,
            input.orderId,
          )
        : await this.deliveryOrdersService.getOrderManifestContextForAdmin(input.orderId);

    const manifest = await this.ensureGeneratedOrderManifest(definition, context);
    return this.mapManifestRow(manifest);
  }

  async listAdminTemplates() {
    const templates = await Promise.all(
      Object.values(DELIVERY_MANIFEST_TEMPLATES).map((definition) => this.ensureTemplate(definition)),
    );

    return Promise.all(
      templates.map(async (template) => {
        const latestVersion = await this.getPublishedVersion(template.id);
        const versions = await this.deliveryPrisma.deliveryManifestVersion.findMany({
          where: { templateId: template.id },
          orderBy: [{ versionNo: 'desc' }],
        });
        const definition = findManifestDefinitionByDbType(template.type as DeliveryManifestTemplateType);

        return {
          id: template.id,
          type: definition?.apiType ?? template.type,
          name: template.name,
          description: template.description,
          currentConfig: this.normalizeTemplateConfig(
            definition ?? DELIVERY_MANIFEST_TEMPLATES.BUYER_FULL,
            template.config,
          ),
          latestVersion: latestVersion
            ? {
                id: latestVersion.id,
                versionNo: latestVersion.versionNo,
                status: latestVersion.status,
                config: latestVersion.config,
              }
            : null,
          versions: versions.map((version) => ({
            id: version.id,
            versionNo: version.versionNo,
            status: version.status,
            createdAt: version.createdAt,
          })),
        };
      }),
    );
  }

  async getTargetCustomization(manifestType: DeliveryManifestApiType, targetId: string) {
    const definition = DELIVERY_MANIFEST_TEMPLATES[manifestType];
    if (!definition) {
      throw new BadRequestException('不支持的配送清单模板类型');
    }

    const scope = this.resolveCustomizationScope(definition);
    if (!scope) {
      throw new BadRequestException('当前配送清单模板不支持逐单自定义列');
    }

    const template = await this.ensureTemplate(definition);
    const config = this.normalizeTemplateConfig(definition, template.config);
    return {
      manifestType,
      targetId,
      entries: config.customizations[scope]?.[targetId]?.entries ?? [],
    };
  }

  async regenerateTemplate(
    deliveryAdminUserId: string,
    templateId: string,
    dto: RegenerateDeliveryManifestDto = {},
  ) {
    const template = await this.deliveryPrisma.deliveryManifestTemplate.findFirst({
      where: { id: templateId },
    });
    if (!template) {
      throw new NotFoundException('配送清单模板不存在');
    }

    const definition = findManifestDefinitionByDbType(template.type as DeliveryManifestTemplateType);
    if (!definition) {
      throw new BadRequestException('不支持的配送清单模板类型');
    }

    return this.deliveryPrisma.$transaction(async (tx) => {
      const existingVersions = await tx.deliveryManifestVersion.findMany({
        where: { templateId },
        orderBy: [{ versionNo: 'desc' }],
      });
      const currentConfig = this.normalizeTemplateConfig(definition, template.config);
      const nextConfig = this.normalizeTemplateConfig(definition, {
        columns: dto.columns?.length
          ? currentConfig.columns.map((column) => {
              const override = dto.columns?.find((item) => item.key === column.key);
              return override
                ? {
                    ...column,
                    label: override.label?.trim() || column.label,
                    sortOrder: typeof override.sortOrder === 'number' ? override.sortOrder : column.sortOrder,
                    visible: column.fixed ? true : override.visible ?? column.visible,
                  }
                : column;
            }).concat(
              (dto.columns ?? [])
                .filter((item) => !currentConfig.columns.some((column) => column.key === item.key))
                .map((item) => {
                  const base = definition.columns.find((column) => column.key === item.key);
                  if (!base) {
                    throw new BadRequestException(`不支持的模板列: ${item.key}`);
                  }
                  return {
                    ...base,
                    label: item.label?.trim() || base.label,
                    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : base.sortOrder,
                    visible: base.fixed ? true : item.visible ?? base.visible,
                  };
                }),
            )
          : currentConfig.columns,
      });

      await tx.deliveryManifestVersion.updateMany({
        where: { templateId, status: DeliveryManifestVersionStatus.PUBLISHED },
        data: { status: DeliveryManifestVersionStatus.ARCHIVED },
      });

      await tx.deliveryManifestTemplate.update({
        where: { id: templateId },
        data: {
          name: dto.name?.trim() || template.name,
          description: dto.description?.trim() || template.description,
          config: nextConfig as unknown as Prisma.InputJsonValue,
        },
      });

      const version = await tx.deliveryManifestVersion.create({
        data: {
          templateId,
          versionNo: (existingVersions[0]?.versionNo ?? 0) + 1,
          status: DeliveryManifestVersionStatus.PUBLISHED,
          config: nextConfig as unknown as Prisma.InputJsonValue,
          createdByAdminId: deliveryAdminUserId,
        },
      });

      return {
        id: version.id,
        templateId,
        versionNo: version.versionNo,
        status: version.status,
        config: nextConfig,
      };
    });
  }

  async upsertTargetCustomization(
    deliveryAdminUserId: string,
    dto: UpsertDeliveryManifestCustomizationDto,
  ) {
    const definition = DELIVERY_MANIFEST_TEMPLATES[dto.manifestType];
    if (!definition) {
      throw new BadRequestException('不支持的配送清单模板类型');
    }

    const scope = this.resolveCustomizationScope(definition);
    if (!scope) {
      throw new BadRequestException('当前配送清单模板不支持逐单自定义列');
    }

    const template = await this.ensureTemplate(definition);
    const version = await this.getPublishedVersion(template.id);
    if (!version) {
      throw new NotFoundException('配送清单模板版本不存在');
    }

    const currentConfig = this.normalizeTemplateConfig(definition, template.config);
    const entries = this.normalizeCustomizationEntries(definition, dto.entries ?? []);
    const nextCustomizations = {
      ...currentConfig.customizations,
      [scope]: {
        ...(currentConfig.customizations[scope] ?? {}),
        [dto.targetId]: {
          targetId: dto.targetId,
          entries,
          updatedAt: new Date().toISOString(),
          updatedByAdminId: deliveryAdminUserId,
        },
      },
    };
    const nextConfig: ManifestTemplateConfig = {
      columns: currentConfig.columns,
      customizations: nextCustomizations,
    };
    const serializedConfig = this.serializeTemplateConfig(nextConfig);

    await this.deliveryPrisma.$transaction(async (tx) => {
      await tx.deliveryManifestTemplate.update({
        where: { id: template.id },
        data: {
          config: serializedConfig as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.deliveryManifestVersion.updateMany({
        where: { id: version.id },
        data: {
          config: serializedConfig as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.deliveryManifest.updateMany({
        where: {
          type: definition.dbType,
          status: DeliveryManifestStatus.GENERATED,
          ...(scope === 'order' ? { orderId: dto.targetId } : { subOrderId: dto.targetId }),
        },
        data: {
          status: DeliveryManifestStatus.PENDING,
          fileUrl: null,
          storageKey: null,
          generatedAt: null,
          failedAt: null,
          failureReason: null,
        },
      });
    });

    return {
      ok: true,
      manifestType: dto.manifestType,
      targetId: dto.targetId,
      entries,
    };
  }

  async getSellerFulfillmentManifest(merchantId: string, subOrderId: string) {
    const definition = DELIVERY_MANIFEST_TEMPLATES.SELLER_FULFILLMENT;
    const context = await this.deliveryOrdersService.getSellerFulfillmentManifestContext(
      merchantId,
      subOrderId,
    );
    const manifest = await this.ensureGeneratedFulfillmentManifest(definition, context);
    return this.mapManifestRow(manifest);
  }

  async exportSellerFinanceManifest(merchantId: string) {
    const definition = DELIVERY_MANIFEST_TEMPLATES.SELLER_FINANCE;
    const context = await this.deliveryOrdersService.getSellerFinanceExportContext(merchantId);
    const manifest = await this.ensureGeneratedFinanceManifest(definition, context);
    return this.mapManifestRow(manifest);
  }

  private async ensureGeneratedOrderManifest(
    definition: DeliveryManifestTemplateDefinition,
    context: DeliveryOrderManifestContext,
  ) {
    const { template, version, config } = await this.getTemplateAndVersion(definition);
    const existing = await this.deliveryPrisma.deliveryManifest.findFirst({
      where: {
        orderId: context.orderId,
        type: definition.dbType,
        format: definition.format,
        status: DeliveryManifestStatus.GENERATED,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    if (existing && existing.templateVersionId === version.id) {
      return existing;
    }

    const rows = context.items.map((item) => ({
      orderId: context.orderId,
      unitName: context.unitName,
      recipientName: context.recipientName,
      recipientPhone: context.recipientPhone,
      detailAddress: context.detailAddress,
      merchantName: item.merchantName,
      productTitle: item.productTitle,
      skuTitle: item.skuTitle,
      quantity: String(item.quantity),
      finalUnitPrice: this.money(item.finalUnitPriceCents),
      finalLineAmount: this.money(item.finalLineAmountCents),
      paidAt: this.formatDate(context.paidAt),
      note: context.note ?? '',
      goodsAmount: this.money(context.goodsAmountCents),
      shippingFee: this.money(context.shippingFeeCents),
      totalAmount: this.money(context.totalAmountCents),
    }));
    const customized = this.applyTargetCustomization(
      definition,
      config,
      context.orderId,
      rows,
    );
    const renderedTable = this.buildRenderedTable(customized.config, customized.rows);

    const payloadSnapshot = {
      versionNo: version.versionNo,
      generatedFor: { orderId: context.orderId, userId: context.userId },
      columns: customized.config.columns,
      rows: customized.rows,
      renderedTable,
    };
    const uploaded = await this.uploadGeneratedBuffer(
      definition,
      await buildSimplePdf(this.buildPdfLines(definition.name, version.versionNo, renderedTable)),
    );
    return this.deliveryPrisma.deliveryManifest.create({
      data: {
        id: await this.deliveryIdService.next('PSQD'),
        orderId: context.orderId,
        userId: context.userId,
        unitId: context.unitId,
        templateId: template.id,
        templateVersionId: version.id,
        type: definition.dbType,
        format: definition.format,
        status: DeliveryManifestStatus.GENERATED,
        title: `${context.orderId}-buyer-full-v${version.versionNo}`,
        fileUrl: uploaded.url,
        storageKey: uploaded.key,
        payloadSnapshot: payloadSnapshot as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    });
  }

  private async ensureGeneratedFulfillmentManifest(
    definition: DeliveryManifestTemplateDefinition,
    context: DeliveryFulfillmentManifestContext,
  ) {
    const { template, version, config } = await this.getTemplateAndVersion(definition);
    const existing = await this.deliveryPrisma.deliveryManifest.findFirst({
      where: {
        subOrderId: context.subOrderId,
        type: definition.dbType,
        format: definition.format,
        status: DeliveryManifestStatus.GENERATED,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    if (existing && existing.templateVersionId === version.id) {
      return existing;
    }

    const rows = context.items.map((item) => ({
      orderId: context.orderId,
      subOrderId: context.subOrderId,
      unitName: context.unitName,
      recipientName: context.recipientName,
      recipientPhone: context.recipientPhone,
      detailAddress: context.detailAddress,
      productTitle: item.productTitle,
      skuTitle: item.skuTitle,
      unitNameItem: item.unitName,
      quantity: String(item.quantity),
      paidAt: this.formatDate(context.paidAt),
      note: context.note ?? '',
    }));
    const customized = this.applyTargetCustomization(
      definition,
      config,
      context.subOrderId,
      rows,
    );
    const renderedTable = this.buildRenderedTable(customized.config, customized.rows);

    const payloadSnapshot = {
      versionNo: version.versionNo,
      generatedFor: { orderId: context.orderId, subOrderId: context.subOrderId, merchantId: context.merchantId },
      columns: customized.config.columns,
      rows: customized.rows,
      renderedTable,
    };
    const uploaded = await this.uploadGeneratedBuffer(
      definition,
      await buildSimplePdf(this.buildPdfLines(definition.name, version.versionNo, renderedTable)),
    );
    return this.deliveryPrisma.deliveryManifest.create({
      data: {
        id: await this.deliveryIdService.next('PSQD'),
        orderId: context.orderId,
        subOrderId: context.subOrderId,
        merchantId: context.merchantId,
        templateId: template.id,
        templateVersionId: version.id,
        type: definition.dbType,
        format: definition.format,
        status: DeliveryManifestStatus.GENERATED,
        title: `${context.subOrderId}-fulfillment-v${version.versionNo}`,
        fileUrl: uploaded.url,
        storageKey: uploaded.key,
        payloadSnapshot: payloadSnapshot as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    });
  }

  private async ensureGeneratedFinanceManifest(
    definition: DeliveryManifestTemplateDefinition,
    context: DeliveryFinanceExportContext,
  ) {
    const { template, version, config } = await this.getTemplateAndVersion(definition);

    const rows = context.rows.map((row) => ({
      orderId: row.orderId,
      subOrderId: row.subOrderId,
      paidAt: this.formatDate(row.paidAt),
      itemSummary: row.itemSummary,
      quantity: String(row.quantity),
      supplyAmount: this.money(row.supplyAmountCents),
      settlementAmount: this.money(row.settlementAmountCents),
    }));
    const renderedTable = this.buildRenderedTable(config, rows);
    const payloadSnapshot = {
      versionNo: version.versionNo,
      generatedFor: { merchantId: context.merchantId },
      columns: config.columns,
      rows,
      renderedTable,
    };
    const uploaded = await this.uploadGeneratedBuffer(
      definition,
      buildSpreadsheetXml(renderedTable.headers, renderedTable.rows),
    );

    return this.deliveryPrisma.deliveryManifest.create({
      data: {
        id: await this.deliveryIdService.next('PSQD'),
        merchantId: context.merchantId,
        templateId: template.id,
        templateVersionId: version.id,
        type: definition.dbType,
        format: definition.format,
        status: DeliveryManifestStatus.GENERATED,
        title: `${context.merchantId}-finance-v${version.versionNo}`,
        fileUrl: uploaded.url,
        storageKey: uploaded.key,
        payloadSnapshot: payloadSnapshot as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    });
  }

  private async getTemplateAndVersion(definition: DeliveryManifestTemplateDefinition) {
    const template = await this.ensureTemplate(definition);
    const version = await this.getPublishedVersion(template.id);
    if (!version) {
      throw new NotFoundException('配送清单模板版本不存在');
    }
    const templateConfig = this.normalizeTemplateConfig(definition, template.config);
    const versionConfig = this.normalizeTemplateConfig(definition, version.config);
    return {
      template,
      version,
      config: {
        columns: versionConfig.columns,
        customizations: templateConfig.customizations,
      },
    };
  }

  private async ensureTemplate(definition: DeliveryManifestTemplateDefinition) {
    let template = await this.deliveryPrisma.deliveryManifestTemplate.findFirst({
      where: { type: definition.dbType, isDefault: true },
    });
    if (!template) {
      const defaultConfig = this.normalizeTemplateConfig(definition, null);
      template = await this.deliveryPrisma.deliveryManifestTemplate.create({
        data: {
          type: definition.dbType,
          name: definition.name,
          description: definition.description,
          config: defaultConfig as unknown as Prisma.InputJsonValue,
          isDefault: true,
          isActive: true,
        },
      });
      await this.deliveryPrisma.deliveryManifestVersion.create({
        data: {
          templateId: template.id,
          versionNo: 1,
          status: DeliveryManifestVersionStatus.PUBLISHED,
          config: defaultConfig as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return template;
  }

  private async getPublishedVersion(templateId: string) {
    return this.deliveryPrisma.deliveryManifestVersion.findFirst({
      where: { templateId, status: DeliveryManifestVersionStatus.PUBLISHED },
      orderBy: [{ versionNo: 'desc' }],
    });
  }

  private normalizeTemplateConfig(
    definition: DeliveryManifestTemplateDefinition,
    rawConfig: unknown,
  ): ManifestTemplateConfig {
    const sourceColumns = Array.isArray((rawConfig as { columns?: unknown[] } | null)?.columns)
      ? ((rawConfig as { columns: Array<Record<string, unknown>> }).columns ?? [])
      : [];
    const sourceMap = new Map(
      sourceColumns
        .filter((column) => column && typeof column === 'object' && typeof column.key === 'string')
        .map((column) => [String(column.key), column]),
    );

    return {
      columns: definition.columns
        .map((column) => {
          const source = sourceMap.get(column.key);
          return {
            ...column,
            label:
              typeof source?.label === 'string' && source.label.trim() ? source.label.trim() : column.label,
            sortOrder:
              typeof source?.sortOrder === 'number' && Number.isInteger(source.sortOrder)
                ? source.sortOrder
                : column.sortOrder,
            visible: column.fixed ? true : source?.visible === false ? false : column.visible,
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
      customizations: this.normalizeCustomizations(rawConfig),
    };
  }

  private normalizeCustomizations(
    rawConfig: unknown,
  ): ManifestTemplateConfig['customizations'] {
    const rawCustomizations = (rawConfig as { customizations?: unknown } | null)?.customizations;
    const normalized: ManifestTemplateConfig['customizations'] = {};

    for (const scope of ['order', 'subOrder'] as const) {
      const scopeValue =
        rawCustomizations &&
        typeof rawCustomizations === 'object' &&
        !Array.isArray(rawCustomizations)
          ? (rawCustomizations as Record<string, unknown>)[scope]
          : undefined;
      if (!scopeValue || typeof scopeValue !== 'object' || Array.isArray(scopeValue)) {
        continue;
      }

      const entries = Object.entries(scopeValue).reduce<Record<string, ManifestTargetCustomization>>(
        (map, [targetId, customization]) => {
          if (!customization || typeof customization !== 'object' || Array.isArray(customization)) {
            return map;
          }

          const rawEntries = Array.isArray((customization as { entries?: unknown[] }).entries)
            ? ((customization as { entries: unknown[] }).entries ?? [])
            : [];
          map[targetId] = {
            targetId,
            entries: rawEntries
              .filter((entry) => entry && typeof entry === 'object')
              .map((entry, index) => ({
                key: String((entry as Record<string, unknown>).key ?? ''),
                label: String((entry as Record<string, unknown>).label ?? ''),
                value: String((entry as Record<string, unknown>).value ?? ''),
                sortOrder:
                  typeof (entry as Record<string, unknown>).sortOrder === 'number'
                    ? Number((entry as Record<string, unknown>).sortOrder)
                    : 500 + index * 10,
                visible: (entry as Record<string, unknown>).visible !== false,
              }))
              .filter((entry) => entry.key && entry.label),
            updatedAt:
              typeof (customization as Record<string, unknown>).updatedAt === 'string'
                ? String((customization as Record<string, unknown>).updatedAt)
                : undefined,
            updatedByAdminId:
              typeof (customization as Record<string, unknown>).updatedByAdminId === 'string'
                ? String((customization as Record<string, unknown>).updatedByAdminId)
                : undefined,
          };
          return map;
        },
        {},
      );

      if (Object.keys(entries).length > 0) {
        normalized[scope] = entries;
      }
    }

    return normalized;
  }

  private serializeTemplateConfig(config: ManifestTemplateConfig) {
    return {
      columns: config.columns,
      ...(Object.keys(config.customizations).length > 0
        ? { customizations: config.customizations }
        : {}),
    };
  }

  private applyTargetCustomization(
    definition: DeliveryManifestTemplateDefinition,
    config: ManifestTemplateConfig,
    targetId: string,
    rows: Array<Record<string, unknown>>,
  ) {
    const scope = this.resolveCustomizationScope(definition);
    if (!scope) {
      return { config, rows };
    }

    const customization = config.customizations[scope]?.[targetId];
    if (!customization || customization.entries.length === 0) {
      return { config, rows };
    }

    const customColumns = customization.entries.map<DeliveryManifestColumnDefinition>((entry) => ({
      key: entry.key,
      label: entry.label,
      sortOrder: entry.sortOrder,
      visible: entry.visible,
      fixed: false,
    }));
    const mergedConfig: ManifestTemplateConfig = {
      columns: [...config.columns, ...customColumns].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
      ),
      customizations: config.customizations,
    };
    const customValues = Object.fromEntries(
      customization.entries.map((entry) => [entry.key, entry.value]),
    );

    return {
      config: mergedConfig,
      rows: rows.map((row) => ({
        ...row,
        ...customValues,
      })),
    };
  }

  private normalizeCustomizationEntries(
    definition: DeliveryManifestTemplateDefinition,
    entries: UpsertDeliveryManifestCustomizationDto['entries'],
  ): ManifestTargetCustomizationEntry[] {
    const normalizedKeys = new Set<string>();

    return entries.map((entry, index) => {
      const key = this.normalizeCustomFieldKey(entry.key ?? entry.label);
      if (!key) {
        throw new BadRequestException('自定义列 key 不能为空');
      }
      if (definition.columns.some((column) => column.key === key)) {
        throw new BadRequestException(`自定义列 key 与系统列冲突: ${key}`);
      }
      if (normalizedKeys.has(key)) {
        throw new BadRequestException(`自定义列 key 重复: ${key}`);
      }

      const label = entry.label.trim();
      this.assertCustomFieldAllowed(definition, key, label);
      normalizedKeys.add(key);

      return {
        key,
        label,
        value: entry.value.trim(),
        sortOrder: typeof entry.sortOrder === 'number' ? entry.sortOrder : 500 + index * 10,
        visible: entry.visible !== false,
      };
    });
  }

  private resolveCustomizationScope(definition: DeliveryManifestTemplateDefinition) {
    if (definition.apiType === 'BUYER_FULL') {
      return 'order' as const;
    }
    if (definition.apiType === 'SELLER_FULFILLMENT') {
      return 'subOrder' as const;
    }
    return null;
  }

  private normalizeCustomFieldKey(input: string) {
    return input
      .trim()
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }

  private assertCustomFieldAllowed(
    definition: DeliveryManifestTemplateDefinition,
    key: string,
    label: string,
  ) {
    if (definition.apiType !== 'SELLER_FULFILLMENT') {
      return;
    }

    const normalized = `${key}${label}`.toLowerCase().replace(/[\s_-]+/g, '');
    const blockedTerms = [
      'price',
      'cost',
      'amount',
      'fee',
      'markup',
      'shippingfee',
      '加价',
      '成本',
      '售价',
      '金额',
      '运费',
    ];
    if (blockedTerms.some((term) => normalized.includes(term))) {
      throw new BadRequestException('卖家配货清单禁止自定义金额相关字段');
    }
  }

  private buildRenderedTable(
    config: ManifestTemplateConfig,
    rows: Array<Record<string, unknown>>,
  ): ManifestRenderedTable {
    const visibleColumns = config.columns.filter((column) => column.visible);

    return {
      headers: visibleColumns.map((column) => column.label),
      rows: rows.map((row) =>
        visibleColumns.map((column) => String(row[column.key] ?? '')),
      ),
    };
  }

  private buildPdfLines(
    title: string,
    versionNo: number,
    renderedTable: ManifestRenderedTable,
  ) {
    return [
      title,
      `Template Version: v${versionNo}`,
      renderedTable.headers.join(' | '),
      ...renderedTable.rows.map((row) => row.join(' | ')),
    ];
  }

  private async uploadGeneratedBuffer(
    definition: DeliveryManifestTemplateDefinition,
    buffer: Buffer,
  ) {
    const folder = `delivery/manifests/${definition.storageSlug}`;
    if (!folder.startsWith('delivery/')) {
      throw new BadRequestException('配送清单上传路径必须位于 delivery/ 前缀下');
    }
    return this.uploadService.uploadBuffer(buffer, folder, definition.extension, definition.mimeType);
  }

  private mapManifestRow(row: any) {
    const definition = findManifestDefinitionByDbType(row.type as DeliveryManifestTemplateType);
    const payloadSnapshot = row.payloadSnapshot ?? {};
    const versionNo =
      typeof payloadSnapshot?.versionNo === 'number' && Number.isFinite(payloadSnapshot.versionNo)
        ? payloadSnapshot.versionNo
        : null;

    return {
      id: row.id,
      type: definition?.apiType ?? row.type,
      format: row.format,
      title: row.title,
      fileUrl: row.fileUrl,
      storageKey: row.storageKey,
      status: row.status,
      generatedAt: row.generatedAt,
      payloadSnapshot,
      templateVersion: {
        id: row.templateVersionId ?? null,
        versionNo,
      },
    };
  }

  private money(cents: number) {
    return (Math.max(0, cents) / 100).toFixed(2);
  }

  private formatDate(date: Date | null | undefined) {
    return date ? date.toISOString() : '';
  }
}
