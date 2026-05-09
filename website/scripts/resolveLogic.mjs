/**
 * 把 cookieId 解析为 deep link URL，供静态 /resolve 页面与单元测试共用。
 *
 * 等价的 inline IIFE 在 scripts/resolve.template.html，两者必须保持行为一致：
 * - 空 cookie / 空字符串 → fallback，不调 API
 * - API 返回 referralCode 字符串 → redirect 带 encoded code
 * - 任何错误（4xx / 5xx / 网络断 / 超时 / json 解析失败）→ fallback
 *
 * 调用方契约：
 * - cookieId 必须是**已解码**的原始 cookie 值（调用方自己跑过 decodeURIComponent），
 *   函数内部会用 encodeURIComponent 再编码塞进 URL。重复编码会导致后端查不到。
 * - 错误日志：函数静默吞错以保持纯净，调用方（HTML 模板 / 测试）自行决定要不要 log。
 *
 * @param {object} deps
 * @param {string|null|undefined} deps.cookieId  已解码的 _ddl_id cookie 值
 * @param {(url: string, opts?: any) => Promise<{ok: boolean, json: () => Promise<any>}>} deps.fetcher
 * @param {number} deps.timeoutMs  AbortController 超时毫秒
 * @param {string} deps.apiBase  后端 API base，如 https://api.ai-maimai.com/api/v1
 * @returns {Promise<string>} 应跳转的 deep link URL
 */
export async function decideRedirect({ cookieId, fetcher, timeoutMs, apiBase }) {
  const FALLBACK = 'aimaimai://referral?code=none'
  if (!cookieId) return FALLBACK

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetcher(
      `${apiBase}/deferred-link/resolve?cookieId=${encodeURIComponent(cookieId)}`,
      { signal: ctrl.signal },
    )
    if (!res.ok) return FALLBACK
    const data = await res.json()
    const code = data?.data?.referralCode
    return code ? `aimaimai://referral?code=${encodeURIComponent(code)}` : FALLBACK
  } catch {
    return FALLBACK
  } finally {
    // 用 finally 统一清理：无论 fetcher 走 success/throw/abort 哪条路径，timer 都不会泄漏
    clearTimeout(timer)
  }
}
