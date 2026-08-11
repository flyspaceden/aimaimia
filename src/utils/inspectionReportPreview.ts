import { API_BASE_URL } from '../repos/http/config';

/**
 * 只为已验证的企业检测报告构造平台受控预览地址。
 * 不能直接打开 seller 保存的 fileUrl：它可能来自不受平台控制的站点，
 * 也可能带有 Content-Disposition: attachment，从而触发系统下载。
 */
export function getInspectionReportPreviewUrl(
  reportId: string,
  apiBaseUrl: string = API_BASE_URL,
): string | null {
  const normalizedId = reportId.trim();
  const normalizedApiBaseUrl = apiBaseUrl.trim();
  if (
    !normalizedId ||
    !/^https?:\/\/[^/?#\s]+(?:[/?#]|$)/i.test(normalizedApiBaseUrl)
  ) {
    return null;
  }

  try {
    const apiUrl = new URL(normalizedApiBaseUrl);
    if (
      !apiUrl.hostname ||
      (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:')
    ) {
      return null;
    }

    apiUrl.pathname = `${apiUrl.pathname.replace(/\/+$/, '')}/companies/inspection-reports/${encodeURIComponent(normalizedId)}/preview`;
    apiUrl.search = '';
    apiUrl.hash = '';
    return apiUrl.toString();
  } catch {
    return null;
  }
}
