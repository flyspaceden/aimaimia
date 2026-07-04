import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { getApiBaseUrl } from '@/lib/apiBase'
import { redirectToCanonicalDomainIfNeeded } from '@/lib/canonicalDomain'
import {
  ANDROID_TEST_DOWNLOAD_URL,
  pickAndroidDownloadUrl,
  resolveAndroidFallbackUrl,
} from '@/lib/downloadLinks'
import { buildNormalShareClipboardText, copyTextToClipboard } from '@/lib/referralClipboard'

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

function isValidNormalShareCode(code?: string): boolean {
  return !!code && /^S[A-Za-z0-9]{7}$/.test(code)
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const domainStr = isLocalhost ? '' : 'domain=.ai-maimai.com;'
  document.cookie = `${name}=${encodeURIComponent(value)};${domainStr}expires=${expires};path=/;SameSite=Lax`
}

function redirectToAndroidDownload(downloadUrl: string) {
  const fallbackUrl = resolveAndroidFallbackUrl(downloadUrl)
  if (!fallbackUrl) {
    window.location.href = downloadUrl
    return
  }
  window.setTimeout(() => {
    window.location.href = fallbackUrl
  }, 1800)
  window.location.href = downloadUrl
}

export default function NormalShareLanding() {
  if (typeof window !== 'undefined' && redirectToCanonicalDomainIfNeeded()) {
    return null
  }

  const { code } = useParams<{ code?: string }>()
  const platform = detectPlatform()
  const wechat = isWechat()
  const normalShareCode = code && isValidNormalShareCode(code) ? code.toUpperCase() : null
  const shareToken = normalShareCode ? buildNormalShareClipboardText(normalShareCode) : ''
  const [showWechatGuide, setShowWechatGuide] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)

  useEffect(() => {
    if (!normalShareCode) return
    const reportDeferred = async () => {
      try {
        const res = await fetch(`${API_BASE}/normal-share/deferred/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: normalShareCode,
            userAgent: navigator.userAgent,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            language: navigator.language,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.cookieId) {
            setCookie('_nsdl_id', data.data.cookieId, 7)
          }
        }
      } catch {
        // 静默失败，剪贴板口令仍可兜底
      }
    }
    reportDeferred()
  }, [normalShareCode])

  useEffect(() => {
    if (wechat) setShowWechatGuide(true)
  }, [wechat])

  const copyNormalShareToken = async () => {
    if (!shareToken) return false
    const ok = await copyTextToClipboard(shareToken)
    if (ok) setCodeCopied(true)
    return ok
  }

  const handleCopyCode = async () => {
    const ok = await copyNormalShareToken()
    if (!ok && normalShareCode) {
      window.alert(`复制失败，请记下普通分享码：${normalShareCode}，下载后在 App 内手动输入`)
    }
  }

  const handleDownload = async () => {
    if (wechat) {
      setShowWechatGuide(true)
      return
    }
    await copyNormalShareToken()
    if (platform === 'ios') {
      window.alert('iOS 版即将上线，请使用安卓手机扫码下载')
    } else if (platform === 'android') {
      redirectToAndroidDownload(pickAndroidDownloadUrl(navigator.userAgent))
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f2f24 0%, #183b4f 48%, #14213d 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      color: '#fff',
      overflow: 'hidden',
    }}>
      <div style={{
        width: 82,
        height: 82,
        borderRadius: 24,
        background: 'linear-gradient(135deg, #2E7D32, #22C55E)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 12px 36px rgba(34,197,94,0.28)',
        marginBottom: 24,
      }}>
        <span style={{ fontSize: 34, fontWeight: 800 }}>买</span>
      </div>

      <p style={{
        margin: '0 0 8px 0',
        fontSize: 13,
        letterSpacing: 0,
        color: 'rgba(255,255,255,0.68)',
      }}>
        好友邀请你加入爱买买
      </p>
      <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2, letterSpacing: 0 }}>
        领普通成长奖励
      </h1>
      <p style={{
        maxWidth: 340,
        margin: '14px 0 28px',
        color: 'rgba(255,255,255,0.72)',
        textAlign: 'center',
        fontSize: 15,
        lineHeight: 1.7,
      }}>
        注册登录即可生成普通成长账户，购物、签到、分享都能获得普通积分和成长值。
      </p>

      {normalShareCode ? (
        <div
          onClick={handleCopyCode}
          style={{
            width: 'min(360px, 100%)',
            borderRadius: 18,
            border: '1px dashed rgba(255,255,255,0.32)',
            background: 'rgba(255,255,255,0.08)',
            padding: 18,
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.62)' }}>普通分享码</p>
          <p style={{
            margin: '8px 0 0',
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 4,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {normalShareCode}
          </p>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: codeCopied ? '#86efac' : 'rgba(255,255,255,0.58)' }}>
            {codeCopied ? '已复制，打开 App 后自动识别' : '点击复制，打开 App 后自动识别'}
          </p>
        </div>
      ) : (
        <div style={{ color: '#fecaca', marginBottom: 18 }}>普通分享码无效</div>
      )}

      {platform !== 'desktop' ? (
        <button
          type="button"
          onClick={handleDownload}
          style={{
            marginTop: 24,
            border: 'none',
            borderRadius: 999,
            padding: '16px 46px',
            color: '#fff',
            fontSize: 17,
            fontWeight: 700,
            background: 'linear-gradient(135deg, #16A34A, #2563EB)',
            boxShadow: '0 10px 28px rgba(37,99,235,0.28)',
          }}
        >
          {platform === 'ios' ? 'iOS 版即将上线' : '下载安卓版'}
        </button>
      ) : (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <div style={{ padding: 14, borderRadius: 16, backgroundColor: '#fff' }}>
            <QRCodeSVG value={shareToken || ANDROID_TEST_DOWNLOAD_URL} size={168} fgColor="#163326" />
          </div>
          <p style={{ color: 'rgba(255,255,255,0.58)', marginTop: 12, fontSize: 13 }}>
            用手机扫码打开
          </p>
        </div>
      )}

      {showWechatGuide && (
        <div
          onClick={() => setShowWechatGuide(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            paddingTop: 20,
            paddingRight: 24,
          }}
        >
          <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
            <path d="M30 50 L30 15 L15 30" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M30 15 L45 30" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <p style={{ color: '#fff', fontSize: 18, fontWeight: 600, textAlign: 'right', marginTop: 16, lineHeight: 1.6 }}>
            点击右上角 ··· <br />
            选择「在浏览器中打开」
          </p>
        </div>
      )}
    </div>
  )
}
