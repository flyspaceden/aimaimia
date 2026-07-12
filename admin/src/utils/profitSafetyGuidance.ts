import { formatProfitSafetyConfigKey } from './configProfitSafetyPreview';

type Scenario = {
  buyerPath?: unknown;
  inviterPath?: unknown;
  captainProfitRate?: unknown;
  safe?: unknown;
};

type ConfigCompleteness = {
  complete?: unknown;
  missingKeys?: unknown;
};

export type ProfitSafetyGuidanceState = 'disabled' | 'setup' | 'risk' | 'safe';

export type ProfitSafetyAction = {
  id: string;
  label: string;
  description: string;
  to: string;
};

export type ProfitSafetyGuidance = {
  state: ProfitSafetyGuidanceState;
  alertType: 'info' | 'warning' | 'error' | 'success';
  title: string;
  description: string;
  actions: ProfitSafetyAction[];
  riskScenarios: Scenario[];
};

export type SystemConfigCompletenessNotice = {
  message: string;
  actions: ProfitSafetyAction[];
};

export type ProfitSafetyGuidanceSummary = {
  safe?: unknown;
  captainConfigState?: unknown;
  errors?: unknown;
  scenarios?: unknown;
  profitSafetyConfigCompleteness?: ConfigCompleteness;
  ruleConfigCompleteness?: ConfigCompleteness;
};

const FINANCIAL_CONFIG_KEYS = new Set([
  'MARKUP_RATE',
  'VIP_DISCOUNT_RATE',
  'VIP_REWARD_PERCENT',
  'VIP_DIRECT_REFERRAL_PERCENT',
  'VIP_INDUSTRY_FUND_PERCENT',
  'NORMAL_REWARD_PERCENT',
  'NORMAL_DIRECT_REFERRAL_PERCENT',
  'NORMAL_INDUSTRY_FUND_PERCENT',
]);

const CAPTAIN_CONFIG_KEY = 'CAPTAIN_SEAFOOD_CONFIG';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function scenariosOf(summary: ProfitSafetyGuidanceSummary): Scenario[] {
  return Array.isArray(summary.scenarios)
    ? summary.scenarios.filter((item): item is Scenario => item !== null && typeof item === 'object')
    : [];
}

function uniqueActions(actions: ProfitSafetyAction[]): ProfitSafetyAction[] {
  return [...new Map(actions.map((action) => [action.id, action])).values()];
}

function actionForConfigKey(key: string): ProfitSafetyAction {
  if (key === CAPTAIN_CONFIG_KEY) {
    return {
      id: 'captain-settings',
      label: '完善团长配置',
      description: '填写团长开关、适用商品范围、五项实际奖励率与利润底线参数。',
      to: '/captain/settings',
    };
  }
  if (key === 'MARKUP_RATE') {
    return {
      id: 'platform-pricing',
      label: '检查商品加价率',
      description: '商品加价率会直接决定自动定价的毛利上限。',
      to: '/config',
    };
  }
  if (key === 'VIP_DISCOUNT_RATE' || key.startsWith('VIP_')) {
    return {
      id: 'vip-config',
      label: '调整 VIP 分润',
      description: '核对 VIP 奖励、产业基金、直推奖励与 VIP 商品折扣。',
      to: '/bonus/vip-config',
    };
  }
  if (key.startsWith('NORMAL_')) {
    return {
      id: 'normal-config',
      label: '调整普通分润',
      description: '核对普通奖励、产业基金与普通直推奖励。',
      to: '/bonus/normal-config',
    };
  }
  if (key.startsWith('GROWTH_')) {
    return {
      id: 'growth-config',
      label: '完善积分成长设置',
      description: '补齐积分成长的系统基础参数，不会改变当前商品利润计算。',
      to: '/growth',
    };
  }
  if (key.startsWith('DIGITAL_ASSET_')) {
    return {
      id: 'digital-assets',
      label: '完善数字资产设置',
      description: '补齐数字资产基础参数，不会改变当前商品利润计算。',
      to: '/digital-assets',
    };
  }
  if (key === 'DISCOVERY_COMPANY_FILTERS') {
    return {
      id: 'discovery-filters',
      label: '完善发现页筛选项',
      description: '补齐发现页基础配置，不会改变当前商品利润计算。',
      to: '/config/discovery-filters',
    };
  }
  return {
    id: 'platform-settings',
    label: '查看平台设置',
    description: `补齐“${formatProfitSafetyConfigKey(key)}”。`,
    to: '/config',
  };
}

function actionsForKeys(keys: string[]): ProfitSafetyAction[] {
  return uniqueActions(keys.map(actionForConfigKey));
}

function configKeysForErrors(errors: string[]): string[] {
  const keys: string[] = [];
  for (const error of errors) {
    if (error.startsWith('INCOMPLETE_PROFIT_SAFETY_CONFIG:')) {
      keys.push(...error.slice('INCOMPLETE_PROFIT_SAFETY_CONFIG:'.length).split(',').filter(Boolean));
    } else if (error === 'INVALID_MARKUP_RATE') {
      keys.push('MARKUP_RATE');
    } else if (error === 'INVALID_VIP_DISCOUNT_RATE') {
      keys.push('VIP_DISCOUNT_RATE');
    } else if (error.includes('VIP_')) {
      keys.push('VIP_REWARD_PERCENT');
    } else if (error.includes('NORMAL_')) {
      keys.push('NORMAL_REWARD_PERCENT');
    } else if (error.includes('CAPTAIN') || error === 'INVALID_PLATFORM_REQUIRED_RATE') {
      keys.push(CAPTAIN_CONFIG_KEY);
    }
  }
  return [...new Set(keys)];
}

