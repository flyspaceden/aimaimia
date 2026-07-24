import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { getApiBaseUrl } from '@/lib/apiBase'
import { redirectToCanonicalDomainIfNeeded } from '@/lib/canonicalDomain'
import {
  apiErrorMessage,
  bindingStatusText,
  buildH5WechatStartUrl,
  canResumeWechatDownload,
  canContinueAfterLandingCodeStatus,
  clearInviteDownloadPass,
  getWechatCallbackParams,
  inviteLandingSessionStorageKey,
  normalizeInviteCode,
  readInviteDownloadPass,
  readInviteDownloadHandoff,
  removeWechatCallbackHash,
  removeWechatCallbackParamsFromSearch,
  storeInviteDownloadPass,
  submitStateForBindingStatus,
  withoutInviteDownloadHandoff,
  unwrapApiData,
  withInviteDownloadHandoff,
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

type DownloadPassResponse =
  | { status: 'READY'; expiresAt: string }
  | { status: 'RENEW_REQUIRED' }

type ConsumeDownloadPassResponse = {
  valid: boolean
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
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

async function postJson<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiRequestError(apiErrorMessage(payload, '请求失败，请稍后重试'), res.status)
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

function startDownloadInBrowser(platform: Platform) {
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

/** 32 字节随机值经 base64url 编码后固定为 43 个字符。 */
function createDownloadPassTicket(): string {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return window.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

/**
 * 必须触发真实导航：微信“在浏览器中打开”会取实际加载的 URL，不能依赖
 * replaceState 写入的 hash。handoff 是高熵、10 分钟、一次性的下载凭证，
 * 不携带登录 token、手机号或推荐码。
 */
function navigateToDownloadHandoff(ticket: string) {
  const url = new URL(window.location.href)
  url.search = withInviteDownloadHandoff(url.search, ticket)
  url.hash = ''
  window.location.replace(url.toString())
}

function removeDownloadHandoffFromUrl() {
  const url = new URL(window.location.href)
  url.search = withoutInviteDownloadHandoff(url.search)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export default function InviteAuthLanding() {
  if (typeof window !== 'undefined' && redirectToCanonicalDomainIfNeeded()) {
    return null
  }

  const { code } = useParams<{ code?: string }>()
  const inviteCode = useMemo(() => normalizeInviteCode(code), [code])
  // 只在页面首次打开时读取。系统浏览器消费前会立即从地址栏移除，不能因为 URL
  // 改写让 React 取消尚在进行的消费请求。
  const [downloadPass, setDownloadPass] = useState(() => {
    return readInviteDownloadHandoff(window.location.search)
  })
  const landingSessionStorageKey = useMemo(
    () => (inviteCode ? inviteLandingSessionStorageKey(inviteCode) : null),
    [inviteCode],
  )
  const [wechatCallbackParams] = useState(() => getWechatCallbackParams(window.location.search))
  const hasWechatCallback = Boolean(wechatCallbackParams.wechatCode && wechatCallbackParams.state)
  const [landingSessionId, setLandingSessionId] = useState<string | undefined>(() => {
    const initialInviteCode = normalizeInviteCode(code)
    if (!initialInviteCode) return undefined
    return sessionStorage.getItem(inviteLandingSessionStorageKey(initialInviteCode)) || undefined
  })
  const [preparedDownloadPass, setPreparedDownloadPass] = useState<string | null>(() => (
    landingSessionId ? readInviteDownloadPass(sessionStorage, landingSessionId) : null
  ))
  const [landingState, setLandingState] = useState<LandingState>(() => (inviteCode ? 'checking' : 'invalid'))
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [name, setName] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [loginCompleted, setLoginCompleted] = useState(() => (
    isWechat() && canResumeWechatDownload({
      ticket: downloadPass || preparedDownloadPass,
      accessToken: sessionStorage.getItem('invite_h5_access_token'),
      landingSessionId,
    })
  ))
  const [showWechatGuide, setShowWechatGuide] = useState(false)
  const [preparingDownload, setPreparingDownload] = useState(false)
  const landingRequestRef = useRef<{ key: string; promise: Promise<LandingResponse> } | null>(null)
  const wechatCallbackRequestRef = useRef<{ key: string; promise: Promise<InviteLoginResponse> } | null>(null)
  const downloadPassRequestRef = useRef<Promise<void> | null>(null)
  const platform = detectPlatform()
  const wechat = isWechat()
  const hasResumableWechatDownload = wechat && canResumeWechatDownload({
    ticket: downloadPass || preparedDownloadPass,
    accessToken: sessionStorage.getItem('invite_h5_access_token'),
    landingSessionId,
  })
  const authCompleted = loginCompleted
  const formDisabled = !inviteCode || landingState === 'invalid' || landingState === 'checking' || authCompleted || Boolean(downloadPass)
  const wechatAuthDisabled = !inviteCode || landingState === 'invalid' || landingState === 'checking' || authCompleted || submitting || Boolean(downloadPass)

  const completeInviteAuth = (res: InviteLoginResponse) => {
    if (res.accessToken) sessionStorage.setItem('invite_h5_access_token', res.accessToken)
    if (res.refreshToken) sessionStorage.setItem('invite_h5_refresh_token', res.refreshToken)
    setLoginCompleted(true)

    const bindingStatus = res.inviteBinding?.status
    const message = res.inviteBinding?.message || bindingStatusText(bindingStatus)
    setSubmitState(submitStateForBindingStatus(bindingStatus))
    setNotice(message)
  }

  useEffect(() => {
    if (!downloadPass) return

    // 微信内不消费凭证，避免刷新页面后把凭证提前作废；系统浏览器才会原子消费并
    // 立即进入下载渠道。handoff query 是真实导航后的 URL，微信打开系统浏览器时可携带它。
    if (wechat) {
      const accessToken = sessionStorage.getItem('invite_h5_access_token')
      if (!canResumeWechatDownload({ ticket: downloadPass, accessToken, landingSessionId })) {
        removeDownloadHandoffFromUrl()
        if (landingSessionId) clearInviteDownloadPass(sessionStorage, landingSessionId)
        setDownloadPass(null)
        setPreparedDownloadPass(null)
        setLoginCompleted(false)
        setSubmitState('warning')
        setNotice('下载状态已失效，请重新登录后下载')
        return
      }
      if (landingSessionId) {
        const storedDownloadPass = readInviteDownloadPass(sessionStorage, landingSessionId)
        if (!storedDownloadPass) {
          storeInviteDownloadPass(sessionStorage, landingSessionId, downloadPass)
        }
        setPreparedDownloadPass((current) => current || storedDownloadPass || downloadPass)
      } else {
        setPreparedDownloadPass((current) => current || downloadPass)
      }
      setLoginCompleted(true)
      setSubmitState('success')
      setNotice('已完成登记，请在浏览器中打开，系统会自动前往下载')
      setShowWechatGuide(true)
      return
    }

    let active = true
    // 先清掉地址栏里的短时凭证，再发起请求，避免它进入浏览器历史或下游 Referer。
    removeDownloadHandoffFromUrl()
    setNotice('正在确认下载')

    postJson<ConsumeDownloadPassResponse>('/invite-h5/download-pass/consume', { ticket: downloadPass })
      .then((res) => {
        if (!active) return
        if (!res.valid) {
          setSubmitState('warning')
          setNotice('下载凭证已过期或已使用，请返回微信页面重新点击下载')
          return
        }
        setLoginCompleted(true)
        setSubmitState('success')
        setNotice('已完成登记，正在前往下载')
        window.setTimeout(() => startDownloadInBrowser(platform), 0)
      })
      .catch(() => {
        if (!active) return
        setSubmitState('error')
        setNotice('下载状态确认失败，请返回微信页面重新点击下载')
      })

    return () => {
      active = false
    }
  }, [downloadPass, landingSessionId, platform, wechat])

  useEffect(() => {
    if (!inviteCode) {
      setLandingState('invalid')
      setNotice('邀请链接不可用')
      return
    }
    // 从微信跳到系统浏览器时只应消费已有下载凭证，不能额外记一次扫码打开。
    if (downloadPass) {
      setLandingState('ready')
      return
    }
    // 创建凭证成功但响应丢失后刷新时，复用原 landing session 和持久化票据，
    // 不能再记一次扫码并换成未认证的新 session。
    if (hasResumableWechatDownload) {
      setLandingState('ready')
      return
    }
    if (hasWechatCallback) {
      setLandingState('ready')
      return
    }

    let active = true
    setLandingState('checking')
    setNotice('')

    if (landingRequestRef.current?.key !== inviteCode) {
      landingRequestRef.current = {
        key: inviteCode,
        promise: postJson<LandingResponse>('/invite-h5/landing', {
          inviteCode,
          userAgent: navigator.userAgent,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          language: navigator.language,
        }),
      }
    }

    landingRequestRef.current.promise.then((res) => {
      if (!active) return
      setLandingSessionId(res.landingSessionId)
      if (landingSessionStorageKey) {
        sessionStorage.setItem(landingSessionStorageKey, res.landingSessionId)
      }
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
  }, [
    inviteCode,
    downloadPass,
    hasResumableWechatDownload,
    hasWechatCallback,
    landingSessionStorageKey,
  ])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  useEffect(() => {
    if (!inviteCode || authCompleted) return
    const { wechatCode, state } = wechatCallbackParams
    if (!wechatCode || !state) return

    let active = true
    setSubmitting(true)
    setSubmitState('idle')
    setNotice('微信登录中')

    const callbackKey = `${inviteCode}:${wechatCode}:${state}`
    if (wechatCallbackRequestRef.current?.key !== callbackKey) {
      wechatCallbackRequestRef.current = {
        key: callbackKey,
        promise: postJson<InviteLoginResponse>('/auth/h5-wechat/invite-login', {
          wechatCode,
          state,
          inviteCode,
          landingSessionId,
        }),
      }
    }

    wechatCallbackRequestRef.current.promise.then((res) => {
      if (!active) return
      completeInviteAuth(res)
    }).catch((err) => {
      if (!active) return
      setSubmitState('error')
      setNotice(err instanceof Error ? err.message : '微信授权失败，请使用手机号登录')
    }).finally(() => {
      if (!active) return
      setSubmitting(false)
      const nextSearch = removeWechatCallbackParamsFromSearch(window.location.search)
      const nextHash = removeWechatCallbackHash(window.location.hash)
      window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}${nextHash}`)
    })

    return () => {
      active = false
    }
  }, [inviteCode, authCompleted, wechatCallbackParams, landingSessionId])

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
      completeInviteAuth(res)
    } catch (err) {
      setSubmitState('error')
      setNotice(err instanceof Error ? err.message : '登录失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleWechatLogin = () => {
    if (!inviteCode) {
      setSubmitState('error')
      setNotice('邀请链接不可用')
      return
    }
    if (!wechat) {
      setSubmitState('error')
      setNotice('请在微信中打开，或使用手机号登录')
      return
    }
    if (landingSessionId && landingSessionStorageKey) {
      sessionStorage.setItem(landingSessionStorageKey, landingSessionId)
    }
    window.location.href = buildH5WechatStartUrl(API_BASE, {
      inviteCode,
      landingSessionId,
    })
  }

  const prepareDownloadInWechat = async () => {
    const accessToken = sessionStorage.getItem('invite_h5_access_token')
    if (!accessToken || !landingSessionId) {
      setSubmitState('error')
      setNotice('登录状态已失效，请重新登录后下载')
      return
    }

    setPreparingDownload(true)
    try {
      // 同一个随机值可以安全重试：若请求已经写入但响应丢失，重新点击仍会拿回原凭证。
      let ticket = preparedDownloadPass ||
        readInviteDownloadPass(sessionStorage, landingSessionId) ||
        downloadPass ||
        createDownloadPassTicket()
      setPreparedDownloadPass(ticket)
      storeInviteDownloadPass(sessionStorage, landingSessionId, ticket)
      const requestPass = (candidate: string) => postJson<DownloadPassResponse>(
        '/invite-h5/download-pass',
        { landingSessionId, ticket: candidate },
        accessToken,
      )

      let response = await requestPass(ticket)
      // 从系统浏览器返回微信时，旧凭证可能已用完或超时；仅在这种明确状态下生成新值。
      if (response.status === 'RENEW_REQUIRED') {
        ticket = createDownloadPassTicket()
        setPreparedDownloadPass(ticket)
        storeInviteDownloadPass(sessionStorage, landingSessionId, ticket)
        response = await requestPass(ticket)
      }
      if (response.status !== 'READY') {
        throw new Error('下载凭证准备失败，请稍后重试')
      }

      navigateToDownloadHandoff(ticket)
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
        sessionStorage.removeItem('invite_h5_access_token')
        sessionStorage.removeItem('invite_h5_refresh_token')
        clearInviteDownloadPass(sessionStorage, landingSessionId)
        removeDownloadHandoffFromUrl()
        setDownloadPass(null)
        setPreparedDownloadPass(null)
        setLoginCompleted(false)
        setShowWechatGuide(false)
        setSubmitState('warning')
        setNotice('登录状态已失效，请重新登录后下载')
        return
      }
      setSubmitState('error')
      setNotice(err instanceof Error ? err.message : '下载准备失败，请稍后重试')
    } finally {
      setPreparingDownload(false)
    }
  }

  const handleDownload = () => {
    if (wechat) {
      const accessToken = sessionStorage.getItem('invite_h5_access_token')
      if (!accessToken || !landingSessionId) {
        setSubmitState('error')
        setNotice('登录状态已失效，请重新登录后下载')
        return
      }

      // 已完成真实 handoff 导航时，只重新展示“右上角打开浏览器”引导，不能重复
      // 签发或覆盖仍有效的一次性凭证。
      if (hasResumableWechatDownload && downloadPass) {
        setShowWechatGuide(true)
        return
      }

      if (downloadPassRequestRef.current) return
      const request = prepareDownloadInWechat()
      downloadPassRequestRef.current = request
      void request.finally(() => {
        if (downloadPassRequestRef.current === request) {
          downloadPassRequestRef.current = null
        }
      })
      return
    }
    startDownloadInBrowser(platform)
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
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-[1fr_112px]">
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

          <div className="my-4 flex items-center gap-3 text-xs text-[#829086] before:h-px before:flex-1 before:bg-[#e1eadf] after:h-px after:flex-1 after:bg-[#e1eadf]">
            也可以使用
          </div>

          <button
            type="button"
            onClick={handleWechatLogin}
            disabled={wechatAuthDisabled}
            className="h-12 w-full rounded-md border border-[#1aad19] bg-[#f8fff8] text-[16px] font-bold text-[#168b18] transition hover:bg-[#eefbea] disabled:cursor-not-allowed disabled:border-[#b9cbbb] disabled:bg-[#f3f7f2] disabled:text-[#8aa08d]"
          >
            微信登录
          </button>

          {authCompleted ? (
            <button
              type="button"
              onClick={handleDownload}
            disabled={preparingDownload}
              className="mt-3 h-12 w-full rounded-md border border-[#0e7c86] bg-white text-[16px] font-bold text-[#0e7c86] transition hover:bg-[#eef9fa]"
            >
              {preparingDownload
                ? '正在准备下载'
                : hasResumableWechatDownload && downloadPass
                  ? '请在右上角打开浏览器'
                  : '下载 App'}
            </button>
          ) : null}
        </form>

        <p className="mt-5 text-center text-xs leading-6 text-[#6b7f6d]">
          未注册手机号会自动创建账号。之后可下载 App 登录。
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
