import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
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
}
