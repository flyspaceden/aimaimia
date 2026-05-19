/**
 * 配置项值验证规则
 *
 * 为每个已知配置键定义值的类型、范围和约束，
 * 防止管理员设置无效或危险的配置值。
 */

export type ConfigValueType = 'number' | 'integer' | 'boolean' | 'json' | 'string';

export interface ConfigValidationRule {
  /** 值类型 */
  type: ConfigValueType;
  /** 配置项中文描述 */
  description: string;
  /** 数值最小值（含） */
  min?: number;
  /** 数值最大值（含） */
  max?: number;
  /** 自定义验证函数，返回错误信息或 null 表示通过 */
  custom?: (value: any) => string | null;
}

const allowedInvoiceRemarkVars = new Set(['orderId', 'paidAt', 'buyerTitle', 'totalAmount']);
const invoiceSecretKeyPattern = /(secret|token|privatekey|private_key|cert|password|key)$/i;

function validateEnumString(key: string, value: any, allowed: string[]): string | null {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return `${key} 只能是：${allowed.join(' / ')}`;
  }
  return null;
}

function validateInvoiceRemarkTemplate(value: any): string | null {
  if (typeof value !== 'string') {
    return 'INVOICE_REMARK_TEMPLATE 的值必须是字符串';
  }
  if (value.length > 500) {
    return 'INVOICE_REMARK_TEMPLATE 不能超过 500 字符';
  }
  const matches = value.match(/\{\{([^}]+)\}\}/g) || [];
  for (const match of matches) {
    const varName = match.replace('{{', '').replace('}}', '').trim();
    if (!allowedInvoiceRemarkVars.has(varName)) {
      return `INVOICE_REMARK_TEMPLATE 只能使用白名单变量：${[...allowedInvoiceRemarkVars].join(', ')}`;
    }
  }
  return null;
}

function validateInvoiceIssuerProfile(value: any): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'INVOICE_ISSUER_PROFILE 的值必须是对象';
  }
  for (const key of Object.keys(value)) {
    if (invoiceSecretKeyPattern.test(key.toLowerCase())) {
      return 'INVOICE_ISSUER_PROFILE 不允许包含密钥、token、证书或密码字段';
    }
  }
  if (!value.companyName || typeof value.companyName !== 'string') {
    return 'INVOICE_ISSUER_PROFILE.companyName 必须是非空字符串';
  }
  if (!value.taxNo || typeof value.taxNo !== 'string') {
    return 'INVOICE_ISSUER_PROFILE.taxNo 必须是非空字符串';
  }
  const maxLengths: Record<string, number> = {
    companyName: 100,
    taxNo: 30,
    registeredAddress: 200,
    registeredPhone: 30,
    bankName: 100,
    bankAccount: 40,
    drawer: 50,
    reviewer: 50,
    payee: 50,
  };
  for (const [key, max] of Object.entries(maxLengths)) {
    const item = value[key];
    if (item !== undefined && item !== null) {
      if (typeof item !== 'string') return `INVOICE_ISSUER_PROFILE.${key} 必须是字符串`;
      if (item.length > max) return `INVOICE_ISSUER_PROFILE.${key} 不能超过 ${max} 字符`;
    }
  }
  return null;
}

/**
 * 已知配置键的验证规则表
 *
 * 规则说明：
 * - 比例/百分比类配置：0~1 之间的浮点数
 * - 金额类配置：大于 0 的浮点数
 * - 天数/次数/层数类配置：正整数
 * - 布尔开关类配置：必须是布尔值
 * - 数组类配置（如 BUCKET_RANGES）：用 custom 验证结构
 */