function actionForRisk(scenarios: Scenario[]): ProfitSafetyAction[] {
  const actions: ProfitSafetyAction[] = [
    {
      id: 'products',
      label: '核对限制商品',
      description: '核对商品成本、售价和规格价格；低毛利商品可排除出团长范围。',
      to: '/products',
    },
  ];
  if (scenarios.some((scenario) => Number(scenario.captainProfitRate) > 0)) {
    actions.unshift({
      id: 'captain-settings',
      label: '调整团长奖励',
      description: '降低五项实际团长奖励率或缩小适用范围；仅调高封顶比例不能减少支出。',
      to: '/captain/settings',
    });
  }
  if (scenarios.some((scenario) => scenario.buyerPath === 'VIP' || scenario.inviterPath === 'VIP')) {
    actions.push(actionForConfigKey('VIP_REWARD_PERCENT'));
  }
  if (scenarios.some((scenario) => scenario.buyerPath === 'NORMAL' || scenario.inviterPath === 'NORMAL')) {
    actions.push(actionForConfigKey('NORMAL_REWARD_PERCENT'));
  }
  return uniqueActions(actions);
}

export function getProfitSafetyGuidance(summary: ProfitSafetyGuidanceSummary): ProfitSafetyGuidance {
  const scenarios = scenariosOf(summary);
  const riskScenarios = scenarios.filter((scenario) => scenario.safe === false);
  const errors = asStringArray(summary.errors);
  const missingFinancialKeys = asStringArray(summary.profitSafetyConfigCompleteness?.missingKeys);
  const errorKeys = configKeysForErrors(errors);
  const captainState = summary.captainConfigState;

  if (captainState === 'INVALID' || errors.length > 0 || missingFinancialKeys.length > 0) {
    const inferredKeys = [
      ...missingFinancialKeys,
      ...errorKeys,
      ...(captainState === 'INVALID' ? [CAPTAIN_CONFIG_KEY] : []),
    ];
    return {
      state: 'setup',
      alertType: 'warning',
      title: '利润安全参数尚未准备完整',
      description: '参数未完成或无效时，当前测算不能作为可保存的利润结论；请先完成下面列出的配置，再重新校验。',
      actions: actionsForKeys(inferredKeys.length > 0 ? inferredKeys : ['MARKUP_RATE']),
      riskScenarios,
    };
  }

  if (riskScenarios.length > 0) {
    return {
      state: 'risk',
      alertType: 'error',
      title: `发现 ${riskScenarios.length} 种奖励组合存在利润缺口`,
      description: '先处理下方风险路径和限制商品；不要通过降低履约、风险或目标净利参数来掩盖真实成本。',
      actions: uniqueActions([...actionForRisk(riskScenarios), ...actionsForKeys(errorKeys)]),
      riskScenarios,
    };
  }

  if (summary.safe === false) {
    return {
      state: 'setup',
      alertType: 'warning',
      title: '利润安全结论暂不可用',
      description: '当前没有可定位的商品利润缺口，但校验结果尚未完整；请检查团长、VIP、普通分润和商品定价配置后重新校验。',
      actions: actionsForKeys(['CAPTAIN_SEAFOOD_CONFIG', 'MARKUP_RATE']),
      riskScenarios,
    };
  }

  if (captainState === 'DISABLED') {
    return {
      state: 'disabled',
      alertType: 'info',
      title: '团长激励未启用，当前按 0% 团长奖励测算',
      description: '不会产生新的团长归因或佣金；VIP 与普通用户分润仍按当前商品利润安全规则测算。',
      actions: [{
        id: 'captain-settings',
        label: '配置团长激励',
        description: '准备启用时，再填写适用范围、实际奖励率和利润底线参数。',
        to: '/captain/settings',
      }],
      riskScenarios,
    };
  }

  return {
    state: 'safe',
    alertType: 'success',
    title: '当前四种买家与推荐人组合均满足平台利润底线',
    description: '可以保存团长配置；之后支付的新订单仍会按订单当时的配置快照计算。',
    actions: [],
    riskScenarios,
  };
}

export function getSystemConfigCompletenessNotice(
  summary: ProfitSafetyGuidanceSummary,
): SystemConfigCompletenessNotice | null {
  const missingKeys = asStringArray(summary.ruleConfigCompleteness?.missingKeys)
    .filter((key) => !FINANCIAL_CONFIG_KEYS.has(key))
    // An absent captain setting is intentionally treated as the disabled, 0% state.
    // The main status card already explains that state and links to its configuration.
    .filter((key) => !(key === CAPTAIN_CONFIG_KEY && summary.captainConfigState === 'DISABLED'));
  if (missingKeys.length === 0) return null;

  const labels = missingKeys.map(formatProfitSafetyConfigKey);
  return {
    message: `系统基础配置尚未完整：${labels.slice(0, 3).join('、')}${labels.length > 3 ? `等 ${labels.length} 项` : ''}。这不会被当作商品利润缺口，但对应配置版本将不能用于回滚。`,
    actions: actionsForKeys(missingKeys),
  };
}
