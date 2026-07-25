import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  apiErrorMessage,
  bindingStatusText,
  buildInviteDownloadHandoffUrl,
  canResumeWechatDownload,
  canContinueAfterLandingCodeStatus,
  clearInviteDownloadPass,
  inviteDownloadPassSessionStorageKey,
  normalizeInviteCode,
  normalizeInviteDownloadPass,
  readInviteDownloadPass,
  readInviteDownloadPassFromClipboardText,
  readInviteDownloadHandoff,
  storeInviteDownloadPass,
  submitStateForBindingStatus,
  unwrapApiData,
  withoutInviteDownloadHandoff,
  withInviteDownloadHandoff,
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

test('下载交接凭证只接受 256 位 base64url，并按 H5 会话持久化和清理', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const ticket = 'A'.repeat(43)

  assert.equal(normalizeInviteDownloadPass(ticket), ticket)
  assert.equal(normalizeInviteDownloadPass('bad-ticket'), null)
  assert.equal(inviteDownloadPassSessionStorageKey('ih5_session_1'), 'invite_h5_download_pass:ih5_session_1')
  storeInviteDownloadPass(storage, 'ih5_session_1', ticket)
  assert.equal(readInviteDownloadPass(storage, 'ih5_session_1'), ticket)
  clearInviteDownloadPass(storage, 'ih5_session_1')
  assert.equal(readInviteDownloadPass(storage, 'ih5_session_1'), null)
})

test('下载交接凭证使用真实 query，保留其他参数且可在消费前清理', () => {
  const ticket = 'A'.repeat(43)
  const search = withInviteDownloadHandoff('?utm_source=wechat', ticket)

  assert.equal(search, `?utm_source=wechat&handoff=${ticket}`)
  assert.equal(readInviteDownloadHandoff(search), ticket)
  assert.equal(readInviteDownloadHandoff('?handoff=fake'), null)
  assert.equal(withoutInviteDownloadHandoff(search), '?utm_source=wechat')
})

test('剪贴板交接使用完整下载 URL，并且只接受完整 URL 或合法纯票据', () => {
  const ticket = 'A'.repeat(43)
  const url = buildInviteDownloadHandoffUrl(
    'https://app.ai-maimai.com/invite/KYY12345?utm_source=wechat#section',
    ticket,
  )

  assert.equal(
    url,
    `https://app.ai-maimai.com/invite/KYY12345?utm_source=wechat&handoff=${ticket}`,
  )
  assert.equal(readInviteDownloadPassFromClipboardText(url), ticket)
  assert.equal(readInviteDownloadPassFromClipboardText(ticket), ticket)
  assert.equal(readInviteDownloadPassFromClipboardText('普通剪贴板内容'), null)
  assert.equal(readInviteDownloadPassFromClipboardText('https://example.com/?handoff=fake'), null)
})

test('微信下载 handoff 必须同时有本地 H5 token 和 landing session 才能恢复', () => {
  const ticket = 'A'.repeat(43)

  assert.equal(canResumeWechatDownload({
    ticket,
    accessToken: 'access-token',
    landingSessionId: 'ih5_session_1',
  }), true)
  assert.equal(canResumeWechatDownload({ ticket, accessToken: null, landingSessionId: 'ih5_session_1' }), false)
  assert.equal(canResumeWechatDownload({ ticket, accessToken: 'access-token', landingSessionId: null }), false)
  assert.equal(canResumeWechatDownload({ ticket: 'fake', accessToken: 'access-token', landingSessionId: 'ih5_session_1' }), false)
})

test('H5 页面首屏不自动弹微信下载遮罩，且成功后阻止重复提交', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(page, /if \(wechat\) setShowWechatGuide\(true\)/)
  assert.match(page, /landingState === 'checking'/)
  assert.match(page, /authCompleted/)
})

test('H5 邀请页保持手机号优先，微信登录只是辅助入口', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')

  assert.match(page, /手机号登录/)
  assert.match(page, /登录并绑定/)
  assert.match(page, /微信登录/)
  assert.match(page, /登录并绑定[\s\S]*也可以使用[\s\S]*微信登录\s*<\/button>/)
  assert.doesNotMatch(page, /登录成功后自动记录推荐关系/)
})

test('H5 邀请页支持微信授权 callback 和非微信浏览器 fallback', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')
  const lib = readFileSync(new URL('../../src/lib/inviteH5.ts', import.meta.url), 'utf8')

  assert.match(page, /h5-wechat\/invite-login/)
  assert.match(page, /buildH5WechatStartUrl/)
  assert.match(lib, /h5-wechat\/start/)
  assert.match(page, /请在微信中打开，或使用手机号登录/)
})