export const CONFIG_VALIDATION_RULES: Record<string, ConfigValidationRule> = {
  // =================== VIP 分润系统（旧，@deprecated） ===================
  REBATE_RATIO: {
    type: 'number',
    description: '@deprecated 返利比例（利润 → 返利池）',
    min: 0,
    max: 1,
  },
  REWARD_POOL_PERCENT: {
    type: 'number',
    description: '@deprecated 奖励池占返利池比例',
    min: 0,
    max: 1,
  },
  PLATFORM_PERCENT: {
    type: 'number',
    description: '@deprecated 平台利润占返利池比例',
    min: 0,
    max: 1,
  },
  FUND_PERCENT: {
    type: 'number',
    description: '@deprecated 基金池占返利池比例',
    min: 0,
    max: 1,
  },
  POINTS_PERCENT: {
    type: 'number',
    description: '@deprecated 积分池占返利池比例',
    min: 0,
    max: 1,
  },

  // =================== VIP 分润系统（新六分） ===================
  VIP_PLATFORM_PERCENT: {
    type: 'number',
    description: 'VIP利润-平台分成比例',
    min: 0,
    max: 1,
  },
  VIP_REWARD_PERCENT: {
    type: 'number',
    description: 'VIP利润-奖励池比例',
    min: 0,
    max: 1,
  },
  VIP_INDUSTRY_FUND_PERCENT: {
    type: 'number',
    description: 'VIP利润-产业基金(卖家)比例',
    min: 0,
    max: 1,
  },
  VIP_CHARITY_PERCENT: {
    type: 'number',
    description: 'VIP利润-慈善基金比例',
    min: 0,
    max: 1,
  },
  VIP_TECH_PERCENT: {
    type: 'number',
    description: 'VIP利润-科技基金比例',
    min: 0,
    max: 1,
  },
  VIP_RESERVE_PERCENT: {
    type: 'number',
    description: 'VIP利润-备用金比例',
    min: 0,
    max: 1,
  },
  VIP_MIN_AMOUNT: {
    type: 'number',
    description: 'VIP 有效消费最低金额（元）',
    min: 0,
    max: 100000,
  },
  VIP_MAX_LAYERS: {
    type: 'integer',
    description: 'VIP 最多收取层数',
    min: 1,
    max: 100,
  },
  VIP_BRANCH_FACTOR: {
    type: 'integer',
    description: '三叉树分叉数',
    min: 2,
    max: 10,
  },
  VIP_FREEZE_DAYS: {
    type: 'integer',
    description: 'VIP 冻结奖励过期天数',
    min: 1,
    max: 365,
  },

  // =================== 普通用户分润系统 ===================
  NORMAL_BRANCH_FACTOR: {
    type: 'integer',
    description: '普通树叉数',
    min: 2,
    max: 10,
  },
  NORMAL_MAX_LAYERS: {
    type: 'integer',
    description: '普通树最大分配层数',
    min: 1,
    max: 100,
  },
  NORMAL_FREEZE_DAYS: {
    type: 'integer',
    description: '普通树冻结奖励过期天数',
    min: 1,
    max: 365,
  },
  NORMAL_PLATFORM_PERCENT: {
    type: 'number',
    description: '普通用户利润-平台分成比例',
    min: 0,
    max: 1,
  },
  NORMAL_REWARD_PERCENT: {
    type: 'number',
    description: '普通用户利润-奖励分成比例',
    min: 0,
    max: 1,
  },
  NORMAL_INDUSTRY_FUND_PERCENT: {
    type: 'number',
    description: '普通用户利润-产业基金(卖家)比例',
    min: 0,
    max: 1,
  },
  NORMAL_CHARITY_PERCENT: {
    type: 'number',
    description: '普通用户利润-慈善基金比例',
    min: 0,
    max: 1,
  },
  NORMAL_TECH_PERCENT: {
    type: 'number',
    description: '普通用户利润-科技基金比例',
    min: 0,
    max: 1,
  },
  NORMAL_RESERVE_PERCENT: {
    type: 'number',
    description: '普通用户利润-备用金比例',
    min: 0,
    max: 1,
  },

  // =================== 系统级配置 ===================
  VIP_DISCOUNT_RATE: {
    type: 'number',
    description: 'VIP用户商品折扣率（如0.95表示95折）',
    min: 0.5,
    max: 1.0,
  },
  MARKUP_RATE: {
    type: 'number',
    description: '卖家商品加价率（售价=成本×此值）',
    min: 1.0,
    max: 10.0,
  },
  DEFAULT_SHIPPING_FEE: {
    type: 'number',
    description: '默认运费（元）',
    min: 0,
    max: 1000,
  },
  AUTO_CONFIRM_DAYS: {
    type: 'integer',
    description: '自动确认收货天数',
    min: 1,
    max: 90,
  },
  LOW_STOCK_DISPLAY_THRESHOLD: {
    type: 'integer',
    description: 'App 低库存展示阈值（0 表示关闭“仅剩 x 件”展示）',
    min: 0,
    max: 999,
  },
  LOTTERY_ENABLED: {
    type: 'boolean',
    description: '抽奖功能开关',
  },
  LOTTERY_DAILY_CHANCES: {
    type: 'integer',
    description: '每日抽奖次数',
    min: 0,
    max: 100,
  },
  VIP_REWARD_EXPIRY_DAYS: {
    type: 'integer',
    description: 'VIP 已释放奖励有效期（天）',
    min: 1,
    max: 365,
  },
  NORMAL_REWARD_EXPIRY_DAYS: {
    type: 'integer',
    description: '普通用户已释放奖励有效期（天）',
    min: 1,
    max: 365,
  },
  VIP_FREE_SHIPPING_THRESHOLD: {
    type: 'number',
    description: 'VIP用户免运费门槛（元），0=无条件免运费',
    min: 0,
    max: 10000,
  },
  NORMAL_FREE_SHIPPING_THRESHOLD: {
    type: 'number',
    description: '普通用户免运费门槛（元），0=无条件免运费',
    min: 0,
    max: 10000,
  },

  // =================== 发票系统配置 ===================
  INVOICE_PROVIDER_MODE: {
    type: 'string',
    description: '发票 Provider 模式',
    custom: (value: any) => validateEnumString('INVOICE_PROVIDER_MODE', value, ['MOCK']),
  },
  INVOICE_AUTO_ISSUE: {
    type: 'boolean',
    description: '买家申请发票后自动开票',
  },
  INVOICE_AUTO_ISSUE_MAX_ATTEMPTS: {
    type: 'number',
    description: '自动开票最大重试次数',
    min: 1,
    max: 10,
  },
  INVOICE_ALLOW_VIP_PACKAGE: {
    type: 'boolean',
    description: 'VIP 礼包是否允许申请发票',
  },
  INVOICE_LINE_MODE: {
    type: 'string',
    description: '发票商品行生成模式',
    custom: (value: any) =>
      validateEnumString('INVOICE_LINE_MODE', value, ['ORDER_ITEMS', 'MERGED_CATEGORY']),
  },
  INVOICE_DEFAULT_TAX_RATE: {
    type: 'number',
    description: '发票默认税率',
    min: 0,
    max: 0.13,
  },
  INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE: {
    type: 'string',
    description: '发票默认税收分类编码',
    custom: (value: any) => {
      if (typeof value !== 'string') return 'INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE 的值必须是字符串';
      if (value && !/^[A-Za-z0-9]{6,30}$/.test(value)) {
        return 'INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE 必须为空或 6-30 位数字/字母';
      }
      return null;
    },
  },
  INVOICE_DEFAULT_GOODS_NAME: {
    type: 'string',
    description: '发票合并商品行默认名称',
    custom: (value: any) => {
      if (typeof value !== 'string') return 'INVOICE_DEFAULT_GOODS_NAME 的值必须是字符串';
      if (!value.trim()) return 'INVOICE_DEFAULT_GOODS_NAME 不能为空';
      if (value.length > 100) return 'INVOICE_DEFAULT_GOODS_NAME 不能超过 100 字符';
      return null;
    },
  },
  INVOICE_REMARK_TEMPLATE: {
    type: 'string',
    description: '发票备注模板',
    custom: validateInvoiceRemarkTemplate,
  },
  INVOICE_ISSUER_PROFILE: {
    type: 'json',
    description: '平台开票主体配置',
    custom: validateInvoiceIssuerProfile,
  },

  // =================== 发现页配置 ===================
  DISCOVERY_COMPANY_FILTERS: {
    type: 'json',
    description: '发现页企业筛选栏配置（有序标签数组）',
    custom: (value: any) => {
      if (!Array.isArray(value)) return 'DISCOVERY_COMPANY_FILTERS 的值必须是数组';
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (!item || typeof item !== 'object') return `[${i}] 必须是对象`;
        if (!item.tagId || typeof item.tagId !== 'string') return `[${i}].tagId 必须是非空字符串`;
        if (!item.icon || typeof item.icon !== 'string') return `[${i}].icon 必须是非空字符串`;
      }
      return null;
    },
  },

  // =================== @deprecated 废弃字段（保留兼容） ===================
  NORMAL_BROADCAST_X: {
    type: 'integer',
    description: '@deprecated 普通广播每次分配订单数',
    min: 1,
    max: 1000,
  },
  BUCKET_RANGES: {
    type: 'json',
    description: '@deprecated 普通桶金额区间',
    custom: (value: any) => {
      if (!Array.isArray(value)) {
        return 'BUCKET_RANGES 的值必须是数组';
      }
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (!Array.isArray(item) || item.length !== 2) {
          return `BUCKET_RANGES[${i}] 必须是 [min, max] 二元组`;
        }
        if (typeof item[0] !== 'number') {
          return `BUCKET_RANGES[${i}][0] 必须是数字`;
        }
        if (item[1] !== null && typeof item[1] !== 'number') {
          return `BUCKET_RANGES[${i}][1] 必须是数字或 null`;
        }
      }
      return null;
    },
  },
};

