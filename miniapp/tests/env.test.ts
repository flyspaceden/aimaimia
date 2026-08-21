import { describe, expect, it } from 'vitest';
import {
  environmentConfigs,
  resolveEnvironment,
  validateReleaseEnvironment,
} from '../config/env';

describe('miniapp environment configuration', () => {
  it('uses development only when the environment is omitted explicitly', () => {
    expect(resolveEnvironment(undefined)).toBe('development');
    expect(resolveEnvironment('development')).toBe('development');
    expect(() => resolveEnvironment('unexpected')).toThrow('不支持的 TARO_APP_ENV');
  });

  it('keeps staging and production on https/wss real APIs', () => {
    for (const env of ['staging', 'production'] as const) {
      expect(environmentConfigs[env].apiBaseUrl).toMatch(/^https:\/\//);
      expect(environmentConfigs[env].wsBaseUrl).toMatch(/^wss:\/\//);
      expect(environmentConfigs[env].useMock).toBe(false);
    }
  });

  it('fails closed when a release build enables mock or changes domains', () => {
    expect(() => validateReleaseEnvironment('production', {
      ...environmentConfigs.production,
      useMock: true,
    })).toThrow('禁止启用 Mock');
    expect(() => validateReleaseEnvironment('staging', {
      ...environmentConfigs.staging,
      apiBaseUrl: environmentConfigs.production.apiBaseUrl,
    })).toThrow('API 域名');
    expect(() => validateReleaseEnvironment('production', {
      ...environmentConfigs.production,
      wsBaseUrl: 'ws://api.ai-maimai.com',
    })).toThrow('WebSocket 域名');
  });
});
