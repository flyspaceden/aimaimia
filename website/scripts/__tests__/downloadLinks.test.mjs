import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ANDROID_TEST_DOWNLOAD_URL,
  HUAWEI_DOWNLOAD_URL,
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

test('huawei devices route to Huawei App Linking, others to Xiaomi OneLink', () => {
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
    'https://m.malink.cn/s/6ZFjYj',
  )
})