/**
 * 验证配置值是否合法
 *
 * @param key 配置键名
 * @param value 要设置的值
 * @returns 错误信息，null 表示验证通过
 */
export function validateConfigValue(key: string, value: any): string | null {
  // 任何配置值不可为 null 或 undefined
  if (value === null || value === undefined) {
    return `配置项 ${key} 的值不能为 null 或 undefined`;
  }

  const rule = CONFIG_VALIDATION_RULES[key];
  if (!rule) {
    // 未知配置键：仅做基本非空检查（已在上面通过）
    return null;
  }

  // 类型检查
  switch (rule.type) {
    case 'number': {
      if (typeof value !== 'number' || isNaN(value)) {
        return `配置项 ${key}（${rule.description}）的值必须是数字，当前值: ${JSON.stringify(value)}`;
      }
      if (rule.min !== undefined && value < rule.min) {
        return `配置项 ${key}（${rule.description}）的值不能小于最小值 ${rule.min}，当前值: ${value}`;
      }
      if (rule.max !== undefined && value > rule.max) {
        return `配置项 ${key}（${rule.description}）的值不能大于最大值 ${rule.max}，当前值: ${value}`;
      }
      break;
    }

    case 'integer': {
      if (typeof value !== 'number' || isNaN(value) || !Number.isInteger(value)) {
        return `配置项 ${key}（${rule.description}）的值必须是整数，当前值: ${JSON.stringify(value)}`;
      }
      if (rule.min !== undefined && value < rule.min) {
        return `配置项 ${key}（${rule.description}）的值不能小于最小值 ${rule.min}，当前值: ${value}`;
      }
      if (rule.max !== undefined && value > rule.max) {
        return `配置项 ${key}（${rule.description}）的值不能大于最大值 ${rule.max}，当前值: ${value}`;
      }
      break;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        return `配置项 ${key}（${rule.description}）的值必须是布尔值（true/false），当前值: ${JSON.stringify(value)}`;
      }
      break;
    }

    case 'string': {
      if (typeof value !== 'string') {
        return `配置项 ${key}（${rule.description}）的值必须是字符串，当前值: ${JSON.stringify(value)}`;
      }
      break;
    }

    case 'json': {
      // json 类型交由 custom 验证器处理
      break;
    }
  }

  // 自定义验证
  if (rule.custom) {
    const customError = rule.custom(value);
    if (customError) return customError;
  }

  return null;
}

/**
 * 普通用户利润分配比例键列表（六项之和必须等于1.0）
 */
export const NORMAL_PERCENT_KEYS = [
  'NORMAL_PLATFORM_PERCENT',
  'NORMAL_REWARD_PERCENT',
  'NORMAL_INDUSTRY_FUND_PERCENT',
  'NORMAL_CHARITY_PERCENT',
  'NORMAL_TECH_PERCENT',
  'NORMAL_RESERVE_PERCENT',
] as const;

/**
 * VIP 分润比例键列表（六项之和必须等于1.0）
 */
export const VIP_POOL_PERCENT_KEYS = [
  'VIP_PLATFORM_PERCENT',
  'VIP_REWARD_PERCENT',
  'VIP_INDUSTRY_FUND_PERCENT',
  'VIP_CHARITY_PERCENT',
  'VIP_TECH_PERCENT',
  'VIP_RESERVE_PERCENT',
] as const;
