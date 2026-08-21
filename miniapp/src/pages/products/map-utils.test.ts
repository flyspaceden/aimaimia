import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Company } from '@/types';
import { buildCompanyMapData, findCompanyByMarkerId } from './map-utils';

const company = (id: string, coordinates?: { lat: number; lng: number }): Company => ({
  id,
  name: `企业${id}`,
  cover: '',
  mainBusiness: '农产品',
  location: '杭州',
  coordinates,
  distanceKm: 0,
  badges: [],
});

describe('company map data', () => {
  it('uses exact server coordinates and never invents points for missing or invalid data', () => {
    const source = [
      company('valid', { lat: 30.2741, lng: 120.1551 }),
      company('missing'),
      company('bad-lat', { lat: 91, lng: 120 }),
      company('bad-lng', { lat: 30, lng: 181 }),
    ];
    const result = buildCompanyMapData(source, '/marker.png');

    expect(result.entries.map(({ company: item }) => item.id)).toEqual(['valid']);
    expect(result.markers[0]).toMatchObject({ latitude: 30.2741, longitude: 120.1551 });
    expect(result.center).toEqual({ latitude: 30.2741, longitude: 120.1551 });
  });

  it('derives the viewport center only from published company points', () => {
    const result = buildCompanyMapData([
      company('one', { lat: 30, lng: 120 }),
      company('two', { lat: 32, lng: 124 }),
    ], '/marker.png');

    expect(result.center).toEqual({ latitude: 31, longitude: 122 });
    expect(result.includePoints).toEqual([
      { latitude: 30, longitude: 120 },
      { latitude: 32, longitude: 124 },
    ]);
  });

  it('resolves marker taps without exposing company ids as numeric native marker ids', () => {
    const data = buildCompanyMapData([
      company('cuid-one', { lat: 30, lng: 120 }),
      company('cuid-two', { lat: 31, lng: 121 }),
    ], '/marker.png', 'cuid-two');

    expect(data.markers.map((marker) => marker.id)).toEqual([1, 2]);
    expect(data.markers[1]).toMatchObject({ width: 42, height: 42, zIndex: 2 });
    expect(findCompanyByMarkerId(data.entries, '2')?.id).toBe('cuid-two');
    expect(findCompanyByMarkerId(data.entries, 'not-a-marker')).toBeUndefined();
  });

  it('returns an explicit empty map model when no company has usable coordinates', () => {
    const result = buildCompanyMapData([company('missing')], '/marker.png');
    expect(result).toEqual({ center: null, entries: [], includePoints: [], markers: [] });
  });

  it('keeps map display independent from WeChat user-location permission', () => {
    const pageSource = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
    expect(pageSource).toContain('showLocation={false}');
    expect(pageSource).toContain('不读取你的实时位置');
    expect(pageSource).not.toMatch(/getLocation|chooseLocation|openLocation|startLocationUpdate/);
  });
});
