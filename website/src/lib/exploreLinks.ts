// 公开介绍入口不携带推荐人、团长或 IoT 用户身份。
export const APP_DOWNLOAD_PAGE = 'https://app.ai-maimai.com/download'

export function publicHttpsUrl(value?: string): string {
  if (!value?.trim()) return ''
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

export function miniProgramImageUrl(value?: string): string {
  const path = value?.trim() ?? ''
  // 允许打包进官网的正式码；不接受协议相对地址或反斜线 URL。
  if (/^\/[a-zA-Z0-9][a-zA-Z0-9/_.,-]*\.(png|jpe?g|webp)$/i.test(path)) return path
  return publicHttpsUrl(path)
}

// 用户从微信后台提供的首页码原图；显式配置空字符串仍可停用。
export const MINI_PROGRAM_QR_IMAGE = miniProgramImageUrl(
  import.meta.env?.VITE_MINI_PROGRAM_QR_IMAGE_URL ?? '/images/mini-program-home-20261008.png',
)
export const MINI_PROGRAM_URL_LINK = publicHttpsUrl(import.meta.env?.VITE_MINI_PROGRAM_URL_LINK)
