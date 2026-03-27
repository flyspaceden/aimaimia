import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}

function isWechat(): boolean {
  return /micromessenger/i.test(navigator.userAgent)
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`
}

export default function Download() {
  const { code } = useParams<{ code?: string }>()
  const [showWechatGuide, setShowWechatGuide] = useState(false)
  const platform = detectPlatform()
  const wechat = isWechat()

  useEffect(() => {
    if (!code) return

    const reportFingerprint = async () => {
      try {
        const res = await fetch(`${API_BASE}/deferred-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referralCode: code.toUpperCase(),
            userAgent: navigator.userAgent,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            language: navigator.language,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.cookieId) {
            setCookie('_ddl_id', data.data.cookieId, 7)
          }
        }
      } catch {
        // 静默失败
      }
    }

    reportFingerprint()
  }, [code])

  useEffect(() => {
    if (wechat) {
      setShowWechatGuide(true)
    }
  }, [wechat])

  const handleDownload = () => {
    if (wechat) {
      setShowWechatGuide(true)
      return
    }
    if (platform === 'ios') {
      window.location.href = 'https://apps.apple.com/app/id000000000'
    } else if (platform === 'android') {
      window.location.href = 'https://play.google.com/store/apps/details?id=com.aimaimai.shop'
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a1628 0%, #1a2744 50%, #0d1f3c 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 20,
        background: 'linear-gradient(135deg, #2E7D32, #66BB6A)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 24, boxShadow: '0 8px 32px rgba(46, 125, 50, 0.3)',
      }}>
        <span style={{ fontSize: 36, color: '#fff', fontWeight: 700 }}>买</span>
      </div>

      <h1 style={{
        fontSize: 28, fontWeight: 700, color: '#fff',
        margin: '0 0 8px 0', letterSpacing: 2,
      }}>
        爱买买
      </h1>

      <p style={{
        fontSize: 16, color: 'rgba(255,255,255,0.7)',
        margin: '0 0 40px 0', textAlign: 'center',
      }}>
        加入爱买买，发现优质农产品
      </p>

      {platform !== 'desktop' ? (
        <button
          onClick={handleDownload}
          style={{
            background: 'linear-gradient(135deg, #2E7D32, #43A047)',
            color: '#fff', border: 'none', borderRadius: 50,
            padding: '16px 48px', fontSize: 18, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(46, 125, 50, 0.4)',
          }}
        >
          {platform === 'ios' ? '前往 App Store 下载' : '前往应用商店下载'}
        </button>
      ) : (
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
          请在手机上打开此页面下载 App
        </p>
      )}

      {showWechatGuide && (
        <div
          onClick={() => setShowWechatGuide(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'flex-end', paddingTop: 20, paddingRight: 24,
          }}
        >
          <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
            <path d="M30 50 L30 15 L15 30" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M30 15 L45 30" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <p style={{
            color: '#fff', fontSize: 18, fontWeight: 600,
            textAlign: 'right', marginTop: 16, lineHeight: 1.6,
          }}>
            点击右上角 ··· <br />
            选择「在浏览器中打开」
          </p>
          <p style={{
            color: 'rgba(255,255,255,0.5)', fontSize: 14,
            textAlign: 'center', position: 'absolute', bottom: 40,
            left: 0, right: 0,
          }}>
            点击任意位置关闭
          </p>
        </div>
      )}
    </div>
  )
}
