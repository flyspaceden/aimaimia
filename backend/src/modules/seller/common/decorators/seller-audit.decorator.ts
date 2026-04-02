import { SetMetadata } from '@nestjs/common';

export const SELLER_AUDIT_KEY = 'sellerAuditAction';

export interface SellerAuditMeta {
  /** 操作类型 */
  action: string;
  /** 模块名 */
  module: string;
  /** 目标实体类型（Order, Product, Replacement 等） */
  targetType?: string;
  /** 从请求参数中提取 targetId 的路径，如 'params.id' */
  targetIdParam?: string;
}

/**
 * 卖家端审计日志装饰器
 *
 * 标记需要记录审计日志的卖家端操作。
 * 配合 SellerAuditInterceptor 使用，自动记录操作人、操作内容、IP 等信息。
 */
export const SellerAudit = (meta: SellerAuditMeta) =>
  SetMetadata(SELLER_AUDIT_KEY, meta);
