import type { Company } from '@/types';

export type CompanySearchFilters = {
  query: string;
  submitted: boolean;
  industryHint?: string;
  location?: string;
  companyType?: string;
  featureTags: string[];
  fromVoice?: boolean;
};

export function normalizeCompanySearchText(value: string): string {
  return value
    .toLocaleLowerCase('zh-CN')
    .replace(/[“”"'`]/g, '')
    .replace(/[，。！？,.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanupCompanyVoiceQuery(value: string): string {
  const compact = normalizeCompanySearchText(value).replace(/\s+/g, '');
  if (!compact) return '';
  return compact
    .replace(/^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:(?:打开|进入|去|逛逛|查看|看看|查|搜(?:索)?|找)(?:一下)?)+/u, '')
    .replace(/^(?:现在|目前|最近|这边|这里|附近)?(?:都)?(?:有哪(?:些|家)|有什?么|哪些|什么)/u, '')
    .replace(/(?:的)?(?:店铺|农场|商家|公司|企业|旗舰店)/gu, '')
    .replace(/(?:相关|列表|推荐)+$/u, '')
    .replace(/(?:吗|呢|啊|呀|吧|嘛|哦)+$/u, '')
    .trim();
}

function companyIndex(company: Company) {
  const normalizeMany = (values?: string[]) => (values || []).map(normalizeCompanySearchText).join(' ');
  const fields = {
    name: normalizeCompanySearchText(company.name || ''),
    shortName: normalizeCompanySearchText(company.shortName || ''),
    business: normalizeCompanySearchText(company.mainBusiness || ''),
    location: normalizeCompanySearchText([
      company.location, company.address?.province, company.address?.city,
      company.address?.district, company.address?.detail, company.address?.text,
    ].filter(Boolean).join(' ')),
    type: normalizeCompanySearchText(company.companyType || ''),
    industries: normalizeMany(company.industryTags),
    features: normalizeMany([...(company.productFeatures || []), ...(company.certifications || []), ...(company.badges || [])]),
    products: normalizeMany(company.productKeywords),
    description: normalizeCompanySearchText(company.description || ''),
  };
  return { ...fields, all: Object.values(fields).join(' ') };
}

const TYPE_KEYWORDS: Record<string, string[]> = {
  farm: ['农场'], company: ['公司', '企业', '商家'], cooperative: ['合作社'],
  base: ['基地'], factory: ['工厂', '加工厂'], store: ['店铺', '门店'],
};

export function scoreCompany(company: Company, filters: CompanySearchFilters): number | null {
  const index = companyIndex(company);
  const rawQuery = filters.fromVoice ? cleanupCompanyVoiceQuery(filters.query) || filters.query : filters.query;
  const tokens = normalizeCompanySearchText(rawQuery).split(/[\s,，、/]+/).filter(Boolean);
  let score = 0;
  if (filters.submitted && tokens.length) {
    let matched = false;
    tokens.forEach((token) => {
      if (index.name === token || index.shortName === token) { score += 180; matched = true; }
      else if (index.name.includes(token) || index.shortName.includes(token)) { score += 130; matched = true; }
      else if (index.business.includes(token)) { score += 95; matched = true; }
      else if (index.location.includes(token)) { score += 85; matched = true; }
      else if (index.all.includes(token)) { score += 55; matched = true; }
    });
    if (!matched) return null;
  }
  if (filters.industryHint) {
    const value = normalizeCompanySearchText(filters.industryHint);
    if (index.industries.includes(value)) score += 160;
    else if (index.business.includes(value)) score += 140;
    else if (index.all.includes(value)) score += 90;
    else return null;
  }
  if (filters.location) {
    const value = normalizeCompanySearchText(filters.location);
    if (index.location.includes(value)) score += 140;
    else if (index.all.includes(value)) score += 70;
    else return null;
  }
  if (filters.companyType) {
    const value = normalizeCompanySearchText(filters.companyType);
    if (index.type === value) score += 100;
    else if ((TYPE_KEYWORDS[filters.companyType] || [filters.companyType]).some((keyword) => index.all.includes(normalizeCompanySearchText(keyword)))) score += 85;
    else return null;
  }
  for (const feature of filters.featureTags) {
    const value = normalizeCompanySearchText(feature);
    if (index.features.includes(value)) score += 60;
    else if (index.all.includes(value)) score += 50;
    else return null;
  }
  return score + Math.max(0, 20 - Math.min(company.distanceKm || 0, 20));
}

export function searchCompanies(companies: Company[], filters: CompanySearchFilters): Company[] {
  return companies
    .map((company) => ({ company, score: scoreCompany(company, filters) }))
    .filter((item): item is { company: Company; score: number } => item.score !== null)
    .sort((left, right) => right.score - left.score || (left.company.distanceKm || 0) - (right.company.distanceKm || 0))
    .map((item) => item.company);
}
