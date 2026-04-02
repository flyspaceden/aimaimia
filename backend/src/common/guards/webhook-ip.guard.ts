import { CanActivate, ExecutionContext, Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIPv4, isIPv6 } from 'net';

/**
 * S04修复：支付回调 IP 白名单 Guard
 *
 * 限制支付回调端点只接受来自可信 IP 的请求。
 * 生产环境：必须配置 WEBHOOK_IP_WHITELIST（逗号分隔的 IP/CIDR）
 * 开发环境：未配置时放行所有请求（允许本地测试）
 *
 * L5修复：支持 IPv4 和 IPv6 地址匹配，IPv4-mapped IPv6 归一化
 *
 * 微信支付回调 IP 段参考：https://pay.weixin.qq.com/doc/v3/merchant/4012791880
 * 支付宝回调 IP 段参考：支付宝开放平台文档
 */
@Injectable()
export class WebhookIpGuard implements CanActivate {
  private readonly logger = new Logger(WebhookIpGuard.name);
  private whitelist: string[] = [];

  constructor(private configService: ConfigService) {
    const raw = this.configService.get<string>('WEBHOOK_IP_WHITELIST');
    if (raw) {
      this.whitelist = raw.split(',').map(ip => ip.trim()).filter(Boolean);
      this.logger.log(`Webhook IP 白名单已加载: ${this.whitelist.length} 条规则`);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // 使用 Express 解析后的 req.ip / req.ips（配合 app.set('trust proxy', ...)）
    // 避免直接信任客户端伪造的 X-Forwarded-For 头。
    const clientIp = (Array.isArray(request.ips) && request.ips.length > 0 ? request.ips[0] : undefined)
      || request.ip
      || request.socket?.remoteAddress
      || request.connection?.remoteAddress;

    // 未配置白名单时
    if (this.whitelist.length === 0) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('生产环境未配置 WEBHOOK_IP_WHITELIST，拒绝支付回调');
        throw new ForbiddenException('支付回调服务暂不可用');
      }
      // 开发环境放行
      this.logger.warn(`开发环境跳过 IP 白名单检查（来源 IP: ${clientIp}）`);
      return true;
    }

    // 检查 IP 是否在白名单中
    const normalizedIp = this.normalizeIp(clientIp);
    const allowed = this.whitelist.some(rule => this.matchIp(normalizedIp, rule));

    if (!allowed) {
      this.logger.error(`支付回调 IP 不在白名单中: ${clientIp}`);
      throw new ForbiddenException('请求来源不在允许范围内');
    }

    return true;
  }

  // 标准化 IPv4-mapped IPv6 地址（::ffff:127.0.0.1 → 127.0.0.1）
  private normalizeIp(ip: string): string {
    if (!ip) return '';
    // IPv4-mapped IPv6 归一化
    if (ip.startsWith('::ffff:')) {
      const v4part = ip.slice(7);
      if (isIPv4(v4part)) return v4part;
    }
    return ip;
  }

  // 支持精确匹配和 CIDR 匹配（IPv4 + IPv6）
  private matchIp(ip: string, rule: string): boolean {
    const normalizedRule = this.normalizeIp(rule.includes('/') ? rule.split('/')[0] : rule);
    const ruleForMatch = rule.includes('/') ? `${normalizedRule}/${rule.split('/')[1]}` : normalizedRule;

    if (!ruleForMatch.includes('/')) {
      return ip === ruleForMatch;
    }

    // CIDR 匹配
    const [network, prefixStr] = ruleForMatch.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (isNaN(prefix) || prefix < 0) return false;

    // IPv4 CIDR
    if (isIPv4(ip) && isIPv4(network)) {
      if (prefix > 32) return false;
      const ipBuf = this.ipv4ToBuffer(ip);
      const netBuf = this.ipv4ToBuffer(network);
      if (!ipBuf || !netBuf) return false;
      return this.bufferMatchPrefix(ipBuf, netBuf, prefix);
    }

    // IPv6 CIDR
    if (isIPv6(ip) && isIPv6(network)) {
      if (prefix > 128) return false;
      const ipBuf = this.ipv6ToBuffer(ip);
      const netBuf = this.ipv6ToBuffer(network);
      if (!ipBuf || !netBuf) return false;
      return this.bufferMatchPrefix(ipBuf, netBuf, prefix);
    }

    return false;
  }

  // IPv4 地址转 4 字节 Buffer
  private ipv4ToBuffer(ip: string): Buffer | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    const buf = Buffer.alloc(4);
    for (let i = 0; i < 4; i++) {
      const n = parseInt(parts[i], 10);
      if (isNaN(n) || n < 0 || n > 255) return null;
      buf[i] = n;
    }
    return buf;
  }

  // IPv6 地址转 16 字节 Buffer（支持 :: 缩写展开）
  private ipv6ToBuffer(ip: string): Buffer | null {
    // 展开 :: 缩写
    let groups: string[];
    if (ip.includes('::')) {
      const [left, right] = ip.split('::');
      const leftParts = left ? left.split(':') : [];
      const rightParts = right ? right.split(':') : [];
      const missing = 8 - leftParts.length - rightParts.length;
      if (missing < 0) return null;
      groups = [...leftParts, ...Array(missing).fill('0'), ...rightParts];
    } else {
      groups = ip.split(':');
    }
    if (groups.length !== 8) return null;

    const buf = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
      const val = parseInt(groups[i] || '0', 16);
      if (isNaN(val) || val < 0 || val > 0xFFFF) return null;
      buf[i * 2] = (val >> 8) & 0xFF;
      buf[i * 2 + 1] = val & 0xFF;
    }
    return buf;
  }

  // 比较两个 Buffer 的前 prefix 位是否相同
  private bufferMatchPrefix(a: Buffer, b: Buffer, prefix: number): boolean {
    const fullBytes = Math.floor(prefix / 8);
    for (let i = 0; i < fullBytes; i++) {
      if (a[i] !== b[i]) return false;
    }
    const remainBits = prefix % 8;
    if (remainBits > 0) {
      const mask = 0xFF << (8 - remainBits);
      if ((a[fullBytes] & mask) !== (b[fullBytes] & mask)) return false;
    }
    return true;
  }
}
