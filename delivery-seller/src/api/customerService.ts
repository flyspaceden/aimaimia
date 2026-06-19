import client from './client';
import type { QueryParams } from '@/types';

export interface DeliveryConversation {
  id: string;
  merchantId: string;
  orderId?: string | null;
  subOrderId?: string | null;
  subject?: string | null;
  status: 'OPEN' | 'CLOSED';
  source: string;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  assignedStaffId?: string | null;
  assignedAdminId?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    phone?: string | null;
    nickname?: string | null;
  } | null;
  order?: {
    id: string;
    status: string;
  } | null;
  subOrder?: {
    id: string;
    status: string;
  } | null;
}

export interface CreateConversationPayload {
  orderId?: string;
  subOrderId?: string;
  subject?: string;
  message: string;
}

export interface UpdateConversationPayload {
  subject?: string;
  message?: string;
  status?: 'OPEN' | 'CLOSED';
}

export const getConversations = (params?: QueryParams): Promise<DeliveryConversation[]> =>
  client.get('/delivery-seller/cs', { params });

export const getConversation = (id: string): Promise<DeliveryConversation> =>
  client.get(`/delivery-seller/cs/${id}`);

export const createConversation = (data: CreateConversationPayload): Promise<DeliveryConversation> =>
  client.post('/delivery-seller/cs', data);

export const updateConversation = (
  id: string,
  data: UpdateConversationPayload,
): Promise<DeliveryConversation> =>
  client.patch(`/delivery-seller/cs/${id}`, data);
