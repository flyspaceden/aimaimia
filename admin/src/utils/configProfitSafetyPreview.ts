export interface ProfitSafetyPreviewConfigMeta {
  key: string;
}

export type ProfitSafetyPreviewUpdate = { key: string; value: { value: unknown } };

const PROFIT_SAFETY_CONFIG_LABELS: Record<string, string> = {
  VIP_PLATFORM_PERCENT: 'VIP 平台留存比例',
  VIP_REWARD_PERCENT: 'VIP 奖励比例',
  VIP_DIRECT_REFERRAL_PERCENT: 'VIP 直推奖励比例',
  VIP_INDUSTRY_FUND_PERCENT: 'VIP 产业基金比例',
  VIP_CHARITY_PERCENT: 'VIP 慈善比例',
  VIP_TECH_PERCENT: 'VIP 科技比例',
  VIP_RESERVE_PERCENT: 'VIP 备用金比例',
  NORMAL_PLATFORM_PERCENT: '普通用户平台留存比例',
  NORMAL_REWARD_PERCENT: '普通用户奖励比例',
  NORMAL_DIRECT_REFERRAL_PERCENT: '普通用户直推奖励比例',
  NORMAL_INDUSTRY_FUND_PERCENT: '普通用户产业基金比例',
  NORMAL_CHARITY_PERCENT: '普通用户慈善比例',
  NORMAL_TECH_PERCENT: '普通用户科技比例',
  NORMAL_RESERVE_PERCENT: '普通用户备用金比例',
  VIP_DISCOUNT_RATE: 'VIP 商品折扣',
  MARKUP_RATE: '商品加价率',
  VIP_MIN_AMOUNT: 'VIP 最低消费金额',
  VIP_MAX_LAYERS: 'VIP 奖励层级',
  VIP_BRANCH_FACTOR: 'VIP 团队分支系数',
  NORMAL_BRANCH_FACTOR: '普通用户团队分支系数',
  NORMAL_MAX_LAYERS: '普通用户奖励层级',
  NORMAL_FREEZE_DAYS: '普通用户奖励冻结天数',
  VIP_FREEZE_DAYS: 'VIP 奖励冻结天数',
  VIP_REWARD_EXPIRY_DAYS: 'VIP 奖励有效期',
  NORMAL_REWARD_EXPIRY_DAYS: '普通用户奖励有效期',
  AUTO_CONFIRM_DAYS: '自动确认收货天数',
  BUCKET_RANGES: '普通用户奖励区间',
  NORMAL_BROADCAST_X: '普通用户广播参数',
  AUTO_VIP_BY_SPEND_ENABLED: '自动升级 VIP 开关',
  AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD: '自动升级 VIP 累计消费门槛',
  DEFAULT_SHIPPING_FEE: '默认运费',
  VIP_FREE_SHIPPING_THRESHOLD: 'VIP 免运费门槛',
  NORMAL_FREE_SHIPPING_THRESHOLD: '普通用户免运费门槛',
  LOW_STOCK_DISPLAY_THRESHOLD: '低库存展示阈值',
  LOTTERY_ENABLED: '抽奖功能开关',
  LOTTERY_DAILY_CHANCES: '每日抽奖次数',
  GROWTH_ENABLED: '成长值功能开关',
  GROWTH_POINTS_EXPIRE_DAYS: '成长值有效期',
  GROWTH_POINTS_EXPIRE_REMIND_DAYS: '成长值到期提醒天数',
  GROWTH_DAILY_POINTS_CAP: '每日成长值上限',
  GROWTH_MONTHLY_POINTS_CAP: '每月成长值上限',
  GROWTH_DAILY_SHARE_REWARD_USER_CAP: '每日分享奖励人数上限',
  GROWTH_MONTHLY_INVITE_FIRST_ORDER_CAP: '每月邀请首单奖励上限',
  GROWTH_VIP_CHECKIN_POINTS_MULTIPLIER: 'VIP 签到积分倍数',
  GROWTH_VIP_SHOPPING_GROWTH_MULTIPLIER: 'VIP 购物成长值倍数',
  GROWTH_REFUND_REVERSAL_ENABLED: '退款扣回成长值开关',
  GROWTH_AUTO_SUSPEND_EXCHANGE_RISK: '高风险自动暂停兑换开关',
  RETURN_WINDOW_DAYS: '退货申请时限',
  NORMAL_RETURN_DAYS: '普通商品退货时限',
  FRESH_RETURN_HOURS: '生鲜退货时限',
  RETURN_NO_SHIP_THRESHOLD: '免退货发货金额门槛',
  RETURN_SHIPPING_FEE_DEFAULT: '默认退货运费',
  SELLER_REVIEW_TIMEOUT_DAYS: '卖家售后审核时限',
  BUYER_SHIP_TIMEOUT_DAYS: '买家退货发货时限',
  SELLER_RECEIVE_TIMEOUT_DAYS: '卖家收货确认时限',
  BUYER_CONFIRM_TIMEOUT_DAYS: '买家确认收货时限',
  INVOICE_PROVIDER_MODE: '开票服务模式',
  INVOICE_AUTO_ISSUE: '自动开票开关',
  INVOICE_AUTO_ISSUE_MAX_ATTEMPTS: '自动开票最大尝试次数',
  INVOICE_ALLOW_VIP_PACKAGE: 'VIP 礼包开票开关',
  INVOICE_LINE_MODE: '发票商品行模式',
  INVOICE_DEFAULT_TAX_RATE: '发票默认税率',
  INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE: '发票默认税收分类编码',
  INVOICE_DEFAULT_GOODS_NAME: '发票默认商品名称',
  INVOICE_REMARK_TEMPLATE: '发票备注模板',
  INVOICE_ISSUER_PROFILE: '开票主体信息',
  WITHDRAW_TAX_RATE: '提现个税比例',
  WITHDRAW_MIN_AMOUNT: '最小提现金额',
  WITHDRAW_MAX_AMOUNT: '单次提现上限',
  WITHDRAW_DAILY_MAX_COUNT: '每日提现次数上限',
  WITHDRAW_COOLDOWN_SECONDS: '提现冷却时间',
  WITHDRAW_YEARLY_MAX_AMOUNT: '年度提现上限',
  WITHDRAW_PROVIDER_FEE_AMOUNT: '提现通道手续费',
  WITHDRAW_YEARLY_ALERT_THRESHOLD: '年度提现预警金额',
  DEDUCTION_RATIO_NORMAL: '普通用户积分抵扣比例',
  DEDUCTION_RATIO_VIP: 'VIP 积分抵扣比例',
  DEDUCTION_MIN_ORDER_AMOUNT: '积分抵扣最低订单金额',
  DEDUCTION_ALLOW_COUPON_STACK: '积分与红包叠加开关',
  DIGITAL_ASSET_CREDIT_TIERS: '数字资产累计消费档位',
  DIGITAL_ASSET_MODULE_SETTINGS: '数字资产模块设置',
  GROUP_BUY_MAX_MONTHLY_LAUNCHES: '每月团购发起次数上限',
  DISCOVERY_COMPANY_FILTERS: '发现页商家筛选项',
  CAPTAIN_SEAFOOD_CONFIG: '团长预包装海鲜激励配置',
};

