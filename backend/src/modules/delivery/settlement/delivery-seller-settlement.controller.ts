import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySettlementService } from './delivery-settlement.service';

@Public()
@UseGuards(DeliverySellerAuthGuard)
@Controller('delivery-seller/settlements')
export class DeliverySellerSettlementController {
  constructor(private readonly deliverySettlementService: DeliverySettlementService) {}

  @Get()
  list(
    @CurrentUser('merchantId') merchantId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliverySettlementService.listSellerSettlements(merchantId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }
}
