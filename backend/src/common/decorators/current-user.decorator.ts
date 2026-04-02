import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 从 JWT payload 中提取当前用户信息 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
