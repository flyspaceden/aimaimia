export interface ProfitSafetyPreviewConfigMeta {
  key: string;
}

export type ProfitSafetyPreviewUpdate = { key: string; value: { value: unknown } };

type PreviewTimers = {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

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
    return { type: 'warning', message: '未保存参数的利润安全校验失败', description: error?.message, summary: undefined, linkCaptain: false };
  }
  if (kind === 'saved' && loading) {
    return { type: 'info', message: '正在读取服务器利润安全状态', description: undefined, summary: undefined, linkCaptain: false };
  }
  if (kind === 'saved' && error) {
    return { type: 'warning', message: '利润安全状态暂不可用', description: error.message, summary: undefined, linkCaptain: false };
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
