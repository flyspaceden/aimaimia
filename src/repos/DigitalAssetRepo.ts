import type { PaginationResult, Result } from '../types';
import type { DigitalAssetLedger, DigitalAssetSummary } from '../types/domain/DigitalAsset';
import { ApiClient } from './http/ApiClient';
import { normalizePagination } from './http/pagination';

type DigitalAssetLedgerPage = {
  items: DigitalAssetLedger[];
  total: number;
  page: number;
  pageSize: number;
};

export const DigitalAssetRepo = {
  getSummary: (): Promise<Result<DigitalAssetSummary>> => {
    return ApiClient.get<DigitalAssetSummary>('/me/digital-assets/summary');
  },

  getLedgers: async (
    page = 1,
    pageSize = 30,
  ): Promise<Result<PaginationResult<DigitalAssetLedger>>> => {
    const result = await ApiClient.get<DigitalAssetLedgerPage>('/me/digital-assets/ledgers', {
      page,
      pageSize,
    });
    if (!result.ok) return result as Result<PaginationResult<DigitalAssetLedger>>;
    return {
      ok: true,
      data: normalizePagination(result.data),
    };
  },
};
