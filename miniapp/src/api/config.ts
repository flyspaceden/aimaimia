export type AppEnv = 'development' | 'staging' | 'production';

export const APP_ENV = (process.env.TARO_APP_ENV || 'development') as AppEnv;
export const API_BASE_URL = process.env.TARO_APP_API_BASE_URL || 'http://127.0.0.1:3000/api/v1';
export const WS_BASE_URL = process.env.TARO_APP_WS_BASE_URL || 'ws://127.0.0.1:3000';
export const USE_MOCK = process.env.TARO_APP_USE_MOCK === 'true';
