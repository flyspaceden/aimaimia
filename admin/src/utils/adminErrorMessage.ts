type UnknownRecord = Record<string, unknown>;

const INTERNAL_ERROR_LABELS: Record<string, string> = {
  INVALID_CAPTAIN_CONFIG: '团长预包装海鲜激励配置不完整或参数无效',
  CAPTAIN_CONFIG_V2_NOT_ACTIVE: '团长激励仍是旧版规则，请在团长配置中完成新版设置',
  CAPTAIN_RATE_EXCEEDS_CONFIGURED_CAP: '团长奖励比例合计超过总激励率上限',
  CAPTAIN_PROFIT_SAFETY_VIOLATION: '当前配置未通过平台利润安全校验',
  CAPTAIN_FUNDING_EXCEEDS_PLATFORM_RETAINED: '团长奖励超过本单可用的平台留存利润',
  CAPTAIN_FUNDING_INVALID_SNAPSHOT: '订单利润快照不完整，暂不能进行团长资金核算',
  ORDER_PROFIT_COST_MISSING: '商品成本缺失，暂不能完成利润核算',
  ORDER_PROFIT_CONSERVATION_FAILED: '订单利润核算未通过一致性校验',
  CAPTCHA_INVALID: '图形验证码错误或已失效',
  INVALID_CODE: '验证码错误或已失效',
  FORBIDDEN: '当前账号没有执行此操作的权限',
  UNAUTHORIZED: '登录已失效，请重新登录',
  NOT_FOUND: '未找到相关数据，可能已被删除或无访问权限',
  CONFLICT: '当前数据已发生变化，请刷新后重试',
  VALIDATION_ERROR: '提交内容不符合要求，请检查后重试',
};

const INTERNAL_CODE_PATTERN = /(?:^|[^A-Z0-9_])[A-Z][A-Z0-9]*_[A-Z0-9_]+(?=$|[^A-Z0-9_])/;
const TECHNICAL_MESSAGE_PATTERN = /^(?:network error|failed to fetch|request failed with status code|timeout of |internal server error)/i;
const CHINESE_CHARACTER_PATTERN = /[\u3400-\u9fff]/;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractMessage(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value) || depth > 2) return undefined;

  for (const key of ['displayMessage', 'message', 'error']) {
    const message = extractMessage(value[key], depth + 1);
    if (message) return message;
  }
  return undefined;
}

/** Converts transport and backend implementation details into administrator-facing Chinese text. */
export function sanitizeAdminErrorMessage(value: unknown, fallback = '操作未完成，请稍后重试'): string {
  const message = extractMessage(value);
  if (!message) return fallback;
  if (message.startsWith('INCOMPLETE_RULE_CONFIG_SNAPSHOT:')) {
    return '基础配置尚未完成，请补全相关配置后重试';
  }
  if (INTERNAL_ERROR_LABELS[message]) return INTERNAL_ERROR_LABELS[message];
  if (
    INTERNAL_CODE_PATTERN.test(message)
    || /^[A-Z][A-Z0-9_]{3,}$/.test(message)
    || TECHNICAL_MESSAGE_PATTERN.test(message)
    || (!CHINESE_CHARACTER_PATTERN.test(message) && /[A-Za-z]/.test(message))
  ) {
    return fallback;
  }
  return message;
}

export function getAdminErrorMessage(error: unknown, fallback = '操作未完成，请稍后重试'): string {
  if (isRecord(error)) {
    const response = isRecord(error.response) ? error.response : undefined;
    const responseData = response ? response.data : undefined;
    const responseMessage = extractMessage(responseData);
    if (responseMessage) return sanitizeAdminErrorMessage(responseMessage, fallback);
  }
  return sanitizeAdminErrorMessage(error, fallback);
}
