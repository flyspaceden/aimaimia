import test from 'node:test'
import assert from 'node:assert/strict'
import { APP_DOWNLOAD_PAGE, publicHttpsUrl, miniProgramImageUrl } from '../../src/lib/exploreLinks.ts'

test('公开下载二维码不绑定任何推荐人或 IoT 用户身份', () => {
  const url = new URL(APP_DOWNLOAD_PAGE)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'app.ai-maimai.com')
  assert.equal(url.pathname, '/download')
  assert.equal(url.search, '')
})

test('小程序配置拒绝脚本、协议相对 URL 和带凭据的地址', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,abc', '//example.com/qr.png', 'https://user:secret@example.com/code', '/\\example.com/qr.png', 'http://example.com/code']) {
    assert.equal(publicHttpsUrl(value), '')
    assert.equal(miniProgramImageUrl(value), '')
  }
  assert.equal(publicHttpsUrl(' https://example.com/code '), 'https://example.com/code')
  assert.equal(miniProgramImageUrl('/images/mini-program-home.png'), '/images/mini-program-home.png')
  assert.equal(miniProgramImageUrl(''), '')
})