const PROFIT_SAFETY_ERROR_LABELS: Record<string, string> = {
  CAPTAIN_CONFIG_V2_NOT_ACTIVE: '团长激励仍是旧版规则，请在团长配置中完成新版设置',
  INVALID_CAPTAIN_CONFIG: '团长预包装海鲜激励配置不完整或参数无效',
  INVALID_CAPTAIN_RATE: '团长奖励比例存在无效值',
  INVALID_CAPTAIN_CAP: '团长总激励率上限存在无效值',
  CAPTAIN_RATE_EXCEEDS_CONFIGURED_CAP: '团长奖励比例合计超过总激励率上限',
  INVALID_PLATFORM_REQUIRED_RATE: '冷链履约、风险预留或目标净利率存在无效值',
  INVALID_MARKUP_RATE: '商品加价率必须大于 0',
  INVALID_VIP_DISCOUNT_RATE: 'VIP 商品折扣必须大于 0 且不高于原价',
  INVALID_VIP_TREE_RATE: 'VIP 奖励比例存在无效值',
  INVALID_NORMAL_TREE_RATE: '普通用户奖励比例存在无效值',
  INVALID_VIP_INDUSTRY_RATE: 'VIP 产业基金比例存在无效值',
  INVALID_NORMAL_INDUSTRY_RATE: '普通用户产业基金比例存在无效值',
  INVALID_VIP_DIRECT_RATE: 'VIP 直推奖励比例存在无效值',
  INVALID_NORMAL_DIRECT_RATE: '普通用户直推奖励比例存在无效值',
  SKU_COST_OR_PRICE_MISSING: '商品售价或成本未完整填写',
  SKU_NON_POSITIVE_MARGIN: '商品折后毛利不大于 0',
  EXTERNAL_PROFIT_RATE_EXCEEDS_100_PERCENT: '各项对外分配比例合计超过利润基数',
  PLATFORM_RETAINED_REVENUE_INSUFFICIENT: '平台留存不足以覆盖履约成本、风险预留和目标净利',
};

