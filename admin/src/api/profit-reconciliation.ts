import client from './client';

export type ProfitReconciliationStatus = 'PENDING' | 'RESOLVED' | 'REJECTED';
export type ProfitAdjustmentStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'SUPERSEDED';
export type ProfitSnapshotStatus = 'READY' | 'RECONCILIATION_REQUIRED';
export type ProfitAdjustmentKind = 'REWARD' | 'CAPTAIN' | 'FUNDING';

export interface ProfitItemBreakdown {
  orderItemId: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  grossGoodsAmountCents: number;
  explicitDiscountCents: number;
  vipDiscountCents: number;
  rewardDeductionCents: number;
  groupBuyRebateDeductionCents: number;
  couponDiscountCents: number;
  totalDiscountCents: number;
  netGoodsRevenueCents: number;
  productCostCents: number;
  grossProfitCents: number;
  distributableProfitShareCents: number;
  captainEligible: boolean;
}

export interface OrderProfitSnapshot {
  id: string;
  orderId: string;
  revision: number;
  isCurrent: boolean;
  supersedesSnapshotId?: string | null;
  status: ProfitSnapshotStatus;
  grossGoodsAmount: number;
  shippingAmount: number;
  vipDiscountAmount: number;
  couponDiscountAmount: number;
  rewardDeductionAmount: number;
  groupBuyRebateDeductionAmount: number;
  otherGoodsDiscountAmount: number;
  netGoodsRevenue: number;
  productCostAmount: number;
  distributableProfitAmount: number;
  captainEligibleProfitAmount: number;
  calculationVersion: string;
  itemBreakdown: ProfitItemBreakdown[] | unknown;
  ruleSnapshot: unknown;
  errorCode?: string | null;
  errorMeta?: unknown;
  createdAt: string;
  createdByAdminId?: string | null;
}

export interface ProfitOrderItem {
  id: string;
  skuId: string;
  productSnapshot?: unknown;
  unitPrice: number;
  quantity: number;
  isPrize: boolean;
}

export interface ProfitOrderLite {
  id: string;
  userId?: string;
  paidAt?: string | null;
  items?: ProfitOrderItem[];
}

export interface ProfitAdjustmentComponent {
  key: string;
  kind: ProfitAdjustmentKind;
  sourceLedgerId?: string | null;
  accountId?: string | null;
  userId?: string | null;
  accountType?: string | null;
  fundingType?: string;
  bucket?: 'frozen' | 'balance';
  beforeCents: number;
  targetCents: number;
  deltaCents: number;
}

export interface ProfitAdjustmentPayload {
  version?: number;
  reason?: string;
  reconciliationTaskId?: string;
  resolutionReason?: string;
  sourceRevision?: number;
  targetRevision?: number;
  components?: ProfitAdjustmentComponent[];
}

export interface ProfitAdjustmentDraft {
  id: string;
  orderId: string;
  order?: ProfitOrderLite;
  sourceSnapshotId: string;
  sourceSnapshot?: OrderProfitSnapshot;
  targetSnapshotId: string;
  targetSnapshot?: OrderProfitSnapshot;
  status: ProfitAdjustmentStatus;
  adjustments: ProfitAdjustmentPayload | unknown;
  idempotencyKey: string;
  supersededByDraftId?: string | null;
  reviewNote?: string | null;
  reviewedByAdminId?: string | null;
  reviewedAt?: string | null;
  appliedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  replacementChain?: Array<{
    id: string;
    status: ProfitAdjustmentStatus;
    supersededByDraftId?: string | null;
    createdAt: string;
    adjustments: ProfitAdjustmentPayload | unknown;
  }>;
}

export interface ProfitReconciliationTask {
  id: string;
  orderId: string;
  order?: ProfitOrderLite;
  sourceSnapshotId: string;
  sourceSnapshot: OrderProfitSnapshot;
  status: ProfitReconciliationStatus;
  errorCode: string;
  itemCostCorrections?: Array<{ orderItemId: string; unitCostCents: number }> | unknown;
  resolutionNote?: string | null;
  resolvedSnapshotId?: string | null;
  resolvedSnapshot?: OrderProfitSnapshot | null;
  resolvedByAdminId?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  adjustmentDrafts?: ProfitAdjustmentDraft[];
}

export interface RecalculateProfitInput {
  reason: string;
  costCorrections: Array<{ orderItemId: string; unitCostCents: number }>;
}

