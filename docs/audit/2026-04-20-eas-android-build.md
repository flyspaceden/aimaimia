# EAS Android 打包可行性独立审查

## 审查目标

让以下命令在 **EAS 云端** 一次跑通，产出可安装的 Release APK，无需再次重跑：

```bash
eas build --profile preview --platform android
```

具体意味着：
- `expo prebuild` 能成功生成 `android/` 目录
- Gradle autolinking 能把 `react-native-wechat-lib` 识别为子项目
- `:app:compileReleaseJavaWithJavac` 能找到 `com.theweflex.react.WeChatModule` 类
- 最终输出 APK，微信登录、支付宝支付等原生功能可用

## 背景

本次改动的目的是在 Expo SDK 54 + React Native 0.81 + AGP 8 环境下，让老旧但合规通过的 `react-native-wechat-lib@1.1.27` 正确链接到 Android 构建。过去 3 次 EAS 云端构建均在 `WXEntryActivity.java` 编译阶段失败，报 `package com.theweflex.react does not exist`，已消耗 6 次免费配额。本地已声称修复，但需独立复核，避免第 4 次失败。

## 审查范围（需要读的文件）

### 构建配置
- `app.json` — Expo 配置，特别是 `plugins` 数组、`android.package`、`android.intentFilters`
- `eas.json` — EAS 构建 profile 定义（关注 `preview` profile）
- `package.json` — 依赖版本、脚本、postinstall
- `babel.config.js` — Babel 配置（如有）

### WeChat 集成核心
- `plugins/withWechat.js` — 自定义 Expo Config Plugin（决定性文件）
- `patches/react-native-wechat-lib+1.1.27.patch` — patch-package 的补丁文件
- `node_modules/react-native-wechat-lib/package.json` — 三方库原始元信息
- `node_modules/react-native-wechat-lib/android/build.gradle` — 可能被 plugin 运行时改写
- `node_modules/react-native-wechat-lib/android/src/main/AndroidManifest.xml` — 可能被 plugin 运行时改写
- `node_modules/react-native-wechat-lib/react-native.config.js` — 可能被 plugin 运行时创建

### App 运行时接入
- `src/services/wechat.ts` — JS 层的微信 SDK 封装
- `app/_layout.tsx` — 启动时微信初始化 + Deferred Deep Link
- `app/me/referral.tsx`、`app/me/vip.tsx` 等调用微信登录/分享的页面（按需）

### 根目录配置（之前是 bug 源头，现已删除）
- `react-native.config.js`（**已从仓库删除**，需确认真的没了）

### autolinking 机制参考（只读不改）
- `node_modules/expo-modules-autolinking/build/reactNativeConfig/reactNativeConfig.js`
- `node_modules/expo-modules-autolinking/build/reactNativeConfig/androidResolver.js`
- `node_modules/expo-modules-autolinking/build/reactNativeConfig/config.js`

### 参考其他已成功链接的同类库（对比基线）
- `node_modules/@uiw/react-native-alipay/` — 支付宝 SDK，构建一直通过
- `node_modules/react-native-safe-area-context/react-native.config.js` — 标准格式参考

## 近期相关 commit

```
1b87063 fix(wechat): 删除根目录 react-native.config.js
af05d5e fix(wechat): Expo config plugin 兜底 wechat-lib 原生修复
9ae4758 fix(wechat): patch-package 修复 react-native-wechat-lib autolinking
```

用 `git show <hash>` 可以看到每次改动的完整 diff。

## 交付要求

给出一份结构化结论，覆盖以下三类：

1. **阻塞性问题（Blocker）**：如果不改，EAS 构建必挂。说明问题、影响、修复方向。
2. **高风险隐患（Warning）**：本次能过，但后续某些场景（iOS、OTA 更新、版本升级）会爆炸。
3. **可以放心的部分（OK）**：哪些改动是合理的、与上游模式一致的。

审查时可以自行选择工具、策略、深度。本次主要关注 Android 构建路径；iOS 微信集成因 Apple Developer 账号未就绪，不在本次范围。
