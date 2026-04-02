import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 统一成功响应包装
 * Controller 返回值 → { ok: true, data: <返回值> }
 * 与前端 Result<T> 契约对齐
 */
@Injectable()
export class ResultWrapperInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => ({ ok: true, data })),
    );
  }
}
