import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { UpdateDeliveryConversationDto } from './dto/update-delivery-conversation.dto';
import { DeliveryCustomerServiceService } from './delivery-customer-service.service';
import { DeliveryConfigService } from '../config/delivery-config.service';
import { UpdateDeliveryConfigDto } from '../config/dto/update-delivery-config.dto';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin/cs')
export class DeliveryAdminCustomerServiceController {
  constructor(
    private readonly deliveryCustomerServiceService: DeliveryCustomerServiceService,
    private readonly deliveryConfigService: DeliveryConfigService,
  ) {}

  @Get()
  @RequireDeliveryAdminPermission('delivery:customer-service:read')
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

  @Get('config/defaults')
  @RequireDeliveryAdminPermission('delivery:customer-service:read')
  getCustomerServiceConfig() {
    return this.deliveryConfigService.list('CUSTOMER_SERVICE');
  }

  @Patch('config/defaults')
  @RequireDeliveryAdminPermission('delivery:customer-service:write')
  updateCustomerServiceConfig(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: UpdateDeliveryConfigDto,
  ) {
    if (dto.items.some((item) => item.key !== 'CUSTOMER_SERVICE_DEFAULTS')) {
      throw new BadRequestException('客服配置接口只能更新配送客服默认配置');
    }
    return this.deliveryConfigService.update(
      dto.items.map((item) => ({ ...item, scope: 'CUSTOMER_SERVICE' })),
      deliveryAdminUserId,
    );
  }

  @Get(':id')
  @RequireDeliveryAdminPermission('delivery:customer-service:read')
  get(@Param('id') id: string) {
    return this.deliveryCustomerServiceService.getAdminConversation(id);
  }

  @Patch(':id')
  @RequireDeliveryAdminPermission('delivery:customer-service:write')
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
