import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

export const AUDIT_ACTION_KEY = 'auditAction';

export interface AuditActionMeta {
  action: AuditAction;
  module: string;
  targetType?: string;
  /** 从请求参数中提取 targetId 的路径，如 'params.id' */
  targetIdParam?: string;
  /** 该操作是否可回滚 */
  isReversible?: boolean;
}

/** 标记端点的审计元数据 */
export const AuditLog = (meta: AuditActionMeta) =>
  SetMetadata(AUDIT_ACTION_KEY, meta);
