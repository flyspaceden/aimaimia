export type InviteBindingStatus =
  | 'BOUND'
  | 'ALREADY_BOUND_SAME'
  | 'ALREADY_BOUND_OTHER'
  | 'SELF_INVITE'
  | 'INVALID_CODE'
  | 'NOT_ELIGIBLE'
  | 'ERROR'

export type InviteSubmitState = 'success' | 'warning' | 'error'

export function normalizeInviteCode(code?: string | null): string | null {
  const normalized = code?.trim().toUpperCase() ?? ''
  return /^[A-Z0-9]{8}$/.test(normalized) ? normalized : null
}

export function getWechatCallbackParams(search: string): {
  wechatCode: string | null
  state: string | null
} {
  const params = new URLSearchParams(search)
  return {
    wechatCode: params.get('wechatCode') || params.get('code'),
    state: params.get('state'),
  }
}

export function removeWechatCallbackParamsFromSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('wechatCode')
  params.delete('code')
  params.delete('state')
  const next = params.toString()
  return next ? `?${next}` : ''
}

export function removeWechatCallbackHash(hash: string): string {
  return hash === '#wechat_redirect' ? '' : hash
}

export function inviteLandingSessionStorageKey(inviteCode: string): string {
  return `invite_h5_landing_session:${inviteCode}`
}

const INVITE_DOWNLOAD_PASS_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const INVITE_DOWNLOAD_HANDOFF_PARAM = 'handoff'

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function normalizeInviteDownloadPass(ticket?: string | null): string | null {
  const normalized = ticket?.trim() ?? ''
  return INVITE_DOWNLOAD_PASS_PATTERN.test(normalized) ? normalized : null
}

/**
 * query 是可兼容的第一条交接路径，但部分安卓微信会让系统浏览器重新打开二维码
 * 初始 URL，连真实导航后的 query 也会丢失，因此不能把它当作唯一交接机制。
 */
export function readInviteDownloadHandoff(search: string): string | null {
  return normalizeInviteDownloadPass(
    new URLSearchParams(search).get(INVITE_DOWNLOAD_HANDOFF_PARAM),
  )
}

export function withInviteDownloadHandoff(search: string, ticket: string): string {
  const normalized = normalizeInviteDownloadPass(ticket)
  if (!normalized) throw new Error('invalid invite download pass')
  const params = new URLSearchParams(search)
  params.set(INVITE_DOWNLOAD_HANDOFF_PARAM, normalized)
  const next = params.toString()
  return next ? `?${next}` : ''
}

export function withoutInviteDownloadHandoff(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(INVITE_DOWNLOAD_HANDOFF_PARAM)
  const next = params.toString()
  return next ? `?${next}` : ''
}

/**
 * 剪贴板写入完整的专属下载 URL：系统浏览器若没有被微信带上 query，
 * 用户仍可读取或手动粘贴同一个高熵一次性凭证。
 */
export function buildInviteDownloadHandoffUrl(currentUrl: string, ticket: string): string {
  const url = new URL(currentUrl)
  url.search = withInviteDownloadHandoff(url.search, ticket)
  url.hash = ''
  return url.toString()
}

/**
 * 兼容剪贴板中是完整 URL 或纯票据两种形式。只提取合法 256 位随机值，
 * 不读取手机号、登录 Token 或推荐码。
 */
export function readInviteDownloadPassFromClipboardText(text?: string | null): string | null {
  const normalized = normalizeInviteDownloadPass(text)
  if (normalized) return normalized

  try {
    return readInviteDownloadHandoff(new URL(text?.trim() ?? '').search)
  } catch {
    return null
  }
}

export function inviteDownloadPassSessionStorageKey(landingSessionId: string): string {
  return `invite_h5_download_pass:${landingSessionId}`
}

export function readInviteDownloadPass(
  storage: Pick<SessionStorageLike, 'getItem'>,
  landingSessionId: string,
): string | null {
  return normalizeInviteDownloadPass(
    storage.getItem(inviteDownloadPassSessionStorageKey(landingSessionId)),
  )
}

export function storeInviteDownloadPass(
  storage: Pick<SessionStorageLike, 'setItem'>,
  landingSessionId: string,
  ticket: string,
): void {
  const normalized = normalizeInviteDownloadPass(ticket)
  if (!normalized) throw new Error('invalid invite download pass')
  storage.setItem(inviteDownloadPassSessionStorageKey(landingSessionId), normalized)
}

export function clearInviteDownloadPass(
  storage: Pick<SessionStorageLike, 'removeItem'>,
  landingSessionId: string,
): void {
  storage.removeItem(inviteDownloadPassSessionStorageKey(landingSessionId))
}

export function canResumeWechatDownload(input: {
  ticket?: string | null
  accessToken?: string | null
  landingSessionId?: string | null
}): boolean {
  return Boolean(
    normalizeInviteDownloadPass(input.ticket) &&
    input.accessToken?.trim() &&
    input.landingSessionId?.trim(),
  )
}

export function buildH5WechatStartUrl(
  apiBase: string,
  input: { inviteCode: string; landingSessionId?: string },
): string {
  const url = new URL(`${apiBase.replace(/\/+$/, '')}/auth/h5-wechat/start`)
  url.searchParams.set('inviteCode', input.inviteCode)
  if (input.landingSessionId) {
    url.searchParams.set('landingSessionId', input.landingSessionId)
  }
  return url.toString()
}

export function unwrapApiData<T>(payload: { data?: T } | T | null): T | null {
  if (!payload || typeof payload !== 'object') return payload as T | null
  if ('data' in payload) return payload.data ?? null
  return payload as T
}

export function bindingStatusText(status?: InviteBindingStatus | string | null): string {
  switch (status) {
    case 'BOUND':
    case 'ALREADY_BOUND_SAME':
      return '推荐关系已记录'
    case 'ALREADY_BOUND_OTHER':
      return '已绑定推荐关系，无法覆盖'
    case 'SELF_INVITE':
      return '不能绑定自己的推荐码'
    case 'INVALID_CODE':
      return '推荐码无效，未绑定推荐关系'
    case 'NOT_ELIGIBLE':
      return '当前账号不适用这个推荐码'
    case 'ERROR':
      return '推荐关系暂未记录，请稍后重试'
    default:
      return '推荐关系处理中'
  }
}

export function canContinueAfterLandingCodeStatus(status?: string | null): boolean {
  return Boolean(status);
}

export function submitStateForBindingStatus(
  status?: InviteBindingStatus | string | null,
): InviteSubmitState {
  if (status === 'BOUND' || status === 'ALREADY_BOUND_SAME') return 'success'
  if (status === 'ERROR') return 'error'
  return 'warning'
}

export function apiErrorMessage(payload: unknown, fallback = '请求失败'): string {
  if (!payload || typeof payload !== 'object') return fallback
  const message = (payload as { message?: unknown }).message
  if (Array.isArray(message) && message.length > 0) return String(message[0])
  if (typeof message === 'string' && message.trim()) return message
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const displayMessage = (error as { displayMessage?: unknown }).displayMessage
    if (typeof displayMessage === 'string' && displayMessage.trim()) return displayMessage
    const nestedMessage = (error as { message?: unknown }).message
    if (Array.isArray(nestedMessage) && nestedMessage.length > 0) return String(nestedMessage[0])
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage
  }
  return fallback
}
