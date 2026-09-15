import type { QueryClient } from '@tanstack/react-query';

export const DISCOVERY_PRODUCTS_QUERY_KEY = ['products', 'discovery'] as const;

/** 失效所有发现页商品分类；复用正在执行的请求，避免取消后重发。 */
export function refreshDiscoveryProducts(queryClient: QueryClient) {
  return queryClient.invalidateQueries(
    { queryKey: DISCOVERY_PRODUCTS_QUERY_KEY },
    { cancelRefetch: false },
  );
}
