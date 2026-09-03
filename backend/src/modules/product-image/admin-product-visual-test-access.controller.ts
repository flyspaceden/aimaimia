import { Body, Controller, Get, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuditLog } from '../admin/common/decorators/audit-action';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { GrantProductVisualTestAccessDto } from './product-visual-test-access.dto';
import { ProductVisualTestAccessService } from './product-visual-test-access.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/visual-agent/test-authorizations')
export class AdminProductVisualTestAccessController {
  constructor(private readonly access: ProductVisualTestAccessService) {}

  @Get('status')
  @RequirePermission('admin_visual_agent:manage')
  status() {
    return this.access.status();
  }

  @Post()
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent-test-access', isReversible: false })
  grant(@Body() dto: GrantProductVisualTestAccessDto) {
    return this.access.grant({ ...dto, expiresAt: new Date(dto.expiresAt) });
  }
}
