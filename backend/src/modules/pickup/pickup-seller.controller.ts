import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { CreatePickupPointDto, UpdatePickupPointDto } from './dto/pickup-point.dto';
import { VerifyPickupDto } from './dto/pickup-verify.dto';
import { PickupService } from './pickup.service';
import { Throttle } from '@nestjs/throttler';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/pickup-points')
export class PickupSellerPointController {
  constructor(private readonly pickupService: PickupService) {}

  @Get()
  list(
    @CurrentSeller('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.pickupService.listSellerPoints(
      companyId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
      isActive === undefined ? undefined : isActive === 'true',
    );
  }

  @SellerAudit({ action: 'CREATE_PICKUP_POINT', module: 'pickup', targetType: 'PickupPoint' })
  @SellerRoles('OWNER', 'MANAGER')
  @Post()
  create(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: CreatePickupPointDto,
  ) {
    return this.pickupService.createSellerPoint(companyId, dto);
  }

  @SellerAudit({ action: 'UPDATE_PICKUP_POINT', module: 'pickup', targetType: 'PickupPoint', targetIdParam: 'params.id' })
  @SellerRoles('OWNER', 'MANAGER')
  @Patch(':id')
  update(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePickupPointDto,
  ) {
    return this.pickupService.updateSellerPoint(companyId, id, dto);
  }
}

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/orders')
export class PickupSellerOrderController {
  constructor(private readonly pickupService: PickupService) {}

  @SellerAudit({ action: 'PICKUP_READY', module: 'orders', targetType: 'Order', targetIdParam: 'params.id' })
  @SellerRoles('OWNER', 'MANAGER', 'OPERATOR')
  @Post(':id/pickup/ready')
  ready(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
  ) {
    return this.pickupService.markReady(companyId, staffId, id);
  }

  @SellerAudit({ action: 'PICKUP_VERIFY', module: 'orders', targetType: 'Order', targetIdParam: 'params.id' })
  @SellerRoles('OWNER', 'MANAGER', 'OPERATOR')
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post(':id/pickup/verify')
  verify(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: VerifyPickupDto,
  ) {
    return this.pickupService.verify(companyId, staffId, id, dto);
  }
}

/**
 * 门店核销台：可通过扫码枪、电脑摄像头或人工短码定位订单。
 * 先 resolve 再 verify，避免任何输入一经识别就直接变更为已收货。
 */
@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/pickup')
export class PickupSellerVerificationController {
  constructor(private readonly pickupService: PickupService) {}

  @SellerAudit({
    action: 'PICKUP_CREDENTIAL_RESOLVE', module: 'pickup', targetType: 'Order', targetIdResponseKey: 'orderId',
  })
  @SellerRoles('OWNER', 'MANAGER', 'OPERATOR')
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 15 } })
  @Post('resolve')
  resolve(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: VerifyPickupDto,
  ) {
    return this.pickupService.resolveCredential(companyId, dto);
  }

  @SellerAudit({
    action: 'PICKUP_VERIFY_FROM_STATION', module: 'pickup', targetType: 'Order', targetIdResponseKey: 'orderId',
  })
  @SellerRoles('OWNER', 'MANAGER', 'OPERATOR')
  @Throttle({ default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('verify')
  verify(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Body() dto: VerifyPickupDto,
  ) {
    return this.pickupService.verifyCredential(companyId, staffId, dto);
  }
}
