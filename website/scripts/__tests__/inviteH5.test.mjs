import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  apiErrorMessage,
  bindingStatusText,
  canContinueAfterLandingCodeStatus,
  normalizeInviteCode,
  submitStateForBindingStatus,
  unwrapApiData,
} from '../../src/lib/inviteH5.ts'

test('邀请码统一修剪并大写，非 8 位字母数字视为无效', () => {
  assert.equal(normalizeInviteCode(' sabc1234 '), 'SABC1234')
  assert.equal(normalizeInviteCode('vipcode1'), 'VIPCODE1')
  assert.equal(normalizeInviteCode('bad'), null)
  assert.equal(normalizeInviteCode('SABC-123'), null)
})

test('后端响应兼容统一 data envelope 和裸对象', () => {
  assert.deepEqual(unwrapApiData({ data: { ok: true } }), { ok: true })
  assert.deepEqual(unwrapApiData({ ok: true }), { ok: true })
  assert.equal(unwrapApiData(null), null)
})

test('错误文案兼容后端统一错误 envelope', () => {
  assert.equal(
    apiErrorMessage({ ok: false, error: { displayMessage: '验证码错误' } }),
    '验证码错误',
  )
  assert.equal(
    apiErrorMessage({ error: { message: '发送过于频繁，请稍后再试' } }),
    '发送过于频繁，请稍后再试',
  )
  assert.equal(apiErrorMessage({ message: ['验证码已被使用'] }), '验证码已被使用')
})

test('绑定状态文案不暴露推荐人信息', () => {
  assert.equal(bindingStatusText('BOUND'), '推荐关系已记录')
  assert.equal(bindingStatusText('ALREADY_BOUND_SAME'), '推荐关系已记录')
  assert.equal(bindingStatusText('ALREADY_BOUND_OTHER'), '已绑定推荐关系，无法覆盖')
  assert.equal(bindingStatusText('INVALID_CODE'), '推荐码无效，未绑定推荐关系')
})

test('landing 阶段邀请码无效或冲突不阻断手机号登录', () => {
  assert.equal(canContinueAfterLandingCodeStatus('NORMAL_SHARE'), true)
  assert.equal(canContinueAfterLandingCodeStatus('VIP_REFERRAL'), true)
  assert.equal(canContinueAfterLandingCodeStatus('INVALID'), true)
  assert.equal(canContinueAfterLandingCodeStatus('CONFLICT'), true)
  assert.equal(canContinueAfterLandingCodeStatus(null), false)
  assert.equal(canContinueAfterLandingCodeStatus(undefined), false)
})

test('绑定结果状态不会把失败误渲染为成功', () => {
  assert.equal(submitStateForBindingStatus('BOUND'), 'success')
  assert.equal(submitStateForBindingStatus('ALREADY_BOUND_SAME'), 'success')
  assert.equal(submitStateForBindingStatus('ALREADY_BOUND_OTHER'), 'warning')
  assert.equal(submitStateForBindingStatus('INVALID_CODE'), 'warning')
  assert.equal(submitStateForBindingStatus('SELF_INVITE'), 'warning')
  assert.equal(submitStateForBindingStatus('NOT_ELIGIBLE'), 'warning')
  assert.equal(submitStateForBindingStatus('ERROR'), 'error')
})

test('H5 页面首屏不自动弹微信下载遮罩，且成功后阻止重复提交', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(page, /if \(wechat\) setShowWechatGuide\(true\)/)
  assert.match(page, /landingState === 'checking'/)
  assert.match(page, /authCompleted/)
})

test('invite H5 测试接入 website npm script', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['test:invite-h5'], 'node --test scripts/__tests__/inviteH5.test.mjs')
})
