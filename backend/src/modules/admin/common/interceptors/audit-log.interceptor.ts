import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AUDIT_ACTION_KEY, AuditActionMeta } from '../decorators/audit-action';
import { sanitizeForLog } from '../../../../common/logging/log-sanitizer';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.get<AuditActionMeta>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    // 无审计标记则直接放行
    if (!meta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const admin = request.user;
    const targetId = this.extractTargetId(request, meta.targetIdParam);

    // 捕获 before 快照（异步，不阻塞请求处理）
    let beforeSnapshot: any = null;
    const snapshotPromise = targetId && meta.targetType
      ? this.captureSnapshot(meta.targetType, targetId)
      : Promise.resolve(null);

    return new Observable((subscriber) => {
      snapshotPromise.then((before) => {
        beforeSnapshot = before;

        next.handle().pipe(
          tap({
            next: async (responseData) => {
              // 请求成功后异步记录审计日志
              try {
                const afterSnapshot = targetId && meta.targetType
                  ? await this.captureSnapshot(meta.targetType, targetId)
                  : null;

                const diff = this.computeDiff(beforeSnapshot, afterSnapshot);

                // L10修复：从请求头提取 requestId，无则生成 UUID
                const requestId = request.headers?.['x-request-id'] || randomUUID();

                await this.prisma.adminAuditLog.create({
                  data: {
                    adminUserId: admin.sub,
                    action: meta.action,
                    module: meta.module,
                    targetType: meta.targetType,
                    targetId,
                    summary: this.buildSummary(meta, request),
                    before: beforeSnapshot,
                    after: afterSnapshot,
                    diff,
                    ip: request.ip,
                    userAgent: request.headers?.['user-agent'],
                    isReversible: meta.isReversible ?? true,
                    requestId,
                  },
                });
              } catch (err) {
                // 审计日志写入失败不影响业务响应
                this.logger.error(`[AuditLog] 写入失败: ${JSON.stringify(sanitizeForLog(err))}`);
              }
            },
          }),
        ).subscribe(subscriber);
      }).catch((err) => {
        this.logger.error(`[AuditLog] 快照捕获失败: ${JSON.stringify(sanitizeForLog(err))}`);
        next.handle().subscribe(subscriber);
      });
    });
  }

  /** 从请求中提取目标 ID */
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

  /** 捕获实体当前状态快照 */
  private async captureSnapshot(
    targetType: string,
    targetId: string,
  ): Promise<any> {
    const modelMap: Record<string, string> = {
      Product: 'product',
      Order: 'order',
      Company: 'company',
      User: 'user',
      AdminUser: 'adminUser',
      AdminRole: 'adminRole',
      RuleConfig: 'ruleConfig',
      WithdrawRequest: 'withdrawRequest',
      TraceBatch: 'traceBatch',
      LotteryPrize: 'lotteryPrize',
      VipGiftOption: 'vipGiftOption',
    };

    const modelName = modelMap[targetType];
    if (!modelName) return null;

    try {
      const model = (this.prisma as any)[modelName];
      if (!model) return null;

      // RuleConfig 用 key 作为 ID
      let snapshot;
      if (targetType === 'RuleConfig') {
        snapshot = await model.findUnique({ where: { key: targetId } });
      } else {
        snapshot = await model.findUnique({ where: { id: targetId } });
      }

      // L9修复：快照 PII 脱敏，防止敏感数据写入审计日志
      return snapshot ? sanitizeForLog(snapshot) : null;
    } catch {
      return null;
    }
  }

  /** 计算字段级 diff */
  private computeDiff(before: any, after: any): any {
    if (!before || !after) return null;

    const diff: Record<string, { old: any; new: any }> = {};
    const allKeys = new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ]);

    for (const key of allKeys) {
      if (key === 'updatedAt' || key === 'createdAt') continue;
      const oldVal = before[key];
      const newVal = after[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diff[key] = { old: oldVal, new: newVal };
      }
    }

    return Object.keys(diff).length > 0 ? diff : null;
  }

  /** 生成操作摘要 */
  private buildSummary(meta: AuditActionMeta, request: any): string {
    const actionLabels: Record<string, string> = {
      CREATE: '创建',
      UPDATE: '更新',
      DELETE: '删除',
      STATUS_CHANGE: '状态变更',
      APPROVE: '审核通过',
      REJECT: '审核拒绝',
      REFUND: '退款',
      SHIP: '发货',
      CONFIG_CHANGE: '配置变更',
      ROLLBACK: '回滚',
      LOGIN: '登录',
      LOGOUT: '登出',
    };
    const actionLabel = actionLabels[meta.action] || meta.action;
    return `${actionLabel} ${meta.module}${meta.targetType ? ` [${meta.targetType}]` : ''}`;
  }
}
