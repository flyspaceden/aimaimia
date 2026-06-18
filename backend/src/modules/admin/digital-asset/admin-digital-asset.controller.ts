import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { AuditLog } from '../common/decorators/audit-action';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AdminDigitalAssetService } from './admin-digital-asset.service';
import {
  AdminDigitalAssetAccountQueryDto,
  AdminDigitalAssetLedgerQueryDto,
} from './dto/admin-digital-asset.dto';
import { AdminAdjustDigitalAssetDto } from '../../digital-asset/dto/admin-adjust-digital-asset.dto';
import { UpdateDigitalAssetSettingsDto } from '../../digital-asset/dto/update-digital-asset-settings.dto';
import { UpdateDigitalAssetRulesDto } from '../../digital-asset/dto/update-digital-asset-rules.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/digital-assets')
export class AdminDigitalAssetController {
  constructor(private readonly digitalAssetService: AdminDigitalAssetService) {}

  @Get('overview')
  @RequirePermission('digital_assets:read')
  getOverview() {
    return this.digitalAssetService.getOverview();
  }

  @Get('accounts')
  @RequirePermission('digital_assets:read')
  findAccounts(@Query() query: AdminDigitalAssetAccountQueryDto) {
    return this.digitalAssetService.findAccounts(query);
  }

  @Get('export')
  @RequirePermission('digital_assets:export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="digital-assets.csv"')
  @AuditLog({
    action: 'EXPORT',
    module: 'digital_assets',
    targetType: 'DigitalAssetAccount',
    isReversible: false,
  })
  exportAccounts(@Query() query: AdminDigitalAssetAccountQueryDto) {
    return this.digitalAssetService.exportAccounts(query);
  }

  @Get('settings')
  @RequirePermission('digital_assets:settings')
  getSettings() {
    return this.digitalAssetService.getSettings();
  }

  @Get('rules')
  @RequirePermission('digital_assets:read')
  getRules() {
    return this.digitalAssetService.getRules();
  }

  @Put('settings')
  @RequirePermission('digital_assets:settings')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'digital_assets',
    targetType: 'RuleConfig',
    targetIdParam: 'body.key',
    isReversible: true,
  })
  updateSettings(@Body() dto: UpdateDigitalAssetSettingsDto) {
    return this.digitalAssetService.updateSettings(dto);
  }

  @Put('rules')
  @RequirePermission('digital_assets:settings')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'digital_assets',
    targetType: 'RuleConfig',
    isReversible: true,
  })
  updateRules(@Body() dto: UpdateDigitalAssetRulesDto) {
    return this.digitalAssetService.updateRules(dto);
  }

  @Get('users/:userId')
  @RequirePermission('digital_assets:read')
  getAccount(@Param('userId') userId: string) {
    return this.digitalAssetService.getAccount(userId);
  }

  @Get('users/:userId/ledgers')
  @RequirePermission('digital_assets:read')
  listLedgers(
    @Param('userId') userId: string,
    @Query() query: AdminDigitalAssetLedgerQueryDto,
  ) {
    return this.digitalAssetService.listLedgers(userId, query);
  }

  @Post('users/:userId/adjust')
  @RequirePermission('digital_assets:adjust')
  @AuditLog({
    action: 'UPDATE',
    module: 'digital_assets',
    targetType: 'User',
    targetIdParam: 'params.userId',
    isReversible: false,
  })
  adjustAccount(
    @Param('userId') userId: string,
    @Body() dto: AdminAdjustDigitalAssetDto,
    @CurrentAdmin() admin: any,
  ) {
    return this.digitalAssetService.adjustAccount(userId, dto, admin);
  }
}
