import {
  AbortController as AbortControllerPolyfill,
  AbortSignal as AbortSignalPolyfill,
} from 'abort-controller/dist/abort-controller';

type AbortGlobals = typeof globalThis & {
  AbortController?: typeof globalThis.AbortController;
  AbortSignal?: typeof globalThis.AbortSignal;
};

/**
 * React Query v5 creates an AbortController for every fetch. Some WeChat
 * Mini Program JS runtimes do not expose that browser API, so install the
 * WHATWG-compatible implementation before the application starts.
 */
export function installAbortControllerPolyfill(target: AbortGlobals = globalThis): void {
  if (typeof target.AbortController !== 'function') {
    target.AbortController = AbortControllerPolyfill as unknown as typeof globalThis.AbortController;
  }
  if (typeof target.AbortSignal !== 'function') {
    target.AbortSignal = AbortSignalPolyfill as unknown as typeof globalThis.AbortSignal;
  }
}

installAbortControllerPolyfill();
