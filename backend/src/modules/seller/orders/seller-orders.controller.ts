import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SellerOrdersService } from './seller-orders.service';
import { SellerShipDto, BatchShipDto } from './seller-orders.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { SellerAudit } from '../common/decorators/seller-audit.decorator';
import { SellerAuditInterceptor } from '../common/interceptors/seller-audit.interceptor';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/orders')
export class SellerOrdersController {
  constructor(private ordersService: SellerOrdersService) {}

  /** 我的订单列表 */
  @Get()
  findAll(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('bizType') bizType?: string,
  ) {
    return this.ordersService.findAll(
      companyId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      bizType,
      staffId,
    );
  }

  /** 订单详情 */
  @SellerAudit({ action: 'VIEW_ORDER', module: 'orders', targetType: 'Order', targetIdParam: 'params.id' })
  @Get(':id')
  findById(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
  ) {
    return this.ordersService.findById(companyId, staffId, id);
  }

  /** 发货 */
  @SellerAudit({ action: 'SHIP_ORDER', module: 'orders', targetType: 'Order', targetIdParam: 'params.id' })
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/ship')
  ship(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: SellerShipDto,
  ) {
    return this.ordersService.ship(companyId, id, dto);
  }

  /** 批量发货 */
  @SellerAudit({ action: 'BATCH_SHIP', module: 'orders' })
  @SellerRoles('OWNER', 'MANAGER')
  @Post('batch-ship')
  batchShip(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: BatchShipDto,
  ) {
    return this.ordersService.batchShip(companyId, dto.items);
  }
}
