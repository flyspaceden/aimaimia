import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuditLog } from '../admin/common/decorators/audit-action';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { AdminUpdatePickupPointDto } from './dto/pickup-verify.dto';
import { PickupService } from './pickup.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/pickup-points')
export class PickupAdminPointController {
  constructor(private readonly pickupService: PickupService) {}

  @RequirePermission('orders:read')
  @Get()
  list(
    @Query('companyId') companyId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.pickupService.listAdminPoints(
      companyId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
      isActive === undefined ? undefined : isActive === 'true',
    );
  }

  @RequirePermission('orders:ship')
  @AuditLog({
    action: 'UPDATE',
    module: 'pickup',
    targetType: 'PickupPoint',
    targetIdParam: 'params.id',
    isReversible: false,
    reasonBodyField: 'reason',
  })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdatePickupPointDto) {
    return this.pickupService.updateAdminPointStatus(id, dto.isActive, dto.reason);
  }
}

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@Controller('admin/orders')
export class PickupAdminOrderController {
  constructor(private readonly pickupService: PickupService) {}

  @RequirePermission('orders:read')
  @Get(':id/pickup-events')
  events(@Param('id') id: string) {
    return this.pickupService.listAdminEvents(id);
  }
}
