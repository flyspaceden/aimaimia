import { Result } from '../../types';
import {
  buildDeliveryPath,
  centsToYuan,
  deliveryApiClient,
  mapDeliveryResult,
} from './DeliveryAuthRepo';
import type { DeliveryPickupPlanItem } from '../../utils/deliveryPickupPlan';

export type DeliveryPickupMode = 'SINGLE' | 'MULTI_BATCH';

export type DeliveryPickupStatus =
  | 'NOT_STARTED'
  | 'PARTIAL_PICKED'
  | 'ALL_PICKED'
  | 'CANCELED'
  | string;

export type DeliveryPickupBatchStatus =
  | 'PLANNED'
  | 'READY_TO_CALL'
  | 'CALLING_CARRIER'
  | 'WAITING_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'ARRIVED'
  | 'LOADED'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELED'
  | 'EXCEPTION'
  | string;

export type DeliveryCheckoutSession = {
  id: string;
  merchantOrderNo: string;
  status: string;
  goodsAmount: number;
  shippingFee: number;
  totalAmount: number;
  paymentChannel: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  addressId?: string | null;
  unitId: string;
};

export type DeliveryOrderUnit = {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
};

export type DeliveryOrderAddress = {
  recipientName: string;
  phone: string;
  regionText: string;
  detailAddress: string;
};

export type DeliveryOrderSubOrder = {
  id: string;
  merchantId: string;
  merchantName: string;
  status: string;
  totalAmount: number;
  shippingFeeShare: number;
};

export type DeliveryOrderItem = {
  id: string;
  subOrderId: string;
  merchantId: string;
  merchantName: string;
  productId: string;
  skuId: string;
  productTitle: string;
  skuTitle: string;
  imageUrl: string;
  unitName: string;
  quantity: number;
  pickedQuantity: number;
  remainingQuantity: number;
  unitPrice: number;
  lineAmount: number;
};

export type DeliveryPickupBatchItem = {
  id: string;
  orderItemId: string;
  skuId: string;
  productTitle: string;
  skuTitle: string;
  unitName: string;
  quantity: number;
  pickedQuantity: number;
};

export type DeliveryPickupBatch = {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  batchNo: number;
  status: DeliveryPickupBatchStatus;
  provider: string;
  plannedPickupAt: string | null;
  readyAt: string | null;
  calledAt: string | null;
  loadedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  carrierOrderNo: string | null;
  driverSnapshot: unknown;
  vehicleSnapshot: unknown;
  items: DeliveryPickupBatchItem[];
};

export type DeliveryOrderShipment = {
  id: string;
  status: string;
  carrierCode: string;
  carrierName: string;
  waybillNo: string | null;
  waybillUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
};

export type DeliveryBuyerOrder = {
  id: string;
  status: string;
  pickupMode: DeliveryPickupMode | string;
  plannedPickupCount: number;
  pickupStatus: DeliveryPickupStatus;
  prepaidPickupShippingFee: number;
  note: string | null;
  merchantOrderNo: string | null;
  paymentChannel: string | null;
  goodsAmount: number;
  shippingFee: number;
  totalAmount: number;
  createdAt: string;
  paidAt: string | null;
  unit: DeliveryOrderUnit;
  address: DeliveryOrderAddress;
  subOrders: DeliveryOrderSubOrder[];
  items: DeliveryOrderItem[];
  shipments: DeliveryOrderShipment[];
  pickupBatches: DeliveryPickupBatch[];
};

