/**
 * API 模式切换
 *
 * - 默认 USE_MOCK=true，走前端 Mock 数据
 * - 设置 EXPO_PUBLIC_USE_MOCK=false 时走真实后端 API
 * - 生产构建时如果未显式关闭 Mock，控制台会输出警告
 */
export const USE_MOCK = process.env.EXPO_PUBLIC_USE_MOCK !== 'false';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000/api/v1';

// 当前构建环境标记（由 eas.json 各 profile 注入）
// development = 开发机 / preview build / staging = 测试包（test-api.ai-maimai.com）
// production = 商店生产包（api.ai-maimai.com）
// 未注入时默认 development，避免开发机器误判为生产
export type AppEnv = 'development' | 'staging' | 'production';
export const APP_ENV: AppEnv =
  (process.env.EXPO_PUBLIC_ENV as AppEnv) || 'development';
export const IS_PRODUCTION = APP_ENV === 'production';

// 安全检查：非本地环境仍使用 Mock 时发出警告
if (USE_MOCK && API_BASE_URL && !API_BASE_URL.includes('localhost') && !API_BASE_URL.includes('127.0.0.1')) {
  console.warn(
    '[爱买买] ⚠️ API_BASE_URL 已配置为远程地址，但 USE_MOCK 仍为 true。' +
    '请设置 EXPO_PUBLIC_USE_MOCK=false 以启用真实 API。'
  );
}
