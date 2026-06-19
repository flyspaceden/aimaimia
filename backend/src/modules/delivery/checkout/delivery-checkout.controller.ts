import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { CreateDeliveryCheckoutDto } from './dto/create-delivery-checkout.dto';
import { DeliveryCheckoutService } from './delivery-checkout.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery')
export class DeliveryCheckoutController {
  constructor(private readonly deliveryCheckoutService: DeliveryCheckoutService) {}

  @Post('checkout')
  createCheckout(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Body() dto: CreateDeliveryCheckoutDto,
  ) {
    return this.deliveryCheckoutService.createCheckout(deliveryUserId, dto);
  }

  @Get('checkout/:id')
  getCheckout(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('id') checkoutSessionId: string,
  ) {
    return this.deliveryCheckoutService.getCheckout(deliveryUserId, checkoutSessionId);
  }
}
