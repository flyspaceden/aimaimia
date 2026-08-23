import { describe, expect, it } from 'vitest';
import type { Company } from '@/types';
import { cleanupCompanyVoiceQuery, searchCompanies } from './search-utils';

const company = (input: Partial<Company> & Pick<Company, 'id' | 'name'>): Company => ({
  cover: '', mainBusiness: '', location: '', distanceKm: 0, badges: [], ...input,
});

describe('miniapp company search parity', () => {
  it('removes conversational words from a voice company query', () => {
    expect(cleanupCompanyVoiceQuery('帮我找一下附近有哪些蓝莓农场')).toBe('蓝莓');
  });

  it('uses structured fields instead of only matching the display name', () => {
    const results = searchCompanies([
      company({ id: '1', name: '山海源', mainBusiness: '蓝莓种植', location: '山东青岛', companyType: 'farm', industryTags: ['有机种植'], certifications: ['有机认证'] }),
      company({ id: '2', name: '田园店', mainBusiness: '粮油零售', location: '北京', companyType: 'store' }),
    ], {
      query: '', submitted: true, industryHint: '有机种植', location: '山东',
      companyType: 'farm', featureTags: ['有机认证'], fromVoice: true,
    });
    expect(results.map((item) => item.id)).toEqual(['1']);
  });
});
