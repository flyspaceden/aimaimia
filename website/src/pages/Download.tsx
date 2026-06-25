import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { getApiBaseUrl } from '@/lib/apiBase'
import { redirectToCanonicalDomainIfNeeded } from '@/lib/canonicalDomain'
import {
  ANDROID_TEST_DOWNLOAD_URL,
  pickAndroidDownloadUrl,
  resolveAndroidFallbackUrl,
} from '@/lib/downloadLinks'
import { buildReferralClipboardText, copyTextToClipboard } from '@/lib/referralClipboard'

const API_BASE = getApiBaseUrl()

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
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  // 必须与 App 端 /resolve 的 host 同域，跨域 cookie 桶不互通
  const domainStr = isLocalhost ? '' : 'domain=.ai-maimai.com;'
  document.cookie = `${name}=${encodeURIComponent(value)};${domainStr}expires=${expires};path=/;SameSite=Lax`
}

function isValidReferralCode(code?: string): boolean {
  return !!code && /^[A-Za-z0-9]{8}$/.test(code)
}

function redirectToAndroidDownload(downloadUrl: string) {
  const fallbackUrl = resolveAndroidFallbackUrl(downloadUrl)

  if (!fallbackUrl) {
    window.location.href = downloadUrl
    return
  }

  let fallbackTimer: number | null = null

  const cleanupFallback = () => {
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
    window.removeEventListener('pagehide', cleanupFallback)
    document.removeEventListener('visibilitychange', cancelFallbackWhenHidden)
  }

  const cancelFallbackWhenHidden = () => {
    if (document.hidden) cleanupFallback()
  }

  window.addEventListener('pagehide', cleanupFallback, { once: true })
  document.addEventListener('visibilitychange', cancelFallbackWhenHidden)

  fallbackTimer = window.setTimeout(() => {
    cleanupFallback()
    window.location.href = fallbackUrl
  }, 1800)

  window.location.href = downloadUrl
}

export default function Download() {
  // 中文域名落地：在所有 Hook 调用前同步重定向并阻止首屏渲染，避免一闪而过
  if (typeof window !== 'undefined' && redirectToCanonicalDomainIfNeeded()) {
    return null
  }

  const { code } = useParams<{ code?: string; groupBuyCode?: string }>()
  const location = useLocation()
  const [showWechatGuide, setShowWechatGuide] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const platform = detectPlatform()
  const wechat = isWechat()
  const isReferralLanding = location.pathname.startsWith('/r/')
  // 合法的 8 位推荐码（统一大写）；非推荐落地（/download）为 null
  const referralCode = isReferralLanding && code && isValidReferralCode(code) ? code.toUpperCase() : null

  useEffect(() => {
    if (!isReferralLanding || !code || !isValidReferralCode(code)) return

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
  }, [code, isReferralLanding])

  useEffect(() => {
    if (wechat) {
      setShowWechatGuide(true)
    }
  }, [wechat])

  // 把推荐口令写进剪贴板（必须发生在用户点击手势内，浏览器才放行）。
  // App 首启会静默读剪贴板自动绑定——这是推荐关系传递的首选路径，与下载渠道无关
  const copyReferralToken = async (): Promise<boolean> => {
    if (!referralCode) return false
    const ok = await copyTextToClipboard(buildReferralClipboardText(referralCode))
    if (ok) setCodeCopied(true)
    return ok
  }

  const handleCopyCode = async () => {
    const ok = await copyReferralToken()
    if (!ok && referralCode) {
      window.alert(`复制失败，请记下邀请码：${referralCode}，下载后在 App 内手动输入`)
    }
  }

  const handleDownload = async () => {
    if (wechat) {
      setShowWechatGuide(true)
      return
    }
    // 跳走前抢先复制推荐口令（失败也不拦下载，还有指纹匹配 + 手动输入兜底）
    await copyReferralToken()
    if (platform === 'ios') {
      // iOS 版尚未上架 App Store，给提示而非跳死链
      window.alert('iOS 版即将上线，请使用安卓手机扫码下载')
    } else if (platform === 'android') {
      // 厂商可识别时优先本机商店；识别不到或本机商店 scheme 打不开时回退小米 OneLink。
      redirectToAndroidDownload(pickAndroidDownloadUrl(navigator.userAgent))
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
          {platform === 'ios' ? 'iOS 版即将上线' : '下载安卓版'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{
            padding: 16, borderRadius: 16, backgroundColor: '#fff',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <QRCodeSVG
              value={window.location.href}
              size={180}
              fgColor="#1a2744"
              bgColor="#ffffff"
            />
          </div>
          <p style={{
            fontSize: 14, color: 'rgba(255,255,255,0.5)',
            marginTop: 16, textAlign: 'center',
          }}>
            用手机扫码下载 App
          </p>
        </div>
      )}

      {/* 邀请码卡片：剪贴板被禁（微信内置浏览器等）或被覆盖时的可见兜底 */}
      {referralCode && platform !== 'desktop' && (
        <div
          onClick={handleCopyCode}
          style={{
            marginTop: 20,
            padding: '12px 28px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.08)',
            border: '1px dashed rgba(255,255,255,0.35)',
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
            我的邀请码
          </p>
          <p style={{
            margin: '6px 0 0 0', fontSize: 26, fontWeight: 700,
            letterSpacing: 6, color: '#fff', fontFamily: 'monospace',
          }}>
            {referralCode}
          </p>
          <p style={{
            margin: '8px 0 0 0', fontSize: 12,
            color: codeCopied ? '#66BB6A' : 'rgba(255,255,255,0.5)',
          }}>
            {codeCopied
              ? '✓ 已复制，下载打开 App 后自动识别'
              : '点击复制 · 下载打开 App 后自动识别'}
          </p>
        </div>
      )}

      {platform === 'android' && (
        <div style={{
          marginTop: 28,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          <div style={{
            padding: 12,
            borderRadius: 14,
            backgroundColor: '#fff',
            boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
          }}>
            {/* 有推荐码：二维码必须指向推荐链接本身，朋友扫屏幕也能把推荐关系带走；
                无推荐码（/download）：直接指向 OneLink 下载 */}
            <QRCodeSVG
              value={referralCode ? buildReferralClipboardText(referralCode) : ANDROID_TEST_DOWNLOAD_URL}
              size={132}
              fgColor="#36404a"
              bgColor="#ffffff"
            />
          </div>
          <p style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.58)',
            margin: '12px 0 0 0',
            textAlign: 'center',
          }}>
            {referralCode ? '朋友扫这个码，推荐关系自动跟随' : '扫码或点击按钮下载安卓版'}
          </p>
        </div>
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
