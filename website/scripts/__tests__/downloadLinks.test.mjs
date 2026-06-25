import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ANDROID_MARKET_DOWNLOAD_URL,
  DEFAULT_ANDROID_TEST_DOWNLOAD_URL,
  VIVO_DOWNLOAD_URL,
  HUAWEI_DOWNLOAD_URL,
  resolveAndroidFallbackUrl,
  resolveAndroidDownloadUrl,
  pickAndroidDownloadUrl,
} from '../../src/lib/downloadLinks.ts'

test('android download defaults to Xiaomi OneLink', () => {
  assert.equal(resolveAndroidDownloadUrl(), 'https://m.malink.cn/s/6ZFjYj')
  assert.equal(DEFAULT_ANDROID_TEST_DOWNLOAD_URL, 'https://m.malink.cn/s/6ZFjYj')
})

test('android download can be overridden by env value', () => {
  assert.equal(
    resolveAndroidDownloadUrl(' https://example.com/latest.apk '),
    'https://example.com/latest.apk',
  )
})

test('known android vendors route to their store entry, unknown vendors keep Xiaomi OneLink fallback', () => {
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; HUAWEI MGA-AL00)'),
    HUAWEI_DOWNLOAD_URL,
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; M2102 MIUI)'),
    'https://m.malink.cn/s/6ZFjYj',
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; V2055A vivo)'),
    VIVO_DOWNLOAD_URL,
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; iQOO Neo9)'),
    VIVO_DOWNLOAD_URL,
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; OPPO Find X9)'),
    ANDROID_MARKET_DOWNLOAD_URL,
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; OnePlus 12)'),
    ANDROID_MARKET_DOWNLOAD_URL,
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; realme GT)'),
    ANDROID_MARKET_DOWNLOAD_URL,
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 14; HONOR BVL-AN00 MagicOS)'),
    ANDROID_MARKET_DOWNLOAD_URL,
  )
  assert.equal(
    pickAndroidDownloadUrl('Mozilla/5.0 (Linux; Android 13; SM-S9280)'),
    'https://m.malink.cn/s/6ZFjYj',
  )
})

test('market scheme entries fall back to Xiaomi OneLink when browser cannot open local store', () => {
  assert.equal(resolveAndroidFallbackUrl(ANDROID_MARKET_DOWNLOAD_URL), 'https://m.malink.cn/s/6ZFjYj')
  assert.equal(resolveAndroidFallbackUrl(VIVO_DOWNLOAD_URL), null)
  assert.equal(resolveAndroidFallbackUrl(HUAWEI_DOWNLOAD_URL), null)
})
