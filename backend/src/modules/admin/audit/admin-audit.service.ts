import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import {
  sanitizeForLog,
  sanitizeStringForLog,
} from '../../../common/logging/log-sanitizer';
import { maskIp } from '../../../common/security/privacy-mask';

@Injectable()
export class AdminAuditService {
  constructor(private prisma: PrismaService) {}

  /** 审计日志列表 */
  async findAll(query: AuditQueryDto, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action;
    if (query.adminUserId) where.adminUserId = query.adminUserId;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          adminUser: {
            select: { id: true, username: true, realName: true },
          },
        },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return {
      items: items.map((log) => ({
        id: log.id,
        admin: log.adminUser,
        action: log.action,
        module: log.module,
        targetType: log.targetType,
        targetId: log.targetId,
        summary: log.summary
          ? sanitizeStringForLog(log.summary, { maxStringLength: 500 })
          : log.summary,
        isReversible: log.isReversible,
        rolledBackAt: log.rolledBackAt,
        createdAt: log.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 审计日志详情（含 before/after/diff） */
  async findById(id: string) {
    const log = await this.prisma.adminAuditLog.findUnique({
      where: { id },
      include: {
        adminUser: {
          select: { id: true, username: true, realName: true },
        },
        rolledBackByAdmin: {
          select: { id: true, username: true, realName: true },
        },
      },
    });

    if (!log) throw new NotFoundException('审计日志不存在');
    return this.sanitizeAuditLogForResponse(log);
  }

  /** 查询某个实体的修改历史 */
  async findByTarget(targetType: string, targetId: string) {
    const logs = await this.prisma.adminAuditLog.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: 'desc' },
      include: {
        adminUser: {
          select: { id: true, username: true, realName: true },
        },
      },
    });

    return logs.map((log) => this.sanitizeAuditLogForResponse(log));
  }

  /** 回滚操作 */
  async rollback(logId: string, adminUserId: string, ip?: string) {
    const log = await this.prisma.adminAuditLog.findUnique({
      where: { id: logId },
    });

    if (!log) throw new NotFoundException('审计日志不存在');
    if (!log.isReversible) throw new BadRequestException('该操作不可回滚');
    if (log.rolledBackAt) throw new BadRequestException('该操作已被回滚');
    if (!log.before) throw new BadRequestException('无法回滚：缺少变更前快照');

    const modelMap: Record<string, string> = {
      Product: 'product',
      Order: 'order',
      Company: 'company',
      AdminUser: 'adminUser',
      AdminRole: 'adminRole',
      RuleConfig: 'ruleConfig',
      WithdrawRequest: 'withdrawRequest',
      TraceBatch: 'traceBatch',
      VipGiftOption: 'vipGiftOption',
    };

    if (!log.targetType || !log.targetId) {
      throw new BadRequestException('无法回滚：缺少目标信息');
    }

    const modelName = modelMap[log.targetType];
    if (!modelName) {
      throw new BadRequestException(`无法回滚：不支持的实体类型 ${log.targetType}`);
    }

    // 在事务中执行回滚
    await this.prisma.$transaction(async (tx) => {
      const model = (tx as any)[modelName];
      const beforeData = log.before as any;

      // 移除不可更新的字段
      const { id, createdAt, ...updateData } = beforeData;

      // 恢复数据
      if (log.targetType === 'RuleConfig') {
        await model.update({
          where: { key: log.targetId },
          data: updateData,
        });
      } else {
        await model.update({
          where: { id: log.targetId },
          data: updateData,
        });
      }

      // 标记原日志已回滚
      await tx.adminAuditLog.update({
        where: { id: logId },
        data: {
          rolledBackAt: new Date(),
          rolledBackByAdminId: adminUserId,
        },
      });

      // 创建回滚审计日志
      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'ROLLBACK',
          module: log.module,
          targetType: log.targetType,
          targetId: log.targetId,
          summary: `回滚操作 [${log.id}]`,
          before: log.after ?? undefined,
          after: log.before ?? undefined,
          ip,
          isReversible: false,
          rollbackOfLogId: logId,
        },
      });
    });

    return { ok: true, message: '回滚成功' };
  }

  private sanitizeAuditLogForResponse(log: any) {
    return {
      ...log,
      summary: log.summary
        ? sanitizeStringForLog(log.summary, { maxStringLength: 500 })
        : log.summary,
      before: sanitizeForLog(log.before),
      after: sanitizeForLog(log.after),
      diff: sanitizeForLog(log.diff),
      userAgent: log.userAgent
        ? sanitizeStringForLog(log.userAgent, { maxStringLength: 1000 })
        : log.userAgent,
      ipMasked: maskIp(log.ip),
    };
  }
}
