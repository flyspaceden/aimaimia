import { useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

export default function Resolve() {
  useEffect(() => {
    const resolve = async () => {
      const cookieId = getCookie('_ddl_id')

      if (cookieId) {
        try {
          const res = await fetch(`${API_BASE}/deferred-link/resolve?cookieId=${encodeURIComponent(cookieId)}`)
          if (res.ok) {
            const data = await res.json()
            const code = data.data?.referralCode
            if (code) {
              window.location.href = `aimaimai://referral?code=${code}`
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
