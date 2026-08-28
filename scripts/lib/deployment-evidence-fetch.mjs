const DEFAULT_RETRY_DELAYS_MS = Object.freeze([500, 1_500]);

class DeploymentEvidenceHttpError extends Error {
  constructor(status) {
    super(`测试部署证据返回 HTTP ${status}`);
    this.name = 'DeploymentEvidenceHttpError';
  }
}

function transportErrorDetail(error) {
  const cause = error instanceof Error && error.cause && typeof error.cause === 'object'
    ? error.cause
    : null;
  const code = cause && 'code' in cause && typeof cause.code === 'string' ? cause.code : null;
  const message = cause && 'message' in cause && typeof cause.message === 'string'
    ? cause.message
    : error instanceof Error
      ? error.message
      : String(error);
  return code ? `${code}: ${message}` : message;
}

/**
 * Fetch one public deployment marker with a small, bounded transport retry.
 * HTTP responses remain authoritative and are never retried; only failures
 * where no response was received (DNS/TLS/socket/timeout) get another attempt.
 */
export async function fetchDeploymentText(url, expectedSha, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const onRetry = options.onRetry || (() => {});
  const retryDelaysMs = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS;
  const maxAttempts = retryDelaysMs.length + 1;
  const separator = url.includes('?') ? '&' : '?';
  const evidenceUrl = `${url}${separator}release=${encodeURIComponent(expectedSha)}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(evidenceUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new DeploymentEvidenceHttpError(response.status);
      return await response.text();
    } catch (error) {
      if (error instanceof DeploymentEvidenceHttpError) throw error;
      const detail = transportErrorDetail(error);
      if (attempt >= maxAttempts) {
        throw new Error(`测试部署证据连续 ${maxAttempts} 次发生传输失败：${detail}`, { cause: error });
      }
      const delayMs = retryDelaysMs[attempt - 1];
      onRetry({ attempt, maxAttempts, delayMs, detail });
      await sleep(delayMs);
    }
  }

  throw new Error('测试部署证据重试状态异常');
}
