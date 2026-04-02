/**
 * 认证相关类型（Domain）
 *
 * 用途：
 * - 统一前端登录/注册/鉴权的字段定义
 * - 作为后端接口返回结构的第一版契约
 */
export type LoginMethod = 'phone' | 'email' | 'wechat';
export type LoginMode = 'code' | 'password';

export type AuthSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  userId: string;
  loginMethod: LoginMethod;
};

