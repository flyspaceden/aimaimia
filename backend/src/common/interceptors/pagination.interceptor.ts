import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * 全局分页参数拦截器
 * - pageSize: 限制在 [1, 100]，默认 20
 * - page: 最小为 1，默认 1
 * - limit: 限制在 [1, 100]，默认 20（卖家端分析模块使用）
 * 防止客户端传入过大的分页参数导致数据库压力
 */
@Injectable()
export class PaginationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const query = request.query;

    if (query) {
      if (query.pageSize !== undefined) {
        query.pageSize = String(
          Math.min(Math.max(parseInt(query.pageSize) || 20, 1), 100),
        );
      }
      if (query.page !== undefined) {
        query.page = String(Math.max(parseInt(query.page) || 1, 1));
      }
      if (query.limit !== undefined) {
        query.limit = String(
          Math.min(Math.max(parseInt(query.limit) || 20, 1), 100),
        );
      }
    }

    return next.handle();
  }
}
