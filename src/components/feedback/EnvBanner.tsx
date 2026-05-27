import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { APP_ENV, API_BASE_URL, IS_PRODUCTION } from '../../repos/http/config';

// 非生产环境顶部红条，让测试人员一眼分得清自己装的是哪个版本，
// 避免拿测试 build 当生产 build 反馈 bug。
// 生产 build 不渲染。
// 故意不消耗 safe area top inset，避免和 Stack 内部 SafeAreaView 双重撑高布局。
// 红条夹在系统状态栏和 App 内容之间，固定 22px 高。
export const EnvBanner = () => {
  if (IS_PRODUCTION) return null;

  const label = APP_ENV === 'staging' ? '测试环境' : '开发环境';
  // 去掉 /api/v1 尾巴方便阅读
  const host = API_BASE_URL.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '');

  return (
    <View style={styles.bar} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1} maxFontSizeMultiplier={1.1}>
        ⚠️ {label} · {host}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    height: 22,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
});
