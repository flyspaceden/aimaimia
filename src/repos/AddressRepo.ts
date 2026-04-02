/**
 * 地址仓储（Repo）
 *
 * 后端接口：
 * - GET /api/v1/addresses → Address[]
 * - POST /api/v1/addresses → Address
 * - PATCH /api/v1/addresses/:id → Address
 * - DELETE /api/v1/addresses/:id → void
 * - PATCH /api/v1/addresses/:id/default → Address
 */
import { Address, Result } from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';

// Mock 数据
let mockAddresses: Address[] = [
  {
    id: 'addr-1',
    receiverName: '张三',
    phone: '13800138000',
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    detail: '文三路 138 号',
    isDefault: true,
    createdAt: '2026-01-10',
  },
  {
    id: 'addr-2',
    receiverName: '李四',
    phone: '13900139000',
    province: '北京市',
    city: '北京市',
    district: '朝阳区',
    detail: '建国路 88 号',
    isDefault: false,
    createdAt: '2026-01-15',
  },
];

export const AddressRepo = {
  /** 地址列表 */
  list: async (): Promise<Result<Address[]>> => {
    if (USE_MOCK) {
      return simulateRequest([...mockAddresses]);
    }
    return ApiClient.get<Address[]>('/addresses');
  },

  /** 新增地址 */
  create: async (data: Omit<Address, 'id' | 'isDefault' | 'createdAt'>): Promise<Result<Address>> => {
    if (USE_MOCK) {
      const addr: Address = {
        ...data,
        id: `addr-${Date.now()}`,
        isDefault: mockAddresses.length === 0,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      mockAddresses.push(addr);
      return simulateRequest(addr, { delay: 300 });
    }
    return ApiClient.post<Address>('/addresses', data);
  },

  /** 更新地址 */
  update: async (id: string, data: Partial<Omit<Address, 'id' | 'isDefault' | 'createdAt'>>): Promise<Result<Address>> => {
    if (USE_MOCK) {
      const addr = mockAddresses.find((a) => a.id === id);
      if (!addr) return { ok: false, error: { code: 'NOT_FOUND', message: '地址不存在', retryable: false } };
      Object.assign(addr, data);
      return simulateRequest(addr, { delay: 300 });
    }
    return ApiClient.patch<Address>(`/addresses/${id}`, data);
  },

  /** 删除地址 */
  remove: async (id: string): Promise<Result<void>> => {
    if (USE_MOCK) {
      mockAddresses = mockAddresses.filter((a) => a.id !== id);
      return simulateRequest(undefined as void, { delay: 200 });
    }
    return ApiClient.delete<void>(`/addresses/${id}`);
  },

  /** 设为默认 */
  setDefault: async (id: string): Promise<Result<Address>> => {
    if (USE_MOCK) {
      mockAddresses.forEach((a) => { a.isDefault = a.id === id; });
      const addr = mockAddresses.find((a) => a.id === id);
      if (!addr) return { ok: false, error: { code: 'NOT_FOUND', message: '地址不存在', retryable: false } };
      return simulateRequest(addr, { delay: 200 });
    }
    return ApiClient.patch<Address>(`/addresses/${id}/default`);
  },
};
