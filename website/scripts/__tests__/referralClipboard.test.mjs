import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildNormalShareAppScheme,
  buildNormalShareClipboardText,
  buildReferralClipboardText,
} from '../../src/lib/referralClipboard.ts'

test('剪贴板口令 = 规范推荐落地链接（统一大写）', () => {
  assert.equal(
    buildReferralClipboardText('abcd2345'),
    'https://app.ai-maimai.com/r/ABCD2345',
  )
})

test('普通分享剪贴板口令 = /s 普通分享链接（统一大写）', () => {
  assert.equal(
    buildNormalShareClipboardText('s8k6m2q9'),
    'https://app.ai-maimai.com/s/S8K6M2Q9',
  )
})

test('普通分享 App scheme = App 端可解析的 normal-share 链接（统一大写）', () => {
  const scheme = buildNormalShareAppScheme('s8k6m2q9')
  assert.equal(scheme, 'aimaimai://normal-share?code=S8K6M2Q9')

  // 与 src/services/deferredLink.ts extractNormalShareCodeFromURL 保持一致
  const APP_SIDE_PATTERN = /aimaimai:\/\/normal-share\?code=([A-Za-z0-9]{8})/
  const match = scheme.match(APP_SIDE_PATTERN)
  assert.ok(match, '普通分享 scheme 未命中 App 端解析正则')
  assert.equal(match[1], 'S8K6M2Q9')
})

test('口令必须能被 App 端 extractReferralCodeFromURL 的正则解析（跨端契约）', () => {
  // 与 src/services/deferredLink.ts extractReferralCodeFromURL 保持一致
  const APP_SIDE_PATTERN = /app\.(ai-maimai|xn--ckqa175y)\.com\/r\/([A-Za-z0-9]{8})/
  const token = buildReferralClipboardText('KYYLQB23')
  const match = token.match(APP_SIDE_PATTERN)
  assert.ok(match, '口令未命中 App 端解析正则')
  assert.equal(match[2], 'KYYLQB23')
})
