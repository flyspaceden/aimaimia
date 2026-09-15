import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  DISCOVERY_PRODUCTS_QUERY_KEY,
  refreshDiscoveryProducts,
} from '../productQueryRefresh';

describe('refreshDiscoveryProducts', () => {
  it('invalidates every cached discovery category without touching unrelated queries', async () => {
    const queryClient = new QueryClient();
    const allProductsKey = [...DISCOVERY_PRODUCTS_QUERY_KEY, null];
    const seafoodKey = [...DISCOVERY_PRODUCTS_QUERY_KEY, 'seafood'];
    const unrelatedKey = ['companies', 'discovery'];
    queryClient.setQueryData(allProductsKey, { items: [] });
    queryClient.setQueryData(seafoodKey, { items: [] });
    queryClient.setQueryData(unrelatedKey, { items: [] });

    await refreshDiscoveryProducts(queryClient);

    expect(queryClient.getQueryState(allProductsKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(seafoodKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

  it('does not cancel and restart an active request', async () => {
    const queryClient = new QueryClient();
    const queryKey = [...DISCOVERY_PRODUCTS_QUERY_KEY, null];
    queryClient.setQueryData(queryKey, { items: [] });
    let resolveRequest: ((value: { items: never[] }) => void) | undefined;
    const queryFn = jest.fn(() => new Promise<{ items: never[] }>((resolve) => {
      resolveRequest = resolve;
    }));
    const observer = new QueryObserver(queryClient, { queryKey, queryFn });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(queryFn).toHaveBeenCalledTimes(1);
    const refreshPromise = refreshDiscoveryProducts(queryClient);
    expect(queryFn).toHaveBeenCalledTimes(1);

    resolveRequest?.({ items: [] });
    await refreshPromise;
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
