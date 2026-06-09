// 安卓下载入口（按手机品牌路由到各厂商官方分发链接）。
//
// - 华为：华为 App Linking 官方短链 → 华为应用市场（appgallery C117802005）。
// - 其余品牌（小米/vivo/OPPO/…）：小米 OneLink 官方统一分发短链
//   （小米机 → 小米商店；非小米机 → 小米托管的最新 APK 直接下载）。
//   同时作为「识别不到品牌」的通用兜底，以及页面二维码的默认值。
//
// 两个都是厂商官方智能短链：自动跟随各商店最新版本，链接固定永不用换；
// 发新版只需照常发到对应商店，无需改这里。
export const HUAWEI_DOWNLOAD_URL = 'https://url.cloud.huawei.com/ALcSLnSARW'

// 小米 OneLink（通用兜底 + 二维码默认值）。命名沿用历史 *_TEST_* 以兼容既有引用。
export const DEFAULT_ANDROID_TEST_DOWNLOAD_URL = 'https://m.malink.cn/s/6ZFjYj'

export function resolveAndroidDownloadUrl(envValue?: string | null): string {
  const trimmed = envValue?.trim()
  return trimmed || DEFAULT_ANDROID_TEST_DOWNLOAD_URL
}

export const ANDROID_TEST_DOWNLOAD_URL = resolveAndroidDownloadUrl(
  import.meta.env?.VITE_ANDROID_TEST_DOWNLOAD_URL,
)

// 按 UA 选下载入口：明确是华为设备 → 华为短链；其余一律走小米 OneLink 通用兜底。
// 只匹配 "huawei"（荣耀新机多无华为商店，归入通用兜底更稳）。
export function pickAndroidDownloadUrl(userAgent: string): string {
  return /huawei/i.test(userAgent) ? HUAWEI_DOWNLOAD_URL : ANDROID_TEST_DOWNLOAD_URL
}
