import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SellerRefundsService } from './seller-refunds.service';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@Controller('seller/refunds')
export class SellerRefundsController {
  constructor(private refundsService: SellerRefundsService) {}

  /** 退款列表 */
  @Get()
  findAll(
    @CurrentSeller('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.refundsService.findAll(
      companyId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
    );
  }

  /** 退款详情 */
  @Get(':id')
  findById(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.refundsService.findById(companyId, id);
  }
}
