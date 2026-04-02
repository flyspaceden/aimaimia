/** 溯源事件 */
export interface TraceEvent {
  id: string;
  type: string;
  data: Record<string, unknown> | null;
  occurredAt: string;
}

/** 溯源批次 */
export interface TraceBatch {
  id: string;
  batchCode: string;
  productId: string | null;
  companyId: string | null;
  stage: string;
  status: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  events: TraceEvent[];
  ownershipClaim?: {
    id: string;
    type: string;
    data: Record<string, unknown> | null;
    verifiedAt: string | null;
  } | null;
}

/** 商品溯源链 */
export interface ProductTrace {
  productId: string;
  batches: TraceBatch[];
}

/** 订单溯源链 */
export interface OrderTrace {
  orderId: string;
  items: Array<{
    orderItemId: string;
    batches: TraceBatch[];
  }>;
}
