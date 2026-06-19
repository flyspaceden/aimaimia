import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { UpdateDeliveryConversationDto } from './dto/update-delivery-conversation.dto';
import { DeliveryCustomerServiceService } from './delivery-customer-service.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/cs')
export class DeliveryAdminCustomerServiceController {
  constructor(private readonly deliveryCustomerServiceService: DeliveryCustomerServiceService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliveryCustomerServiceService.listAdminConversations({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.deliveryCustomerServiceService.getAdminConversation(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: UpdateDeliveryConversationDto,
  ) {
    return this.deliveryCustomerServiceService.updateAdminConversation(
      id,
      deliveryAdminUserId,
      dto,
    );
  }
}
