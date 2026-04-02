import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SELLER_AUDIT_KEY, SellerAuditMeta } from '../decorators/seller-audit.decorator';
import { maskIp } from '../../../../common/security/privacy-mask';

/**
 * 卖家端审计日志拦截器
 *
 * 自动记录标记了 @SellerAudit() 的端点操作到 SellerAuditLog 表。
 * 审计日志写入失败不影响业务响应。
 */
@Injectable()
export class SellerAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SellerAuditInterceptor.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.get<SellerAuditMeta>(
      SELLER_AUDIT_KEY,
      context.getHandler(),
    );

    // 无审计标记则直接放行
    if (!meta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const seller = request.user;
    const targetId = this.extractTargetId(request, meta.targetIdParam);

    return next.handle().pipe(
      tap({
        next: async () => {
          try {
            await this.prisma.sellerAuditLog.create({
              data: {
                staffId: seller?.staffId || seller?.sub || 'unknown',
                companyId: seller?.companyId || 'unknown',
                action: meta.action,
                module: meta.module,
                targetType: meta.targetType,
                targetId,
                ip: maskIp(request.ip),
                userAgent: request.headers?.['user-agent'],
              },
            });
          } catch (err) {
            // 审计日志写入失败不影响业务响应
            this.logger.error(`[SellerAudit] 写入失败: ${(err as Error)?.message}`);
          }
        },
      }),
    );
  }

  private extractTargetId(
    request: any,
    targetIdParam?: string,
  ): string | undefined {
    if (!targetIdParam) return undefined;
    const parts = targetIdParam.split('.');
    let value = request;
    for (const part of parts) {
      value = value?.[part];
    }
    return value as string | undefined;
  }
}
