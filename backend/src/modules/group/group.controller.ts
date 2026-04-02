import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { GroupService } from './group.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupStatusDto } from './dto/update-group-status.dto';

@Controller('groups')
export class GroupController {
  constructor(private groupService: GroupService) {}

  @Public()
  @Get()
  list() {
    return this.groupService.list();
  }

  @Public()
  @Get('company/:companyId')
  listByCompany(@Param('companyId') companyId: string) {
    return this.groupService.listByCompany(companyId);
  }

  @Public()
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.groupService.getById(id);
  }

  // H2修复：添加 PermissionGuard + RequirePermission
  @Public()
  @UseGuards(AdminAuthGuard, PermissionGuard)
  @RequirePermission('groups:create')
  @Post()
  create(@Body() dto: CreateGroupDto) {
    return this.groupService.create(dto);
  }

  // H1修复：注入 userId，忽略客户端 count，由 service 去重
  @Post(':id/join')
  join(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.groupService.join(id, userId);
  }

  // H2修复：添加 PermissionGuard + RequirePermission
  @Public()
  @UseGuards(AdminAuthGuard, PermissionGuard)
  @RequirePermission('groups:update')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateGroupStatusDto,
  ) {
    return this.groupService.updateStatus(id, dto);
  }
}