export interface RecalculateProfitResult {
  task: Pick<
    ProfitReconciliationTask,
    | 'id'
    | 'orderId'
    | 'status'
    | 'sourceSnapshotId'
    | 'resolvedSnapshotId'
    | 'resolutionNote'
    | 'resolvedByAdminId'
    | 'resolvedAt'
  >;
  resolvedSnapshot: OrderProfitSnapshot;
  adjustmentDraft?: ProfitAdjustmentDraft | null;
}

export interface PagedProfitResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProfitListParams<TStatus extends string> {
  status?: TStatus;
  page?: number;
  pageSize?: number;
}

export const getProfitReconciliations = (
  params: ProfitListParams<ProfitReconciliationStatus> = {},
) =>
  client.get<unknown, PagedProfitResult<ProfitReconciliationTask>>('/admin/profit-reconciliation', {
    params,
  });

export const getProfitReconciliation = (id: string) =>
  client.get<unknown, ProfitReconciliationTask>(`/admin/profit-reconciliation/${id}`);

export const recalculateProfit = (id: string, data: RecalculateProfitInput) =>
  client.post<unknown, RecalculateProfitResult>(
    `/admin/profit-reconciliation/${id}/recalculate`,
    data,
  );

export const rejectProfitReconciliation = (id: string, note: string) =>
  client.post<unknown, ProfitReconciliationTask>(
    `/admin/profit-reconciliation/${id}/reject`,
    { note },
  );

export const getProfitAdjustments = (
  params: ProfitListParams<ProfitAdjustmentStatus> = {},
) =>
  client.get<unknown, PagedProfitResult<ProfitAdjustmentDraft>>('/admin/profit-adjustments', {
    params,
  });

export const getProfitAdjustment = (id: string) =>
  client.get<unknown, ProfitAdjustmentDraft>(`/admin/profit-adjustments/${id}`);

export const approveAndApplyProfitAdjustment = (id: string, note: string) =>
  client.post<unknown, ProfitAdjustmentDraft>(
    `/admin/profit-adjustments/${id}/approve-and-apply`,
    { note },
  );

export const rejectProfitAdjustment = (id: string, note: string) =>
  client.post<unknown, ProfitAdjustmentDraft>(`/admin/profit-adjustments/${id}/reject`, {
    note,
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function getProfitSnapshotModel(snapshot?: OrderProfitSnapshot | null) {
  return snapshot?.calculationVersion === 'discounted-profit-v1' ? 'PROFIT_V3' : 'HISTORICAL';
}

export function getAdjustmentComponents(value: unknown): ProfitAdjustmentComponent[] {
  const payload = asRecord(value);
  if (!payload || !Array.isArray(payload.components)) return [];
  return payload.components.filter((row): row is ProfitAdjustmentComponent => {
    const item = asRecord(row);
    return Boolean(
      item
      && typeof item.key === 'string'
      && typeof item.kind === 'string'
      && typeof item.beforeCents === 'number'
      && typeof item.targetCents === 'number'
      && typeof item.deltaCents === 'number',
    );
  });
}

export function getCaptainIdFromSnapshot(snapshot?: OrderProfitSnapshot | null) {
  const rules = asRecord(snapshot?.ruleSnapshot);
  const captain = asRecord(rules?.captain);
  return typeof captain?.directCaptainUserId === 'string' ? captain.directCaptainUserId : null;
}

export function formatProfitWorkflowError(error: unknown): string {
  const root = asRecord(error);
  const details = asRecord(root?.details);
  const payload = details ?? root;
  const message = [payload?.displayMessage, payload?.message, root?.message]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?? '操作失败，请刷新后重试';
  const code = typeof payload?.code === 'string' ? payload.code : null;
  const errorMeta = asRecord(payload?.errorMeta);
  const orderItemIds = Array.isArray(errorMeta?.orderItemIds)
    ? errorMeta.orderItemIds.filter((id): id is string => typeof id === 'string')
    : [];
  const reason = typeof errorMeta?.reason === 'string' ? errorMeta.reason : null;
  const suffix = [
    code ? `错误码 ${code}` : null,
    orderItemIds.length > 0 ? `订单项 ${orderItemIds.join('、')}` : null,
    reason ? `校验原因 ${reason}` : null,
  ].filter(Boolean);
  return suffix.length > 0 ? `${message}；${suffix.join('；')}` : message;
}
