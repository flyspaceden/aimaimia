import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { MarkDeliverySettlementPaidDto } from './dto/mark-delivery-settlement-paid.dto';
import { DeliverySettlementService } from './delivery-settlement.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/settlements')
export class DeliveryAdminSettlementController {
  constructor(private readonly deliverySettlementService: DeliverySettlementService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliverySettlementService.listAdminSettlements({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      status,
    });
  }

  @Patch(':id/paid')
  markPaid(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: MarkDeliverySettlementPaidDto,
  ) {
    return this.deliverySettlementService.markSettlementPaid(deliveryAdminUserId, id, dto);
  }
}
