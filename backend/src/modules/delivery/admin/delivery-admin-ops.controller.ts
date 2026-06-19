import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminOpsService } from './delivery-admin-ops.service';
import { ReviewDeliveryMerchantApplicationDto } from './dto/review-delivery-merchant-application.dto';
import { UpdateDeliveryMerchantDto } from './dto/update-delivery-merchant.dto';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin')
export class DeliveryAdminOpsController {
  constructor(private readonly deliveryAdminOpsService: DeliveryAdminOpsService) {}

  @Get('users')
  listUsers(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('keyword') keyword?: string) {
    return this.deliveryAdminOpsService.listUsers({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
    });
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getUser(id);
  }

  @Get('units')
  listUnits(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.deliveryAdminOpsService.listUnits({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get('units/:id')
  getUnit(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getUnit(id);
  }

  @Get('merchants')
  listMerchants(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.deliveryAdminOpsService.listMerchants({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
      keyword,
    });
  }

  @Get('merchants/:id')
  getMerchant(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getMerchant(id);
  }

  @Patch('merchants/:id')
  updateMerchant(@Param('id') id: string, @Body() dto: UpdateDeliveryMerchantDto) {
    return this.deliveryAdminOpsService.updateMerchant(id, dto);
  }

  @Get('merchant-applications')
  listMerchantApplications(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliveryAdminOpsService.listMerchantApplications({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get('merchant-applications/:id')
  getMerchantApplication(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getMerchantApplication(id);
  }

  @Patch('merchant-applications/:id/review')
  reviewMerchantApplication(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: ReviewDeliveryMerchantApplicationDto,
  ) {
    return this.deliveryAdminOpsService.reviewMerchantApplication(deliveryAdminUserId, id, dto);
  }

  @Get('orders')
  listOrders(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.deliveryAdminOpsService.listOrders({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getOrder(id);
  }

  @Get('payments/abnormal')
  listAbnormalPayments(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.deliveryAdminOpsService.listAbnormalPayments({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('audit')
  listAudit(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('keyword') keyword?: string) {
    return this.deliveryAdminOpsService.listAuditLogs({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
    });
  }
}
