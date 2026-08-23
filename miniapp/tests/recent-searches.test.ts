import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecentSearch, clearRecentSearches, loadRecentSearches } from '@/components/recent-searches';

const storage = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  },
}));

describe('recent searches', () => {
  beforeEach(() => storage.clear());

  it('normalizes, deduplicates and limits recent terms', () => {
    for (let index = 0; index < 10; index += 1) addRecentSearch(` 商品 ${index} `);
    expect(loadRecentSearches()).toEqual([
      '商品 9', '商品 8', '商品 7', '商品 6',
      '商品 5', '商品 4', '商品 3', '商品 2',
    ]);

    addRecentSearch('商品 5');
    expect(loadRecentSearches()[0]).toBe('商品 5');
    expect(loadRecentSearches().filter((item) => item === '商品 5')).toHaveLength(1);
  });

  it('clears all recent terms without storing blank input', () => {
    addRecentSearch('大闸蟹');
    addRecentSearch('   ');
    expect(loadRecentSearches()).toEqual(['大闸蟹']);
    clearRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
  });
});
