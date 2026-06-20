import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliverySellerPermission } from '../auth/decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from '../auth/guards/delivery-seller-permission.guard';
import { CreateDeliveryConversationDto } from './dto/create-delivery-conversation.dto';
import { UpdateDeliveryConversationDto } from './dto/update-delivery-conversation.dto';
import { DeliveryCustomerServiceService } from './delivery-customer-service.service';

@Public()
@UseGuards(DeliverySellerAuthGuard, DeliverySellerPermissionGuard)
@Controller('delivery-seller/cs')
export class DeliverySellerCustomerServiceController {
  constructor(private readonly deliveryCustomerServiceService: DeliveryCustomerServiceService) {}

  @Get()
  @RequireDeliverySellerPermission('customer-service:read')
  list(
    @CurrentUser('merchantId') merchantId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliveryCustomerServiceService.listSellerConversations(merchantId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get(':id')
  @RequireDeliverySellerPermission('customer-service:read')
  get(@CurrentUser('merchantId') merchantId: string, @Param('id') id: string) {
    return this.deliveryCustomerServiceService.getSellerConversation(merchantId, id);
  }

  @Post()
  @RequireDeliverySellerPermission('customer-service:write')
  create(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Body() dto: CreateDeliveryConversationDto,
  ) {
    return this.deliveryCustomerServiceService.createSellerConversation(
      merchantId,
      deliverySellerStaffId,
      dto,
    );
  }

  @Patch(':id')
  @RequireDeliverySellerPermission('customer-service:write')
  update(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryConversationDto,
  ) {
    return this.deliveryCustomerServiceService.updateSellerConversation(
      merchantId,
      deliverySellerStaffId,
      id,
      dto,
    );
  }
}
