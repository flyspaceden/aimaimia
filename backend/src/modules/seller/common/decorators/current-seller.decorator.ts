import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 从 seller JWT payload 中提取当前卖家信息
 * 返回 { sub, userId, companyId, role, type }
 * 可传入字段名获取单个值，如 @CurrentSeller('companyId')
 */
export const CurrentSeller = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const seller = request.user;
    return data ? seller?.[data] : seller;
  },
);
