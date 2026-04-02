import { Controller, Get, Param, Query } from '@nestjs/common';
import { TraceService } from './trace.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Controller('trace')
export class TraceController {
  constructor(private traceService: TraceService) {}

  /** 商品溯源链（公开） */
  @Public()
  @Get('product/:productId')
  getProductTrace(@Param('productId') productId: string) {
    return this.traceService.getProductTrace(productId);
  }

  /** 订单溯源（需认证） */
  @Get('order/:orderId')
  getOrderTrace(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.traceService.getOrderTrace(orderId, userId);
  }

  /** 批次详情（公开） */
  @Public()
  @Get('batch/:batchId')
  getBatchDetail(@Param('batchId') batchId: string) {
    return this.traceService.getBatchDetail(batchId);
  }

  /** 通过批次码查询（公开） */
  @Public()
  @Get('code')
  getBatchByCode(@Query('code') code: string) {
    return this.traceService.getBatchByCode(code);
  }
}
