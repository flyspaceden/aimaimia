import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import path from 'node:path';
import { environmentConfigs, resolveEnvironment, validateReleaseEnvironment } from './env';

export default defineConfig(async () => {
  const appEnv = resolveEnvironment(process.env.TARO_APP_ENV);
  const defaults = environmentConfigs[appEnv];
  const apiBaseUrl = process.env.TARO_APP_API_BASE_URL || defaults.apiBaseUrl;
  const wsBaseUrl = process.env.TARO_APP_WS_BASE_URL || defaults.wsBaseUrl;
  const useMock = process.env.TARO_APP_USE_MOCK == null
    ? defaults.useMock
    : process.env.TARO_APP_USE_MOCK === 'true';
  validateReleaseEnvironment(appEnv, { apiBaseUrl, wsBaseUrl, useMock });

  const config: UserConfigExport = {
    projectName: 'aimai-miniapp',
    date: '2026-08-02',
    designWidth: 375,
    deviceRatio: {
      375: 2,
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'webpack5',
    plugins: ['@tarojs/plugin-framework-react', '@tarojs/plugin-platform-weapp'],
    defineConstants: {
      'process.env.TARO_APP_ENV': JSON.stringify(appEnv),
      'process.env.TARO_APP_API_BASE_URL': JSON.stringify(apiBaseUrl),
      'process.env.TARO_APP_WS_BASE_URL': JSON.stringify(wsBaseUrl),
      'process.env.TARO_APP_USE_MOCK': JSON.stringify(String(useMock)),
    },
    copy: {
      patterns: [
        {
          from: path.resolve(__dirname, '..', '..', 'assets', 'seafood'),
          to: path.resolve(__dirname, '..', 'dist', 'assets', 'seafood'),
        },
      ],
      options: {},
    },
    // Taro/webpack 的持久化缓存曾把新版推荐中心与旧版小程序码子组件
    // 混合进同一份 dist。开发态保留增量速度，staging/production 必须
    // 从源码完整生成，避免源码测试通过但真机仍运行旧组件。
    cache: { enable: appEnv === 'development' },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        url: { enable: true, config: { limit: 1024 } },
        cssModules: {
          enable: false,
          config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' },
        },
      },
      webpackChain(chain) {
        chain.resolve.alias.set('@', path.resolve(__dirname, '..', 'src'));
      },
    },
  };

  return config;
});
