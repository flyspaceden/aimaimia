import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { getApiBaseUrl } from '@/lib/apiBase'
import { redirectToCanonicalDomainIfNeeded } from '@/lib/canonicalDomain'
import {
  apiErrorMessage,
  bindingStatusText,
  canContinueAfterLandingCodeStatus,
  normalizeInviteCode,
  submitStateForBindingStatus,
  unwrapApiData,
  type InviteBindingStatus,
} from '@/lib/inviteH5'
import { pickAndroidDownloadUrl, resolveAndroidFallbackUrl } from '@/lib/downloadLinks'

const API_BASE = getApiBaseUrl()

type Platform = 'ios' | 'android' | 'desktop'
type LandingState = 'checking' | 'ready' | 'invalid' | 'unverified'
type SubmitState = 'idle' | 'success' | 'warning' | 'error'

type LandingResponse = {
  landingSessionId: string
  codeStatus: string
}

type InviteLoginResponse = {
  accessToken?: string
  refreshToken?: string
  userId: string
  inviteBinding?: {
    status: InviteBindingStatus
    type: 'NORMAL_SHARE' | 'VIP_REFERRAL' | null
    message?: string
  }
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}

function isWechat(): boolean {
  return /micromessenger/i.test(navigator.userAgent)
}

function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone.trim())
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(apiErrorMessage(payload, '请求失败，请稍后重试'))
  }
  return unwrapApiData<T>(payload) as T
}

function redirectToAndroidDownload(downloadUrl: string) {
  const fallbackUrl = resolveAndroidFallbackUrl(downloadUrl)
  if (!fallbackUrl) {
    window.location.href = downloadUrl
    return
  }

  const fallbackTimer = window.setTimeout(() => {
    window.location.href = fallbackUrl
  }, 1800)
  const cancelFallback = () => window.clearTimeout(fallbackTimer)
  window.addEventListener('pagehide', cancelFallback, { once: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelFallback()
  }, { once: true })
  window.location.href = downloadUrl
}

