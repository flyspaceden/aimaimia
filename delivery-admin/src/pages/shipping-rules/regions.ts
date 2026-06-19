export type ShippingRegionOption = {
  label: string;
  value: string;
};

export const SHIPPING_REGION_OPTIONS: ShippingRegionOption[] = [
  { label: '北京市', value: '11' },
  { label: '天津市', value: '12' },
  { label: '河北省', value: '13' },
  { label: '山西省', value: '14' },
  { label: '内蒙古自治区', value: '15' },
  { label: '辽宁省', value: '21' },
  { label: '吉林省', value: '22' },
  { label: '黑龙江省', value: '23' },
  { label: '上海市', value: '31' },
  { label: '江苏省', value: '32' },
  { label: '浙江省', value: '33' },
  { label: '安徽省', value: '34' },
  { label: '福建省', value: '35' },
  { label: '江西省', value: '36' },
  { label: '山东省', value: '37' },
  { label: '河南省', value: '41' },
  { label: '湖北省', value: '42' },
  { label: '湖南省', value: '43' },
  { label: '广东省', value: '44' },
  { label: '广西壮族自治区', value: '45' },
  { label: '海南省', value: '46' },
  { label: '重庆市', value: '50' },
  { label: '四川省', value: '51' },
  { label: '贵州省', value: '52' },
  { label: '云南省', value: '53' },
  { label: '西藏自治区', value: '54' },
  { label: '陕西省', value: '61' },
  { label: '甘肃省', value: '62' },
  { label: '青海省', value: '63' },
  { label: '宁夏回族自治区', value: '64' },
  { label: '新疆维吾尔自治区', value: '65' },
];

const REGION_LABEL_MAP = SHIPPING_REGION_OPTIONS.reduce<Record<string, string>>((map, option) => {
  map[option.value] = option.label;
  return map;
}, {});

const KNOWN_REGION_PREFIXES = new Set(SHIPPING_REGION_OPTIONS.map((option) => option.value));

const toAdministrativeProvincePrefix = (value: unknown, options?: { allowProvinceFullCode?: boolean }): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (KNOWN_REGION_PREFIXES.has(raw)) return raw;
  if (options?.allowProvinceFullCode && /^\d{6}$/.test(raw) && raw.endsWith('0000')) {
    const prefix = raw.slice(0, 2);
    return KNOWN_REGION_PREFIXES.has(prefix) ? prefix : null;
  }
  return null;
};

export const normalizeRuleRegionCodesForForm = (regionCodes?: string[] | null): string[] => {
  const normalized: string[] = [];
  for (const code of regionCodes ?? []) {
    const prefix = toAdministrativeProvincePrefix(code, { allowProvinceFullCode: true });
    if (prefix && !normalized.includes(prefix)) {
      normalized.push(prefix);
    }
  }
  return normalized;
};

export const normalizeSelectedRegionCodes = (regionCodes?: string[] | null): string[] =>
  (regionCodes ?? []).reduce<string[]>((result, value) => {
    const raw = String(value ?? '').trim();
    if (KNOWN_REGION_PREFIXES.has(raw) && !result.includes(raw)) {
      result.push(raw);
    }
    return result;
  }, []);

export const formatRuleRegionCode = (regionCode?: string | null): string => {
  const prefix = toAdministrativeProvincePrefix(regionCode, { allowProvinceFullCode: true });
  return prefix ? REGION_LABEL_MAP[prefix] : String(regionCode ?? '');
};

export const formatRuleRegionCodes = (regionCodes: string[]): string => {
  if (regionCodes.length === 0) return '全国';
  const labels = regionCodes.map((code) => {
    const prefix = toAdministrativeProvincePrefix(code, { allowProvinceFullCode: true });
    return prefix ? REGION_LABEL_MAP[prefix] : `未知地区：${String(code ?? '').trim()}`;
  });
  return [...new Set(labels)].join(', ');
};
