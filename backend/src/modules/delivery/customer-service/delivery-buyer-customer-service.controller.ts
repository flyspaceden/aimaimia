import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { CreateDeliveryConversationDto } from './dto/create-delivery-conversation.dto';
import { DeliveryCustomerServiceService } from './delivery-customer-service.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery/cs')
export class DeliveryBuyerCustomerServiceController {
  constructor(private readonly deliveryCustomerServiceService: DeliveryCustomerServiceService) {}

  @Get()
  list(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliveryCustomerServiceService.listBuyerConversations(deliveryUserId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get(':id')
  get(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryCustomerServiceService.getBuyerConversation(deliveryUserId, id);
  }

  @Post()
  create(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Body() dto: CreateDeliveryConversationDto,
  ) {
    return this.deliveryCustomerServiceService.createBuyerConversation(deliveryUserId, dto);
  }
}
