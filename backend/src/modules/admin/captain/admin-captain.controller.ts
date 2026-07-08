import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AuditLog } from '../common/decorators/audit-action';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { RequirePermission } from '../common/decorators/require-permission';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import {
  ApproveCaptainApplicationDto,
  RejectCaptainApplicationDto,
} from '../../captain/dto/captain-application.dto';
import {
  CreateCaptainProfileDto,
  GenerateCaptainSettlementsDto,
  ListCaptainApplicationsQueryDto,
  ListCaptainLedgersQueryDto,
  ListCaptainOrdersQueryDto,
  ListCaptainProfilesQueryDto,
  ListCaptainSettlementsQueryDto,
  UpdateCaptainProfileStatusDto,
  UpdateCaptainSettingsDto,
} from './admin-captain.dto';
import { AdminCaptainService } from './admin-captain.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/captain')
export class AdminCaptainController {
  constructor(private readonly captainService: AdminCaptainService) {}

  @Get('applications')
  @RequirePermission('captain:read')
  listApplications(@Query() query: ListCaptainApplicationsQueryDto) {
    return this.captainService.listApplications(query);
  }

  @Get('applications/:id')
  @RequirePermission('captain:read')
  getApplication(@Param('id') id: string) {
    return this.captainService.getApplication(id);
  }

  @Post('applications/:id/approve')
  @RequirePermission('captain:manage')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'captain',
    targetType: 'CaptainApplication',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  approveApplication(
    @Param('id') id: string,
    @Body() dto: ApproveCaptainApplicationDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.captainService.approveApplication(id, adminUserId, dto);
  }

  @Post('applications/:id/reject')
  @RequirePermission('captain:manage')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'captain',
    targetType: 'CaptainApplication',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  rejectApplication(
    @Param('id') id: string,
    @Body() dto: RejectCaptainApplicationDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.captainService.rejectApplication(id, adminUserId, dto);
  }

  @Get('profiles')
  @RequirePermission('captain:read')
  listProfiles(@Query() query: ListCaptainProfilesQueryDto) {
    return this.captainService.listProfiles(query);
  }

  @Post('profiles')
  @RequirePermission('captain:manage')
  @AuditLog({ action: 'CREATE', module: 'captain', targetType: 'CaptainProfile', isReversible: true })
  createProfile(@Body() dto: CreateCaptainProfileDto, @CurrentAdmin('sub') adminUserId: string) {
    return this.captainService.createProfile(dto, adminUserId);
  }

  @Get('profiles/:userId')
  @RequirePermission('captain:read')
  getProfile(@Param('userId') userId: string, @Query('month') month?: string) {
    return this.captainService.getProfile(userId, month);
  }

  @Patch('profiles/:userId/status')
  @RequirePermission('captain:manage')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'captain',
    targetType: 'CaptainProfile',
    targetIdParam: 'params.userId',
    isReversible: true,
  })
  updateStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateCaptainProfileStatusDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.captainService.updateProfileStatus(userId, dto, adminUserId);
  }

  @Get('profiles/:userId/team')
  @RequirePermission('captain:read')
  getTeam(@Param('userId') userId: string) {
    return this.captainService.getTeam(userId);
  }

  @Get('orders')
  @RequirePermission('captain:read')
  listOrders(@Query() query: ListCaptainOrdersQueryDto) {
    return this.captainService.listOrders(query);
  }

  @Get('ledgers')
  @RequirePermission('captain:read')
  listLedgers(@Query() query: ListCaptainLedgersQueryDto) {
    return this.captainService.listLedgers(query);
  }

  @Get('settlements')
  @RequirePermission('captain:read')
  listSettlements(@Query() query: ListCaptainSettlementsQueryDto) {
    return this.captainService.listSettlements(query);
  }

  @Post('settlements/generate')
  @RequirePermission('captain:settlement')
  @AuditLog({
    action: 'CREATE',
    module: 'captain',
    targetType: 'CaptainMonthlySettlement',
    isReversible: true,
  })
  generateSettlements(@Body() dto: GenerateCaptainSettlementsDto) {
    return this.captainService.generateSettlements(dto.month);
  }

  @Post('settlements/:id/approve')
  @RequirePermission('captain:settlement')
  @AuditLog({
    action: 'UPDATE',
    module: 'captain',
    targetType: 'CaptainMonthlySettlement',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  approveSettlement(@Param('id') id: string, @CurrentAdmin('sub') adminUserId: string) {
    return this.captainService.approveSettlement(id, adminUserId);
  }

  @Post('settlements/:id/mark-paid')
  @RequirePermission('captain:settlement')
  @AuditLog({
    action: 'UPDATE',
    module: 'captain',
    targetType: 'CaptainMonthlySettlement',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  markPaid(@Param('id') id: string, @CurrentAdmin('sub') adminUserId: string) {
    return this.captainService.markSettlementPaid(id, adminUserId);
  }

  @Post('settlements/:id/recalculate')
  @RequirePermission('captain:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'captain',
    targetType: 'CaptainMonthlySettlement',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  recalculate(@Param('id') id: string, @CurrentAdmin('sub') adminUserId: string) {
    return this.captainService.recalculateSettlement(id, adminUserId);
  }

  @Get('settings')
  @RequirePermission('captain:settings')
  getSettings() {
    return this.captainService.getSettings();
  }

  @Put('settings')
  @RequirePermission('captain:settings')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'captain', targetType: 'RuleConfig', isReversible: true })
  updateSettings(@Body() dto: UpdateCaptainSettingsDto, @CurrentAdmin('sub') adminUserId: string) {
    return this.captainService.updateSettings(dto.value, adminUserId);
  }
}
