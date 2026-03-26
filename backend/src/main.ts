import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ResultWrapperInterceptor } from './common/interceptors/result-wrapper.interceptor';
import { PaginationInterceptor } from './common/interceptors/pagination.interceptor';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

function parseTrustProxy(value: string): boolean | number | string | string[] {
  const normalized = value.trim();
  if (normalized === '' || normalized === '0' || normalized.toLowerCase() === 'false') return false;
  if (normalized === '1' || normalized.toLowerCase() === 'true') return true;

  if (/^\d+$/.test(normalized)) return Number(normalized);
  if (normalized.includes(',')) return normalized.split(',').map((item) => item.trim()).filter(Boolean);
  return normalized;
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProduction = process.env.NODE_ENV === 'production';

  // 请求关联 ID（便于安全审计/问题排查）
  app.use(requestIdMiddleware);

  // 反向代理信任链（影响 req.ip / req.ips / 限流 / Webhook IP 白名单）
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  }

  // 静态文件服务：本地开发默认公开访问；启用私有签名模式时关闭直出
  const uploadLocalPrivate = process.env.UPLOAD_LOCAL_PRIVATE === 'true';
  if (!uploadLocalPrivate) {
    app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  }

  // HTTP 安全头（API 安全基线）
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // 请求体大小限制（防 JSON 深度/体积攻击）
  const bodyLimit = process.env.BODY_LIMIT || '1mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // 全局前缀：/api/v1
  app.setGlobalPrefix('api/v1');

  // CORS：从环境变量读取允许的域名，默认只允许本地开发
  // L05修复：生产环境必须配置 CORS_ORIGINS，否则拒绝启动
  if (isProduction && !process.env.CORS_ORIGINS) {
    throw new Error('生产环境必须配置 CORS_ORIGINS 环境变量');
  }
  app.enableCors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          // 本地开发：允许所有 localhost 端口
          if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
            callback(null, true);
          } else {
            callback(new Error('CORS blocked'));
          }
        },
    credentials: true,
  });

  // 全局管道：DTO 校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // 全局拦截器：分页参数钳位（防止过大 pageSize 导致数据库压力）
  // + 成功响应包装为 { ok: true, data }
  app.useGlobalInterceptors(
    new PaginationInterceptor(),
    new ResultWrapperInterceptor(),
  );

  // 全局异常过滤器：错误响应包装为 { ok: false, error: AppError }
  app.useGlobalFilters(new AppExceptionFilter());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`爱买买后端已启动: http://localhost:${port}/api/v1`);
}

bootstrap();
