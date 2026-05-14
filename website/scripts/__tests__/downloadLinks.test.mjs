import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ANDROID_TEST_DOWNLOAD_URL,
  resolveAndroidDownloadUrl,
} from '../../src/lib/downloadLinks.ts'

test('android test download defaults to Pgyer distribution page', () => {
  assert.equal(
    resolveAndroidDownloadUrl(),
    'https://www.pgyer.com/aimaimai-android-test',
  )
  assert.equal(DEFAULT_ANDROID_TEST_DOWNLOAD_URL, 'https://www.pgyer.com/aimaimai-android-test')
})

test('android test download can be overridden by env value', () => {
  assert.equal(
    resolveAndroidDownloadUrl(' https://example.com/latest.apk '),
    'https://example.com/latest.apk',
  )
})