const PROFIT_SAFETY_SCENARIO_LABELS: Record<string, string> = {
  VIP_BUYER_VIP_INVITER: 'VIP 买家 / VIP 邀请人',
  VIP_BUYER_NORMAL_INVITER: 'VIP 买家 / 普通邀请人',
  NORMAL_BUYER_VIP_INVITER: '普通买家 / VIP 邀请人',
  NORMAL_BUYER_NORMAL_INVITER: '普通买家 / 普通邀请人',
};

type PreviewTimers = {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

export function formatProfitSafetyScenario(key: string | null | undefined): string {
  return key && PROFIT_SAFETY_SCENARIO_LABELS[key] ? PROFIT_SAFETY_SCENARIO_LABELS[key] : '当前奖励组合';
}

export function formatProfitSafetyConfigKey(key: string): string {
  return PROFIT_SAFETY_CONFIG_LABELS[key] ?? '未识别的基础配置项';
}

export function formatProfitSafetySummaryError(error: string): string {
  const incompletePrefix = 'INCOMPLETE_RULE_CONFIG_SNAPSHOT:';
  if (error.startsWith(incompletePrefix)) {
    const keys = error.slice(incompletePrefix.length).split(',').filter(Boolean);
    const labels = keys.map(formatProfitSafetyConfigKey);
    return labels.length > 0 ? `以下基础配置尚未完成：${labels.join('、')}` : '基础配置尚未完成';
  }
  return PROFIT_SAFETY_ERROR_LABELS[error] ?? '利润安全参数存在异常，请检查相关配置';
}

export function formatProfitSafetySummaryErrors(errors: readonly string[] | null | undefined): string[] {
  const rawErrors = Array.isArray(errors) ? errors : [];
  const hasMissingCaptainConfig = rawErrors.some((error) =>
    error.startsWith('INCOMPLETE_RULE_CONFIG_SNAPSHOT:') && error.includes('CAPTAIN_SEAFOOD_CONFIG'));
  return [...new Set(rawErrors
    .filter((error) => !(hasMissingCaptainConfig && error === 'INVALID_CAPTAIN_CONFIG'))
    .map(formatProfitSafetySummaryError))];
}

export function formatProfitSafetyRequestError(error: Error | null | undefined): string | undefined {
  const message = error?.message?.trim();
  if (!message) return undefined;
  return /(?:^|[,:\s])[A-Z][A-Z0-9_]{2,}(?::|,|$)/.test(message)
    ? '利润安全校验未完成，请检查页面提示后重试'
    : message;
}

function unwrapConfigValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'value' in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

export function buildProfitSafetyCandidateUpdates(
  configs: readonly { key: string; value: unknown }[],
  values: Record<string, unknown>,
  schema: readonly ProfitSafetyPreviewConfigMeta[],
): ProfitSafetyPreviewUpdate[] {
  const savedByKey = new Map(configs.map((config) => [config.key, unwrapConfigValue(config.value)]));
  return schema.flatMap(({ key }) => (
    Object.is(savedByKey.get(key), values[key])
      ? []
      : [{ key, value: { value: values[key] } }]
  ));
}

export function getProfitSafetyPreviewEligibility({
  enabled,
  valuesReady,
  updates,
  sumValid,
  hasValidationErrors,
}: {
  enabled: boolean;
  valuesReady: boolean;
  updates: ProfitSafetyPreviewUpdate[];
  sumValid: boolean;
  hasValidationErrors: boolean;
}): 'saved' | 'invalid-ratio' | 'invalid-form' | 'ready' {
  if (!enabled || !valuesReady || updates.length === 0) return 'saved';
  if (!sumValid) return 'invalid-ratio';
  if (hasValidationErrors) return 'invalid-form';
  return 'ready';
}

export function createProfitSafetyPreviewScheduler<TSummary>({
  delayMs,
  preview,
  timers = globalThis,
  onChecking,
  onCandidate,
  onError,
}: {
  delayMs: number;
  preview: (updates: ProfitSafetyPreviewUpdate[]) => Promise<TSummary>;
  timers?: PreviewTimers;
  onChecking: () => void;
  onCandidate: (summary: TSummary) => void;
  onError: (error: Error) => void;
}) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const invalidate = () => {
    generation += 1;
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timer = undefined;
    }
  };

  const schedule = (updates: ProfitSafetyPreviewUpdate[]) => {
    invalidate();
    const scheduledGeneration = generation;
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (scheduledGeneration !== generation) return;
      onChecking();
      void preview(updates).then(
        (summary) => {
          if (scheduledGeneration === generation) onCandidate(summary);
        },
        (reason: unknown) => {
          if (scheduledGeneration === generation) {
            onError(reason instanceof Error ? reason : new Error('预检请求失败'));
          }
        },
      );
    }, delayMs);
  };

  return { schedule, invalidate };
}

