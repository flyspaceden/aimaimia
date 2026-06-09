import test from 'node:test'
import assert from 'node:assert/strict'

import { buildReferralClipboardText } from '../../src/lib/referralClipboard.ts'

test('剪贴板口令 = 规范推荐落地链接（统一大写）', () => {
  assert.equal(
    buildReferralClipboardText('abcd2345'),
    'https://app.ai-maimai.com/r/ABCD2345',
  )
})

test('口令必须能被 App 端 extractReferralCodeFromURL 的正则解析（跨端契约）', () => {
  // 与 src/services/deferredLink.ts extractReferralCodeFromURL 保持一致
  const APP_SIDE_PATTERN = /app\.(ai-maimai|xn--ckqa175y)\.com\/r\/([A-Za-z0-9]{8})/
  const token = buildReferralClipboardText('KYYLQB23')
  const match = token.match(APP_SIDE_PATTERN)
  assert.ok(match, '口令未命中 App 端解析正则')
  assert.equal(match[2], 'KYYLQB23')
})
