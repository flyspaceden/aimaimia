/**
 * Expo Config Plugin for react-native-wechat-lib (Android only for now)
 *
 * 做三件事：
 *   1. 在 android/app/src/main/java/<package>/wxapi/ 下生成 WXEntryActivity.java
 *   2. 在 AndroidManifest.xml 注册 WXEntryActivity
 *   3. 在 AndroidManifest.xml 加 <queries><package android:name="com.tencent.mm"/></queries>
 *      （Android 11+ 需要声明查询的包才能 isWXAppInstalled 判断）
 *
 * iOS 部分待 Apple Developer 账号（U06）就绪后再补，届时需处理 Info.plist 的
 * LSApplicationQueriesSchemes / CFBundleURLTypes + AppDelegate 的 continueUserActivity / openURL。
 */

const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * react-native-wechat-lib 1.1.27 原生修复：
 * 直接在 prebuild 阶段改写 node_modules 里的文件，不依赖 patch-package
 * （EAS 云端 postinstall 未必触发，改成 config plugin 执行更稳妥）
 *
 * 修三处：
 *   - 新增 react-native.config.js（autolinking 发现入口）
 *   - 重写 android/build.gradle（AGP 8+ namespace、compileSdk 34、mavenCentral）
 *   - 移除 AndroidManifest.xml 里已废弃的 package= 属性
 */
function withWechatLibNativeFixes(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const libRoot = path.join(
        cfg.modRequest.projectRoot,
        'node_modules/react-native-wechat-lib',
      );
      if (!fs.existsSync(libRoot)) {
        // 包没装就跳过（不阻塞其他 prebuild 流程）
        return cfg;
      }

      // 1. react-native.config.js
      const rnConfigContent = `module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: 'import com.theweflex.react.WeChatPackage;',
        packageInstance: 'new WeChatPackage()',
      },
      ios: null,
    },
  },
};
`;
      fs.writeFileSync(path.join(libRoot, 'react-native.config.js'), rnConfigContent);

      // 2. android/build.gradle
      const gradleContent = `apply plugin: 'com.android.library'

def safeExtGet(prop, fallback) {
  rootProject.ext.has(prop) ? rootProject.ext.get(prop) : fallback
}

android {
  namespace 'com.theweflex.react'
  compileSdkVersion safeExtGet('compileSdkVersion', 34)
  buildToolsVersion safeExtGet('buildToolsVersion', '34.0.0')

  defaultConfig {
    minSdkVersion safeExtGet('minSdkVersion', 24)
    targetSdkVersion safeExtGet('targetSdkVersion', 34)
    versionCode 1
    versionName "1.0"
  }
}

repositories {
  mavenCentral()
  google()
}

dependencies {
  implementation 'com.facebook.react:react-native:+'
  // api（非 implementation）：libammsdk 里的 IWXAPIEventHandler 等接口是 WeChatModule/Package
  // 的 public API 的一部分（WeChatModule implements IWXAPIEventHandler），消费者 :app 在
  // 编译 WXEntryActivity.java 时也需要能解析到它，必须用 api 传递
  api files('libs/libammsdk.jar')
}
`;
      fs.writeFileSync(path.join(libRoot, 'android/build.gradle'), gradleContent);

      // 3. android/src/main/AndroidManifest.xml
      // 去掉原库带的 READ_PHONE_STATE（dangerous 权限，合规审查会被标）和
      // WRITE_EXTERNAL_STORAGE（Android 10+ 废弃）。实测 wechat-lib 1.1.27 Java 代码
      // 未调用 TelephonyManager.getDeviceId() 等需要这两个权限的 API
      const manifestContent = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>
</manifest>
`;
      fs.writeFileSync(
        path.join(libRoot, 'android/src/main/AndroidManifest.xml'),
        manifestContent,
      );

      return cfg;
    },
  ]);
}

function withWechatEntryActivity(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const androidPackage = cfg.android?.package || 'com.aimaimai.shop';
      const packagePath = androidPackage.replace(/\./g, '/');
      const wxapiDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java',
        packagePath,
        'wxapi',
      );
      fs.mkdirSync(wxapiDir, { recursive: true });

      // WXEntryActivity：微信回调会跳到这个 Activity，调库里的 WeChatModule.handleIntent 把 intent 丢给 JS 层
      const wxEntryCode = `package ${androidPackage}.wxapi;

import android.app.Activity;
import android.os.Bundle;
import com.theweflex.react.WeChatModule;

public class WXEntryActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WeChatModule.handleIntent(getIntent());
    finish();
  }
}
`;
      fs.writeFileSync(path.join(wxapiDir, 'WXEntryActivity.java'), wxEntryCode);

      return cfg;
    },
  ]);
}

function withWechatAndroidManifest(config) {
  return withAndroidManifest(config, async (cfg) => {
    const manifest = cfg.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    // 1. 注册 WXEntryActivity
    if (!application.activity) application.activity = [];
    const alreadyExists = application.activity.some(
      (a) => a.$?.['android:name'] === '.wxapi.WXEntryActivity',
    );
    if (!alreadyExists) {
      application.activity.push({
        $: {
          'android:name': '.wxapi.WXEntryActivity',
          'android:label': '@string/app_name',
          'android:exported': 'true',
          'android:launchMode': 'singleTask',
          'android:taskAffinity': cfg.android?.package || 'com.aimaimai.shop',
        },
      });
    }

    // 2. <queries><package android:name="com.tencent.mm"/></queries>（Android 11+ 必需）
    if (!manifest.manifest.queries) {
      manifest.manifest.queries = [{ package: [] }];
    }
    const queries = manifest.manifest.queries[0];
    if (!queries.package) queries.package = [];
    const wechatAlreadyQueried = queries.package.some(
      (p) => p.$?.['android:name'] === 'com.tencent.mm',
    );
    if (!wechatAlreadyQueried) {
      queries.package.push({ $: { 'android:name': 'com.tencent.mm' } });
    }

    return cfg;
  });
}

module.exports = function withWechat(config) {
  // 先改 node_modules 里的原生文件，保证 autolinking 能发现这个包
  config = withWechatLibNativeFixes(config);
  // 再生成 WXEntryActivity + AndroidManifest 修改
  config = withWechatEntryActivity(config);
  config = withWechatAndroidManifest(config);
  return config;
};
