// 推荐码剪贴板口令（落地页点「下载」时写入，App 首启读取后自动绑定）。
//
// 口令文本直接用推荐链接本身：App 端 extractReferralCodeFromURL 已能从该
// URL 解析出 8 位推荐码；即使用户把它误粘贴到聊天里，也是一条有意义的
// 可点开链接，而非看不懂的乱码口令。
export function buildReferralClipboardText(code: string): string {
  return `https://app.ai-maimai.com/r/${code.toUpperCase()}`
}

export function buildNormalShareClipboardText(code: string): string {
  return `https://app.ai-maimai.com/s/${code.toUpperCase()}`
}

export function buildNormalShareAppScheme(code: string): string {
  return `aimaimai://normal-share?code=${code.toUpperCase()}`
}

export function buildCaptainClipboardText(code: string): string {
  return `https://app.ai-maimai.com/c/${encodeURIComponent(code.trim().toUpperCase())}`
}

// 写剪贴板：现代 Clipboard API 优先，execCommand 兜底。
// 必须在用户点击手势内调用，浏览器才放行；微信内置浏览器等环境可能两条路都拒绝，
// 返回 false 由调用方降级（页面上有大字邀请码 + App 内手动输入兜底）。
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through 到 execCommand 兜底
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
