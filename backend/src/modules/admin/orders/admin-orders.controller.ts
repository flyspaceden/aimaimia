import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';
import { AdminShipDto, AdminOrderQueryDto, CancelOrderDto } from './dto/admin-order.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private ordersService: AdminOrdersService) {}

  @Get()
  @RequirePermission('orders:read')
  findAll(
    @Query() query: AdminOrderQueryDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.ordersService.findAll(
      query,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get('stats')
  @RequirePermission('orders:read')
  getStats() {
    return this.ordersService.getStats();
  }

  @Get(':id')
  @RequirePermission('orders:read')
  findById(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }

  @Post(':id/ship')
  @RequirePermission('orders:ship')
  @AuditLog({
    action: 'SHIP',
    module: 'orders',
    targetType: 'Order',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  ship(@Param('id') id: string, @Body() dto: AdminShipDto) {
    return this.ordersService.ship(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermission('orders:cancel')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'orders',
    targetType: 'Order',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.ordersService.cancel(id, dto.reason);
  }
}
