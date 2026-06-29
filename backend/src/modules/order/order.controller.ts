import { Controller, Get, Post, Patch, Body, Param, Query, GoneException } from '@nestjs/common';
import { OrderService } from './order.service';
import { CheckoutService } from './checkout.service';
import { PaymentService } from '../payment/payment.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { CheckoutDto } from './checkout.dto';
import { VipCheckoutDto } from './vip-checkout.dto';
import { AfterSaleDto } from './dto/after-sale.dto';
import { UpdateOrderReceiverInfoDto } from './dto/update-order-receiver-info.dto';
import { AfterSaleService } from '../after-sale/after-sale.service';
import { Throttle } from '@nestjs/throttler';

@Controller('orders')
export class OrderController {
  constructor(
    private orderService: OrderService,
    private checkoutService: CheckoutService,
    private afterSaleService: AfterSaleService,
    private paymentService: PaymentService,
  ) {}

  // ===== F1: 新结算流程 =====

  /** F1: 创建 CheckoutSession（校验+计算+预留奖励+返回支付参数） */
  @Post('checkout')
  checkout(
    @CurrentUser('sub') userId: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.checkoutService.checkout(userId, dto);
  }

  /** VIP 礼包结算（独立于普通商品 checkout） */
  @Post('vip-checkout')
  vipCheckout(
    @CurrentUser('sub') userId: string,
    @Body() dto: VipCheckoutDto,
  ) {
    return this.checkoutService.checkoutVipPackage(userId, dto);
  }

  /** F1: 取消结算会话 */
  @Post('checkout/:sessionId/cancel')
  cancelCheckout(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.checkoutService.cancelSession(userId, sessionId);
  }

  /** F1: 查询结算会话状态（前端轮询） */
  @Get('checkout/:sessionId/status')
  getCheckoutStatus(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.checkoutService.getSessionStatus(userId, sessionId);
  }

  /** Task 16: 查询当前用户最新的 ACTIVE CheckoutSession（"未完成订单"入口） */
  @Get('checkout/me/pending')
  getMyPendingCheckout(@CurrentUser('sub') userId: string) {
    return this.checkoutService.getPendingForUser(userId);
  }

  /** Task 17: 续付未完成的 CheckoutSession（重新生成支付参数） */
  @Post('checkout/:sessionId/resume')
  resumeCheckout(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.checkoutService.resumeSession(userId, sessionId);
  }

  /**
   * P5 第三轮：App 端主动查询支付订单状态（不等 notify）
   *
   * App 调起支付 SDK 后立即调用此接口，让后端按 CheckoutSession 支付渠道主动查询：
   * - 查到成功态 → 立刻建单 + session COMPLETED
   * - 未支付 / 中间态 / 异常 → 返回当前状态，让前端 polling 兜底
   *
   * 解决沙箱 notify 慢/丢失导致的"已扣款但订单未生成"问题
   */
  @Post('checkout/:sessionId/active-query')
  activeQueryCheckout(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.paymentService.confirmCheckout(sessionId, userId);
  }

  // ===== 已有接口 =====

  /** N09修复：预结算接口 — 放在 :id 路由之前避免被拦截 */
  @Post('preview')
  preview(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.orderService.previewOrder(userId, dto);
  }

  /** @deprecated F1: 合并支付旧入口停用，统一走 CheckoutSession */
  @Post('batch-pay')
  batchPay() {
    throw new GoneException('合并支付旧接口已停用，请使用 POST /orders/checkout');
  }

  /** @deprecated F1: 旧流程 — 使用 POST /orders/checkout 代替 */
  @Post()
  create() {
    throw new GoneException('旧下单接口已停用，请使用 POST /orders/checkout');
  }

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orderService.list(
      userId,
      status,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Get('status-counts')
  getStatusCounts(@CurrentUser('sub') userId: string) {
    return this.orderService.getStatusCounts(userId);
  }

  @Get('latest-issue')
  getLatestIssue(@CurrentUser('sub') userId: string) {
    return this.orderService.getLatestIssue(userId);
  }

  @Post(':id/repurchase')
  @Throttle({ user: { ttl: 60000, limit: 10 } })
  repurchase(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.orderService.repurchase(id, userId);
  }

  @Patch(':id/receiver-info')
  updateReceiverInfo(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderReceiverInfoDto,
  ) {
    return this.orderService.updateReceiverInfo(id, userId, dto);
  }

  @Get(':id')
  getById(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.orderService.getById(id, userId);
  }

  /** @deprecated F1: 旧流程 — 新流程由支付回调自动创建订单 */
  @Post(':id/pay')
  pay() {
    throw new GoneException('旧支付接口已停用，请完成 Checkout 后等待支付回调建单');
  }

  /**
   * @deprecated 旧售后入口 — 请使用 POST /after-sale/orders/:orderId 代替
   * 保留兼容性：转发到 AfterSaleService
   */
  @Post(':id/after-sale')
  applyAfterSale(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    // 新统一售后系统入口
    return this.afterSaleService.apply(userId, id, dto);
  }

  /** @deprecated 旧换货确认入口已停用 — 请使用 POST /after-sale/:id/confirm 代替 */
  @Post(':id/replacement/confirm')
  confirmReplacementReceive() {
    throw new GoneException('旧换货确认接口已停用，请使用 POST /after-sale/:id/confirm');
  }

  @Post(':id/receive')
  confirmReceive(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.orderService.confirmReceive(id, userId);
  }

  @Post(':id/cancel')
  cancelOrder(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.orderService.cancelOrder(id, userId);
  }
}
