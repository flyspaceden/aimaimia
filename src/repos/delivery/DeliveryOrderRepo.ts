import { Result } from '../../types';
import {
  buildDeliveryPath,
  centsToYuan,
  deliveryApiClient,
  mapDeliveryResult,
} from './DeliveryAuthRepo';

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
  pricingSnapshot?: Record<string, unknown> | null;
  addressSnapshot?: Record<string, unknown> | null;
  unitSnapshot?: Record<string, unknown> | null;
  itemsSnapshot?: unknown[];
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
  pricingSnapshot?: Record<string, unknown> | null;
  addressSnapshot?: Record<string, unknown> | null;
  unitSnapshot?: Record<string, unknown> | null;
  itemsSnapshot?: unknown[];
};

export type DeliveryCreateCheckoutPayload = {
  cartItemIds: string[];
  addressId?: string;
  note?: string;
  paymentChannel: 'ALIPAY' | 'WECHAT_PAY';
};

export const deliveryOrderPaths = {
  checkoutRoot: () => buildDeliveryPath('checkout'),
  checkout: (id: string) => buildDeliveryPath(`checkout/${id}`),
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
  pricingSnapshot: session.pricingSnapshot ?? null,
  addressSnapshot: session.addressSnapshot ?? null,
  unitSnapshot: session.unitSnapshot ?? null,
  itemsSnapshot: session.itemsSnapshot ?? [],
});

export const DeliveryOrderRepo = {
  createCheckout: (
    payload: DeliveryCreateCheckoutPayload,
  ): Promise<Result<DeliveryCheckoutSession>> =>
    deliveryApiClient
      .post<DeliveryCheckoutSessionResponse>(deliveryOrderPaths.checkoutRoot(), payload)
      .then((result) => mapDeliveryResult(result, mapDeliveryCheckoutSession)),

  getCheckout: (id: string): Promise<Result<DeliveryCheckoutSession>> =>
    deliveryApiClient
      .get<DeliveryCheckoutSessionResponse>(deliveryOrderPaths.checkout(id))
      .then((result) => mapDeliveryResult(result, mapDeliveryCheckoutSession)),
};
