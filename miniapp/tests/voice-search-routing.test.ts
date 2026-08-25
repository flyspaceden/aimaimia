import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeRouteCsv, decodeRouteText } from '@/packages/commerce/catalog-search/route-utils';

describe('voice search route presentation', () => {
  it('decodes a Taro route query exactly once before showing and searching it', () => {
    expect(decodeRouteText('%E6%B0%B4%E4%BA%A7')).toBe('水产');
    expect(decodeRouteText('水产')).toBe('水产');
    expect(decodeRouteText('%E6%B0%B4%E4%BA%A7%2520')).toBe('水产%20');
    expect(decodeRouteText('  99%鲜活  ')).toBe('99%鲜活');
  });

  it('decodes encoded semantic CSV values before splitting and deduplicating them', () => {
    expect(decodeRouteCsv('%E6%96%B0%E9%B2%9C%2C%E6%B5%B7%E9%B2%9C%2C%E6%96%B0%E9%B2%9C'))
      .toEqual(['新鲜', '海鲜']);
  });

  it('shows the recognized transcript without the redundant “我听到” prefix', () => {
    const source = fs.readFileSync(path.resolve('src/pages/home/index.tsx'), 'utf8');
    expect(source).not.toContain('我听到');
    expect(source).toContain("<Text className='home-ai-result__heard'>{voiceIntent.transcript}</Text>");
  });
});
