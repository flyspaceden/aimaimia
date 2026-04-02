const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 优先解析 .js（CJS）而非 .mjs（ESM），避免 zustand v5 的 import.meta 在 web 端报错
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // zustand ESM 文件含 import.meta.env，浏览器以 <script> 加载时不支持
  // 强制使用 react-native / CJS 入口
  if (moduleName.startsWith('zustand')) {
    const newContext = { ...context, unstable_conditionNames: ['react-native', 'default'] };
    return newContext.resolveRequest(newContext, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
