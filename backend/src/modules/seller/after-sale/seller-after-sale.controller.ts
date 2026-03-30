import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  Req,
  Res,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SellerAfterSaleService } from './seller-after-sale.service';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { SellerAudit } from '../common/decorators/seller-audit.decorator';
import { SellerAuditInterceptor } from '../common/interceptors/seller-audit.interceptor';
import {
  ApproveAfterSaleDto,
  RejectAfterSaleDto,
  RejectReturnDto,
  GenerateWaybillDto,
} from './dto/seller-after-sale.dto';
import { applyWaybillWatermark } from '../../../common/security/waybill-watermark';
import {
  fetchBinaryWithLimit,
  RemoteBinaryFetchError,
} from '../../../common/utils/remote-binary-fetch.util';

@Public()
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/after-sale')
export class SellerAfterSaleController {
  constructor(private afterSaleService: SellerAfterSaleService) {}

  /** 售后申请列表 */
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @Get()
  findAll(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('afterSaleType') afterSaleType?: string,
  ) {
    return this.afterSaleService.findAll(
      companyId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      afterSaleType,
      staffId,
    );
  }

  /** 按状态统计 */
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @Get('stats')
  getStats(@CurrentSeller('companyId') companyId: string) {
    return this.afterSaleService.getStats(companyId);
  }

  /** 售后详情 */
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @Get(':id')
  findById(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.findById(companyId, id, staffId);
  }

  /** 开始审核 */
  @SellerAudit({
    action: 'REVIEW_AFTER_SALE',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/review')
  startReview(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.startReview(companyId, staffId, id);
  }

  /** 审核通过 */
  @SellerAudit({
    action: 'APPROVE_AFTER_SALE',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/approve')
  approve(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: ApproveAfterSaleDto,
  ) {
    return this.afterSaleService.approve(companyId, staffId, id, dto.note);
  }

  /** 驳回 */
  @SellerAudit({
    action: 'REJECT_AFTER_SALE',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/reject')
  reject(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: RejectAfterSaleDto,
  ) {
    return this.afterSaleService.reject(companyId, staffId, id, dto.reason);
  }

  /** 确认收到退货 */
  @SellerAudit({
    action: 'RECEIVE_AFTER_SALE_RETURN',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/receive')
  confirmReceiveReturn(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.confirmReceiveReturn(companyId, staffId, id);
  }

  /** 拒收退货（验收不合格） */
  @SellerAudit({
    action: 'REJECT_AFTER_SALE_RETURN',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/reject-return')
  rejectReturn(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: RejectReturnDto,
  ) {
    return this.afterSaleService.rejectReturn(
      companyId,
      staffId,
      id,
      dto.reason,
      dto.photos,
      dto.returnWaybillNo,
    );
  }

  /** 换货发货 */
  @SellerAudit({
    action: 'SHIP_AFTER_SALE',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/ship')
  ship(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.ship(companyId, staffId, id);
  }

  /** 生成换货电子面单 */
  @SellerAudit({
    action: 'GENERATE_AFTER_SALE_WAYBILL',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post(':id/waybill')
  generateWaybill(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: GenerateWaybillDto,
  ) {
    return this.afterSaleService.generateWaybill(
      companyId,
      staffId,
      id,
      dto.carrierCode,
    );
  }

  /** 换货面单打印代理 */
  @Get(':id/waybill/print')
  async printWaybill(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @Query('staffId') staffId: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!companyId || !staffId || !expires || !sig) {
      throw new BadRequestException('缺少打印签名参数');
    }

    const valid = this.afterSaleService.verifyWaybillPrintSignature(
      companyId,
      id,
      staffId,
      expires,
      sig,
    );
    if (!valid) {
      throw new ForbiddenException('打印链接已过期或签名无效');
    }

    const printData = await this.afterSaleService.getWaybillPrintData(
      companyId,
      id,
    );
    const printedAt = new Date();
    let imageBuffer: Buffer;
    try {
      const remoteImage = await fetchBinaryWithLimit(
        printData.replacementWaybillUrl,
      );
      imageBuffer = remoteImage.buffer;
    } catch (error) {
      if (error instanceof RemoteBinaryFetchError) {
        throw new HttpException(error.message, error.statusCode);
      }
      throw new HttpException('面单图片读取失败', HttpStatus.BAD_GATEWAY);
    }
    const watermarked = await applyWaybillWatermark(imageBuffer, {
      documentLabel: `售后#${id}`,
      staffId,
      printedAt,
    });
    const fileExt = watermarked.contentType.split('/')[1] || 'png';

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', watermarked.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="after-sale-waybill-${id}.${fileExt}"`,
    );
    res.setHeader(
      'X-Watermark',
      `售后#${id}:${staffId}:${printedAt.toISOString()}`,
    );

    await this.afterSaleService.recordWaybillPrintAccess(
      companyId,
      staffId,
      id,
      req.ip,
      req.headers['user-agent'],
    );

    return res.send(watermarked.buffer);
  }

  /** 取消换货面单 */
  @SellerAudit({
    action: 'CANCEL_AFTER_SALE_WAYBILL',
    module: 'after-sale',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Delete(':id/waybill')
  cancelWaybill(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.afterSaleService.cancelWaybill(companyId, id);
  }
}
