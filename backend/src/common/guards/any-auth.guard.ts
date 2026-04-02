import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * 允许买家/卖家/管理员任一 JWT 通过。
 * 用于跨端共用但仍需鉴权的接口（如上传）。
 */
@Injectable()
export class AnyAuthGuard extends AuthGuard(['jwt', 'seller-jwt', 'admin-jwt']) {}
