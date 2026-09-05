import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import theme from '@/theme';
import VisualAgentPage from '../src/pages/visual-agent';
import useAuthStore from '../src/store/useAuthStore';

useAuthStore.setState({
  token: 'admin-test-token',
  refreshToken: null,
  admin: {
    id: 'admin-test',
    username: 'admin-test',
    realName: '测试管理员',
    roles: ['超级管理员'],
    permissions: [],
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp>
        <VisualAgentPage />
      </AntdApp>
    </ConfigProvider>
  </QueryClientProvider>,
);
