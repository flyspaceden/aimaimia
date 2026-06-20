import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliverySellerPermission } from '../auth/decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from '../auth/guards/delivery-seller-permission.guard';
import { CreateDeliveryStaffDto } from './dto/create-delivery-staff.dto';
import { UpdateDeliveryCompanyDto } from './dto/update-delivery-company.dto';
import { UpdateDeliveryStaffDto } from './dto/update-delivery-staff.dto';
import { DeliverySellerOpsService } from './delivery-seller-ops.service';

@Public()
@UseGuards(DeliverySellerAuthGuard, DeliverySellerPermissionGuard)
@Controller('delivery-seller')
export class DeliverySellerOpsController {
  constructor(private readonly deliverySellerOpsService: DeliverySellerOpsService) {}

  @Get('dashboard')
  @RequireDeliverySellerPermission('orders:read')
  dashboard(@CurrentUser('merchantId') merchantId: string) {
    return this.deliverySellerOpsService.getDashboard(merchantId);
  }

  @Get('orders')
  @RequireDeliverySellerPermission('orders:read')
  listOrders(
    @CurrentUser('merchantId') merchantId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliverySellerOpsService.listOrders(merchantId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get('orders/:id')
  @RequireDeliverySellerPermission('orders:read')
  getOrder(@CurrentUser('merchantId') merchantId: string, @Param('id') id: string) {
    return this.deliverySellerOpsService.getOrder(merchantId, id);
  }

  @Get('company')
  @RequireDeliverySellerPermission('company:read')
  getCompany(@CurrentUser('merchantId') merchantId: string) {
    return this.deliverySellerOpsService.getCompany(merchantId);
  }

  @Patch('company')
  @RequireDeliverySellerPermission('company:write')
  updateCompany(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @CurrentUser('role') role: 'OWNER' | 'MANAGER' | 'OPERATOR',
    @Body() dto: UpdateDeliveryCompanyDto,
  ) {
    return this.deliverySellerOpsService.updateCompany({ merchantId, deliverySellerStaffId, role }, dto);
  }

  @Get('staff')
  @RequireDeliverySellerPermission('staff:manage')
  listStaff(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @CurrentUser('role') role: 'OWNER' | 'MANAGER' | 'OPERATOR',
  ) {
    return this.deliverySellerOpsService.listStaff({ merchantId, deliverySellerStaffId, role });
  }

  @Post('staff')
  @RequireDeliverySellerPermission('staff:manage')
  createStaff(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @CurrentUser('role') role: 'OWNER' | 'MANAGER' | 'OPERATOR',
    @Body() dto: CreateDeliveryStaffDto,
  ) {
    return this.deliverySellerOpsService.createStaff({ merchantId, deliverySellerStaffId, role }, dto);
  }

  @Patch('staff/:id')
  @RequireDeliverySellerPermission('staff:manage')
  updateStaff(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @CurrentUser('role') role: 'OWNER' | 'MANAGER' | 'OPERATOR',
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStaffDto,
  ) {
    return this.deliverySellerOpsService.updateStaff({ merchantId, deliverySellerStaffId, role }, id, dto);
  }
}
