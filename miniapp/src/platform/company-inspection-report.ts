import { API_BASE_URL } from '@/api/config';

/** 只构造本平台受控检测报告预览地址，不使用后端返回的原始存储 URL。 */
export function getCompanyInspectionReportPreviewUrl(reportId: string): string | null {
  const normalizedId = reportId.trim();
  if (!normalizedId) return null;
  try {
    const apiUrl = new URL(API_BASE_URL);
    if (apiUrl.protocol !== 'https:' || !apiUrl.hostname) return null;
    apiUrl.pathname = `${apiUrl.pathname.replace(/\/+$/, '')}/companies/inspection-reports/${encodeURIComponent(normalizedId)}/preview`;
    apiUrl.search = '';
    apiUrl.hash = '';
    return apiUrl.toString();
  } catch {
    return null;
  }
}
