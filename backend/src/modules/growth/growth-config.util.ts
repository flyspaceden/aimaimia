type RuleConfigClient = {
  ruleConfig?: {
    findUnique?: (args: { where: { key: string } }) => Promise<{ value: unknown } | null>;
  };
};

type GrowthLevelClient = {
  growthLevel?: {
    findFirst?: (args: unknown) => Promise<{ code: string } | null>;
  };
  growthAccount?: {
    update?: (args: unknown) => Promise<unknown>;
  };
};

export const WIRED_GROWTH_BEHAVIOR_CODES = new Set([
  'REGISTER',
  'CHECK_IN',
  'FIRST_ORDER_RECEIVED',
  'REPURCHASE_RECEIVED',
  'NORMAL_INVITE_REGISTER',
  'NORMAL_INVITE_FIRST_ORDER',
  'TASK_COMPLETE',
  'ADMIN_ADJUST',
]);

export function isWiredGrowthBehaviorCode(code: string): boolean {
  return WIRED_GROWTH_BEHAVIOR_CODES.has(code);
}

export async function readGrowthConfigValue(
  client: RuleConfigClient,
  key: string,
): Promise<unknown | undefined> {
  if (!client.ruleConfig?.findUnique) {
    return undefined;
  }
  const config = await client.ruleConfig.findUnique({ where: { key } });
  return unwrapGrowthConfigValue(config?.value);
}

export function unwrapGrowthConfigValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'value')
  ) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

export async function readGrowthConfigBoolean(
  client: RuleConfigClient,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  const value = await readGrowthConfigValue(client, key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

export async function readGrowthConfigInt(
  client: RuleConfigClient,
  key: string,
  fallback: number,
): Promise<number> {
  const value = await readGrowthConfigValue(client, key);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isCouponBackedExchangeType(type: string): boolean {
  return type === 'COUPON' || type === 'SHIPPING_COUPON' || type === 'VIP_DISCOUNT_COUPON';
}

export async function isGrowthEnabled(client: RuleConfigClient): Promise<boolean> {
  return readGrowthConfigBoolean(client, 'GROWTH_ENABLED', false);
}

export async function isGrowthRefundReversalEnabled(client: RuleConfigClient): Promise<boolean> {
  return readGrowthConfigBoolean(client, 'GROWTH_REFUND_REVERSAL_ENABLED', true);
}

export async function resolveGrowthLevelCode(
  client: GrowthLevelClient,
  growthValue: number,
): Promise<string | null> {
  if (!client.growthLevel?.findFirst) {
    return null;
  }
  const level = await client.growthLevel.findFirst({
    where: {
      enabled: true,
      threshold: { lte: Math.max(0, growthValue) },
    },
    orderBy: { threshold: 'desc' },
    select: { code: true },
  });
  return level?.code ?? null;
}

export async function syncGrowthAccountLevel(
  client: GrowthLevelClient,
  account: { id?: string; growthValue?: number; currentLevelCode?: string | null } | null | undefined,
): Promise<void> {
  if (!account?.id || typeof account.growthValue !== 'number' || !client.growthAccount?.update) {
    return;
  }

  const nextLevelCode = await resolveGrowthLevelCode(client, account.growthValue);
  if ((account.currentLevelCode ?? null) === nextLevelCode) {
    return;
  }

  await client.growthAccount.update({
    where: { id: account.id },
    data: { currentLevelCode: nextLevelCode },
  });
}
