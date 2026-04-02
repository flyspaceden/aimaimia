import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { SellerConfigService } from './seller-config.service';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@Controller('seller/config')
export class SellerConfigController {
  constructor(private readonly configService: SellerConfigService) {}

  @SellerRoles('OWNER', 'MANAGER', 'OPERATOR')
  @Get('markup-rate')
  getMarkupRate() {
    return this.configService.getMarkupRate();
  }
}
