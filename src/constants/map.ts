export type MapProvider = 'amap' | 'tencent';

export const mapProviders: Array<{ value: MapProvider; label: string; note: string }> = [
  { value: 'amap', label: '高德地图', note: '主用' },
  { value: 'tencent', label: '腾讯地图', note: '备用' },
];

// 地图 SDK Key 占位（接入真实 SDK 时填入）
export const mapSdkKeys = {
  amap: {
    ios: 'AMAP_IOS_KEY',
    android: 'AMAP_ANDROID_KEY',
  },
  tencent: {
    ios: 'TENCENT_IOS_KEY',
    android: 'TENCENT_ANDROID_KEY',
  },
};

// SDK 接入开关：接入 dev client + 原生模块后改为 true
export const mapSdkReady = false;
