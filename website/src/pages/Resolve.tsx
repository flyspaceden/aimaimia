import { useEffect } from 'react'
import { getApiBaseUrl } from '@/lib/apiBase'

const API_BASE = getApiBaseUrl()

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

// 中文域名（爱买买.com / xn--ckqa175y.com）落地时强制跳到英文域名，
// 否则 cookie 写在中文域桶 / App 端读英文域桶，跨域读不到
function redirectToCanonicalDomainIfNeeded(): boolean {
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

export default function Resolve() {
  useEffect(() => {
    if (redirectToCanonicalDomainIfNeeded()) return

    const resolve = async () => {
      const cookieId = getCookie('_ddl_id')

      if (cookieId) {
        try {
          const res = await fetch(`${API_BASE}/deferred-link/resolve?cookieId=${encodeURIComponent(cookieId)}`)
          if (res.ok) {
            const data = await res.json()
            const code = data.data?.referralCode
            if (code) {
              window.location.href = `aimaimai://referral?code=${encodeURIComponent(code)}`
              return
            }
          }
        } catch {
          // 静默失败
        }
      }

      window.location.href = 'aimaimai://referral?code=none'
    }

    resolve()
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a1628',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>正在处理...</p>
    </div>
  )
}
