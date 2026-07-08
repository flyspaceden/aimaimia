export type InviteBindingStatus =
  | 'BOUND'
  | 'ALREADY_BOUND_SAME'
  | 'ALREADY_BOUND_OTHER'
  | 'SELF_INVITE'
  | 'INVALID_CODE'
  | 'NOT_ELIGIBLE'
  | 'ERROR'

export function normalizeInviteCode(code?: string | null): string | null {
  const normalized = code?.trim().toUpperCase() ?? ''
  return /^[A-Z0-9]{8}$/.test(normalized) ? normalized : null
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

export function apiErrorMessage(payload: unknown, fallback = '请求失败'): string {
  if (!payload || typeof payload !== 'object') return fallback
  const message = (payload as { message?: unknown }).message
  if (Array.isArray(message) && message.length > 0) return String(message[0])
  if (typeof message === 'string' && message.trim()) return message
  const error = (payload as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error : fallback
}
