/**
 * This is an internal Core-to-provider contract. It is deliberately not a
 * DTO: no browser or Domain Adapter may manufacture a provider request.
 *
 * The Core must persist the invocation and its budget reservation *before*
 * calling submit. A transport UNKNOWN result is charge-ambiguous and must
 * remain RECONCILING; it may never be retried as a fresh generation.
 */
export type VisualProviderTaskState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
export type VisualProviderModel = 'wan2.7-image' | 'wan2.7-image-pro' | 'qwen-image-3.0' | 'qwen-image-3.0-pro';
export type VisualProviderDirection = 'PRESERVE_REAL_SCENE' | 'CATALOG_STUDIO' | 'PRODUCT_RETOUCH' | 'MARKETING_SCENE';
export type VisualProviderRiskProfile = 'STRICT_FACTS' | 'CONSERVATIVE_FACTS' | 'STANDARD_FACTS' | 'ORGANIC_FACTS' | 'MARKETING_ONLY';
export type VisualProviderAllowedOperation = 'LIGHTING' | 'WHITE_BALANCE' | 'DENOISE' | 'DEGLARE' | 'COMPOSITION' | 'BACKGROUND_SIMPLIFY' | 'BACKGROUND_REPLACE';

/** A Core-normalized, non-transparent image. The provider revalidates it. */
export type VisualProviderSource = {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  normalizedVersion: 'normalized-rgba-srgb-v1';
  opaque: true;
};

/**
 * Only a server-created plan reaches a provider. Prompt text is intentionally
 * absent: each provider owns a reviewed fixed template for this plan shape.
 */
export type VisualProviderServerPlan = {
  templateVersion: 'truth-preserving-v1';
  direction: VisualProviderDirection;
  riskProfile: VisualProviderRiskProfile;
  allowedOperations: readonly VisualProviderAllowedOperation[];
  protectedRegionVersion: string;
};

/** Evidence that the Core has already persisted all scope budget reservations. */
export type VisualProviderAuthorization = {
  invocationId: string;
  provider: string;
  policySnapshotVersion: string;
  reservedCostCents: number;
  adapterExecutionApproved: true;
  /** A single-use persisted Core submit lease, never supplied by a browser. */
  leaseToken: string;
  leaseGeneration: number;
  expiresAt: Date;
};

export type VisualProviderSubmitInput = {
  source: VisualProviderSource;
  visualPlan: VisualProviderServerPlan;
  model: VisualProviderModel;
  authorization: VisualProviderAuthorization;
};

export type VisualProviderTask = {
  providerTaskId: string;
  state: VisualProviderTaskState;
  providerRequestId?: string;
};

export type VisualProviderKnownTaskResult = VisualProviderTask & {
  kind: 'KNOWN';
  outputUrl?: string;
  successfulImageCount?: number;
};

export type VisualProviderDeclinedResult = {
  kind: 'DECLINED';
  code: 'INVALID_REQUEST' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'NOT_FOUND';
  /** The provider explicitly rejected the operation; it is safe to release a reservation. */
  providerRequestId?: string;
};

export type VisualProviderUnknownResult = {
  kind: 'UNKNOWN';
  code: 'TRANSPORT_TIMEOUT' | 'TRANSPORT_FAILURE' | 'AMBIGUOUS_PROVIDER_RESPONSE' | 'UNKNOWN_PROVIDER_STATE';
  /** The Core must durably transition its existing invocation to RECONCILING. */
  requiresReconciliation: true;
  providerRequestId?: string;
};

export type VisualProviderSubmitResult =
  | ({ kind: 'ACCEPTED' } & VisualProviderTask)
  | VisualProviderDeclinedResult
  | VisualProviderUnknownResult;

export type VisualProviderQueryResult = VisualProviderKnownTaskResult | VisualProviderDeclinedResult | VisualProviderUnknownResult;

export type VisualProviderOutput = {
  buffer: Buffer;
  mimeType: VisualProviderSource['mimeType'];
};

/** Provider adapters do not decide verification, publication, or retries. */
export interface VisualImageEditProvider {
  isAvailable(): boolean;
  preflight(input: Pick<VisualProviderSubmitInput, 'source' | 'visualPlan' | 'model'>): Promise<void>;
  submit(input: VisualProviderSubmitInput): Promise<VisualProviderSubmitResult>;
  query(providerTaskId: string): Promise<VisualProviderQueryResult>;
  fetchOutput(outputUrl: string): Promise<VisualProviderOutput>;
}
