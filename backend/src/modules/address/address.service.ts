import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import {
  maskAddressDetail,
  maskName,
  maskPhone,
} from '../../common/security/privacy-mask';
import { parseChineseAddress } from '../../common/utils/parse-region';

@Injectable()
export class AddressService {
  constructor(private prisma: PrismaService) {}

  /** 用户地址列表 */
  async list(userId: string) {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });

    return addresses.map((a) => this.formatAddress(a));
  }

  /** 新增地址 */
  async create(userId: string, dto: CreateAddressDto) {
    // 兼容前端字段：receiverName → recipientName, province/city/district → regionText
    const recipientName = dto.recipientName || dto.receiverName || '';
    const regionText = dto.regionText || this.buildRegionText(dto as any) || '';
    const regionCode = dto.regionCode || '';
    if (!recipientName.trim()) {
      throw new BadRequestException('收件人不能为空');
    }
    if (!regionText.trim()) {
      throw new BadRequestException('地址区域不能为空');
    }

    // 如果设为默认，先取消其他默认
    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    // 如果是第一个地址，自动设为默认
    const count = await this.prisma.address.count({ where: { userId } });
    const isDefault = dto.isDefault || count === 0;

    const address = await this.prisma.address.create({
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

    return this.formatAddress(address);
  }

  /** 更新地址 */
  async update(userId: string, addressId: string, dto: UpdateAddressDto) {
    await this.ensureOwnership(userId, addressId);

    // 兼容前端字段
    const recipientName = dto.recipientName || dto.receiverName;
    const regionText = dto.regionText || this.buildRegionText(dto as any);

    if (recipientName !== undefined && !recipientName.trim()) {
      throw new BadRequestException('收件人不能为空');
    }
    if (regionText !== undefined && !regionText.trim()) {
      throw new BadRequestException('地址区域不能为空');
    }

    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, isDefault: true, id: { not: addressId } },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.address.update({
      where: { id: addressId },
      data: {
        ...(recipientName !== undefined && { recipientName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.regionCode !== undefined && { regionCode: dto.regionCode }),
        ...(regionText !== undefined && { regionText }),
        ...(dto.detail !== undefined && { detail: dto.detail }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      },
    });

    return this.formatAddress(updated);
  }

  /** 删除地址 */
  async remove(userId: string, addressId: string) {
    await this.ensureOwnership(userId, addressId);

    await this.prisma.address.delete({ where: { id: addressId } });

    // 如果删除的是默认地址，把最新的一条设为默认
    const remaining = await this.prisma.address.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    if (remaining && !(await this.prisma.address.findFirst({ where: { userId, isDefault: true } }))) {
      await this.prisma.address.update({
        where: { id: remaining.id },
        data: { isDefault: true },
      });
    }

    // 返回 undefined，ResultWrapper 会包装为 { ok: true, data: null }
    return undefined;
  }

  /** 设为默认地址 */
  async setDefault(userId: string, addressId: string) {
    await this.ensureOwnership(userId, addressId);

    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      }),
    ]);

    // 返回更新后的地址
    const updated = await this.prisma.address.findUnique({ where: { id: addressId } });
    return this.formatAddress(updated);
  }

  /** 确认地址归属 */
  private async ensureOwnership(userId: string, addressId: string) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address) throw new NotFoundException('地址不存在');
    if (address.userId !== userId) throw new ForbiddenException('无权操作此地址');
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

  private formatAddress(a: any) {
    const region = this.parseRegionText(a.regionText || '');
    return {
      id: a.id,
      receiverName: a.recipientName,   // 前端使用 receiverName
      receiverNameMasked: maskName(a.recipientName),
      phone: a.phone,
      phoneMasked: maskPhone(a.phone),
      province: region.province,
      city: region.city,
      district: region.district,
      detail: a.detail,
      detailMasked: maskAddressDetail(a.detail),
      isDefault: a.isDefault,
      createdAt: a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : '',
    };
  }
}
