import { useEffect, useMemo, useState } from 'react';
import { previewProfitSafety } from '@/api/config';
import type { ProfitSafetySummary, RuleConfig } from '@/types';
import {
  buildProfitSafetyCandidateUpdates,
  createProfitSafetyPreviewScheduler,
  getProfitSafetyPreviewEligibility,
  type ProfitSafetyPreviewConfigMeta,
} from '@/utils/configProfitSafetyPreview';

export type ProfitSafetyPreviewState =
  | { kind: 'saved' }
  | { kind: 'checking' }
  | { kind: 'candidate'; summary: ProfitSafetySummary }
  | { kind: 'invalid-ratio' }
  | { kind: 'invalid-form' }
  | { kind: 'error'; error: Error };

export interface UseConfigProfitSafetyPreviewInput {
  configs: RuleConfig[];
  values?: Record<string, unknown>;
  schema: readonly ProfitSafetyPreviewConfigMeta[];
  sumValid: boolean;
  hasValidationErrors: boolean;
  enabled: boolean;
  delayMs?: number;
}

type AsyncProfitSafetyPreviewState =
  | { fingerprint: string; kind: 'checking' }
  | { fingerprint: string; kind: 'candidate'; summary: ProfitSafetySummary }
  | { fingerprint: string; kind: 'error'; error: Error };

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
}: UseConfigProfitSafetyPreviewInput): ProfitSafetyPreviewState {
  const [asyncState, setAsyncState] = useState<AsyncProfitSafetyPreviewState>();
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
  const fingerprint = JSON.stringify(updates);
  const scheduler = useMemo(() => createProfitSafetyPreviewScheduler<ProfitSafetySummary>({
    delayMs,
    preview: async (updates) => previewProfitSafety({ updates }),
    onChecking: () => setAsyncState({ fingerprint, kind: 'checking' }),
    onCandidate: (summary) => setAsyncState({ fingerprint, kind: 'candidate', summary }),
    onError: (error) => setAsyncState({ fingerprint, kind: 'error', error }),
  }), [delayMs, fingerprint]);

  useEffect(() => {
    scheduler.invalidate();
    if (eligibility === 'ready') scheduler.schedule(updates);
    return () => {
      scheduler.invalidate();
    };
  }, [eligibility, scheduler, updates]);

  if (eligibility === 'saved') return { kind: 'saved' };
  if (eligibility === 'invalid-ratio') return { kind: 'invalid-ratio' };
  if (eligibility === 'invalid-form') return { kind: 'invalid-form' };
  if (asyncState?.fingerprint !== fingerprint) return { kind: 'checking' };
  if (asyncState.kind === 'candidate') return { kind: 'candidate', summary: asyncState.summary };
  if (asyncState.kind === 'error') return { kind: 'error', error: asyncState.error };
  return { kind: 'checking' };
}
