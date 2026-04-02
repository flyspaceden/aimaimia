import { QueryClient } from '@tanstack/react-query';

// 导出 queryClient 实例，供 main.tsx 和其他需要直接操作缓存的地方使用
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,             // 30 秒（与管理端对齐）
      refetchOnWindowFocus: false,   // Web 管理面板不需要
    },
  },
});
