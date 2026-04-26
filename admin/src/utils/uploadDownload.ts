export interface UploadDownloadRequest {
  href: string;
  filename: string;
}

const UPLOAD_KEY_PREFIXES = ['products/', 'documents/', 'general/', 'avatars/'];

function appendQuery(url: string, params: Record<string, string>): string {
  const sep = url.includes('?') ? '&' : '?';
  const query = new URLSearchParams(params).toString();
  return `${url}${sep}${query}`;
}

function getPathname(fileUrl: string): string {
  try {
    return new URL(fileUrl, window.location.origin).pathname;
  } catch {
    return fileUrl.split('?')[0];
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

function extractUploadKey(fileUrl: string): string | null {
  const pathname = decodeURIComponent(getPathname(fileUrl)).replace(/^\/+/, '');
  const uploadIndex = pathname.indexOf('uploads/');
  if (uploadIndex >= 0) return pathname.slice(uploadIndex + 'uploads/'.length);

  for (const prefix of UPLOAD_KEY_PREFIXES) {
    const index = pathname.indexOf(prefix);
    if (index >= 0) return pathname.slice(index);
  }

  return null;
}

export function buildUploadDownloadRequest(
  fileUrl: string,
  preferredName: string,
  apiBase: string,
): UploadDownloadRequest {
  const privateMatch = fileUrl.match(/\/upload\/private\/(.+?)(?:\?|$)/);
  if (privateMatch) {
    const key = decodeURIComponent(privateMatch[1]);
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
    href: `${apiBase}/upload/download?${new URLSearchParams({ key, filename }).toString()}`,
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
