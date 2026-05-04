// 中文域名（爱买买.com / xn--ckqa175y.com）落地时强制跳到英文域名，
// 否则 cookie 写在中文域桶 / App 端读英文域桶，跨域读不到
export function redirectToCanonicalDomainIfNeeded(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  if (host.includes('xn--ckqa175y') || host.includes('爱买买')) {
    const target = window.location.href.replace(
      /\/\/([^/]*\.)?(xn--ckqa175y|爱买买)\.com/,
      '//app.ai-maimai.com',
    )
    window.location.replace(target)
    return true
  }
  return false
}
