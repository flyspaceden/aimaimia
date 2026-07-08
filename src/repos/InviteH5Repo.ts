import type { InviteH5Stats, Result } from '../types';
import { simulateRequest } from './helpers';
import { ApiClient } from './http/ApiClient';
import { USE_MOCK } from './http/config';

const mockStats: InviteH5Stats = {
  openCount: 18,
  authedCount: 11,
  boundCount: 9,
};

export const InviteH5Repo = {
  getStats: async (): Promise<Result<InviteH5Stats>> => {
    if (USE_MOCK) return simulateRequest(mockStats);
    return ApiClient.get<InviteH5Stats>('/invite-h5/stats');
  },
};
