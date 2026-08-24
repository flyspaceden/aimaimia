import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  apiErrorMessage,
  bindingStatusText,
  inviteKindForCodeStatus,
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

test('只有已解析的普通或 VIP 推荐码可以继续到客户端', () => {
  assert.equal(inviteKindForCodeStatus('NORMAL_SHARE'), 'normal')
  assert.equal(inviteKindForCodeStatus('VIP_REFERRAL'), 'vip')
  assert.equal(inviteKindForCodeStatus('INVALID'), null)
  assert.equal(inviteKindForCodeStatus('CONFLICT'), null)
  assert.equal(inviteKindForCodeStatus(null), null)
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

test('H5 页面首屏不自动弹下载遮罩，并且只在用户点击时打开小程序', () => {
  const page = readFileSync(new URL('../../src/pages/InviteChoiceLanding.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(page, /if \(wechat\) setShowWechatGuide\(true\)/)
  assert.match(page, /landingState === 'checking'/)
  assert.match(page, /onClick=\{handleOpenMiniProgram\}/)
  assert.match(page, /invite-h5\/mini-program-link/)
})

test('H5 邀请页不再收集登录信息，改为小程序和 App 两个客户端选择', () => {
  const page = readFileSync(new URL('../../src/pages/InviteChoiceLanding.tsx', import.meta.url), 'utf8')

  assert.match(page, /打开爱买买小程序/)
  assert.match(page, /下载爱买买 App/)
  assert.match(page, /mini-program-link/)
  assert.match(page, /copyAppReferralToken/)
  assert.doesNotMatch(page, /auth\/invite-login/)
  assert.doesNotMatch(page, /h5-wechat/)
  assert.doesNotMatch(page, /<input/)
})

test('App 下载在微信内展示浏览器指引前先保存对应类型的推荐口令', () => {
  const page = readFileSync(new URL('../../src/pages/InviteChoiceLanding.tsx', import.meta.url), 'utf8')
  const copyIndex = page.indexOf('const copied = await copyAppReferralToken()')
  const guideIndex = page.indexOf('if (wechat) {')

  assert.ok(copyIndex >= 0, 'download action should copy an App handoff token')
  assert.ok(guideIndex > copyIndex, 'WeChat guide must appear after copying the handoff token')
  assert.match(page, /buildNormalShareClipboardText/)
  assert.match(page, /buildReferralClipboardText/)
  assert.match(page, /window\.location\.assign\(await requestMiniProgramLink\(\)\)/)
})

test('H5 邀请页在窄屏保持按钮入口，桌面按需生成小程序二维码并直接展示 App 二维码', () => {
  const page = readFileSync(new URL('../../src/pages/InviteChoiceLanding.tsx', import.meta.url), 'utf8')

  assert.match(page, /max-w-\[760px\]/)
  assert.match(page, /focus-visible:outline/)
  assert.match(page, /aria-live="polite"/)
  assert.match(page, /showWechatGuide/)
  assert.match(page, /desktopQrMode/)
  assert.match(page, /onClick=\{handleGenerateDesktopMiniProgramQr\}/)
  assert.match(page, /QRCodeCanvas value=\{desktopMiniProgramLink\}/)
  assert.match(page, /QRCodeCanvas value=\{appReferralUrl\}/)
  const landingRequest = page.indexOf("postJson<LandingResponse>('/invite-h5/landing'")
  const miniProgramRequest = page.indexOf("postJson<MiniProgramLinkResponse>('/invite-h5/mini-program-link'")
  const desktopClick = page.indexOf('onClick={handleGenerateDesktopMiniProgramQr}')
  assert.ok(landingRequest >= 0 && miniProgramRequest >= 0 && desktopClick >= 0)
  assert.ok(desktopClick > miniProgramRequest, 'desktop QR request must remain behind an explicit user click')
})

test('invite H5 测试接入 website npm script', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['test:invite-h5'], 'node --test scripts/__tests__/inviteH5.test.mjs')
})
