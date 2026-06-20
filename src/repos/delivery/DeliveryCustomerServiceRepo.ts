import { Result } from '../../types';
import {
  buildDeliveryPath,
  deliveryApiClient,
  mapDeliveryResult,
} from './DeliveryAuthRepo';

export type DeliveryCustomerServiceConversation = {
  id: string;
  source: string;
  status: string;
  subject: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  orderId: string | null;
  subOrderId: string | null;
  merchantId: string | null;
  createdAt: string;
  updatedAt: string;
};

type DeliveryCustomerServiceConversationResponse = DeliveryCustomerServiceConversation;

export type DeliveryCreateConversationPayload = {
  orderId?: string;
  subOrderId?: string;
  subject?: string;
  message: string;
};

export const deliveryCustomerServicePaths = {
  list: () => buildDeliveryPath('cs'),
  detail: (id: string) => buildDeliveryPath(`cs/${id}`),
};

const mapConversation = (
  conversation: DeliveryCustomerServiceConversationResponse,
): DeliveryCustomerServiceConversation => ({
  ...conversation,
  subject: conversation.subject ?? null,
  lastMessagePreview: conversation.lastMessagePreview ?? null,
  lastMessageAt: conversation.lastMessageAt ?? null,
  orderId: conversation.orderId ?? null,
  subOrderId: conversation.subOrderId ?? null,
  merchantId: conversation.merchantId ?? null,
});

export const DeliveryCustomerServiceRepo = {
  list: (params?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Result<DeliveryCustomerServiceConversation[]>> =>
    deliveryApiClient
      .get<DeliveryCustomerServiceConversationResponse[]>(
        deliveryCustomerServicePaths.list(),
        params,
      )
      .then((result) =>
        mapDeliveryResult(result, (items) => items.map(mapConversation)),
      ),

  get: (id: string): Promise<Result<DeliveryCustomerServiceConversation>> =>
    deliveryApiClient
      .get<DeliveryCustomerServiceConversationResponse>(
        deliveryCustomerServicePaths.detail(id),
      )
      .then((result) => mapDeliveryResult(result, mapConversation)),

  create: (
    payload: DeliveryCreateConversationPayload,
  ): Promise<Result<DeliveryCustomerServiceConversation>> =>
    deliveryApiClient
      .post<DeliveryCustomerServiceConversationResponse>(
        deliveryCustomerServicePaths.list(),
        payload,
      )
      .then((result) => mapDeliveryResult(result, mapConversation)),
};
