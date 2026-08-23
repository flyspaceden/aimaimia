import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Production must explicitly opt out of authentication mocks. A missing value is
 * treated as unsafe so a deployment cannot silently inherit a development code.
 */
export function resolveAuthenticationMockMode(
  config: ConfigService,
  key: string,
  serviceName: string,
  nonProductionDefault: boolean,
): boolean {
  const raw = config.get<string>(key);
  const production = config.get<string>('NODE_ENV', 'development') === 'production';
  if (production && raw !== 'false') {
    throw new ServiceUnavailableException(`${serviceName}配置不可用`);
  }
  if (raw == null || raw === '') return nonProductionDefault;
  return raw === 'true';
}
