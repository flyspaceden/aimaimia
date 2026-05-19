import { useQuery } from '@tanstack/react-query';
import { AppConfigRepo, PublicAppConfig } from '../repos/AppConfigRepo';

const FALLBACK: PublicAppConfig = {
  lowStockDisplayThreshold: 10,
};

/**
 * 拉取并缓存公开 App 配置（含低库存展示阈值等）。
 * 失败或加载中时返回 FALLBACK，调用方可直接使用、无需判断 loading。
 */
export function useAppConfig(): PublicAppConfig {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: AppConfigRepo.getPublicConfig,
    staleTime: 1000 * 60 * 60,
  });
  return data?.ok ? data.data : FALLBACK;
}
