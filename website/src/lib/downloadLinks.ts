export const DEFAULT_ANDROID_TEST_DOWNLOAD_URL = 'https://www.pgyer.com/aimaimai-android-test'

export function resolveAndroidDownloadUrl(envValue?: string | null): string {
  const trimmed = envValue?.trim()
  return trimmed || DEFAULT_ANDROID_TEST_DOWNLOAD_URL
}

export const ANDROID_TEST_DOWNLOAD_URL = resolveAndroidDownloadUrl(
  import.meta.env?.VITE_ANDROID_TEST_DOWNLOAD_URL,
)
