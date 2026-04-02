import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * 全局限流 Guard
 *
 * - `default` 桶：按 IP 限流
 * - `user` 桶：按登录主体限流（user/staff/admin），未登录时回退到 anon+IP
 *
 * 注意：这里对 Authorization 中的 JWT 仅做「非信任解码」提取 `sub`，只用于限流分桶，
 * 真正鉴权仍以各类 AuthGuard 校验结果为准。
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return (req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown').toString();
  }

  protected generateKey(context: ExecutionContext, trackerString: string, throttlerName: string): string {
    if (throttlerName === 'user') {
      const { req } = this.getRequestResponse(context);
      const subject = this.extractSubject(req);
      return super.generateKey(
        context,
        subject ? `user:${subject}` : `anon:${trackerString}`,
        throttlerName,
      );
    }

    return super.generateKey(context, `ip:${trackerString}`, throttlerName);
  }

  private extractSubject(req: Record<string, any>): string | null {
    const fromGuard = req.user?.sub || req.user?.userId;
    if (fromGuard) return String(fromGuard);

    const authHeader = req.headers?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) return null;

    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length < 2) return null;

    try {
      const payloadPart = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8'));
      const sub = payload?.sub ?? payload?.userId;
      return sub ? String(sub) : null;
    } catch {
      return null;
    }
  }
}
