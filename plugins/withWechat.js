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
  config = withWechatEntryActivity(config);
  config = withWechatAndroidManifest(config);
  return config;
};
