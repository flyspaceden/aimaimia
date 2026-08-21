import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installAbortControllerPolyfill,
} from '@/polyfills/abort-controller';

const nativeAbortController = globalThis.AbortController;
const nativeAbortSignal = globalThis.AbortSignal;

afterEach(() => {
  Object.defineProperty(globalThis, 'AbortController', {
    configurable: true,
    writable: true,
    value: nativeAbortController,
  });
  Object.defineProperty(globalThis, 'AbortSignal', {
    configurable: true,
    writable: true,
    value: nativeAbortSignal,
  });
});

describe('WeChat runtime AbortController compatibility', () => {
  it('lets React Query fetch when the runtime does not provide AbortController', async () => {
    Object.defineProperty(globalThis, 'AbortController', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'AbortSignal', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    installAbortControllerPolyfill();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(client.fetchQuery({
      queryKey: ['abort-controller-polyfill'],
      queryFn: ({ signal }) => {
        expect(signal).toBeDefined();
        expect(signal.aborted).toBe(false);
        return 'ok';
      },
    })).resolves.toBe('ok');
  });
});