type DeliveryBuyerOrderResponse = {
  id: string;
  status: string;
  pickupMode?: DeliveryPickupMode | string | null;
  plannedPickupCount?: number | null;
  pickupStatus?: DeliveryPickupStatus | null;
  prepaidPickupShippingFeeCents?: number | null;
  note: string | null;
  merchantOrderNo: string | null;
  paymentChannel: string | null;
  goodsAmountCents: number;
  shippingFeeCents: number;
  totalAmountCents: number;
  createdAt: string;
  paidAt: string | null;
  unit: DeliveryOrderUnit;
  address: DeliveryOrderAddress;
  subOrders: Array<{
    id: string;
    merchantId: string;
    merchantName: string;
    status: string;
    totalAmountCents: number;
    shippingFeeShareCents: number;
  }>;
  items: Array<{
    id: string;
    subOrderId: string;
    merchantId: string;
    merchantName: string;
    productId: string;
    skuId: string;
    productTitle: string;
    skuTitle: string;
    imageUrl: string | null;
    unitName: string;
    quantity: number;
    pickedQuantity?: number | null;
    remainingQuantity?: number | null;
    unitPriceCents: number;
    lineAmountCents: number;
  }>;
  shipments: Array<{
    id: string;
    status: string;
    carrierCode: string;
    carrierName: string;
    waybillNo: string | null;
    waybillUrl: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  }>;
  pickupBatches?: Array<{
    id: string;
    orderId: string;
    subOrderId: string;
    merchantId: string;
    batchNo: number;
    status: DeliveryPickupBatchStatus;
    provider: string;
    plannedPickupAt: string | null;
    readyAt: string | null;
    calledAt: string | null;
    loadedAt: string | null;
    completedAt: string | null;
    canceledAt: string | null;
    carrierOrderNo: string | null;
    driverSnapshot: unknown;
    vehicleSnapshot: unknown;
    items: Array<{
      id: string;
      orderItemId: string;
      skuId: string;
      productTitle: string;
      skuTitle: string;
      unitName: string;
      quantity: number;
      pickedQuantity: number;
    }>;
  }>;
};

type DeliveryBuyerOrderListResponse = {
  items: DeliveryBuyerOrderResponse[];
  total: number;
  page: number;
  pageSize: number;
};

type DeliveryCheckoutSessionResponse = {
  id: string;
  merchantOrderNo: string;
  status: string;
  goodsAmountCents: number;
  shippingFeeCents: number;
  totalAmountCents: number;
  paymentChannel: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  addressId?: string | null;
  unitId: string;
};

export type DeliveryCreateCheckoutPayload = {
  cartItemIds: string[];
  addressId?: string;
  note?: string;
  paymentChannel: 'ALIPAY' | 'WECHAT_PAY';
  pickupMode?: DeliveryPickupMode;
  plannedPickupCount?: number;
  pickupPlanItems?: DeliveryPickupPlanItem[];
};

type DeliveryPickupEstimateResponse = {
  goodsAmountCents: number;
  prepaidPickupShippingFeeCents: number;
  totalAmountCents: number;
  plannedPickupCount: number;
  perBatchEstimates: Array<{
    merchantId: string;
    merchantName?: string;
    batchNo: number;
    estimatedShippingFeeCents: number;
  }>;
};

export type DeliveryPickupEstimate = {
  goodsAmount: number;
  prepaidPickupShippingFee: number;
  totalAmount: number;
  plannedPickupCount: number;
  perBatchEstimates: Array<{
    merchantId: string;
    merchantName?: string;
    batchNo: number;
    estimatedShippingFee: number;
  }>;
};

export type DeliveryAlipayPaymentParams = {
  channel: 'alipay';
  orderStr: string;
};

export type DeliveryWechatPaymentParams = {
  channel: 'wechat';
  appId: string;
  partnerId: string;
  timestamp: string;
  nonceStr: string;
  prepayId: string;
  packageVal: string;
  signType: string;
  paySign: string;
};

export type DeliveryCheckoutPaymentParams =
  | DeliveryAlipayPaymentParams
  | DeliveryWechatPaymentParams
  | Record<string, never>;

type DeliveryCheckoutPaymentResponse = {
  checkoutId: string;
  merchantOrderNo: string | null;
  totalAmount: number;
  paymentParams: DeliveryCheckoutPaymentParams;
};

export type DeliveryCheckoutActiveQueryResult = {
  status: string;
  orderIds: string[];
  expectedTotal: number;
  confirmedBy: string;
};

export const deliveryOrderPaths = {
  checkoutRoot: () => buildDeliveryPath('checkout'),
  estimatePickups: () => buildDeliveryPath('checkout/estimate-pickups'),
  checkout: (id: string) => buildDeliveryPath(`checkout/${id}`),
  payment: (id: string) => buildDeliveryPath(`checkout/${id}/pay`),
  activeQuery: (id: string) => buildDeliveryPath(`checkout/${id}/active-query`),
  list: () => buildDeliveryPath('orders'),
  detail: (id: string) => buildDeliveryPath(`orders/${id}`),
  shipments: (id: string) => buildDeliveryPath(`orders/${id}/shipments`),
};

