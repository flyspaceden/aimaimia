/** Recovery reads never submit a model job. A failed read preserves the caller's task reference. */
export async function readVisualRecovery<Q extends { quote: { sourceAssetRef: string }; optimization?: { id: string; status: string } | null }, A, O>(
  quoteId: string,
  readers: { quote: (id: string) => Promise<Q>; asset: (id: string) => Promise<A>; optimization: (id: string) => Promise<O> },
) {
  const result = await readers.quote(quoteId);
  const source = await readers.asset(result.quote.sourceAssetRef);
  const optimization = result.optimization && ['SUCCEEDED', 'ADOPTED', 'REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(result.optimization.status)
    ? await readers.optimization(result.optimization.id) : null;
  return { result, source, optimization };
}

export function visualExecutionNeedsQuery(status: string, optimizationId?: string, loadedId?: string) {
  return ['QUEUED', 'RUNNING', 'VERIFYING', 'ALREADY_BOUND', 'RECONCILING', 'PENDING_REVIEW'].includes(status)
    || (status === 'SUCCEEDED' && Boolean(optimizationId) && loadedId !== optimizationId);
}

export function visualQuoteExpired(expiresAt: string, now: number) {
  return !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now;
}

export async function confirmWithRecoveryPointer<T>(quoteId: string, remember: (id: string) => void, confirm: () => Promise<T>) {
  // Persist before the request: the response may be lost after the server accepts it.
  remember(quoteId);
  return confirm();
}

export function freeTuneEligibility(
  plan: { sourceAssetId: string; riskProfile: string; allowedModes: string[]; processingPlan?: { freeTunePolicy?: { contractVersion?: string; available?: boolean } } | null } | null,
  scan: { sourceAssetId: string; freeTuneEligible: boolean } | null,
) {
  if (!plan) return false;
  const policy = plan.processingPlan?.freeTunePolicy;
  if (policy) return policy.contractVersion === 'local-photometric-v2' && policy.available === true;
  return plan.riskProfile === 'STANDARD_FACTS' && plan.allowedModes.includes('PRESERVE_REAL_SCENE')
    && scan?.sourceAssetId === plan.sourceAssetId && scan.freeTuneEligible === true;
}
