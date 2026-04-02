import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // 公开路由：如果请求带了 JWT，尝试解析（填充 request.user），但不强制
      const request = context.switchToHttp().getRequest();
      const authHeader = request.headers?.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const result = super.canActivate(context);
        // 无论 JWT 是否有效，公开路由都放行
        if (result instanceof Promise || (typeof result === 'object' && isObservable(result))) {
          const promise = isObservable(result) ? firstValueFrom(result) : result;
          return promise.catch(() => true).then(() => true);
        }
      }
      return true;
    }

    return super.canActivate(context);
  }
}
