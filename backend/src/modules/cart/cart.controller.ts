import { Controller, Get, Post, Patch, Delete, Param, Body, Headers } from '@nestjs/common';
import { CartService } from './cart.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AddCartItemDto,
  UpdateCartItemQuantityDto,
  ToggleCartSelectDto,
  MergeCartDto,
} from './dto/cart.dto';

@Controller('cart')
export class CartController {
  constructor(private cartService: CartService) {}

  @Get()
  getCart(@CurrentUser('sub') userId: string) {
    return this.cartService.getCart(userId);
  }

  @Post('items')
  addItem(
    @CurrentUser('sub') userId: string,
    @Body() dto: AddCartItemDto,
  ) {
    return this.cartService.addItem(userId, dto.skuId, dto.quantity);
  }

  @Patch('items/:skuId')
  updateItemQuantity(
    @CurrentUser('sub') userId: string,
    @Param('skuId') skuId: string,
    @Body() dto: UpdateCartItemQuantityDto,
  ) {
    return this.cartService.updateItemQuantity(userId, skuId, dto.quantity);
  }

  @Delete('items/:skuId')
  removeItem(
    @CurrentUser('sub') userId: string,
    @Param('skuId') skuId: string,
  ) {
    return this.cartService.removeItem(userId, skuId);
  }

  /** F2: 勾选/取消勾选购物车商品 */
  @Patch('items/:skuId/select')
  toggleSelect(
    @CurrentUser('sub') userId: string,
    @Param('skuId') skuId: string,
    @Body() dto: ToggleCartSelectDto,
  ) {
    return this.cartService.toggleSelect(userId, skuId, dto.isSelected);
  }

  /** 删除购物车奖品项（按 cartItemId） */
  @Delete('prize-items/:cartItemId')
  removePrizeItem(
    @CurrentUser('sub') userId: string,
    @Param('cartItemId') cartItemId: string,
  ) {
    return this.cartService.removePrizeItem(userId, cartItemId);
  }

  /** 购物车合并（登录后同步本地购物车到服务端） */
  @Post('merge')
  mergeCart(
    @CurrentUser('sub') userId: string,
    @Body() dto: MergeCartDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.cartService.mergeItems(userId, dto.items, idempotencyKey);
  }

  @Delete()
  clearCart(@CurrentUser('sub') userId: string) {
    return this.cartService.clearCart(userId);
  }
}