export const mapDeliveryCheckoutSession = (
  session: DeliveryCheckoutSessionResponse,
): DeliveryCheckoutSession => ({
  id: session.id,
  merchantOrderNo: session.merchantOrderNo,
  status: session.status,
  goodsAmount: centsToYuan(session.goodsAmountCents),
  shippingFee: centsToYuan(session.shippingFeeCents),
  totalAmount: centsToYuan(session.totalAmountCents),
  paymentChannel: session.paymentChannel,
  note: session.note ?? null,
  expiresAt: session.expiresAt,
  createdAt: session.createdAt,
  addressId: session.addressId ?? null,
  unitId: session.unitId,
});

export const mapDeliveryBuyerOrder = (
  order: DeliveryBuyerOrderResponse,
): DeliveryBuyerOrder => ({
  id: order.id,
  status: order.status,
  pickupMode: order.pickupMode ?? 'SINGLE',
  plannedPickupCount: order.plannedPickupCount ?? 1,
  pickupStatus: order.pickupStatus ?? 'NOT_STARTED',
  prepaidPickupShippingFee: centsToYuan(
    order.prepaidPickupShippingFeeCents ?? order.shippingFeeCents,
  ),
  note: order.note ?? null,
  merchantOrderNo: order.merchantOrderNo ?? null,
  paymentChannel: order.paymentChannel ?? null,
  goodsAmount: centsToYuan(order.goodsAmountCents),
  shippingFee: centsToYuan(order.shippingFeeCents),
  totalAmount: centsToYuan(order.totalAmountCents),
  createdAt: order.createdAt,
  paidAt: order.paidAt ?? null,
  unit: order.unit,
  address: order.address,
  subOrders: order.subOrders.map((subOrder) => ({
    id: subOrder.id,
    merchantId: subOrder.merchantId,
    merchantName: subOrder.merchantName,
    status: subOrder.status,
    totalAmount: centsToYuan(subOrder.totalAmountCents),
    shippingFeeShare: centsToYuan(subOrder.shippingFeeShareCents),
  })),
  items: order.items.map((item) => ({
    id: item.id,
    subOrderId: item.subOrderId,
    merchantId: item.merchantId,
    merchantName: item.merchantName,
    productId: item.productId,
    skuId: item.skuId,
    productTitle: item.productTitle,
    skuTitle: item.skuTitle,
    imageUrl: item.imageUrl ?? '',
    unitName: item.unitName,
    quantity: item.quantity,
    pickedQuantity: item.pickedQuantity ?? 0,
    remainingQuantity:
      item.remainingQuantity ?? Math.max(0, item.quantity - (item.pickedQuantity ?? 0)),
    unitPrice: centsToYuan(item.unitPriceCents),
    lineAmount: centsToYuan(item.lineAmountCents),
  })),
  shipments: order.shipments.map((shipment) => ({
    id: shipment.id,
    status: shipment.status,
    carrierCode: shipment.carrierCode,
    carrierName: shipment.carrierName,
    waybillNo: shipment.waybillNo ?? null,
    waybillUrl: shipment.waybillUrl ?? null,
    shippedAt: shipment.shippedAt ?? null,
    deliveredAt: shipment.deliveredAt ?? null,
  })),
  pickupBatches: (order.pickupBatches ?? []).map((batch) => ({
    id: batch.id,
    orderId: batch.orderId,
    subOrderId: batch.subOrderId,
    merchantId: batch.merchantId,
    batchNo: batch.batchNo,
    status: batch.status,
    provider: batch.provider,
    plannedPickupAt: batch.plannedPickupAt ?? null,
    readyAt: batch.readyAt ?? null,
    calledAt: batch.calledAt ?? null,
    loadedAt: batch.loadedAt ?? null,
    completedAt: batch.completedAt ?? null,
    canceledAt: batch.canceledAt ?? null,
    carrierOrderNo: batch.carrierOrderNo ?? null,
    driverSnapshot: batch.driverSnapshot ?? null,
    vehicleSnapshot: batch.vehicleSnapshot ?? null,
    items: batch.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      skuId: item.skuId,
      productTitle: item.productTitle,
      skuTitle: item.skuTitle,
      unitName: item.unitName,
      quantity: item.quantity,
      pickedQuantity: item.pickedQuantity,
    })),
  })),
});

