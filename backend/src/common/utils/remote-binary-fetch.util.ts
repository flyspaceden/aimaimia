const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export class RemoteBinaryFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 502,
  ) {
    super(message);
    this.name = 'RemoteBinaryFetchError';
  }
}

export async function fetchBinaryWithLimit(
  url: string,
  options?: {
    timeoutMs?: number;
    maxBytes?: number;
  },
): Promise<{
  buffer: Buffer;
  contentType: string | null;
}> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new RemoteBinaryFetchError('面单图片地址无效');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new RemoteBinaryFetchError('面单图片地址协议不被允许');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsedUrl, {
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new RemoteBinaryFetchError('面单图片读取失败');
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      throw new RemoteBinaryFetchError('面单图片格式无效');
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new RemoteBinaryFetchError('面单图片体积超限');
    }

    if (!response.body) {
      const fallback = Buffer.from(await response.arrayBuffer());
      if (fallback.length > maxBytes) {
        throw new RemoteBinaryFetchError('面单图片体积超限');
      }
      return { buffer: fallback, contentType };
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        controller.abort();
        throw new RemoteBinaryFetchError('面单图片体积超限');
      }

      chunks.push(Buffer.from(value));
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType,
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new RemoteBinaryFetchError('面单图片读取超时', 504);
    }
    if (error instanceof RemoteBinaryFetchError) {
      throw error;
    }
    throw new RemoteBinaryFetchError('面单图片读取失败');
  } finally {
    clearTimeout(timer);
  }
}
