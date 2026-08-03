import { BadRequestException } from '@nestjs/common';

export const SF_EXPRESS_PRODUCTS_CONFIG_KEY = 'SF_EXPRESS_PRODUCTS';

export type DeliverySfExpressProduct = {
  expressTypeId: number;
  name: string;
  enabled: boolean;
};

export const DEFAULT_SF_EXPRESS_PRODUCTS: DeliverySfExpressProduct[] = [
  {
    expressTypeId: 1,
    name: '顺丰标快',
    enabled: true,
  },
];

export function parseSfExpressProducts(raw: unknown): DeliverySfExpressProduct[] {
  const source = unwrapProducts(raw);
  if (!Array.isArray(source)) {
    return DEFAULT_SF_EXPRESS_PRODUCTS;
  }

  const normalized = source.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const expressTypeId = Number(record.expressTypeId);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!Number.isSafeInteger(expressTypeId) || expressTypeId <= 0 || !name) {
      return [];
    }
    return [{ expressTypeId, name, enabled: record.enabled === true }];
  });

  const unique = new Map<number, DeliverySfExpressProduct>();
  for (const product of normalized) {
    if (!unique.has(product.expressTypeId)) {
      unique.set(product.expressTypeId, product);
    }
  }
  return unique.size > 0 ? Array.from(unique.values()) : DEFAULT_SF_EXPRESS_PRODUCTS;
}

export function validateSfExpressProducts(raw: unknown): DeliverySfExpressProduct[] {
  const source = unwrapProducts(raw);
  if (!Array.isArray(source) || source.length < 1 || source.length > 20) {
    throw new BadRequestException('顺丰产品配置必须包含 1 到 20 个产品');
  }

  const products = source.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException(`第 ${index + 1} 个顺丰产品配置格式无效`);
    }
    const record = item as Record<string, unknown>;
    const expressTypeId = Number(record.expressTypeId);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!Number.isSafeInteger(expressTypeId) || expressTypeId <= 0) {
      throw new BadRequestException(`第 ${index + 1} 个顺丰产品代码必须是正整数`);
    }
    if (!name || name.length > 30) {
      throw new BadRequestException(`第 ${index + 1} 个顺丰产品名称长度必须为 1 到 30 个字符`);
    }
    if (typeof record.enabled !== 'boolean') {
      throw new BadRequestException(`第 ${index + 1} 个顺丰产品必须明确是否启用`);
    }
    return { expressTypeId, name, enabled: record.enabled };
  });

  if (new Set(products.map((item) => item.expressTypeId)).size !== products.length) {
    throw new BadRequestException('顺丰产品代码不能重复');
  }
  if (!products.some((item) => item.enabled)) {
    throw new BadRequestException('至少启用一个顺丰产品');
  }
  return products;
}

function unwrapProducts(raw: unknown) {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Array.isArray((raw as { products?: unknown }).products)
  ) {
    return (raw as { products: unknown[] }).products;
  }
  return raw;
}
