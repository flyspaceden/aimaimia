import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { getApiBaseUrl } from '@/lib/apiBase'
import { redirectToCanonicalDomainIfNeeded } from '@/lib/canonicalDomain'
import { pickAndroidDownloadUrl, resolveAndroidFallbackUrl } from '@/lib/downloadLinks'
import {
  apiErrorMessage,
  inviteKindForCodeStatus,
  normalizeInviteCode,
  unwrapApiData,
} from '@/lib/inviteH5'
import {
  buildNormalShareClipboardText,
  buildReferralClipboardText,
  copyTextToClipboard,
} from '@/lib/referralClipboard'

const API_BASE = getApiBaseUrl()

type Platform = 'ios' | 'android' | 'desktop'
type LandingState = 'checking' | 'ready' | 'invalid' | 'error'
type NoticeTone = 'info' | 'error' | 'success'

type LandingResponse = {
  landingSessionId: string
  codeStatus: string
}

type MiniProgramLinkResponse = {
  urlLink: string
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(apiErrorMessage(payload, '请求失败，请稍后重试'))
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

export default function InviteChoiceLanding() {
  if (typeof window !== 'undefined' && redirectToCanonicalDomainIfNeeded()) return null

  const { code } = useParams<{ code?: string }>()
  const inviteCode = useMemo(() => normalizeInviteCode(code), [code])
  const platform = detectPlatform()
  const wechat = isWechat()
  const [landingState, setLandingState] = useState<LandingState>(() => (inviteCode ? 'checking' : 'invalid'))
  const [landingSessionId, setLandingSessionId] = useState<string | null>(null)
  const [codeStatus, setCodeStatus] = useState<string | null>(null)
  const [openingMiniProgram, setOpeningMiniProgram] = useState(false)
  const [desktopMiniProgramLink, setDesktopMiniProgramLink] = useState('')
  const [desktopQrMode, setDesktopQrMode] = useState(
    () => platform === 'desktop' && window.matchMedia('(min-width: 768px)').matches,
  )
  const [showWechatGuide, setShowWechatGuide] = useState(false)
  const [showManualCode, setShowManualCode] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info')
  const landingRequestRef = useRef<{ key: string; promise: Promise<LandingResponse> } | null>(null)
  const inviteKind = inviteKindForCodeStatus(codeStatus)
  const actionsReady = landingState === 'ready' && Boolean(inviteCode && landingSessionId && inviteKind)
  const appReferralUrl = inviteCode && inviteKind
    ? `${window.location.origin}/${inviteKind === 'normal' ? 's' : 'r'}/${encodeURIComponent(inviteCode)}`
    : ''

  useEffect(() => {
    if (platform !== 'desktop') {
      setDesktopQrMode(false)
      return
    }
    const media = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktopQrMode(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [platform])

  useEffect(() => {
    if (!inviteCode) {
      setLandingState('invalid')
      setNotice('邀请链接不可用，请让好友重新分享。')
      setNoticeTone('error')
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

    landingRequestRef.current.promise.then((result) => {
      if (!active) return
      if (!inviteKindForCodeStatus(result.codeStatus)) {
        setLandingState('invalid')
        setNotice('邀请链接已失效，请让好友重新分享。')
        setNoticeTone('error')
        return
      }
      setLandingSessionId(result.landingSessionId)
      setCodeStatus(result.codeStatus)
      setLandingState('ready')
    }).catch(() => {
      if (!active) return
      setLandingState('error')
      setNotice('暂时无法识别邀请信息，请稍后重新扫码。')
      setNoticeTone('error')
    })

    return () => {
      active = false
    }
  }, [inviteCode])

  const copyAppReferralToken = async (): Promise<boolean> => {
    if (!inviteCode || !inviteKind) return false
    const token = inviteKind === 'normal'
      ? buildNormalShareClipboardText(inviteCode)
      : buildReferralClipboardText(inviteCode)
    const copied = await copyTextToClipboard(token)
    if (!copied) setShowManualCode(true)
    return copied
  }

  const requestMiniProgramLink = async (): Promise<string> => {
    if (!actionsReady || !inviteCode || !landingSessionId) throw new Error('邀请信息尚未准备好')
    const result = await postJson<MiniProgramLinkResponse>('/invite-h5/mini-program-link', {
        inviteCode,
        landingSessionId,
      })
    return result.urlLink
  }

  const handleOpenMiniProgram = async () => {
    if (!actionsReady) return
    if (!wechat) {
      setNotice('请用微信扫码，或在微信中打开此页后再打开小程序。')
      setNoticeTone('info')
      return
    }

    setOpeningMiniProgram(true)
    setNotice('')
    try {
      window.location.assign(await requestMiniProgramLink())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '微信小程序暂不可打开，请下载 App。')
      setNoticeTone('error')
    } finally {
      setOpeningMiniProgram(false)
    }
  }

  const handleGenerateDesktopMiniProgramQr = async () => {
    if (!actionsReady || openingMiniProgram) return
    setOpeningMiniProgram(true)
    setNotice('')
    try {
      setDesktopMiniProgramLink(await requestMiniProgramLink())
      setNotice('小程序二维码已生成，请使用微信扫一扫。')
      setNoticeTone('success')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '小程序二维码暂时无法生成，请稍后重试。')
      setNoticeTone('error')
    } finally {
      setOpeningMiniProgram(false)
    }
  }

  const handleDownloadApp = async () => {
    if (!actionsReady) return
    const copied = await copyAppReferralToken()
    setNotice(copied
      ? '推荐信息已保存。完成登录后，App 会自动尝试记录这次邀请。'
      : '未能保存推荐信息，请记下页面下方的邀请码，下载后可在 App 内手动输入。')
    setNoticeTone(copied ? 'success' : 'error')

    if (wechat) {
      setShowWechatGuide(true)
      return
    }
    if (platform === 'ios') {
      window.alert('iOS 版即将上线，请使用安卓手机扫码下载')
      return
    }
    if (platform === 'android') {
      redirectToAndroidDownload(pickAndroidDownloadUrl(navigator.userAgent))
      return
    }
    window.location.href = '/download'
  }

  const retryLanding = () => {
    landingRequestRef.current = null
    window.location.reload()
  }

  const noticeClass = noticeTone === 'error'
    ? 'border-[#f2c8c3] bg-[#fff3f1] text-[#9a3228]'
    : noticeTone === 'success'
      ? 'border-[#b8dfc2] bg-[#f0f8ee] text-[#226b3d]'
      : 'border-[#c7dde0] bg-[#f2fafb] text-[#245b66]'

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f4f8f0] text-[#15211c]">
      <div className="pointer-events-none fixed inset-0 opacity-70" style={{
        backgroundImage: 'radial-gradient(circle at 8% 9%, rgba(233,181,93,.28), transparent 25%), radial-gradient(circle at 90% 82%, rgba(14,96,114,.17), transparent 29%), linear-gradient(148deg, #f9fbf4 0%, #eef6ec 57%, #edf7f7 100%)',
      }} />
      <section className="relative mx-auto flex min-h-screen w-full max-w-[760px] flex-col justify-center px-5 py-8 sm:px-7">
        <div className="mb-7 flex items-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-[17px_17px_17px_5px] bg-[#1e6b4f] text-xl font-bold text-white shadow-[0_12px_30px_rgba(30,107,79,.22)]">
            买
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#f4f8f0] bg-[#e9b55d]" />
          </div>
          <div>
            <p className="m-0 text-xs font-bold tracking-[0.18em] text-[#0e6072]">AI 爱买买</p>
            <h1 className="m-0 mt-1 text-[clamp(25px,7vw,34px)] font-semibold leading-tight tracking-[-0.04em]" style={{ fontFamily: 'STKaiti, Songti SC, serif' }}>
              好友邀你一起发现好物
            </h1>
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px_28px_28px_9px] border border-white/80 bg-white/85 shadow-[0_20px_60px_rgba(21,33,28,.12)] backdrop-blur-sm">
          <div className="border-b border-[#e2ece0] px-6 py-5 sm:px-7">
            <div className="flex items-center gap-3">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${landingState === 'ready' ? 'bg-[#e5f2e7] text-[#1e6b4f]' : landingState === 'invalid' || landingState === 'error' ? 'bg-[#fff0ed] text-[#a03c31]' : 'bg-[#fff5db] text-[#956600]'}`}>
                {landingState === 'ready' ? '✓' : landingState === 'checking' ? '…' : '!'}
              </span>
              <div>
                <p className="m-0 text-sm font-semibold text-[#1b3025]">
                  {landingState === 'ready' ? '邀请已识别' : landingState === 'checking' ? '正在识别邀请' : '邀请暂不可用'}
                </p>
                <p className="m-0 mt-1 text-xs leading-5 text-[#61746a]">
                  {landingState === 'ready'
                    ? '选择一种方式继续；登录只会在你选择的客户端中进行。'
                    : '不会在这个网页要求你填写手机号、验证码或注册信息。'}
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-6 sm:px-7">
            {landingState === 'ready' ? (
              desktopQrMode ? (
                <div className="grid gap-5 md:grid-cols-2">
                <section className="flex min-h-[330px] flex-col rounded-[22px_22px_22px_7px] border border-[#a8d2b3] bg-[#eff9ef] p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[14px_14px_14px_4px] bg-[#1e6b4f] text-lg text-white shadow-[0_8px_18px_rgba(30,107,79,.2)]">微</span>
                    <div>
                      <h2 className="m-0 text-base font-bold text-[#184e39]">微信小程序</h2>
                      <p className="m-0 mt-1 text-xs text-[#4d7560]">生成后使用微信扫一扫</p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-1 items-center justify-center rounded-2xl border border-[#c9dfce] bg-white p-4">
                    {desktopMiniProgramLink ? (
                      <QRCodeCanvas value={desktopMiniProgramLink} size={170} level="M" aria-label="爱买买小程序二维码" />
                    ) : (
                      <button
                        type="button"
                        onClick={handleGenerateDesktopMiniProgramQr}
                        disabled={openingMiniProgram}
                        className="rounded-full bg-[#1e6b4f] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#15533b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e6b4f] disabled:cursor-wait disabled:opacity-65"
                      >
                        {openingMiniProgram ? '正在生成…' : '生成小程序二维码'}
                      </button>
                    )}
                  </div>
                  <p className="m-0 mt-4 text-center text-xs leading-5 text-[#4d7560]">二维码仅对应本次邀请，不会在网页要求登录。</p>
                </section>

                <section className="flex min-h-[330px] flex-col rounded-[22px_22px_7px_22px] border border-[#c9dfe3] bg-[#f2f9fa] p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[14px_14px_4px_14px] bg-[#0e6072] text-lg font-semibold text-white shadow-[0_8px_18px_rgba(14,96,114,.18)]">A</span>
                    <div>
                      <h2 className="m-0 text-base font-bold text-[#164e5a]">爱买买 App</h2>
                      <p className="m-0 mt-1 text-xs text-[#56757d]">扫码进入下载和邀请交接页</p>
                    </div>
                  </div>
                  <a
                    href={appReferralUrl}
                    className="mt-5 flex flex-1 items-center justify-center rounded-2xl border border-[#d4e5e8] bg-white p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e6072]"
                    aria-label="打开爱买买 App 下载页"
                  >
                    <QRCodeCanvas value={appReferralUrl} size={170} level="M" aria-label="爱买买 App 下载二维码" />
                  </a>
                  <p className="m-0 mt-4 text-center text-xs leading-5 text-[#56757d]">手机扫码后先保存推荐信息，再进入 App 下载流程。</p>
                </section>
                </div>
            ) : (
                <div className="relative">
                <div className="absolute left-[23px] top-[48px] bottom-[48px] w-px bg-gradient-to-b from-[#79aa91] via-[#b9d7c3] to-[#d2e4de]" aria-hidden="true" />
                <button
                  type="button"
                  onClick={handleOpenMiniProgram}
                  disabled={openingMiniProgram}
                  className="group relative flex w-full items-center gap-4 rounded-[19px_19px_19px_5px] border border-[#a8d2b3] bg-[#eff9ef] p-4 text-left transition hover:-translate-y-0.5 hover:bg-[#e5f5e8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e6b4f] disabled:cursor-wait disabled:opacity-70"
                >
                  <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px_15px_15px_4px] bg-[#1e6b4f] text-xl text-white shadow-[0_8px_18px_rgba(30,107,79,.22)]">微</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-[#184e39]">打开爱买买小程序</span>
                    <span className="mt-1 block text-xs leading-5 text-[#4d7560]">{openingMiniProgram ? '正在打开…' : wechat ? '微信登录一次，即可继续浏览和下单' : '请在微信中打开此页后使用此选项'}</span>
                  </span>
                  <span className="text-xl text-[#1e6b4f] transition-transform group-hover:translate-x-0.5" aria-hidden="true">›</span>
                </button>

                <div className="relative z-10 my-3 flex items-center gap-3 pl-3">
                  <span className="h-px flex-1 bg-[#dce8dd]" />
                  <span className="rounded-full bg-white px-2 text-[11px] font-medium text-[#7a8b80]">或使用 App</span>
                  <span className="h-px flex-1 bg-[#dce8dd]" />
                </div>

                <button
                  type="button"
                  onClick={handleDownloadApp}
                  className="group relative flex w-full items-center gap-4 rounded-[19px_19px_5px_19px] border border-[#c9dfe3] bg-[#f2f9fa] p-4 text-left transition hover:-translate-y-0.5 hover:bg-[#eaf6f8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e6072]"
                >
                  <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px_15px_4px_15px] bg-[#0e6072] text-xl font-semibold text-white shadow-[0_8px_18px_rgba(14,96,114,.2)]">A</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-[#164e5a]">下载爱买买 App</span>
                    <span className="mt-1 block text-xs leading-5 text-[#56757d]">先保存本次邀请，再前往应用商店下载</span>
                  </span>
                  <span className="text-xl text-[#0e6072] transition-transform group-hover:translate-x-0.5" aria-hidden="true">›</span>
                </button>
                </div>
              )
            ) : (
              <div className="py-2 text-center">
                <p className="m-0 text-sm leading-6 text-[#61746a]">{notice || '正在准备邀请入口。'}</p>
                {landingState === 'error' ? (
                  <button type="button" onClick={retryLanding} className="mt-4 rounded-full bg-[#1e6b4f] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#15533b]">
                    重新识别
                  </button>
                ) : null}
              </div>
            )}

            {notice && landingState === 'ready' ? (
              <p className={`mt-5 rounded-xl border px-3 py-2.5 text-xs leading-5 ${noticeClass}`} aria-live="polite">{notice}</p>
            ) : null}
            {showManualCode && inviteCode ? (
              <p className="mt-4 rounded-xl border border-[#ead69d] bg-[#fff9e8] px-3 py-2.5 text-center text-xs leading-5 text-[#765c16]">
                邀请码：<span className="ml-1 font-semibold tracking-[0.18em]">{inviteCode}</span>
              </p>
            ) : null}
          </div>
        </div>

        <p className="mx-auto mt-5 max-w-[420px] text-center text-xs leading-5 text-[#687b70]">
          不论选择小程序还是 App，推荐关系都会在对应客户端完成登录后核验；已有推荐关系不会被替换。
        </p>
      </section>

      {showWechatGuide ? (
        <button
          type="button"
          onClick={() => setShowWechatGuide(false)}
          className="fixed inset-0 z-[9999] flex w-full flex-col items-end bg-[#10231ddd] px-7 pt-6 text-right text-white"
          aria-label="关闭浏览器打开指引"
        >
          <span className="h-14 w-14 border-r-4 border-t-4 border-white" style={{ transform: 'rotate(-45deg)' }} />
          <span className="mt-5 text-xl font-semibold leading-9">点击右上角<br />选择在浏览器中打开</span>
          <span className="mt-3 max-w-[245px] text-sm leading-6 text-white/75">推荐信息已先保存。请在浏览器里再次点击下载，即可前往应用商店。</span>
          <span className="absolute inset-x-0 bottom-10 text-center text-xs text-white/55">点击任意位置关闭</span>
        </button>
      ) : null}
    </main>
  )
}
