import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { UpdateConfigDto, BatchUpdateConfigDto } from './dto/admin-config.dto';
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

  /**
   * 批量更新配置（原子事务 + 最终态一次性校验）
   *
   * 为什么要这个接口：单项 update 会触发 validateRatioUpdate，用"DB 旧值 + 单项新值"
   * 校验总和。当用户同时调整多个比例（如 VIP 平台 50→49 + 奖励 30→31），串行调用
   * 就会在第一项提交时因其他项仍是旧值导致总和 ≠ 1.0 被拦截。批量接口把所有
   * updates 先合并成目标快照，再校验比例总和，最后在单个事务里 upsert 全部项。
   */
  async batchUpdate(dto: BatchUpdateConfigDto, adminUserId: string) {
    const { updates, changeNote } = dto;

    // 1. 逐项校验值类型和范围（不涉及跨项约束）
    for (const u of updates) {
      const rawValue = u.value;
      const actualValue =
        rawValue !== null &&
        typeof rawValue === 'object' &&
        !Array.isArray(rawValue) &&
        'value' in rawValue
          ? rawValue.value
          : rawValue;
      const err = validateConfigValue(u.key, actualValue);
      if (err) {
        throw new BadRequestException(`[${u.key}] ${err}`);
      }
    }

    // 2. 构建目标快照：以当前 DB 为基线，全部 updates 叠加
    const allConfigs = await this.prisma.ruleConfig.findMany();
    const snapshot: Record<string, any> = {};
    for (const c of allConfigs) {
      snapshot[c.key] = c.value;
    }
    for (const u of updates) {
      snapshot[u.key] = u.value;
    }

    // 3. 对目标快照做跨项约束校验（VIP + 普通用户六分比例总和 = 1.0）
    this.bonusConfig.validateSnapshotRatios(snapshot);

    // 4. 事务内批量 upsert + 版本快照
    return this.prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.ruleConfig.upsert({
          where: { key: u.key },
          update: { value: u.value },
          create: { key: u.key, value: u.value },
        });
      }

      const version = createHash('md5')
        .update(JSON.stringify(snapshot) + Date.now())
        .digest('hex')
        .slice(0, 12);

      await tx.ruleVersion.create({
        data: {
          version,
          snapshot,
          createdByAdminId: adminUserId,
          changeNote:
            changeNote ||
            `批量更新 ${updates.length} 个配置项：${updates.map((u) => u.key).join(', ')}`,
        },
      });

      this.bonusConfig.invalidateCache();

      return { ok: true, version, updated: updates.length };
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
