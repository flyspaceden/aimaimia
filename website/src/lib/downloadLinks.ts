// 安卓下载入口（按手机品牌路由到各厂商官方分发链接）。
//
// - 华为：华为 App Linking 官方短链 → 华为应用市场（appgallery C117802005）。
// - vivo/iQOO：vivo 应用商店 H5 详情页。
// - OPPO/一加/realme/荣耀：系统 market 协议，进入本机应用商店详情页。
// - 小米/红米/识别不到品牌/其他安卓：小米 OneLink 统一链接服务，作为通用兜底。
//
// 商店入口自动跟随各商店已上架版本；发新版只需照常发到对应商店，无需改这里。
export const HUAWEI_DOWNLOAD_URL = 'https://url.cloud.huawei.com/ALcSLnSARW'
export const VIVO_DOWNLOAD_URL =
  'https://h5coml.vivo.com.cn/h5coml/appdetail_h5/browser_v2/index.html?appId=4611341'
export const ANDROID_MARKET_DOWNLOAD_URL = 'market://details?id=com.aimaimai.shop'

// 小米 OneLink（小米/红米入口 + 通用兜底 + 二维码默认值）。命名沿用历史 *_TEST_* 以兼容既有引用。
export const DEFAULT_ANDROID_TEST_DOWNLOAD_URL = 'https://m.malink.cn/s/6ZFjYj'

export function resolveAndroidDownloadUrl(envValue?: string | null): string {
  const trimmed = envValue?.trim()
  return trimmed || DEFAULT_ANDROID_TEST_DOWNLOAD_URL
}

export const ANDROID_TEST_DOWNLOAD_URL = resolveAndroidDownloadUrl(
  import.meta.env?.VITE_ANDROID_TEST_DOWNLOAD_URL,
)

export function resolveAndroidFallbackUrl(downloadUrl: string): string | null {
  return /^(?:market|honormarket):\/\//i.test(downloadUrl) ? ANDROID_TEST_DOWNLOAD_URL : null
}

// 按 UA 选下载入口。UA 识别不到时必须保留 OneLink 兜底，避免用户找不到下载入口。
// 只把 "huawei" 走华为短链；荣耀走本机 market，避免新荣耀误跳华为市场。
export function pickAndroidDownloadUrl(userAgent: string): string {
  if (/huawei/i.test(userAgent)) {
    return HUAWEI_DOWNLOAD_URL
  }

  if (/vivo|iqoo/i.test(userAgent)) {
    return VIVO_DOWNLOAD_URL
  }

  if (/oppo|oneplus|realme|heytap|coloros|honor/i.test(userAgent)) {
    return ANDROID_MARKET_DOWNLOAD_URL
  }

  return ANDROID_TEST_DOWNLOAD_URL
}
