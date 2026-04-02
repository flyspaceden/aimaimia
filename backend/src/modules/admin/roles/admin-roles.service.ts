import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class AdminRolesService {
  constructor(private prisma: PrismaService) {}

  /** 角色列表 */
  async findAll() {
    const roles = await this.prisma.adminRole.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        module: rp.permission.module,
        action: rp.permission.action,
        description: rp.permission.description,
      })),
      userCount: role._count.userRoles,
      createdAt: role.createdAt,
    }));
  }

  /** 所有权限列表 */
  async findAllPermissions() {
    return this.prisma.adminPermission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }

  /** 创建角色 */
  async create(dto: CreateRoleDto) {
    const existing = await this.prisma.adminRole.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new BadRequestException('角色名已存在');

    const role = await this.prisma.adminRole.create({
      data: {
        name: dto.name,
        description: dto.description,
        rolePermissions: dto.permissionIds?.length
          ? {
              create: dto.permissionIds.map((permissionId) => ({
                permissionId,
              })),
            }
          : undefined,
      },
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
      })),
    };
  }

  /** 更新角色 */
  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.adminRole.findUnique({
      where: { id },
    });
    if (!role) throw new NotFoundException('角色不存在');

    // 系统角色仅可修改权限，不可修改名称
    if (role.isSystem && dto.name && dto.name !== role.name) {
      throw new ForbiddenException('系统角色不可修改名称');
    }

    await this.prisma.adminRole.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
      },
    });

    // 更新权限关联
    if (dto.permissionIds !== undefined) {
      await this.prisma.adminRolePermission.deleteMany({
        where: { roleId: id },
      });
      if (dto.permissionIds.length > 0) {
        await this.prisma.adminRolePermission.createMany({
          data: dto.permissionIds.map((permissionId) => ({
            roleId: id,
            permissionId,
          })),
        });
      }
    }

    return this.findById(id);
  }

  /** 删除角色 */
  async remove(id: string) {
    const role = await this.prisma.adminRole.findUnique({
      where: { id },
    });
    if (!role) throw new NotFoundException('角色不存在');
    if (role.isSystem) throw new ForbiddenException('系统角色不可删除');

    await this.prisma.adminRole.delete({ where: { id } });
    return { ok: true };
  }

  /** 查询单个角色 */
  async findById(id: string) {
    const role = await this.prisma.adminRole.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
    });
    if (!role) throw new NotFoundException('角色不存在');

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        module: rp.permission.module,
        action: rp.permission.action,
        description: rp.permission.description,
      })),
      userCount: role._count.userRoles,
      createdAt: role.createdAt,
    };
  }
}