export const mapDeliveryPickupEstimate = (
  payload: DeliveryPickupEstimateResponse,
): DeliveryPickupEstimate => ({
  goodsAmount: centsToYuan(payload.goodsAmountCents),
  prepaidPickupShippingFee: centsToYuan(payload.prepaidPickupShippingFeeCents),
  totalAmount: centsToYuan(payload.totalAmountCents),
  plannedPickupCount: payload.plannedPickupCount,
  perBatchEstimates: payload.perBatchEstimates.map((item) => ({
    merchantId: item.merchantId,
    merchantName: item.merchantName,
    batchNo: item.batchNo,
    estimatedShippingFee: centsToYuan(item.estimatedShippingFeeCents),
  })),
});

export const DeliveryOrderRepo = {
  createCheckout: (
    payload: DeliveryCreateCheckoutPayload,
  ): Promise<Result<DeliveryCheckoutSession>> =>
    deliveryApiClient
      .post<DeliveryCheckoutSessionResponse>(deliveryOrderPaths.checkoutRoot(), payload)
      .then((result) => mapDeliveryResult(result, mapDeliveryCheckoutSession)),

  estimatePickups: (
    payload: DeliveryCreateCheckoutPayload,
  ): Promise<Result<DeliveryPickupEstimate>> =>
    deliveryApiClient
      .post<DeliveryPickupEstimateResponse>(deliveryOrderPaths.estimatePickups(), payload)
      .then((result) => mapDeliveryResult(result, mapDeliveryPickupEstimate)),

  getCheckout: (id: string): Promise<Result<DeliveryCheckoutSession>> =>
    deliveryApiClient
      .get<DeliveryCheckoutSessionResponse>(deliveryOrderPaths.checkout(id))
      .then((result) => mapDeliveryResult(result, mapDeliveryCheckoutSession)),

  createPaymentParams: (
    checkoutId: string,
  ): Promise<Result<DeliveryCheckoutPaymentResponse>> =>
    deliveryApiClient.post<DeliveryCheckoutPaymentResponse>(
      deliveryOrderPaths.payment(checkoutId),
      {},
    ),

  activeQueryPayment: (
    checkoutId: string,
  ): Promise<Result<DeliveryCheckoutActiveQueryResult>> =>
    deliveryApiClient.post<DeliveryCheckoutActiveQueryResult>(
      deliveryOrderPaths.activeQuery(checkoutId),
      {},
    ),

  listOrders: (params?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Result<{ items: DeliveryBuyerOrder[]; total: number; page: number; pageSize: number }>> =>
    deliveryApiClient
      .get<DeliveryBuyerOrderListResponse>(deliveryOrderPaths.list(), params)
      .then((result) =>
        mapDeliveryResult(result, (payload) => ({
          items: payload.items.map(mapDeliveryBuyerOrder),
          total: payload.total,
          page: payload.page,
          pageSize: payload.pageSize,
        })),
      ),

  getOrder: (id: string): Promise<Result<DeliveryBuyerOrder>> =>
    deliveryApiClient
      .get<DeliveryBuyerOrderResponse>(deliveryOrderPaths.detail(id))
      .then((result) => mapDeliveryResult(result, mapDeliveryBuyerOrder)),

  listShipments: (id: string): Promise<Result<DeliveryOrderShipment[]>> =>
    deliveryApiClient
      .get<DeliveryBuyerOrderResponse['shipments']>(deliveryOrderPaths.shipments(id))
      .then((result) =>
        mapDeliveryResult(result, (shipments) =>
          shipments.map((shipment) => ({
            id: shipment.id,
            status: shipment.status,
            carrierCode: shipment.carrierCode,
            carrierName: shipment.carrierName,
            waybillNo: shipment.waybillNo ?? null,
            waybillUrl: shipment.waybillUrl ?? null,
            shippedAt: shipment.shippedAt ?? null,
            deliveredAt: shipment.deliveredAt ?? null,
          })),
        ),
      ),
};
