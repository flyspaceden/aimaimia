import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertActiveUserWriteBarrier } from '../../common/transactions/active-user-write-barrier';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import {
  maskAddressDetail,
  maskName,
  maskPhone,
} from '../../common/security/privacy-mask';
import { parseChineseAddress } from '../../common/utils/parse-region';
import { provinceForRegionCode } from './china-province-code';

@Injectable()
export class AddressService {
  constructor(private prisma: PrismaService) {}

  /**
   * 默认地址是用户级唯一状态。所有可能改变默认项的写入均收口到
   * Serializable 事务，并由数据库 partial unique index 做最终防线。
   */
  private async withDefaultAddressRetry<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await assertActiveUserWriteBarrier(tx, userId);
          return operation(tx);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable) throw error;
        if (attempt === maxAttempts - 1) {
          throw new ConflictException('地址状态已变化，请重试');
        }
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    throw new ConflictException('地址状态已变化，请重试');
  }

  /** 用户地址列表 */
  async list(userId: string) {
    const addresses = await this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });

    return addresses.map((a) => this.formatAddress(a));
  }

  /** 新增地址 */
  async create(userId: string, dto: CreateAddressDto) {
    // 兼容前端字段：receiverName → recipientName, province/city/district → regionText
    const recipientName = dto.recipientName || dto.receiverName || '';
    const rawRegionText = dto.regionText || this.buildRegionText(dto as any) || '';
    if (!recipientName.trim()) {
      throw new BadRequestException('收件人不能为空');
    }
    const { regionCode, regionText } = this.assertStandardRegion(dto.regionCode, rawRegionText);

    const address = await this.withDefaultAddressRetry(userId, async (tx) => {
      // 第一个活跃地址自动成为默认；显式设默认时先在同一事务取消旧值。
      const count = await tx.address.count({ where: { userId, deletedAt: null } });
      const activeDefault = count > 0
        ? await tx.address.findFirst({
          where: { userId, isDefault: true, deletedAt: null },
          select: { id: true },
        })
        : null;
      // 同时修复历史“有地址但无默认项”数据。
      const isDefault = dto.isDefault === true || count === 0 || !activeDefault;
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: {
          userId,
          recipientName,
          phone: dto.phone,
          regionCode,
          regionText,
          detail: dto.detail,
          location: dto.location,
          isDefault,
        },
      });
    });

    return this.formatAddress(address);
  }

  /** 更新地址 */
  async update(userId: string, addressId: string, dto: UpdateAddressDto) {
    // 兼容前端字段
    const recipientName = dto.recipientName || dto.receiverName;
    const requestedRegionText = dto.regionText || this.buildRegionText(dto as any);

    if (recipientName !== undefined && !recipientName.trim()) {
      throw new BadRequestException('收件人不能为空');
    }
    if (requestedRegionText !== undefined && !requestedRegionText.trim()) {
      throw new BadRequestException('地址区域不能为空');
    }

    const updated = await this.withDefaultAddressRetry(userId, async (tx) => {
      const current = await this.ensureOwnership(userId, addressId, tx);
      const normalizedRegion = this.assertStandardRegion(
        dto.regionCode ?? current.regionCode,
        requestedRegionText ?? current.regionText,
      );
      const regionTouched = dto.regionCode !== undefined || requestedRegionText !== undefined;
      if (dto.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, deletedAt: null, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      const updateData = {
        ...(recipientName !== undefined && { recipientName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(regionTouched && { regionCode: normalizedRegion.regionCode }),
        ...(regionTouched && { regionText: normalizedRegion.regionText }),
        ...(dto.detail !== undefined && { detail: dto.detail }),
        ...(dto.location !== undefined && { location: dto.location }),
      };

      // 有其他活跃地址时，取消当前默认必须先更新当前项，
      // 再提升替代项。partial unique index 是立即约束，顺序不可颠倒。
      let requestedDefault = dto.isDefault;
      if (dto.isDefault === false && current.isDefault) {
        const replacement = await tx.address.findFirst({
          where: { userId, deletedAt: null, id: { not: addressId } },
          orderBy: { updatedAt: 'desc' },
        });
        if (replacement) {
          const currentUpdated = await tx.address.update({
            where: { id: addressId, userId, deletedAt: null },
            data: { ...updateData, isDefault: false },
          });
          await tx.address.update({
            where: { id: replacement.id, userId, deletedAt: null },
            data: { isDefault: true },
          });
          return currentUpdated;
        } else {
          requestedDefault = true;
        }
      }

      return tx.address.update({
        where: { id: addressId, userId, deletedAt: null },
        data: {
          ...updateData,
          ...(requestedDefault !== undefined && { isDefault: requestedDefault }),
        },
      });
    });

    return this.formatAddress(updated);
  }

  /** 删除地址 */
  async remove(userId: string, addressId: string) {
    await this.withDefaultAddressRetry(userId, async (tx) => {
      await this.ensureOwnership(userId, addressId, tx);
      await tx.address.update({
        where: { id: addressId, userId, deletedAt: null },
        data: { deletedAt: new Date(), isDefault: false },
      });

      const activeDefault = await tx.address.findFirst({
        where: { userId, isDefault: true, deletedAt: null },
      });
      if (!activeDefault) {
        const nextDefault = await tx.address.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (nextDefault) {
          await tx.address.update({
            where: { id: nextDefault.id, userId, deletedAt: null },
            data: { isDefault: true },
          });
        }
      }
    });

    // 返回 undefined，ResultWrapper 会包装为 { ok: true, data: null }
    return undefined;
  }

  /** 设为默认地址 */
  async setDefault(userId: string, addressId: string) {
    const updated = await this.withDefaultAddressRetry(userId, async (tx) => {
      await this.ensureOwnership(userId, addressId, tx);
      await tx.address.updateMany({
        where: { userId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
      return tx.address.update({
        where: { id: addressId, userId, deletedAt: null },
        data: { isDefault: true },
      });
    });
    return this.formatAddress(updated);
  }

  /** 确认地址归属 */
  private async ensureOwnership(
    userId: string,
    addressId: string,
    client: Pick<Prisma.TransactionClient, 'address'> = this.prisma,
  ) {
    const address = await client.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
    });
    if (!address) throw new NotFoundException('地址不存在');
    return address;
  }

  /** 拆分 regionText 为 province/city/district（兼容分隔符/直接拼接/直辖市/自治区） */
  private parseRegionText(regionText: string): { province: string; city: string; district: string } {
    return parseChineseAddress(regionText);
  }

  /** 合并 province/city/district 为 regionText */
  private buildRegionText(dto: { province?: string; city?: string; district?: string }): string | undefined {
    if (!dto.province && !dto.city && !dto.district) return undefined;
    return [dto.province, dto.city, dto.district].filter(Boolean).join(' ');
  }

  /**
   * New writes must use a six-digit GB/T 2260 code and a province label that
   * resolves to the same province. Historical rows remain readable, but any
   * edit must first repair a legacy/non-standard region through the picker.
   */
  private assertStandardRegion(regionCode: string | null | undefined, regionText: string): {
    regionCode: string;
    regionText: string;
  } {
    const normalizedCode = String(regionCode ?? '').trim();
    const normalizedText = String(regionText ?? '').trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      throw new BadRequestException('请选择标准省/市/区');
    }
    if (!normalizedText) {
      throw new BadRequestException('地址区域不能为空');
    }
    const expectedProvince = provinceForRegionCode(normalizedCode);
    if (!expectedProvince) {
      throw new BadRequestException('行政区划代码所属省份无效');
    }
    const actualProvince = parseChineseAddress(normalizedText).province;
    if (actualProvince !== expectedProvince) {
      throw new BadRequestException('行政区划代码与地址省份不一致');
    }
    return { regionCode: normalizedCode, regionText: normalizedText };
  }

  private formatAddress(a: any) {
    const region = this.parseRegionText(a.regionText || '');
    return {
      id: a.id,
      receiverName: a.recipientName,   // 前端使用 receiverName
      receiverNameMasked: maskName(a.recipientName),
      phone: a.phone,
      phoneMasked: maskPhone(a.phone),
      regionCode: a.regionCode || '',  // 行政区划标准编码（6 位）
      regionText: a.regionText || '',  // "北京市/北京市/东城区"
      province: region.province,       // @deprecated 兼容字段，由 regionText 拆出
      city: region.city,
      district: region.district,
      detail: a.detail,
      detailMasked: maskAddressDetail(a.detail),
      isDefault: a.isDefault,
      createdAt: a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : '',
    };
  }
}
