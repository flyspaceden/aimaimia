import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { CreateDeliveryCartItemDto } from './dto/create-delivery-cart-item.dto';
import { UpdateDeliveryCartItemDto } from './dto/update-delivery-cart-item.dto';
import { DeliveryCartService } from './delivery-cart.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery')
export class DeliveryCartController {
  constructor(private readonly deliveryCartService: DeliveryCartService) {}

  @Get('cart')
  getCart(@CurrentUser('deliveryUserId') deliveryUserId: string) {
    return this.deliveryCartService.getCart(deliveryUserId);
  }

  @Post('cart/items')
  addItem(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Body() dto: CreateDeliveryCartItemDto,
  ) {
    return this.deliveryCartService.addItem(deliveryUserId, dto);
  }

  @Patch('cart/items/:id')
  updateItem(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('id') cartItemId: string,
    @Body() dto: UpdateDeliveryCartItemDto,
  ) {
    return this.deliveryCartService.updateItem(deliveryUserId, cartItemId, dto);
  }

  @Delete('cart/items/:id')
  removeItem(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('id') cartItemId: string,
  ) {
    return this.deliveryCartService.removeItem(deliveryUserId, cartItemId);
  }
}
