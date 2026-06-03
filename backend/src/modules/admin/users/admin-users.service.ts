import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto, ResetPasswordDto } from './dto/update-admin-user.dto';
import { SUPER_ADMIN_ROLE } from '../common/constants';
import { maskIp } from '../../../common/security/privacy-mask';

@Injectable()
export class AdminUsersService {
  constructor(private prisma: PrismaService) {}

  // ---- 内部辅助方法 ----

  /**
   * 判断指定管理员是否拥有超级管理员角色
   * 通过查询 AdminUserRole → AdminRole 的 name 字段来判断
   */
  private async isSuperAdmin(adminUserId: string): Promise<boolean> {
    const count = await this.prisma.adminUserRole.count({
      where: {
        adminUserId,
        role: { name: SUPER_ADMIN_ROLE },
      },
    });
    return count > 0;
  }

  /**
   * 判断给定的 roleIds 中是否包含超级管理员角色
   */
  private async containsSuperAdminRole(roleIds: string[]): Promise<boolean> {
    if (!roleIds || roleIds.length === 0) return false;
    const count = await this.prisma.adminRole.count({
      where: {
        id: { in: roleIds },
        name: SUPER_ADMIN_ROLE,
      },
    });
    return count > 0;
  }

  /** 管理员列表 */
  async findAll(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.adminUser.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          userRoles: { include: { role: true } },
        },
      }),
      this.prisma.adminUser.count(),
    ]);

    // M1修复：只返回脱敏 IP，不返回原始 lastLoginIp
    return {
      items: items.map((admin) => ({
        id: admin.id,
        username: admin.username,
        realName: admin.realName,
        phone: admin.phone,
        status: admin.status,
        roles: admin.userRoles.map((ur) => ({
          id: ur.role.id,
          name: ur.role.name,
        })),
        lastLoginAt: admin.lastLoginAt,
        lastLoginIpMasked: maskIp(admin.lastLoginIp),
        createdAt: admin.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 创建管理员 */
  async create(dto: CreateAdminUserDto, createdByAdminId: string) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new BadRequestException('用户名已存在');
    }

    // H08: 非超级管理员不能为新用户分配超级管理员角色
    if (dto.roleIds?.length) {
      const hasSuperRole = await this.containsSuperAdminRole(dto.roleIds);
      if (hasSuperRole) {
        const operatorIsSuperAdmin = await this.isSuperAdmin(createdByAdminId);
        if (!operatorIsSuperAdmin) {
          throw new ForbiddenException('只有超级管理员才能分配超级管理员角色');
        }
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    let admin;
    try {
      admin = await this.prisma.adminUser.create({
        data: {
          username: dto.username,
          passwordHash,
          realName: dto.realName,
          phone: dto.phone,
          createdByAdminId,
          userRoles: dto.roleIds?.length
            ? {
                create: dto.roleIds.map((roleId) => ({ roleId })),
              }
            : undefined,
        },
        include: {
          userRoles: { include: { role: true } },
        },
      });
    } catch (err) {
      // P2002: 唯一约束冲突（phone 是 @unique）
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined) ?? [];
        if (target.includes('phone')) {
          throw new BadRequestException('手机号已被占用');
        }
        if (target.includes('username')) {
          throw new BadRequestException('用户名已存在');
        }
      }
      throw err;
    }

    return {
      id: admin.id,
      username: admin.username,
      realName: admin.realName,
      phone: admin.phone,
      status: admin.status,
      roles: admin.userRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
      })),
    };
  }

  /** 更新管理员 */
  async update(id: string, dto: UpdateAdminUserDto, operatorId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id },
    });
    if (!admin) throw new NotFoundException('管理员不存在');

    const operatorIsSuperAdmin = await this.isSuperAdmin(operatorId);
    const targetIsSuperAdmin = await this.isSuperAdmin(id);

    // H08: 目标用户是超级管理员时，只有超级管理员才能修改
    if (targetIsSuperAdmin && !operatorIsSuperAdmin) {
      throw new ForbiddenException('只有超级管理员才能修改超级管理员账号');
    }

    // H08: 非超级管理员不能分配或移除超级管理员角色
    if (dto.roleIds !== undefined) {
      const newRolesContainSuper = await this.containsSuperAdminRole(dto.roleIds);
      if (newRolesContainSuper && !operatorIsSuperAdmin) {
        throw new ForbiddenException('只有超级管理员才能分配超级管理员角色');
      }
      // 如果目标原本是超级管理员，但新角色列表中不含超级管理员（即降级），也需要超管权限
      if (targetIsSuperAdmin && !newRolesContainSuper && !operatorIsSuperAdmin) {
        throw new ForbiddenException('只有超级管理员才能移除超级管理员角色');
      }
    }

    // 更新基本信息
    try {
      await this.prisma.adminUser.update({
        where: { id },
        data: {
          realName: dto.realName,
          phone: dto.phone,
          status: dto.status,
        },
      });
    } catch (err) {
      // P2002: 唯一约束冲突（phone 是 @unique）
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined) ?? [];
        if (target.includes('phone')) {
          throw new BadRequestException('手机号已被占用');
        }
      }
      throw err;
    }

    // 更新角色关联
    if (dto.roleIds !== undefined) {
      await this.prisma.adminUserRole.deleteMany({
        where: { adminUserId: id },
      });
      if (dto.roleIds.length > 0) {
        await this.prisma.adminUserRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            adminUserId: id,
            roleId,
          })),
        });
      }
    }

    return this.findById(id);
  }

  /** 重置密码 */
  async resetPassword(id: string, dto: ResetPasswordDto, operatorId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id },
    });
    if (!admin) throw new NotFoundException('管理员不存在');

    // H09: 只有超级管理员才能重置其他管理员的密码
    const operatorIsSuperAdmin = await this.isSuperAdmin(operatorId);
    if (!operatorIsSuperAdmin) {
      throw new ForbiddenException('只有超级管理员才能重置管理员密码');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.adminUser.update({
      where: { id },
      data: { passwordHash },
    });

    // H09: 密码重置后，使目标用户的所有活跃 Session 失效（强制重新登录）
    await this.prisma.adminSession.updateMany({
      where: {
        adminUserId: id,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },
    });

    return { ok: true };
  }

  /** 删除管理员 */
  async remove(id: string, operatorId: string) {
    // C50 修复：禁止删除自己（即使是超管也不能删除自己，防止系统陷入无超管状态）
    if (id === operatorId) {
      throw new ForbiddenException('不能删除自己的账号');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id },
    });
    if (!admin) throw new NotFoundException('管理员不存在');

    // H08: 只有超级管理员才能删除超级管理员账号
    const targetIsSuperAdmin = await this.isSuperAdmin(id);
    if (targetIsSuperAdmin) {
      const operatorIsSuperAdmin = await this.isSuperAdmin(operatorId);
      if (!operatorIsSuperAdmin) {
        throw new ForbiddenException('只有超级管理员才能删除超级管理员账号');
      }
    }

    await this.prisma.adminUser.delete({ where: { id } });
    return { ok: true };
  }

  /** 查询单个管理员 */
  async findById(id: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id },
      include: {
        userRoles: { include: { role: true } },
      },
    });
    if (!admin) throw new NotFoundException('管理员不存在');

    // M1修复：只返回脱敏 IP，不返回原始 lastLoginIp
    return {
      id: admin.id,
      username: admin.username,
      realName: admin.realName,
      phone: admin.phone,
      status: admin.status,
      roles: admin.userRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
      })),
      lastLoginAt: admin.lastLoginAt,
      lastLoginIpMasked: maskIp(admin.lastLoginIp),
      createdAt: admin.createdAt,
    };
  }
}
