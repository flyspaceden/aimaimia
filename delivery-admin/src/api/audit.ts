import client from './client';
import type { AuditLog, AuditQueryParams, PaginatedData } from '@/types';

/** 审计日志列表 */
export const getAuditLogs = (params?: AuditQueryParams): Promise<PaginatedData<AuditLog>> =>
  client.get('/admin/audit', { params });

/** 审计日志详情 */
export const getAuditLog = (id: string): Promise<AuditLog> =>
  client.get(`/admin/audit/${id}`);

/** 目标实体的审计记录 */
export const getTargetAuditLogs = (targetType: string, targetId: string): Promise<AuditLog[]> =>
  client.get(`/admin/audit/target/${targetType}/${targetId}`);

/** 回滚操作 */
export const rollbackAuditLog = (id: string): Promise<AuditLog> =>
  client.post(`/admin/audit/${id}/rollback`);
