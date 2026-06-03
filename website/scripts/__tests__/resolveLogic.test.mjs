// 静态 /resolve 页面的核心逻辑单元测试
// 与 website/scripts/resolveLogic.mjs 中的 decideRedirect 一一对应
// 跑：cd website && node --test scripts/__tests__/resolveLogic.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRedirect } from '../resolveLogic.mjs'

const FALLBACK = 'aimaimai://referral?code=none'
const API = 'https://test-api.ai-maimai.com/api/v1'

function mockFetcher(handler) {
  return async (url, opts) => handler({ url, opts })
}

test('cookieId 缺失 → 立即 fallback，不调 fetch', async () => {
  const url = await decideRedirect({
    cookieId: null,
    fetcher: () => assert.fail('不应调用 fetch'),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('cookieId 空字符串 → 立即 fallback，不调 fetch', async () => {
  const url = await decideRedirect({
    cookieId: '',
    fetcher: () => assert.fail('不应调用 fetch'),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('cookieId 有效 + API 返回推荐码 → redirect 带 code', async () => {
  const url = await decideRedirect({
    cookieId: 'abc123',
    fetcher: mockFetcher(({ url }) => {
      assert.match(url, /cookieId=abc123/)
      assert.ok(url.startsWith(API), 'fetch URL 必须基于 apiBase')
      return {
        ok: true,
        json: async () => ({ data: { referralCode: 'REF7777' } }),
      }
    }),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, 'aimaimai://referral?code=REF7777')
})

test('API 返回 referralCode=null → fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: true,
      json: async () => ({ data: { referralCode: null } }),
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('API 返回结构异常（无 data 字段）→ fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: true,
      json: async () => ({ message: 'unexpected' }),
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('API 返回 4xx → fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('API 返回 5xx → fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('fetch 抛错（网络断）→ fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: () => Promise.reject(new Error('Network error')),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('fetch 超时（超过 timeoutMs 仍未 resolve）→ fallback', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: (_url, opts) =>
      new Promise((resolve, reject) => {
        opts?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      }),
    timeoutMs: 50,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('cookieId 含特殊字符 → URL encode 正确', async () => {
  const url = await decideRedirect({
    cookieId: 'abc 中文+/',
    fetcher: mockFetcher(({ url }) => {
      assert.match(url, /cookieId=abc%20%E4%B8%AD%E6%96%87%2B%2F/)
      return {
        ok: true,
        json: async () => ({ data: { referralCode: 'OK' } }),
      }
    }),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, 'aimaimai://referral?code=OK')
})

test('referralCode 含特殊字符 → 输出 URI 正确 encode', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: true,
      json: async () => ({ data: { referralCode: 'ABC&xss=1' } }),
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, 'aimaimai://referral?code=ABC%26xss%3D1')
})

test('res.json() 抛 SyntaxError → fallback（API 返回非法 JSON）', async () => {
  const url = await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(() => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
    })),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.equal(url, FALLBACK)
})

test('调用方契约：cookieId 必须是已解码值（重复编码会破坏后端查找）', async () => {
  // 已解码值 'abc def' 应被编码为 'abc%20def'
  let observed = null
  await decideRedirect({
    cookieId: 'abc def',
    fetcher: mockFetcher(({ url }) => {
      observed = url
      return { ok: true, json: async () => ({ data: { referralCode: 'X' } }) }
    }),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.match(observed, /cookieId=abc%20def$/)
  assert.doesNotMatch(observed, /cookieId=abc%2520def/, '不应 double-encode')
})

test('AbortController.signal 被正确传给 fetcher', async () => {
  let receivedSignal = null
  await decideRedirect({
    cookieId: 'abc',
    fetcher: mockFetcher(({ opts }) => {
      receivedSignal = opts?.signal
      return {
        ok: true,
        json: async () => ({ data: { referralCode: 'X' } }),
      }
    }),
    timeoutMs: 3000,
    apiBase: API,
  })
  assert.ok(receivedSignal, 'signal 必须传给 fetcher 用于超时取消')
  assert.equal(typeof receivedSignal.aborted, 'boolean')
})
