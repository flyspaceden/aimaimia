import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import theme from '@/theme';
import App from './App';

// 部署后旧版本的 lazy chunk 被服务器删除 → 动态 import 失败。
// 捕获这类错误，自动刷新一次拿到最新 index.html（sessionStorage 防死循环）。
const STALE_CHUNK_KEY = 'admin:staleChunkReloadedAt';
const STALE_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
];

function isStaleChunkError(reason: unknown): boolean {
  const msg = reason instanceof Error ? reason.message : String(reason ?? '');
  return STALE_PATTERNS.some((p) => msg.includes(p));
}

function handleStaleChunk() {
  // 10 分钟内已自动刷新过一次 → 说明刷新也救不了，避免循环
  const last = Number(sessionStorage.getItem(STALE_CHUNK_KEY) || 0);
  if (last && Date.now() - last < 10 * 60 * 1000) {
    alert('加载失败且刷新仍未恢复，请检查网络或联系技术支持');
    return;
  }
  sessionStorage.setItem(STALE_CHUNK_KEY, String(Date.now()));
  window.location.reload();
}

window.addEventListener('error', (e) => {
  if (isStaleChunkError(e.error ?? e.message)) {
    e.preventDefault();
    handleStaleChunk();
  }
});

window.addEventListener('unhandledrejection', (e) => {
  if (isStaleChunkError(e.reason)) {
    e.preventDefault();
    handleStaleChunk();
  }
});

// 全局样式重置
const globalStyle = document.createElement('style');
globalStyle.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif; }
  #root { min-height: 100vh; }
  /* 展开行丝滑动画 */
  @keyframes expandRowIn {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ant-table-expanded-row > td { animation: expandRowIn 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94); }
  .ant-table-expanded-row .ant-table { animation: expandRowIn 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94); }
`;
document.head.appendChild(globalStyle);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000, // 30 秒缓存
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN} theme={theme}>
        <AntdApp>
          <App />
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
);