export default function InviteAuthLanding() {
  if (typeof window !== 'undefined' && redirectToCanonicalDomainIfNeeded()) {
    return null
  }

  const { code } = useParams<{ code?: string }>()
  const inviteCode = useMemo(() => normalizeInviteCode(code), [code])
  const [landingSessionId, setLandingSessionId] = useState<string>()
  const [landingState, setLandingState] = useState<LandingState>(() => (inviteCode ? 'checking' : 'invalid'))
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [name, setName] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [loginCompleted, setLoginCompleted] = useState(false)
  const [showWechatGuide, setShowWechatGuide] = useState(false)
  const platform = detectPlatform()
  const wechat = isWechat()
  const authCompleted = loginCompleted
  const formDisabled = !inviteCode || landingState === 'invalid' || landingState === 'checking' || authCompleted

  useEffect(() => {
    if (!inviteCode) {
      setLandingState('invalid')
      setNotice('邀请链接不可用')
      return
    }

    let active = true
    setLandingState('checking')
    setNotice('')

    postJson<LandingResponse>('/invite-h5/landing', {
      inviteCode,
      userAgent: navigator.userAgent,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      language: navigator.language,
    }).then((res) => {
      if (!active) return
      setLandingSessionId(res.landingSessionId)
      if (!canContinueAfterLandingCodeStatus(res.codeStatus)) {
        setLandingState('invalid')
        setNotice('邀请链接不可用')
      } else if (res.codeStatus === 'INVALID' || res.codeStatus === 'CONFLICT') {
        setLandingState('unverified')
        setNotice('邀请链接暂不可用，登录后不会绑定推荐关系')
      } else {
        setLandingState('ready')
      }
    }).catch(() => {
      if (!active) return
      setLandingState('unverified')
    })

    return () => {
      active = false
    }
  }, [inviteCode])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  const handleSendCode = async () => {
    if (!isValidPhone(phone)) {
      setSubmitState('error')
      setNotice('请输入正确的手机号')
      return
    }
    setSendingCode(true)
    setSubmitState('idle')
    setNotice('')
    try {
      await postJson('/auth/sms/code', { phone: phone.trim() })
      setCountdown(60)
      setNotice('验证码已发送')
    } catch (err) {
      setSubmitState('error')
      setNotice(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (authCompleted) return
    if (!inviteCode) {
      setSubmitState('error')
      setNotice('邀请链接不可用')
      return
    }
    if (!isValidPhone(phone)) {
      setSubmitState('error')
      setNotice('请输入正确的手机号')
      return
    }
    if (smsCode.trim().length < 4) {
      setSubmitState('error')
      setNotice('请输入验证码')
      return
    }

    setSubmitting(true)
    setSubmitState('idle')
    setNotice('')
    try {
      const res = await postJson<InviteLoginResponse>('/auth/invite-login', {
        phone: phone.trim(),
        code: smsCode.trim(),
        name: name.trim() || undefined,
        inviteCode,
        landingSessionId,
      })
      if (res.accessToken) sessionStorage.setItem('invite_h5_access_token', res.accessToken)
      if (res.refreshToken) sessionStorage.setItem('invite_h5_refresh_token', res.refreshToken)
      setLoginCompleted(true)

      const bindingStatus = res.inviteBinding?.status
      const message = res.inviteBinding?.message || bindingStatusText(bindingStatus)
      setSubmitState(submitStateForBindingStatus(bindingStatus))
      setNotice(message)
    } catch (err) {
      setSubmitState('error')
      setNotice(err instanceof Error ? err.message : '登录失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDownload = () => {
    if (wechat) {
      setShowWechatGuide(true)
      return
    }
    if (platform === 'ios') {
      window.alert('iOS 版即将上线，请使用安卓手机下载')
      return
    }
    if (platform === 'android') {
      redirectToAndroidDownload(pickAndroidDownloadUrl(navigator.userAgent))
      return
    }
    window.location.href = '/download'
  }

  const noticeTone = submitState === 'success'
    ? 'border-[#b8dfc2] bg-[#eef8ef] text-[#1f6f35]'
    : submitState === 'warning'
      ? 'border-[#ecd99d] bg-[#fff8df] text-[#795a0a]'
      : submitState === 'error' || landingState === 'invalid'
        ? 'border-[#f0c4c4] bg-[#fff0f0] text-[#9f1d1d]'
        : 'border-[#d7e7d5] bg-white/70 text-[#36543c]'

  return (
    <div className="min-h-screen bg-[#f7fbf1] text-[#17211a]" style={{
      backgroundImage: 'linear-gradient(150deg, #f8fbf2 0%, #edf6ee 54%, #e7f4f7 100%)',
    }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-5 py-8">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#247a3e] text-2xl font-bold text-white shadow-[0_12px_30px_rgba(36,122,62,0.22)]">
            买
          </div>
          <div>
            <p className="m-0 text-sm font-semibold text-[#247a3e]">爱买买</p>
            <h1 className="m-0 text-[26px] font-bold leading-tight tracking-[0]">手机号登录</h1>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-[#d9e7d4] bg-white p-5 shadow-[0_18px_60px_rgba(23,33,26,0.10)]"
        >
          <div className="mb-5 flex items-center justify-between gap-3 border-b border-[#e6eee3] pb-4">
            <span className="text-sm font-medium text-[#4e6652]">
              {landingState === 'checking'
                ? '正在识别邀请通道'
                : landingState === 'invalid'
                  ? '邀请通道不可用'
                  : landingState === 'unverified'
                    ? '邀请通道待确认'
                    : '邀请通道已识别'}
            </span>
            <span className={`h-2.5 w-2.5 rounded-full ${landingState === 'invalid' ? 'bg-[#dc2626]' : landingState === 'checking' ? 'bg-[#d79b28]' : 'bg-[#247a3e]'}`} />
          </div>

          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-semibold text-[#263a2b]">昵称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
              disabled={formDisabled || submitting}
              placeholder="选填"
              className="h-12 w-full rounded-md border border-[#cfded0] bg-[#fbfdf9] px-3 text-[16px] text-[#17211a] outline-none transition focus:border-[#247a3e] disabled:cursor-not-allowed disabled:bg-[#f1f4ef]"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-semibold text-[#263a2b]">手机号</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={11}
              disabled={formDisabled || submitting}
              placeholder="请输入手机号"
              className="h-12 w-full rounded-md border border-[#cfded0] bg-[#fbfdf9] px-3 text-[16px] text-[#17211a] outline-none transition focus:border-[#247a3e] disabled:cursor-not-allowed disabled:bg-[#f1f4ef]"
            />
          </label>

          <label className="mb-5 block">
            <span className="mb-2 block text-sm font-semibold text-[#263a2b]">验证码</span>
            <div className="grid grid-cols-[1fr_112px] gap-2">
              <input
                value={smsCode}
                onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={formDisabled || submitting}
                placeholder="短信验证码"
                className="h-12 min-w-0 rounded-md border border-[#cfded0] bg-[#fbfdf9] px-3 text-[16px] text-[#17211a] outline-none transition focus:border-[#247a3e] disabled:cursor-not-allowed disabled:bg-[#f1f4ef]"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={formDisabled || sendingCode || countdown > 0 || submitting}
                className="h-12 rounded-md border border-[#247a3e] bg-white px-2 text-sm font-semibold text-[#247a3e] transition hover:bg-[#eef8ef] disabled:cursor-not-allowed disabled:border-[#b9cbbb] disabled:text-[#8aa08d]"
              >
                {sendingCode ? '发送中' : countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          </label>

          {notice && (
            <div className={`mb-5 rounded-md border px-3 py-3 text-sm leading-6 ${noticeTone}`} aria-live="polite">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={formDisabled || submitting}
            className="h-12 w-full rounded-md bg-[#247a3e] text-[16px] font-bold text-white shadow-[0_10px_24px_rgba(36,122,62,0.24)] transition hover:bg-[#1f6f35] disabled:cursor-not-allowed disabled:bg-[#9eb5a1] disabled:shadow-none"
          >
            {authCompleted ? '已登录' : submitting ? '登录中' : '登录并绑定'}
          </button>

          {submitState === 'success' || submitState === 'warning' ? (
            <button
              type="button"
              onClick={handleDownload}
              className="mt-3 h-12 w-full rounded-md border border-[#0e7c86] bg-white text-[16px] font-bold text-[#0e7c86] transition hover:bg-[#eef9fa]"
            >
              下载 App
            </button>
          ) : null}
        </form>

        <p className="mt-5 text-center text-xs leading-6 text-[#6b7f6d]">
          未注册手机号会自动创建账号。之后用同一手机号登录 App。
        </p>
      </div>

      {showWechatGuide && (
        <div
          onClick={() => setShowWechatGuide(false)}
          className="fixed inset-0 z-[9999] flex flex-col items-end bg-black/85 px-6 pt-5 text-white"
        >
          <div className="h-14 w-14 border-r-4 border-t-4 border-white" style={{ transform: 'rotate(-45deg)' }} />
          <p className="mt-5 text-right text-lg font-semibold leading-8">
            点击右上角<br />
            选择在浏览器中打开
          </p>
          <p className="absolute inset-x-0 bottom-10 text-center text-sm text-white/60">
            点击任意位置关闭
          </p>
        </div>
      )}
    </div>
  )
}
