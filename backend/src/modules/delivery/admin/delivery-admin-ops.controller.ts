import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { DeliveryAdminOpsService } from './delivery-admin-ops.service';
import {
  BatchSortDeliveryCategoriesDto,
  CreateDeliveryCategoryDto,
  UpdateDeliveryCategoryDto,
} from './dto/delivery-category.dto';
import { ReviewDeliveryMerchantApplicationDto } from './dto/review-delivery-merchant-application.dto';
import { UpdateDeliveryMerchantDto } from './dto/update-delivery-merchant.dto';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin')
export class DeliveryAdminOpsController {
  constructor(private readonly deliveryAdminOpsService: DeliveryAdminOpsService) {}

  @Get('users')
  @RequireDeliveryAdminPermission('delivery:users:read')
  listUsers(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('keyword') keyword?: string) {
    return this.deliveryAdminOpsService.listUsers({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
    });
  }

  @Get('users/:id')
  @RequireDeliveryAdminPermission('delivery:users:read')
  getUser(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getUser(id);
  }

  @Get('units')
  @RequireDeliveryAdminPermission('delivery:users:read')
  listUnits(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.deliveryAdminOpsService.listUnits({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get('units/:id')
  @RequireDeliveryAdminPermission('delivery:users:read')
  getUnit(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getUnit(id);
  }

  @Get('merchants')
  @RequireDeliveryAdminPermission('delivery:merchants:read')
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
  @RequireDeliveryAdminPermission('delivery:merchants:read')
  getMerchant(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getMerchant(id);
  }

  @Patch('merchants/:id')
  @RequireDeliveryAdminPermission('delivery:merchants:write')
  updateMerchant(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryMerchantDto,
  ) {
    return this.deliveryAdminOpsService.updateMerchant(id, dto, deliveryAdminUserId);
  }

  @Get('merchant-applications')
  @RequireDeliveryAdminPermission('delivery:merchants:read')
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
  @RequireDeliveryAdminPermission('delivery:merchants:read')
  getMerchantApplication(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getMerchantApplication(id);
  }

  @Get('categories')
  @RequireDeliveryAdminPermission('delivery:products:read')
  listCategories() {
    return this.deliveryAdminOpsService.listCategories();
  }

  @Post('categories')
  @RequireDeliveryAdminPermission('delivery:products:write')
  createCategory(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: CreateDeliveryCategoryDto,
  ) {
    return this.deliveryAdminOpsService.createCategory(dto, deliveryAdminUserId);
  }

  @Put('categories/batch/sort')
  @RequireDeliveryAdminPermission('delivery:products:write')
  batchSortCategories(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: BatchSortDeliveryCategoriesDto,
  ) {
    return this.deliveryAdminOpsService.batchSortCategories(dto, deliveryAdminUserId);
  }

  @Patch('categories/:id')
  @RequireDeliveryAdminPermission('delivery:products:write')
  updateCategory(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryCategoryDto,
  ) {
    return this.deliveryAdminOpsService.updateCategory(id, dto, deliveryAdminUserId);
  }

  @Post('categories/:id/toggle-status')
  @RequireDeliveryAdminPermission('delivery:products:write')
  toggleCategoryStatus(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryAdminOpsService.toggleCategoryStatus(id, deliveryAdminUserId);
  }

  @Delete('categories/:id')
  @RequireDeliveryAdminPermission('delivery:products:write')
  removeCategory(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryAdminOpsService.removeCategory(id, deliveryAdminUserId);
  }

  @Patch('merchant-applications/:id/review')
  @RequireDeliveryAdminPermission('delivery:merchants:write')
  reviewMerchantApplication(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: ReviewDeliveryMerchantApplicationDto,
  ) {
    return this.deliveryAdminOpsService.reviewMerchantApplication(deliveryAdminUserId, id, dto);
  }

  @Get('orders')
  @RequireDeliveryAdminPermission('delivery:orders:read')
  listOrders(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.deliveryAdminOpsService.listOrders({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get('orders/:id')
  @RequireDeliveryAdminPermission('delivery:orders:read')
  getOrder(@Param('id') id: string) {
    return this.deliveryAdminOpsService.getOrder(id);
  }

  @Get('payments/abnormal')
  @RequireDeliveryAdminPermission('delivery:orders:read')
  listAbnormalPayments(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.deliveryAdminOpsService.listAbnormalPayments({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('audit')
  @RequireDeliveryAdminPermission('delivery:config:read')
  listAudit(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('keyword') keyword?: string) {
    return this.deliveryAdminOpsService.listAuditLogs({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
    });
  }
}
