import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

export function safeFundReturn(value: string | null | undefined, fallback = '/fund-ledgers') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const parsed = new URL(value, 'https://fund.local');
    return parsed.origin === 'https://fund.local' && (parsed.pathname === '/fund-ledgers' || parsed.pathname.startsWith('/fund-ledgers/'))
      ? parsed.pathname + parsed.search : fallback;
  } catch { return fallback; }
}
export function fundLink(path: string, returnTo: string) {
  const url = new URL(path, 'https://fund.local');
  url.searchParams.set('returnTo', safeFundReturn(returnTo));
  return url.pathname + url.search;
}
export function useFundSearch() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const current = location.pathname + location.search;
  const update = (patch: Record<string, string | number | undefined>, resetPage = true) => {
    // BrowserRouter updates history before React commits its next render. Its
    // functional setter still captures the old render's params, so compose rapid
    // actions against the current address instead of restoring a removed filter.
    const next = new URLSearchParams(window.location.search);
    if (resetPage) next.delete('page');
    if (Object.prototype.hasOwnProperty.call(patch, 'q')) next.delete('search');
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key); else next.set(key, String(value));
    }
    setParams(next);
  };
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1;
  const pageSize = [20, 50, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20;
  return { params, update, current, page, pageSize, reset: () => setParams({}) };
}
/** 仅保存页面滚动位置，不保存账号/凭证或任何表单输入。 */
export function useFundScroll(key: string) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => { try { window.scrollTo({ top: Number(sessionStorage.getItem('fund-scroll:' + key) || 0) }); } catch { /* 存储不可用时仍可正常查账。 */ } });
    const save = () => { try { sessionStorage.setItem('fund-scroll:' + key, String(window.scrollY)); } catch { /* 不影响操作。 */ } };
    window.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', save); };
  }, [key]);
}
