export type MiniAppEnv = 'development' | 'staging' | 'production';

type EnvironmentConfig = {
  apiBaseUrl: string;
  wsBaseUrl: string;
  useMock: boolean;
};

export const environmentConfigs: Record<MiniAppEnv, EnvironmentConfig> = {
  development: {
    apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
    wsBaseUrl: 'ws://127.0.0.1:3000',
    useMock: true,
  },
  staging: {
    apiBaseUrl: 'https://test-api.ai-maimai.com/api/v1',
    wsBaseUrl: 'wss://test-api.ai-maimai.com',
    useMock: false,
  },
  production: {
    apiBaseUrl: 'https://api.ai-maimai.com/api/v1',
    wsBaseUrl: 'wss://api.ai-maimai.com',
    useMock: false,
  },
};

export function resolveEnvironment(value: string | undefined): MiniAppEnv {
  if (value == null || value === '' || value === 'development') return 'development';
  if (value === 'staging' || value === 'production') return value;
  throw new Error(`不支持的 TARO_APP_ENV: ${value}`);
}

export function validateReleaseEnvironment(
  env: MiniAppEnv,
  config: EnvironmentConfig,
): EnvironmentConfig {
  if (env === 'development') return config;

  const expected = environmentConfigs[env];
  if (config.useMock) {
    throw new Error(`${env} 构建禁止启用 Mock`);
  }
  if (config.apiBaseUrl !== expected.apiBaseUrl) {
    throw new Error(`${env} 构建的 API 域名必须为 ${expected.apiBaseUrl}`);
  }
  if (config.wsBaseUrl !== expected.wsBaseUrl) {
    throw new Error(`${env} 构建的 WebSocket 域名必须为 ${expected.wsBaseUrl}`);
  }
  if (!config.apiBaseUrl.startsWith('https://') || !config.wsBaseUrl.startsWith('wss://')) {
    throw new Error(`${env} 构建必须使用 HTTPS/WSS`);
  }

  return config;
}
