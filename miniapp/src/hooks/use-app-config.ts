import { useQuery } from '@tanstack/react-query';
import { AppConfigRepo, DEFAULT_PUBLIC_APP_CONFIG, type PublicAppConfig } from '@/repos/app-config';

export function useAppConfig(): PublicAppConfig {
  const query = useQuery({
    queryKey: ['app-config'],
    queryFn: AppConfigRepo.getPublicConfig,
    staleTime: 60 * 60_000,
  });
  return query.data?.ok ? query.data.data : DEFAULT_PUBLIC_APP_CONFIG;
}
