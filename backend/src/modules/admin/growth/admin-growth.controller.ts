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
import { AdminGrowthService } from './admin-growth.service';
import {
  AdminGrowthAccountQueryDto,
  AdminGrowthAdjustDto,
  AdminGrowthExchangeItemDto,
  AdminGrowthLedgerQueryDto,
  AdminGrowthReplaceLevelsDto,
  AdminGrowthRuleDto,
  AdminGrowthUpdateExchangeItemDto,
  AdminNormalShareBindingQueryDto,
} from './dto/admin-growth.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/growth')
export class AdminGrowthController {
  constructor(private readonly growthService: AdminGrowthService) {}

  @Get('dashboard')
  @RequirePermission('growth:read')
  getDashboard() {
    return this.growthService.getDashboard();
  }

  @Get('rules')
  @RequirePermission('growth:read')
  listRules() {
    return this.growthService.listBehaviorRules();
  }

  @Put('rules/:code')
  @RequirePermission('growth:manage_rules')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'growth',
    targetType: 'GrowthBehaviorRule',
    targetIdParam: 'params.code',
    isReversible: true,
  })
  upsertRule(@Param('code') code: string, @Body() dto: AdminGrowthRuleDto) {
    return this.growthService.upsertBehaviorRule({ ...dto, code });
  }

  @Get('levels')
  @RequirePermission('growth:read')
  listLevels() {
    return this.growthService.listLevels();
  }

  @Put('levels')
  @RequirePermission('growth:manage_rules')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'growth',
    targetType: 'GrowthLevel',
    isReversible: true,
  })
  replaceLevels(@Body() dto: AdminGrowthReplaceLevelsDto) {
    return this.growthService.replaceLevels(dto.levels);
  }

  @Get('exchange-items')
  @RequirePermission('growth:read')
  listExchangeItems() {
    return this.growthService.listExchangeItems();
  }

  @Post('exchange-items')
  @RequirePermission('growth:manage_exchange')
  @AuditLog({
    action: 'CREATE',
    module: 'growth',
    targetType: 'GrowthExchangeItem',
    isReversible: true,
  })
  createExchangeItem(@Body() dto: AdminGrowthExchangeItemDto) {
    return this.growthService.createExchangeItem(dto);
  }

  @Patch('exchange-items/:id')
  @RequirePermission('growth:manage_exchange')
  @AuditLog({
    action: 'UPDATE',
    module: 'growth',
    targetType: 'GrowthExchangeItem',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateExchangeItem(
    @Param('id') id: string,
    @Body() dto: AdminGrowthUpdateExchangeItemDto,
  ) {
    return this.growthService.updateExchangeItem(id, dto);
  }

  @Get('accounts')
  @RequirePermission('growth:read')
  listAccounts(@Query() query: AdminGrowthAccountQueryDto) {
    return this.growthService.listUserAccounts(query);
  }

  @Get('ledgers')
  @RequirePermission('growth:read')
  listLedgers(@Query() query: AdminGrowthLedgerQueryDto) {
    return this.growthService.listLedgers(query);
  }

  @Post('users/:userId/adjust')
  @RequirePermission('growth:adjust')
  @AuditLog({
    action: 'UPDATE',
    module: 'growth',
    targetType: 'User',
    targetIdParam: 'params.userId',
    isReversible: false,
  })
  adjustUser(
    @Param('userId') userId: string,
    @Body() dto: AdminGrowthAdjustDto,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.growthService.adjustUser(userId, dto, adminId);
  }

  @Get('normal-share/bindings')
  @RequirePermission('growth:read')
  listNormalShareBindings(@Query() query: AdminNormalShareBindingQueryDto) {
    return this.growthService.listNormalShareBindings(query);
  }
}
