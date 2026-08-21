import '@/polyfills/abort-controller';
import { useEffect, useRef, type PropsWithChildren } from 'react';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { useDidHide, useDidShow } from '@tarojs/taro';
import { MiniappPrivacyAuthorization } from '@/components/privacy-authorization';
import { queryClient } from '@/query/client';
import { useAuthStore } from '@/store/auth';
import './app.scss';

export default function App({ children }: PropsWithChildren) {
  const revision = useAuthStore((state) => state.revision);
  const previousRevision = useRef(revision);

  useDidShow(() => focusManager.setFocused(true));
  useDidHide(() => focusManager.setFocused(false));

  useEffect(() => {
    if (previousRevision.current !== revision) {
      queryClient.clear();
      previousRevision.current = revision;
    }
  }, [revision]);

  useEffect(() => () => focusManager.setFocused(undefined), []);

  return <QueryClientProvider client={queryClient}>
    {children}
    <MiniappPrivacyAuthorization />
  </QueryClientProvider>;
}
