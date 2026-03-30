import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { AfterSaleService } from './after-sale.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateAfterSaleDto } from './dto/create-after-sale.dto';
import { ReturnShippingDto } from './dto/return-shipping.dto';

@Controller('after-sale')
export class AfterSaleController {
  constructor(private afterSaleService: AfterSaleService) {}

  /** 申请售后（退货退款 / 质量退货 / 质量换货） */
  @Post('orders/:orderId')
  apply(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
    @Body() dto: CreateAfterSaleDto,
  ) {
    return this.afterSaleService.apply(userId, orderId, dto);
  }

  /** 我的售后记录 */
  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.afterSaleService.list(
      userId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  /** 售后详情 */
  @Get('return-policy')
  getReturnPolicy() {
    // 返回退货政策静态文本
    return {
      title: '退货退款政策',
      content: [
        '1. 支持七天无理由退货的商品，自签收之日起 7 天内可申请无理由退货退款。',
        '2. 商品存在质量问题，自签收之日起 7 天内可申请质量退货退款或换货。',
        '3. 生鲜等不支持无理由退货的商品，如存在质量问题，自签收之日起 24 小时内可申请售后。',
        '4. 退货商品须保持原包装完好，不影响二次销售。',
        '5. 无理由退货运费由买家承担；质量问题退货运费由卖家承担。',
        '6. 退款金额将按优惠券使用比例扣减，退回到原支付渠道。',
        '7. 换货后的商品如再次出现质量问题，仅支持退货退款，不支持再次换货。',
        '8. 抽奖奖品不支持退换。',
      ],
    };
  }

  /** 同意退货政策 */
  @Post('agree-policy')
  agreePolicy(@CurrentUser('sub') userId: string) {
    return this.afterSaleService.agreePolicy(userId);
  }

  /** 售后详情 */
  @Get(':id')
  findById(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.findById(userId, id);
  }

  /** 取消售后申请 */
  @Post(':id/cancel')
  cancel(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.cancel(userId, id);
  }

  /** 填写退货物流信息 */
  @Post(':id/return-shipping')
  fillReturnShipping(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ReturnShippingDto,
  ) {
    return this.afterSaleService.fillReturnShipping(userId, id, dto);
  }

  /** 确认收到换货商品 */
  @Post(':id/confirm')
  confirmReceive(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.confirmReceive(userId, id);
  }

  /** 申请平台仲裁 */
  @Post(':id/escalate')
  escalate(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.escalate(userId, id);
  }

  /** 接受关闭（放弃售后） */
  @Post(':id/accept-close')
  acceptClose(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.acceptClose(userId, id);
  }
}
