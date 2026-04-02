import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 买家匿名编号服务
 *
 * 为每个（买家, 企业）组合生成全局唯一的匿名编号，
 * 防止卖家通过昵称/userId 等信息还原买家真实身份。
 *
 * 使用方：
 * - 订单创建流程（支付回调建单时自动生成）
 * - 卖家端 Service（查询时批量投影到 DTO）
 */
@Injectable()
export class BuyerAliasService {
  private readonly logger = new Logger(BuyerAliasService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 获取或创建买家匿名编号
   *
   * 冲突重试策略：
   * - 6 位字母数字（36^6 ≈ 21亿种），最多尝试 3 次
   * - 3 次均冲突则升级为 8 位（极端情况兜底）
   */
  async getOrCreate(userId: string, companyId: string): Promise<string> {
    // 先查询已有别名
    const existing = await this.prisma.buyerAlias.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (existing) return existing.alias;

    // 冲突重试：最多 3 次 6 位，1 次 8 位
    for (let attempt = 0; attempt < 4; attempt++) {
      const length = attempt < 3 ? 6 : 8;
      const alias = '买家#' + this.generateRandomAlphanumeric(length);
      try {
        const record = await this.prisma.buyerAlias.create({
          data: { userId, companyId, alias },
        });
        return record.alias;
      } catch (e: any) {
        if (e.code === 'P2002') {
          // 唯一约束冲突，重试
          this.logger.warn(
            `BuyerAlias 冲突重试 (attempt=${attempt + 1}, length=${length}): userId=${userId}, companyId=${companyId}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new Error(
      `BuyerAlias generation failed after 4 retries: userId=${userId}, companyId=${companyId}`,
    );
  }

  /**
   * 批量查询买家匿名编号
   * 返回 Map<userId, alias>
   */
  async getBatchAliases(
    userIds: string[],
    companyId: string,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const aliases = await this.prisma.buyerAlias.findMany({
      where: { userId: { in: userIds }, companyId },
      select: { userId: true, alias: true },
    });
    return new Map(aliases.map((a) => [a.userId, a.alias]));
  }

  /**
   * 确保一批用户都有别名（批量 getOrCreate）
   * 用于订单创建流程中批量预生成
   */
  async ensureAliases(
    userIds: string[],
    companyId: string,
  ): Promise<Map<string, string>> {
    const existing = await this.getBatchAliases(userIds, companyId);
    const missing = userIds.filter((id) => !existing.has(id));

    for (const userId of missing) {
      const alias = await this.getOrCreate(userId, companyId);
      existing.set(userId, alias);
    }

    return existing;
  }

  private generateRandomAlphanumeric(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from(randomBytes(length), (byte) =>
      chars[byte % chars.length],
    ).join('');
  }
}
