import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SellerShipmentsService } from './seller-shipments.service';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@Controller('seller/shipments')
export class SellerShipmentsController {
  constructor(private shipmentsService: SellerShipmentsService) {}

  /** 物流列表 */
  @Get()
  findAll(
    @CurrentSeller('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.shipmentsService.findAll(
      companyId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  /** 物流详情 */
  @Get(':id')
  findById(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.shipmentsService.findById(companyId, id);
  }
}
