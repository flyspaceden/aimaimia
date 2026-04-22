import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateVipPackageDto, UpdateVipPackageDto } from './vip-package.dto';

@Injectable()
export class VipPackageService {
  constructor(private prisma: PrismaService) {}

  /** 查询所有 VIP 档位，按价格升序（sortOrder 仅作同价打平） */
  async findAll() {
    return this.prisma.vipPackage.findMany({
      orderBy: [{ price: 'asc' }, { sortOrder: 'asc' }],
      include: {
        _count: { select: { giftOptions: true } },
      },
    });
  }

  /** 创建 VIP 档位 */
  async create(dto: CreateVipPackageDto) {
    return this.prisma.vipPackage.create({
      data: {
        price: dto.price,
        referralBonusRate: dto.referralBonusRate ?? 0.15,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? 'ACTIVE',
      },
    });
  }

  /** 更新 VIP 档位 */
  async update(id: string, dto: UpdateVipPackageDto) {
    await this.ensureExists(id);
    return this.prisma.vipPackage.update({
      where: { id },
      data: dto,
    });
  }

  /** 删除 VIP 档位（有赠品方案时禁止删除） */
  async remove(id: string) {
    const pkg = await this.prisma.vipPackage.findUnique({
      where: { id },
      include: { _count: { select: { giftOptions: true } } },
    });
    if (!pkg) throw new BadRequestException('档位不存在');
    if (pkg._count.giftOptions > 0) {
      throw new BadRequestException(
        `该档位下还有 ${pkg._count.giftOptions} 个赠品方案，请先移除或转移`,
      );
    }
    return this.prisma.vipPackage.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const pkg = await this.prisma.vipPackage.findUnique({ where: { id } });
    if (!pkg) throw new BadRequestException('档位不存在');
    return pkg;
  }
}
