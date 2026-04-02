import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 从 admin JWT payload 中提取当前管理员信息 */
export const CurrentAdmin = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const admin = request.user;
    return data ? admin?.[data] : admin;
  },
);
