import { BadRequestException } from '@nestjs/common';

export type DigitalAssetModuleKey = 'assetValue' | 'level' | 'benefits' | 'futureRights';
type LegacyDigitalAssetModuleKey = 'equity';

export type DigitalAssetModuleSetting = {
  key: DigitalAssetModuleKey;
  title: string;
  enabled: boolean;
  description: string;
};

const LEGACY_FUTURE_RIGHTS_KEY: LegacyDigitalAssetModuleKey = 'equity';
const ALLOWED_SETTING_FIELDS = new Set(['key', 'title', 'enabled', 'description']);
const RISKY_FUTURE_MODULE_COPY_PATTERN = /现金|兑换|定期|收益|利息|股权|期权|工资|cash|interest|equity|return/i;

export const DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS: DigitalAssetModuleSetting[] = [
  { key: 'assetValue', title: '未来权益模块', enabled: false, description: '规则待开放' },
  { key: 'level', title: '权益规则待开放', enabled: false, description: '规则待开放' },
  { key: 'benefits', title: '未来权益模块', enabled: false, description: '规则待开放' },
  { key: 'futureRights', title: '未来权益模块', enabled: false, description: '规则待开放' },
];

function normalizeFutureModuleCopy(value: unknown, fallback: string): string {
  const text = typeof value === 'string' && value.trim() ? value : fallback;
  return RISKY_FUTURE_MODULE_COPY_PATTERN.test(text) ? fallback : text;
}

function canonicalizeModuleKey(
  rawKey: unknown,
  allowLegacyKey: boolean,
): DigitalAssetModuleKey | null {
  if (typeof rawKey !== 'string') return null;
  if (DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS.some((item) => item.key === rawKey)) {
    return rawKey as DigitalAssetModuleKey;
  }
  if (allowLegacyKey && rawKey === LEGACY_FUTURE_RIGHTS_KEY) {
    return 'futureRights';
  }
  return null;
}

export function normalizeDigitalAssetModuleSettings(
  modules: any[],
  options?: { allowLegacyKey?: boolean },
): DigitalAssetModuleSetting[] {
  if (!Array.isArray(modules)) throw new BadRequestException('modules 必须是数组');

  const allowLegacyKey = options?.allowLegacyKey === true;
  const defaults = new Map(DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS.map((item) => [item.key, item]));
  const order: DigitalAssetModuleKey[] = [];
  const normalizedByKey = new Map<
    DigitalAssetModuleKey,
    { module: DigitalAssetModuleSetting; source: 'canonical' | 'legacy' }
  >();

  for (const item of modules) {
    const extraFields = Object.keys(item ?? {}).filter((key) => !ALLOWED_SETTING_FIELDS.has(key));
    if (extraFields.length > 0) {
      throw new BadRequestException(`数字资产规则字段尚未开放: ${extraFields.join(', ')}`);
    }

    const key = canonicalizeModuleKey(item?.key, allowLegacyKey);
    if (!key) throw new BadRequestException(`未知数字资产模块: ${item?.key ?? ''}`);

    const fallback = defaults.get(key)!;
    const source = item?.key === LEGACY_FUTURE_RIGHTS_KEY ? 'legacy' : 'canonical';
    const existing = normalizedByKey.get(key);

    if (existing) {
      if (existing.source === 'legacy' && source === 'canonical') {
        normalizedByKey.set(key, {
          module: {
            key,
            title: normalizeFutureModuleCopy(item?.title, fallback.title),
            enabled: item?.enabled ?? fallback.enabled,
            description: normalizeFutureModuleCopy(item?.description, fallback.description),
          },
          source,
        });
        continue;
      }
      if (existing.source === 'canonical' && source === 'legacy') {
        continue;
      }
      throw new BadRequestException(`重复数字资产模块: ${key}`);
    }

    order.push(key);
    normalizedByKey.set(key, {
      module: {
        key,
        title: normalizeFutureModuleCopy(item?.title, fallback.title),
        enabled: item?.enabled ?? fallback.enabled,
        description: normalizeFutureModuleCopy(item?.description, fallback.description),
      },
      source,
    });
  }

  return order.map((key) => normalizedByKey.get(key)!.module);
}
