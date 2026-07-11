type CalculationModel = 'SALES_V2' | 'PROFIT_V3' | string | null | undefined;

type SafetyScenarioLike = {
  key?: unknown;
  safe?: unknown;
  captainProfitRate?: unknown;
};

type SafetySummaryLike = {
  safe?: unknown;
  errors?: unknown;
  scenarios?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getCaptainCalculationDisplay(model: CalculationModel) {
  return model === 'PROFIT_V3'
    ? { label: '利润规则 V3', color: 'blue' as const }
    : { label: '历史销售额规则', color: 'default' as const };
}

export function getCaptainCalculationModel(record: {
  calculationModel?: CalculationModel;
  orderAttribution?: unknown;
  configSnapshot?: unknown;
  meta?: unknown;
}): 'SALES_V2' | 'PROFIT_V3' {
  const attribution = isRecord(record.orderAttribution) ? record.orderAttribution : {};
  const snapshot = isRecord(record.configSnapshot) ? record.configSnapshot : {};
  const meta = isRecord(record.meta) ? record.meta : {};
  return record.calculationModel === 'PROFIT_V3'
    || attribution.calculationModel === 'PROFIT_V3'
    || snapshot.schemaVersion === 3
    || meta.calculationModel === 'PROFIT_V3_ORDER_SNAPSHOT'
    ? 'PROFIT_V3'
    : 'SALES_V2';
}

export function getCaptainProfitBaseAmount(record: {
  calculationModel?: CalculationModel;
  profitBaseAmount?: unknown;
  commissionBase?: unknown;
}): number | null {
  return record.calculationModel === 'PROFIT_V3'
    ? finiteNumber(record.profitBaseAmount)
    : finiteNumber(record.commissionBase);
}

export function isProfitV3Settlement(record: {
  configSnapshot?: unknown;
  meta?: unknown;
}): boolean {
  const snapshot = isRecord(record.configSnapshot) ? record.configSnapshot : {};
  const meta = isRecord(record.meta) ? record.meta : {};
  return snapshot.schemaVersion === 3
    || meta.calculationModel === 'PROFIT_V3_ORDER_SNAPSHOT';
}

export function getConfigRollbackState(version: {
  rollbackAllowed?: unknown;
  rollbackBlockedReason?: unknown;
}) {
  const disabled = version.rollbackAllowed === false;
  return {
    disabled,
    reason: disabled
      ? typeof version.rollbackBlockedReason === 'string' && version.rollbackBlockedReason
        ? version.rollbackBlockedReason
        : '服务器未允许回滚此版本'
      : null,
  };
}

export function shouldLinkCaptainSettings(summary: SafetySummaryLike | null | undefined): boolean {
  if (!summary || summary.safe === true) return false;
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  if (errors.some((item) => typeof item === 'string' && item.includes('CAPTAIN'))) return true;
  const scenarios = Array.isArray(summary.scenarios)
    ? summary.scenarios.filter(isRecord) as SafetyScenarioLike[]
    : [];
  return scenarios.some((scenario) => scenario.safe === false
    && (finiteNumber(scenario.captainProfitRate) ?? 0) > 0);
}

export function formatProfitSafetyError(error: unknown): string {
  const record = isRecord(error) ? error : {};
  const payloadDetails = isRecord(record.details) ? record.details : record;
  const message = error instanceof Error && error.message
    ? error.message
    : typeof record.message === 'string' && record.message
      ? record.message
      : '保存失败';
  const details: string[] = [];
  const scenarios = Array.isArray(payloadDetails.scenarios)
    ? payloadDetails.scenarios.filter(isRecord)
    : [];
  const failedScenario = scenarios.find((scenario) => scenario.safe === false);
  if (typeof failedScenario?.key === 'string') {
    details.push(`失败场景 ${failedScenario.key}`);
  }
  const limitingSkus = Array.isArray(payloadDetails.limitingSkus)
    ? payloadDetails.limitingSkus.filter(isRecord)
    : [];
  const limitingSku = limitingSkus[0];
  if (typeof limitingSku?.skuId === 'string') {
    details.push(`限制 SKU ${limitingSku.skuId}`);
  }
  const shortfall = finiteNumber(limitingSku?.shortfall ?? payloadDetails.shortfall);
  if (shortfall !== null && shortfall > 0) {
    details.push(`利润缺口 ${(shortfall * 100).toFixed(2)}%`);
  }
  return details.length > 0 ? `${message}；${details.join('；')}` : message;
}
