import { useEffect, useMemo, useState } from 'react';
import { previewProfitSafety } from '@/api/config';
import type { ProfitSafetySummary, RuleConfig } from '@/types';
import {
  buildProfitSafetyCandidateUpdates,
  createProfitSafetyPreviewScheduler,
  getProfitSafetyPreviewEligibility,
  type ProfitSafetyPreviewConfigMeta,
} from '@/utils/configProfitSafetyPreview';

export type ConfigProfitSafetyPreviewState =
  | { kind: 'saved' }
  | { kind: 'checking' }
  | { kind: 'candidate'; summary: ProfitSafetySummary }
  | { kind: 'invalid-ratio' }
  | { kind: 'invalid-form' }
  | { kind: 'error'; error: Error };

function normalizeValues(values: unknown): Record<string, unknown> {
  return values !== null && typeof values === 'object' && !Array.isArray(values)
    ? { ...(values as Record<string, unknown>) }
    : {};
}

export function useConfigProfitSafetyPreview({
  configs,
  values,
  schema,
  sumValid,
  hasValidationErrors,
  enabled,
  delayMs = 500,
}: {
  configs: RuleConfig[];
  values?: Record<string, unknown>;
  schema: ProfitSafetyPreviewConfigMeta[];
  sumValid: boolean;
  hasValidationErrors: boolean;
  enabled: boolean;
  delayMs?: number;
}): ConfigProfitSafetyPreviewState {
  const [state, setState] = useState<ConfigProfitSafetyPreviewState>({ kind: 'saved' });
  const normalizedValues = useMemo(() => normalizeValues(values), [values]);
  const valuesReady = schema.every(({ key }) => Object.hasOwn(normalizedValues, key));
  const updates = useMemo(
    () => buildProfitSafetyCandidateUpdates(configs, normalizedValues, schema),
    [configs, normalizedValues, schema],
  );
  const eligibility = getProfitSafetyPreviewEligibility({
    enabled,
    valuesReady,
    updates,
    sumValid,
    hasValidationErrors,
  });
  const scheduler = useMemo(() => createProfitSafetyPreviewScheduler<ProfitSafetySummary>({
    delayMs,
    preview: async (updates) => previewProfitSafety({ updates }),
    onChecking: () => setState({ kind: 'checking' }),
    onCandidate: (summary) => setState({ kind: 'candidate', summary }),
    onError: (error) => setState({ kind: 'error', error }),
  }), [delayMs]);

  useEffect(() => {
    scheduler.invalidate();
    if (eligibility === 'saved') setState({ kind: 'saved' });
    if (eligibility === 'invalid-ratio') setState({ kind: 'invalid-ratio' });
    if (eligibility === 'invalid-form') setState({ kind: 'invalid-form' });
    if (eligibility === 'ready') scheduler.schedule(updates);
    return () => {
      scheduler.invalidate();
    };
  }, [eligibility, scheduler, updates]);

  return state;
}