export function getProfitSafetyStatusPresentation<TSummary extends { safe: boolean }>({
  kind,
  summary,
  loading = false,
  error,
  linkCaptain = false,
}: {
  kind: 'saved' | 'checking' | 'candidate' | 'invalid-ratio' | 'invalid-form' | 'error';
  summary?: TSummary;
  loading?: boolean;
  error?: Error | null;
  linkCaptain?: boolean;
}): {
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  description: string | undefined;
  summary: TSummary | undefined;
  linkCaptain: boolean;
} | null {
  if (kind === 'checking') {
    return { type: 'info', message: '正在校验未保存参数', description: undefined, summary: undefined, linkCaptain: false };
  }
  if (kind === 'invalid-ratio') {
    return { type: 'warning', message: '请先使七项比例合计为 100% 再校验利润安全', description: undefined, summary: undefined, linkCaptain: false };
  }
  if (kind === 'invalid-form') {
    return { type: 'warning', message: '请先修正存在校验错误的参数再校验利润安全', description: undefined, summary: undefined, linkCaptain: false };
  }
  if (kind === 'error') {
    return { type: 'warning', message: '未保存参数的利润安全校验失败', description: formatProfitSafetyRequestError(error), summary: undefined, linkCaptain: false };
  }
  if (kind === 'saved' && loading) {
    return { type: 'info', message: '正在读取服务器利润安全状态', description: undefined, summary: undefined, linkCaptain: false };
  }
  if (kind === 'saved' && error) {
    return { type: 'warning', message: '利润安全状态暂不可用', description: formatProfitSafetyRequestError(error), summary: undefined, linkCaptain: false };
  }
  if (!summary) return null;

  const candidate = kind === 'candidate';
  return {
    type: summary.safe ? 'success' : 'error',
    message: candidate
      ? (summary.safe ? '未保存参数通过利润安全校验' : '未保存参数未通过利润安全校验')
      : (summary.safe ? '服务器利润安全校验通过' : '服务器利润安全校验未通过'),
    description: undefined,
    summary,
    linkCaptain: !summary.safe && linkCaptain,
  };
}
