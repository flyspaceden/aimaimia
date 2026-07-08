import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('H5 微信 callback 不重复记录 landing 打开事件', () => {
  const page = read('website/src/pages/InviteAuthLanding.tsx')
  const guardIndex = page.indexOf('if (hasWechatCallback) {')
  const landingPostIndex = page.indexOf("postJson<LandingResponse>('/invite-h5/landing'")

  assert.match(page, /useRef/)
  assert.match(page, /landingRequestRef/)
  assert.match(page, /wechatCallbackRequestRef/)
  assert.match(page, /inviteLandingSessionStorageKey/)
  assert.match(page, /sessionStorage\.setItem\(landingSessionStorageKey, res\.landingSessionId\)/)
  assert.match(page, /const \[wechatCallbackParams\] = useState\(\(\) => getWechatCallbackParams\(window\.location\.search\)\)/)
  assert.match(page, /const hasWechatCallback = Boolean\(wechatCallbackParams\.wechatCode && wechatCallbackParams\.state\)/)
  assert.ok(guardIndex >= 0, 'landing effect should guard callback redirects')
  assert.ok(landingPostIndex >= 0, 'landing event should still be recorded for normal opens')
  assert.ok(guardIndex < landingPostIndex, 'callback guard must run before landing POST')
  assert.match(page, /setLandingState\('ready'\)[\s\S]*return/)
  assert.match(page, /removeWechatCallbackHash\(window\.location\.hash\)/)
})

test('H5 邀请页不覆盖旧推荐下载和普通分享路由', () => {
  const app = read('website/src/App.tsx')

  assert.match(app, /const InviteAuthLanding = lazy\(\(\) => import\('@\/pages\/InviteAuthLanding'\)\)/)
  assert.match(app, /const NormalShareLanding = lazy\(\(\) => import\('@\/pages\/NormalShareLanding'\)\)/)
  assert.match(app, /<Route path="\/invite\/:code" element={<InviteAuthLanding \/>} \/>/)
  assert.match(app, /<Route path="\/r\/:code" element={<Download \/>} \/>/)
  assert.match(app, /<Route path="\/s\/:code" element={<NormalShareLanding \/>} \/>/)
  assert.doesNotMatch(app, /<Route path="\/r\/:code" element={<InviteAuthLanding \/>} \/>/)
  assert.doesNotMatch(app, /<Route path="\/s\/:code" element={<InviteAuthLanding \/>} \/>/)
})

test('H5 微信公开接口配置限流，避免公开登录入口无保护', () => {
  const controller = read('backend/src/modules/auth/auth.controller.ts')
  const service = read('backend/src/modules/auth/auth.service.ts')
  const dto = read('backend/src/modules/auth/dto/send-code.dto.ts')

  assert.match(
    controller,
    /@Throttle\(\{ default: \{ ttl: 60_000, limit: 20 \} \}\)\s+@Get\('h5-wechat\/start'\)/,
  )
  assert.match(controller, /async startH5WechatLogin/)
  assert.match(
    controller,
    /@Throttle\(\{ default: \{ ttl: 60_000, limit: 5 \} \}\)\s+@Post\('h5-wechat\/invite-login'\)/,
  )
  assert.match(service, /const H5_WECHAT_STATE_TTL_MS = 10 \* 60_000/)
  assert.match(service, /createH5WechatState/)
  assert.match(service, /consumeH5WechatState/)
  assert.match(service, /redisCoord\.set\(/)
  assert.match(service, /redisCoord\.getdel\(/)
  assert.match(service, /\^\[a-f0-9\]\{32\}\$/)
  assert.doesNotMatch(service, /signH5WechatState/)
  assert.match(dto, /@Length\(16, 128\)\s+state: string/)
})

test('H5 微信登录发布配置写入 env 模板、CORS 和测试到生产切换文档', () => {
  const backendEnv = read('backend/.env.example')
  const rootEnv = read('.env.example')
  const stagingToProduction = read('docs/operations/staging-to-production.md')
  const deployment = read('docs/operations/deployment.md')

  for (const source of [backendEnv, rootEnv, stagingToProduction]) {
    assert.match(source, /WECHAT_H5_APP_ID/)
    assert.match(source, /WECHAT_H5_APP_SECRET/)
    assert.match(source, /WECHAT_H5_AUTH_REDIRECT_BASE/)
    assert.doesNotMatch(source, /WECHAT_H5_AUTH_STATE_SECRET/)
  }
  assert.match(stagingToProduction, /H5 OAuth state 使用 Redis 一次性 nonce/)
  assert.match(deployment, /https:\/\/app\.ai-maimai\.com/)
  assert.match(deployment, /WECHAT_H5_AUTH_REDIRECT_BASE=https:\/\/app\.ai-maimai\.com\/invite/)
})
