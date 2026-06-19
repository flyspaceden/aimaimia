import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { CreateDeliveryConversationDto } from './dto/create-delivery-conversation.dto';
import { UpdateDeliveryConversationDto } from './dto/update-delivery-conversation.dto';
import { DeliveryCustomerServiceService } from './delivery-customer-service.service';

@Public()
@UseGuards(DeliverySellerAuthGuard)
@Controller('delivery-seller/cs')
export class DeliverySellerCustomerServiceController {
  constructor(private readonly deliveryCustomerServiceService: DeliveryCustomerServiceService) {}

  @Get()
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
  get(@CurrentUser('merchantId') merchantId: string, @Param('id') id: string) {
    return this.deliveryCustomerServiceService.getSellerConversation(merchantId, id);
  }

  @Post()
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