test('微信完成 H5 登录后可由短时设备匹配或剪贴板一次性凭证交接，不重复登录或绑定', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')
  const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

  assert.match(page, /invite-h5\/download-pass/)
  assert.match(page, /invite-h5\/download-pass\/consume/)
  assert.match(page, /invite-h5\/download-pass\/resume/)
  assert.match(page, /consumeDownloadPassRequestRef/)
  assert.match(page, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(page, /window\.crypto\.getRandomValues/)
  assert.match(page, /storeInviteDownloadPass\(sessionStorage, landingSessionId, ticket\)/)
  assert.match(page, /readInviteDownloadPass\(sessionStorage, landingSessionId\)/)
  assert.match(page, /ticket: candidate/)
  assert.match(page, /response\.status === 'RENEW_REQUIRED'/)
  assert.match(page, /readInviteDownloadHandoff\(window\.location\.search\)/)
  assert.match(page, /navigateToDownloadHandoff\(ticket\)/)
  assert.match(page, /window\.location\.replace\(buildInviteDownloadHandoffUrl\(window\.location\.href, ticket\)\)/)
  assert.match(page, /removeDownloadHandoffFromUrl\(\)/)
  assert.doesNotMatch(page, /hashParams\.set\('downloadPass', ticket\)/)
  assert.match(page, /setShowWechatGuide\(true\)/)
  assert.match(page, /if \(hasResumableWechatDownload && downloadPass\) \{\s*setShowWechatGuide\(true\)\s*return/)
  assert.match(page, /请在右上角打开浏览器/)
  assert.match(page, /读取刚才复制的下载链接/)
  assert.match(page, /readInviteDownloadPassFromClipboardText/)
  assert.match(page, /copyTextToClipboard/)
  assert.match(page, /devicePixelRatio/)
  assert.match(page, /timezoneOffset/)
  assert.match(page, /startDownloadInBrowser\(platform\)/)
  assert.match(page, /已完成登记，请在浏览器中打开，系统会自动前往下载/)
  assert.match(page, /if \(downloadPass\) \{\s*setLandingState\('ready'\)/)
  assert.match(page, /\{authCompleted \? \(/)
  assert.match(index, /<meta name="referrer" content="no-referrer" \/>/)
})

test('微信返回后会复用有效下载凭证，已使用或过期才生成新的凭证', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')

  assert.match(
    page,
    /let ticket = preparedDownloadPass \|\|[\s\S]*readInviteDownloadPass\(sessionStorage, landingSessionId\) \|\|[\s\S]*downloadPass \|\|[\s\S]*createDownloadPassTicket\(\)/,
  )
  assert.match(page, /if \(response\.status === 'RENEW_REQUIRED'\) \{[\s\S]*ticket = createDownloadPassTicket\(\)/)
  assert.match(page, /renewedAfterAsyncResponse = true/)
  assert.match(page, /replaceDownloadHandoffInUrl\(ticket\)/)
  assert.match(page, /下载链接已更新，请先点击上方按钮复制，再打开浏览器/)
  assert.match(page, /const ticket = preparedDownloadPass \|\| downloadPass/)
  assert.match(page, /downloadPassRequestRef\.current/)
  assert.match(page, /canResumeWechatDownload\(\{ ticket: downloadPass, accessToken, landingSessionId \}\)/)
  assert.match(page, /if \(!storedDownloadPass\) \{\s*storeInviteDownloadPass\(sessionStorage, landingSessionId, downloadPass\)/)
  assert.match(page, /if \(hasResumableWechatDownload\) \{\s*setLandingState\('ready'\)\s*return/)
  assert.match(page, /setDownloadPass\(null\)/)
  assert.doesNotMatch(page, /if \(downloadPass \|\| preparedDownloadPass\) \{\s*setShowWechatGuide/)
})

test('H5 邀请页响应式覆盖窄屏验证码行和桌面窄表单', () => {
  const page = readFileSync(new URL('../../src/pages/InviteAuthLanding.tsx', import.meta.url), 'utf8')

  assert.match(page, /max-w-\[480px\]/)
  assert.match(page, /min-\[360px\]:grid-cols-\[1fr_112px\]/)
  assert.doesNotMatch(page, /text-\[clamp\(/)
})

test('invite H5 测试接入 website npm script', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['test:invite-h5'], 'node --test scripts/__tests__/inviteH5.test.mjs')
})
