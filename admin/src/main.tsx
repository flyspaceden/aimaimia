import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import theme from '@/theme';
import App from './App';

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
        <App />
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
);
