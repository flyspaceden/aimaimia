import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('H5 无登录分流只记录落地事件，并在用户点击时请求小程序 URL Link', () => {
  const page = read('website/src/pages/InviteChoiceLanding.tsx')
  const landingPostIndex = page.indexOf("postJson<LandingResponse>('/invite-h5/landing'")
  const miniLinkPostIndex = page.indexOf("postJson<MiniProgramLinkResponse>('/invite-h5/mini-program-link'")

  assert.match(page, /useRef/)
  assert.match(page, /landingRequestRef/)
  assert.ok(landingPostIndex >= 0, 'landing event should still be recorded for normal opens')
  assert.ok(miniLinkPostIndex >= 0, 'mini-program link must be requested only after a landing event')
  assert.match(page, /onClick=\{handleOpenMiniProgram\}/)
  assert.match(page, /landingSessionId/)
  assert.doesNotMatch(page, /auth\/invite-login/)
  assert.doesNotMatch(page, /h5-wechat/)
  assert.doesNotMatch(page, /sessionStorage/)
})

test('H5 邀请页不覆盖旧推荐下载和普通分享路由', () => {
  const app = read('website/src/App.tsx')

  assert.match(app, /const InviteChoiceLanding = lazy\(\(\) => import\('@\/pages\/InviteChoiceLanding'\)\)/)
  assert.match(app, /const NormalShareLanding = lazy\(\(\) => import\('@\/pages\/NormalShareLanding'\)\)/)
  assert.match(app, /<Route path="\/invite\/:code" element={<InviteChoiceLanding \/>} \/>/)
  assert.match(app, /<Route path="\/r\/:code" element={<Download \/>} \/>/)
  assert.match(app, /<Route path="\/s\/:code" element={<NormalShareLanding \/>} \/>/)
  assert.doesNotMatch(app, /<Route path="\/r\/:code" element={<InviteChoiceLanding \/>} \/>/)
  assert.doesNotMatch(app, /<Route path="\/s\/:code" element={<InviteChoiceLanding \/>} \/>/)
})

test('H5 小程序 URL Link 公开接口限流、绑定同一落地事件并校验跳转域名', () => {
  const controller = read('backend/src/modules/invite-h5/invite-h5.controller.ts')
  const service = read('backend/src/modules/invite-h5/invite-h5.service.ts')
  const dto = read('backend/src/modules/invite-h5/dto/mini-program-link.dto.ts')
  const module = read('backend/src/modules/invite-h5/invite-h5.module.ts')

  assert.match(
    controller,
    /@Throttle\(\{ default: \{ ttl: 60_000, limit: 10 \} \}\)\s+@Post\('mini-program-link'\)/,
  )
  assert.match(controller, /@Public\(\)/)
  assert.match(service, /landingForMiniProgramLink/)
  assert.match(service, /validWechatMiniProgramUrlLink/)
  assert.match(service, /host !== 'wxaurl\.cn'/)
  assert.match(service, /MINI_PROGRAM_REFERRAL_PAGE/)
  assert.match(service, /MINI_PROGRAM_URL_LINK_CLAIM_MS/)
  assert.match(service, /miniProgramUrlLinkExpiresAt/)
  assert.match(dto, /@Matches\(\/\^ih5_\[a-f0-9\]\{24\}\$\//)
  assert.match(module, /WechatMiniProgramPlatformModule/)
})

test('URL Link 使用既有小程序平台凭据并在生产环境拒绝 Mock', () => {
  const backendEnv = read('backend/.env.example')
  const api = read('backend/src/modules/wechat-mini-program-platform/wechat-mini-program-api.service.ts')

  assert.match(backendEnv, /WECHAT_MINIAPP_APP_ID/)
  assert.match(backendEnv, /WECHAT_MINIAPP_APP_SECRET/)
  assert.match(api, /productionMockRejected/)
  assert.match(api, /生产环境禁止微信小程序平台 API Mock/)
})

test('认证控制器不再公开 H5 邀请登录或 H5 微信登录入口', () => {
  const controller = read('backend/src/modules/auth/auth.controller.ts')

  assert.doesNotMatch(controller, /@Post\('invite-login'\)/)
  assert.doesNotMatch(controller, /@Get\('h5-wechat\/start'\)/)
  assert.doesNotMatch(controller, /@Post\('h5-wechat\/invite-login'\)/)
})
