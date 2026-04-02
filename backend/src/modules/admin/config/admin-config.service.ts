import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { UpdateConfigDto } from './dto/admin-config.dto';
import { validateConfigValue } from './config-validation';
import { createHash } from 'crypto';

@Injectable()
export class AdminConfigService {
  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
  ) {}

  /** 获取所有配置 */
  async findAll() {
    return this.prisma.ruleConfig.findMany();
  }

  /** 获取单个配置 */
  async findByKey(key: string) {
    const config = await this.prisma.ruleConfig.findUnique({ where: { key } });
    if (!config) throw new NotFoundException(`配置项 ${key} 不存在`);
    return config;
  }

  /** 更新配置 */
  async update(key: string, dto: UpdateConfigDto, adminUserId: string) {
    // 提取实际值：前端可能传 { value: xxx, description: xxx } 或直接传值
    const rawValue = dto.value;
    const actualValue =
      rawValue !== null &&
      typeof rawValue === 'object' &&
      !Array.isArray(rawValue) &&
      'value' in rawValue
        ? rawValue.value
        : rawValue;

    // 校验配置值类型和范围
    const validationError = validateConfigValue(key, actualValue);
    if (validationError) {
      throw new BadRequestException(validationError);
    }

    // 校验利润分配比例（VIP/普通用户）更新后总和是否仍为 1.0
    await this.bonusConfig.validateRatioUpdate(key, dto.value);

    // 获取当前值用于快照
    const allConfigs = await this.prisma.ruleConfig.findMany();
    const snapshot: Record<string, any> = {};
    for (const c of allConfigs) {
      snapshot[c.key] = c.value;
    }
    // 更新为新值
    snapshot[key] = dto.value;

    return this.prisma.$transaction(async (tx) => {
      // 更新或创建配置
      await tx.ruleConfig.upsert({
        where: { key },
        update: { value: dto.value },
        create: { key, value: dto.value },
      });

      // 创建版本记录
      const version = createHash('md5')
        .update(JSON.stringify(snapshot) + Date.now())
        .digest('hex')
        .slice(0, 12);

      await tx.ruleVersion.create({
        data: {
          version,
          snapshot,
          createdByAdminId: adminUserId,
          changeNote: dto.changeNote || `更新配置项 ${key}`,
        },
      });

      // P1-7: 清除分润配置缓存
      this.bonusConfig.invalidateCache();

      return { ok: true, version };
    });
  }

  /** 配置版本历史 */
  async findVersions(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.ruleVersion.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          createdByAdmin: {
            select: { id: true, username: true, realName: true },
          },
        },
      }),
      this.prisma.ruleVersion.count(),
    ]);

    return { items, total, page, pageSize };
  }

  /** 查看某个版本的快照 */
  async findVersionById(id: string) {
    const version = await this.prisma.ruleVersion.findUnique({
      where: { id },
      include: {
        createdByAdmin: {
          select: { id: true, username: true, realName: true },
        },
      },
    });
    if (!version) throw new NotFoundException('版本不存在');
    return version;
  }

  /** 回滚到指定版本 */
  async rollbackToVersion(versionId: string, adminUserId: string) {
    const version = await this.prisma.ruleVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('版本不存在');

    const snapshot = version.snapshot as Record<string, any>;

    // 校验回滚快照中的利润分配比例（VIP + 普通用户）总和是否为 1.0
    this.bonusConfig.validateSnapshotRatios(snapshot);

    return this.prisma.$transaction(async (tx) => {
      // 清空当前配置
      await tx.ruleConfig.deleteMany();

      // 恢复快照中的所有配置
      for (const [key, value] of Object.entries(snapshot)) {
        await tx.ruleConfig.create({ data: { key, value } });
      }

      // 创建新版本记录
      const newVersion = createHash('md5')
        .update(JSON.stringify(snapshot) + Date.now())
        .digest('hex')
        .slice(0, 12);

      await tx.ruleVersion.create({
        data: {
          version: newVersion,
          snapshot,
          createdByAdminId: adminUserId,
          changeNote: `回滚到版本 ${version.version}`,
        },
      });

      // P1-7: 清除分润配置缓存
      this.bonusConfig.invalidateCache();

      return { ok: true, version: newVersion };
    });
  }
}
