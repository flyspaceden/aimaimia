import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { getApiBaseUrl } from '@/lib/apiBase'
import { redirectToCanonicalDomainIfNeeded } from '@/lib/canonicalDomain'
import {
  apiErrorMessage,
  bindingStatusText,
  buildInviteDownloadHandoffUrl,
  buildH5WechatStartUrl,
  canResumeWechatDownload,
  canContinueAfterLandingCodeStatus,
  clearInviteDownloadPass,
  getWechatCallbackParams,
  inviteLandingSessionStorageKey,
  normalizeInviteCode,
  readInviteDownloadPass,
  readInviteDownloadPassFromClipboardText,
  readInviteDownloadHandoff,
  removeWechatCallbackHash,
  removeWechatCallbackParamsFromSearch,
  storeInviteDownloadPass,
  submitStateForBindingStatus,
  withoutInviteDownloadHandoff,
  unwrapApiData,
  type InviteBindingStatus,
} from '@/lib/inviteH5'
import { pickAndroidDownloadUrl, resolveAndroidFallbackUrl } from '@/lib/downloadLinks'

const API_BASE = getApiBaseUrl()

type Platform = 'ios' | 'android' | 'desktop'
type LandingState = 'checking' | 'ready' | 'invalid' | 'unverified'
type SubmitState = 'idle' | 'success' | 'warning' | 'error'
type BrowserResumeState = 'not-needed' | 'checking' | 'unavailable' | 'resumed'

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

function inviteDeviceContext() {
  return {
    userAgent: navigator.userAgent,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    language: navigator.language,
    devicePixelRatio: Math.round(window.devicePixelRatio * 100) / 100,
    colorDepth: window.screen.colorDepth,
    timezoneOffset: new Date().getTimezoneOffset(),
    maxTouchPoints: navigator.maxTouchPoints || 0,
  }
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
 * 优先同步使用传统 copy，兼容不开放 Clipboard API 的微信 WebView；失败后再
 * 尝试标准 Clipboard API。调用方必须在用户点击手势内立即调用本函数。
 */
function legacyCopyText(text: string): boolean {
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  input.style.pointerEvents = 'none'
  document.body.appendChild(input)
  input.select()
  input.setSelectionRange(0, input.value.length)
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  document.body.removeChild(input)
  return copied
}

function copyTextToClipboard(text: string): Promise<boolean> {
  const legacyCopied = legacyCopyText(text)
  if (!navigator.clipboard?.writeText) return Promise.resolve(legacyCopied)
  return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopied)
}

/**
 * query 跳转继续保留为兼容路径；真正兜底不再依赖微信传递当前 URL，而是使用
 * 服务端短时唯一设备匹配或剪贴板中的同一高熵一次性凭证。
 */
function navigateToDownloadHandoff(ticket: string) {
  window.location.replace(buildInviteDownloadHandoffUrl(window.location.href, ticket))
}

