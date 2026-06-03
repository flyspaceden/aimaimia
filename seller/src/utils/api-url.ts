/**
 * 把后端返回的相对 URL（如 /api/v1/seller/orders/.../waybill/print?...）
 * 拼成绝对 URL 供 window.open / iframe src / <img src> 使用。
 *
 * 背景：seller SPA 部署在 test-seller.ai-maimai.com / seller.ai-maimai.com，
 * 与后端 API host（test-api / api）不同。axios 通过 VITE_API_BASE_URL 处理 host，
 * 但 window.open 用相对路径会拼当前页面 host → 跳转到 SPA fallback 页（工作台）。
 */
export function toAbsoluteApiUrl(path: string | undefined | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path; // 已是绝对 URL
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api/v1';
  // apiBase 可能是 "https://test-api.ai-maimai.com/api/v1" 或 "/api/v1"
  // path 已含 /api/v1 前缀，所以提取 host 部分（去掉 /api/vN 后缀）
  const host = apiBase.replace(/\/api\/v\d+$/, '');
  return `${host}${path}`;
}
