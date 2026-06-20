export interface UploadDownloadRequest {
  href: string;
  filename: string;
}

const DELIVERY_UPLOAD_KEY_PREFIXES = [
  'delivery/products/',
  'delivery/waybills/',
  'delivery/manifests/',
  'delivery/settlements/',
  'delivery/documents/',
  'delivery/general/',
  'delivery/avatars/',
];

function appendQuery(url: string, params: Record<string, string>): string {
  const sep = url.includes('?') ? '&' : '?';
  const query = new URLSearchParams(params).toString();
  return `${url}${sep}${query}`;
}

function getPathname(fileUrl: string): string {
  try {
    const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    return new URL(fileUrl, baseUrl).pathname;
  } catch {
    return fileUrl.split('?')[0];
  }
}

function extractProtectedDownloadKey(fileUrl: string): string | null {
  try {
    const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(fileUrl, baseUrl);
    if (!url.pathname.includes('/delivery-seller/upload/download')) {
      return null;
    }
    const key = url.searchParams.get('key');
    return key?.startsWith('delivery/') ? key : null;
  } catch {
    return null;
  }
}

function getExtension(keyOrUrl: string): string {
  const clean = keyOrUrl.split('?')[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1]}` : '';
}

function deriveFilename(preferredName: string, keyOrUrl: string): string {
  if (/\.[a-zA-Z0-9]+$/.test(preferredName)) return preferredName;
  return `${preferredName}${getExtension(keyOrUrl) || '.jpg'}`;
}

function extractKeyByPrefix(pathname: string): string | null {
  for (const prefix of DELIVERY_UPLOAD_KEY_PREFIXES) {
    const index = pathname.indexOf(prefix);
    if (index >= 0) return pathname.slice(index);
  }
  return null;
}

function extractUploadKey(fileUrl: string): string | null {
  const pathname = decodeURIComponent(getPathname(fileUrl)).replace(/^\/+/, '');
  const uploadIndex = pathname.indexOf('uploads/');
  if (uploadIndex >= 0) {
    const uploadKey = pathname.slice(uploadIndex + 'uploads/'.length);
    return extractKeyByPrefix(uploadKey);
  }

  return extractKeyByPrefix(pathname);
}

export function buildUploadDownloadRequest(
  fileUrl: string,
  preferredName: string,
  apiBase: string,
): UploadDownloadRequest {
  const protectedKey = extractProtectedDownloadKey(fileUrl);
  if (protectedKey) {
    const filename = deriveFilename(preferredName, protectedKey);
    return {
      href: `${apiBase}/delivery-seller/upload/download?${new URLSearchParams({ key: protectedKey, filename }).toString()}`,
      filename,
    };
  }

  const privateMatch = fileUrl.match(/\/delivery-seller\/upload\/private\/(.+?)(?:\?|$)/);
  if (privateMatch) {
    const key = decodeURIComponent(privateMatch[1]);
    if (!key.startsWith('delivery/')) {
      throw new Error('UNSUPPORTED_UPLOAD_URL');
    }
    const filename = deriveFilename(preferredName, key);
    return {
      href: appendQuery(fileUrl, { download: '1', filename }),
      filename,
    };
  }

  const key = extractUploadKey(fileUrl);
  if (!key) {
    throw new Error('UNSUPPORTED_UPLOAD_URL');
  }

  const filename = deriveFilename(preferredName, key);
  return {
    href: `${apiBase}/delivery-seller/upload/download?${new URLSearchParams({ key, filename }).toString()}`,
    filename,
  };
}

export function triggerBrowserDownload(href: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export async function downloadDeliveryUploadWithAuth(
  fileUrl: string,
  preferredName: string,
  apiBase: string,
): Promise<void> {
  const request = buildUploadDownloadRequest(fileUrl, preferredName, apiBase);
  const client = (await import('../api/client')).default;
  const payload = await client.get(request.href, {
    responseType: 'blob',
  }) as Blob | ArrayBuffer;
  const blob = payload instanceof Blob ? payload : new Blob([payload]);
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerBrowserDownload(objectUrl, request.filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}
