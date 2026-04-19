/**
 * React Native CLI 配置
 *
 * 主要作用：对 autolinking 不完整的第三方包做显式声明，确保 MainApplication 能注册 package
 *
 * - react-native-wechat-lib 1.1.27 不带 autolinking 元信息（无 react-native.config.js
 *   也无 package.json 的 androidPackage 字段），在 RN 0.81 + Expo SDK 54 下可能被 skip，
 *   导致 NativeModules.WeChat 为 undefined、App 内微信登录不可用
 */

module.exports = {
  dependencies: {
    'react-native-wechat-lib': {
      platforms: {
        android: {
          sourceDir: './node_modules/react-native-wechat-lib/android',
          packageImportPath: 'import com.theweflex.react.WeChatPackage;',
          packageInstance: 'new WeChatPackage()',
        },
        // iOS 延后，待 Apple Developer 账号就绪后补 Pod + 初始化代码
        ios: null,
      },
    },
  },
};
