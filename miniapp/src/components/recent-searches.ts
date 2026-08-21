import Taro from '@tarojs/taro';

const STORAGE_KEY = `aimai-miniapp-recent-searches-v1:${process.env.TARO_APP_ENV || 'development'}`;
const LIMIT = 8;

export function loadRecentSearches(): string[] {
  const value = Taro.getStorageSync<unknown>(STORAGE_KEY);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 64))
    .filter(Boolean)
    .slice(0, LIMIT);
}

export function addRecentSearch(value: string): string[] {
  const normalized = value.trim().slice(0, 64);
  if (!normalized) return loadRecentSearches();
  const next = [normalized, ...loadRecentSearches().filter((item) => item !== normalized)].slice(0, LIMIT);
  Taro.setStorageSync(STORAGE_KEY, next);
  return next;
}

export function clearRecentSearches(): void {
  Taro.removeStorageSync(STORAGE_KEY);
}