function replaceDownloadHandoffInUrl(ticket: string) {
  const url = new URL(buildInviteDownloadHandoffUrl(window.location.href, ticket))
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
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
  const [browserResumeState, setBrowserResumeState] = useState<BrowserResumeState>(() => (
    isWechat() || Boolean(downloadPass) || hasWechatCallback ? 'not-needed' : 'checking'
  ))
  const [showBrowserLoginForm, setShowBrowserLoginForm] = useState(() => isWechat())
  const [clipboardWorking, setClipboardWorking] = useState(false)
  const [clipboardCopyNotice, setClipboardCopyNotice] = useState('')
  const [showManualHandoff, setShowManualHandoff] = useState(false)
  const [manualHandoff, setManualHandoff] = useState('')
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
  const browserResumeRequestRef = useRef<{
    key: string
    promise: Promise<ConsumeDownloadPassResponse>
  } | null>(null)
  const consumeDownloadPassRequestRef = useRef<{
    ticket: string
    promise: Promise<ConsumeDownloadPassResponse>
  } | null>(null)
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
    if (browserResumeState !== 'checking') return
    if (!inviteCode || wechat || downloadPass || hasWechatCallback) {
      setBrowserResumeState('not-needed')
      return
    }

    let active = true
    setLandingState('checking')
    setNotice('正在恢复微信中的下载状态')

    if (browserResumeRequestRef.current?.key !== inviteCode) {
      browserResumeRequestRef.current = {
        key: inviteCode,
        promise: postJson<ConsumeDownloadPassResponse>('/invite-h5/download-pass/resume', {
          inviteCode,
          ...inviteDeviceContext(),
        }),
      }
    }

    browserResumeRequestRef.current.promise.then((res) => {
      if (!active) return
      if (!res.valid) {
        setBrowserResumeState('unavailable')
        setNotice('')
        return
      }

      setBrowserResumeState('resumed')
      setLandingState('ready')
      setLoginCompleted(true)
      setSubmitState('success')
      setNotice('已恢复登记状态，正在前往下载')
      window.setTimeout(() => startDownloadInBrowser(platform), 0)
    }).catch(() => {
      if (!active) return
      // 自动匹配失败不能阻断正常登录或剪贴板兜底，也不向公开页面暴露失败原因。
      setBrowserResumeState('unavailable')
      setNotice('')
    })

    return () => {
      active = false
    }
  }, [
    browserResumeState,
    downloadPass,
    hasWechatCallback,
    inviteCode,
    platform,
    wechat,
  ])

  useEffect(() => {
    if (!downloadPass) return

    // 微信内不消费凭证，避免刷新页面后把凭证提前作废；系统浏览器才会原子消费并
    // 立即进入下载渠道。query 只作为兼容路径，丢失时由设备匹配/剪贴板继续。
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

    if (consumeDownloadPassRequestRef.current?.ticket !== downloadPass) {
      consumeDownloadPassRequestRef.current = {
        ticket: downloadPass,
        promise: postJson<ConsumeDownloadPassResponse>(
          '/invite-h5/download-pass/consume',
          { ticket: downloadPass },
        ),
      }
    }

    consumeDownloadPassRequestRef.current.promise
      .then((res) => {
        if (!active) return
        if (!res.valid) {
          setDownloadPass(null)
          setBrowserResumeState('unavailable')
          setSubmitState('warning')
          setNotice('下载凭证已过期或已使用，可读取刚才复制的下载链接重试')
          return
        }
        setBrowserResumeState('resumed')
        setLoginCompleted(true)
        setSubmitState('success')
        setNotice('已完成登记，正在前往下载')
        window.setTimeout(() => startDownloadInBrowser(platform), 0)
      })
      .catch(() => {
        if (!active) return
        setDownloadPass(null)
        setBrowserResumeState('unavailable')
        setSubmitState('error')
        setNotice('下载状态确认失败，可读取刚才复制的下载链接重试')
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
    // 非微信浏览器先尝试恢复刚在微信完成的下载；完成或明确失败前不能创建新的
    // landing session，否则会把原始已认证会话遮蔽成一个新的未认证会话。
    if (browserResumeState === 'checking' || browserResumeState === 'resumed') {
      if (browserResumeState === 'resumed') setLandingState('ready')
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
          ...inviteDeviceContext(),
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
    browserResumeState,
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
      // 在用户点击手势仍有效时立即开始写剪贴板。微信若重新打开原始二维码 URL，
      // 系统浏览器仍可读取或让用户手动粘贴这个完整的一次性下载地址。
      const clipboardPromise = copyTextToClipboard(
        buildInviteDownloadHandoffUrl(window.location.href, ticket),
      )
      const requestPass = (candidate: string) => postJson<DownloadPassResponse>(
        '/invite-h5/download-pass',
        { landingSessionId, ticket: candidate },
        accessToken,
      )

      let response = await requestPass(ticket)
      let renewedAfterAsyncResponse = false
      // 从系统浏览器返回微信时，旧凭证可能已用完或超时；仅在这种明确状态下生成新值。
      if (response.status === 'RENEW_REQUIRED') {
        ticket = createDownloadPassTicket()
        setPreparedDownloadPass(ticket)
        storeInviteDownloadPass(sessionStorage, landingSessionId, ticket)
        // 网络 await 后已不再处于原始点击手势，浏览器通常会拒绝自动写入新票据。
        // 先登记新票据并更新地址栏，随后要求用户在遮罩按钮上显式复制一次。
        renewedAfterAsyncResponse = true
        response = await requestPass(ticket)
      }
      if (response.status !== 'READY') {
        throw new Error('下载凭证准备失败，请稍后重试')
      }

      if (renewedAfterAsyncResponse) {
        replaceDownloadHandoffInUrl(ticket)
        setClipboardCopyNotice('下载链接已更新，请先点击上方按钮复制，再打开浏览器')
        setSubmitState('success')
        setNotice('下载链接已更新，请先复制专属下载链接')
        setShowWechatGuide(true)
        return
      }

      await clipboardPromise
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

  const consumeClipboardDownload = async (clipboardText: string) => {
    const ticket = readInviteDownloadPassFromClipboardText(clipboardText)
    if (!ticket) {
      setShowManualHandoff(true)
      setSubmitState('warning')
      setNotice('没有读取到有效下载链接，请长按输入框粘贴后继续')
      return
    }

    setClipboardWorking(true)
    setSubmitState('idle')
    setNotice('正在确认下载')
    try {
      const res = await postJson<ConsumeDownloadPassResponse>(
        '/invite-h5/download-pass/consume',
        { ticket },
      )
      if (!res.valid) {
        setShowManualHandoff(true)
        setSubmitState('warning')
        setNotice('下载链接已过期或已使用，请返回微信页面重新点击下载')
        return
      }

      setBrowserResumeState('resumed')
      setLoginCompleted(true)
      setSubmitState('success')
      setNotice('已完成登记，正在前往下载')
      window.setTimeout(() => startDownloadInBrowser(platform), 0)
    } catch {
      setShowManualHandoff(true)
      setSubmitState('error')
      setNotice('下载状态确认失败，请粘贴下载链接后重试')
    } finally {
      setClipboardWorking(false)
    }
  }

  const handleClipboardResume = async () => {
    if (!navigator.clipboard?.readText) {
      setShowManualHandoff(true)
      setSubmitState('warning')
      setNotice('当前浏览器不能自动读取，请长按输入框粘贴下载链接')
      return
    }

    setClipboardWorking(true)
    try {
      const clipboardText = await navigator.clipboard.readText()
      await consumeClipboardDownload(clipboardText)
    } catch {
      setShowManualHandoff(true)
      setSubmitState('warning')
      setNotice('浏览器未允许读取剪贴板，请长按输入框粘贴下载链接')
    } finally {
      setClipboardWorking(false)
    }
  }

  const handleManualHandoff = () => {
    void consumeClipboardDownload(manualHandoff)
  }

  const handleCopyPreparedDownloadLink = async () => {
    // preparedDownloadPass 可能是旧票据消费后刚续签的新值，应优先于初始 URL 中的值。
    const ticket = preparedDownloadPass || downloadPass
    if (!ticket) {
      setSubmitState('warning')
      setNotice('下载链接已失效，请关闭提示后重新点击下载')
      return
    }

    const copied = await copyTextToClipboard(
      buildInviteDownloadHandoffUrl(window.location.href, ticket),
    )
    setClipboardCopyNotice(copied ? '复制成功，可以打开浏览器' : '复制失败，请再试一次')
    setSubmitState(copied ? 'success' : 'warning')
    setNotice(copied
      ? '专属下载链接已复制，请在右上角选择浏览器打开'
      : '复制失败，请重试或使用右上角浏览器打开')
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
  const showBrowserResumeCard = !wechat && !authCompleted && !showBrowserLoginForm

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
            <h1 className="m-0 text-[26px] font-bold leading-tight tracking-[0]">
              {showBrowserResumeCard ? '继续下载' : '手机号登录'}
            </h1>
          </div>
        </div>

        {showBrowserResumeCard ? (
          <div className="rounded-lg border border-[#d9e7d4] bg-white p-5 shadow-[0_18px_60px_rgba(23,33,26,0.10)]">
            <div className="mb-5 flex items-center justify-between gap-3 border-b border-[#e6eee3] pb-4">
              <span className="text-sm font-medium text-[#4e6652]">
                {browserResumeState === 'checking' ? '正在恢复下载状态' : '已从微信打开浏览器'}
              </span>
              <span className={`h-2.5 w-2.5 rounded-full ${browserResumeState === 'checking' ? 'bg-[#d79b28]' : 'bg-[#247a3e]'}`} />
            </div>

            {browserResumeState === 'checking' ? (
              <div className="rounded-md border border-[#d7e7d5] bg-[#f7fbf6] px-4 py-5 text-center text-sm leading-6 text-[#36543c]">
                正在确认你刚才在微信里完成的登记，请稍候
              </div>
            ) : (
              <>
                <p className="mb-4 text-sm leading-6 text-[#4e6652]">
                  如果你刚才已经在微信里注册或登录，不需要再次填写手机号。
                </p>

                {notice && (
                  <div className={`mb-4 rounded-md border px-3 py-3 text-sm leading-6 ${noticeTone}`} aria-live="polite">
                    {notice}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleClipboardResume()}
                  disabled={clipboardWorking}
                  className="h-12 w-full rounded-md bg-[#247a3e] text-[16px] font-bold text-white shadow-[0_10px_24px_rgba(36,122,62,0.24)] transition hover:bg-[#1f6f35] disabled:cursor-not-allowed disabled:bg-[#9eb5a1] disabled:shadow-none"
                >
                  {clipboardWorking ? '正在确认下载' : '读取刚才复制的下载链接'}
                </button>

                {showManualHandoff && (
                  <div className="mt-4 rounded-md border border-[#d7e7d5] bg-[#f7fbf6] p-3">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-[#263a2b]">粘贴下载链接</span>
                      <input
                        value={manualHandoff}
                        onChange={(event) => setManualHandoff(event.target.value)}
                        autoCapitalize="none"
                        autoCorrect="off"
                        placeholder="长按此处粘贴"
                        className="h-12 w-full rounded-md border border-[#cfded0] bg-white px-3 text-[16px] text-[#17211a] outline-none transition focus:border-[#247a3e]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleManualHandoff}
                      disabled={clipboardWorking || !manualHandoff.trim()}
                      className="mt-3 h-11 w-full rounded-md border border-[#247a3e] bg-white text-sm font-bold text-[#247a3e] disabled:cursor-not-allowed disabled:border-[#b9cbbb] disabled:text-[#8aa08d]"
                    >
                      确认并继续下载
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowBrowserLoginForm(true)
                    setNotice('')
                    setSubmitState('idle')
                  }}
                  className="mt-4 h-11 w-full rounded-md border border-[#cfded0] bg-white text-sm font-semibold text-[#4e6652]"
                >
                  还没有登录？使用手机号登录
                </button>
              </>
            )}
          </div>
        ) : (
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
        )}

        <p className="mt-5 text-center text-xs leading-6 text-[#6b7f6d]">
          {showBrowserResumeCard
            ? '下载链接只用于本次 App 下载，不会转移登录状态或推荐关系。'
            : '未注册手机号会自动创建账号。之后可下载 App 登录。'}
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
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleCopyPreparedDownloadLink()
            }}
            className="mt-6 rounded-md border border-white/70 bg-white/10 px-4 py-3 text-sm font-semibold text-white"
          >
            先复制专属下载链接
          </button>
          <p className="mt-3 max-w-[260px] text-right text-xs leading-5 text-white/70">
            {clipboardCopyNotice ||
              '若浏览器没有自动继续，可在浏览器页面读取或粘贴此链接，不需要重新登录。'}
          </p>
          <p className="absolute inset-x-0 bottom-10 text-center text-sm text-white/60">
            点击任意位置关闭
          </p>
        </div>
      )}
    </div>
  )
}
