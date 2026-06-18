import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Res,
  Req,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SellerShippingService } from './seller-shipping.service';
import { GenerateWaybillDto, BatchGenerateWaybillDto } from './seller-shipping.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { SellerAudit } from '../common/decorators/seller-audit.decorator';
import { SellerAuditInterceptor } from '../common/interceptors/seller-audit.interceptor';
import { applyWaybillWatermark } from '../../../common/security/waybill-watermark';
import {
  fetchBinaryWithLimit,
  RemoteBinaryFetchError,
} from '../../../common/utils/remote-binary-fetch.util';

@Public()
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/orders')
export class SellerShippingController {
  constructor(private shippingService: SellerShippingService) {}

  /**
   * 生成电子面单
   * POST /seller/orders/:orderId/waybill
   */
  @SellerAudit({
    action: 'GENERATE_WAYBILL',
    module: 'shipping',
    targetType: 'Order',
    targetIdParam: 'params.orderId',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @Post(':orderId/waybill')
  generateWaybill(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('orderId') orderId: string,
    @Body() dto: GenerateWaybillDto,
  ) {
    return this.shippingService.generateWaybill(companyId, staffId, orderId, dto.carrierCode);
  }

  /**
   * 面单打印代理
   * GET /seller/orders/:orderId/waybill/print
   *
   * 返回面单图片 URL 及打印相关信息
   * 添加 Cache-Control: no-store 防止缓存
   * 添加 X-Watermark 响应头（占位，真实水印需要 sharp 集成）
   */
  @Get(':orderId/waybill/print')
  async printWaybill(
    @Param('orderId') orderId: string,
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

    const valid = this.shippingService.verifyPrintSignature(
      companyId,
      orderId,
      staffId,
      expires,
      sig,
    );
    if (!valid) {
      throw new ForbiddenException('打印链接已过期或签名无效');
    }

    const printData = await this.shippingService.getWaybillPrintData(
      companyId,
      orderId,
    );

    // PDF 面单（历史 base64 兼容）
    const isPdfBase64 = printData.waybillUrl.startsWith('data:application/pdf;base64,');
    if (isPdfBase64) {
      const base64Data = printData.waybillUrl.replace('data:application/pdf;base64,', '');
      const pdfBuffer = Buffer.from(base64Data, 'base64');

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="waybill-${orderId}.pdf"`);

      await this.shippingService.recordWaybillPrintAccess(
        companyId, staffId, orderId, req.ip, req.headers['user-agent'],
      );

      return res.send(pdfBuffer);
    }

    let remoteFile: { buffer: Buffer; contentType: string | null };
    try {
      remoteFile = await fetchBinaryWithLimit(printData.waybillUrl, {
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 15000,
        allowedContentTypes: ['application/pdf', 'application/octet-stream', 'image/'],
      });
    } catch (error) {
      if (error instanceof RemoteBinaryFetchError) {
        throw new HttpException(error.message, error.statusCode);
      }
      throw new HttpException('面单文件读取失败', HttpStatus.BAD_GATEWAY);
    }

    const contentType = remoteFile.contentType?.toLowerCase() ?? '';
    const isPdfUrl = /\.pdf(\?|$)/i.test(printData.waybillUrl);
    const isPdfContent =
      isPdfUrl ||
      contentType.startsWith('application/pdf') ||
      remoteFile.buffer.subarray(0, 5).toString('ascii') === '%PDF-';

    if (isPdfContent) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="waybill-${orderId}.pdf"`);

      await this.shippingService.recordWaybillPrintAccess(
        companyId, staffId, orderId, req.ip, req.headers['user-agent'],
      );

      return res.send(remoteFile.buffer);
    }

    // 原有图片逻辑保持不变（向后兼容）
    const printedAt = new Date();
    const watermarked = await applyWaybillWatermark(remoteFile.buffer, {
      documentLabel: `订单#${orderId}`,
      staffId,
      printedAt,
    });
    const fileExt = watermarked.contentType.split('/')[1] || 'png';

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', watermarked.contentType);
    res.setHeader('Content-Disposition', `inline; filename="waybill-${orderId}.${fileExt}"`);
    res.setHeader('X-Watermark', `订单#${orderId}:${staffId}:${printedAt.toISOString()}`);

    await this.shippingService.recordWaybillPrintAccess(
      companyId,
      staffId,
      orderId,
      req.ip,
      req.headers['user-agent'],
    );

    return res.send(watermarked.buffer);
  }

  /**
   * 批量生成电子面单
   * POST /seller/orders/batch-waybill
   */
  @SellerAudit({
    action: 'BATCH_GENERATE_WAYBILL',
    module: 'shipping',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER')
  @Post('batch-waybill')
  batchGenerateWaybill(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Body() dto: BatchGenerateWaybillDto,
  ) {
    return this.shippingService.batchGenerateWaybill(companyId, staffId, dto.items);
  }

  /**
   * 取消面单
   * DELETE /seller/orders/:orderId/waybill
   *
   * Bug 75 联动: OPERATOR 能生面单 / 确认发货后，也应能取消面单（防发错单卡死）
   */
  @SellerAudit({
    action: 'CANCEL_WAYBILL',
    module: 'shipping',
    targetType: 'Order',
    targetIdParam: 'params.orderId',
  })
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @SellerRoles('OWNER', 'MANAGER', 'OPERATOR')
  @Delete(':orderId/waybill')
  cancelWaybill(
    @CurrentSeller('companyId') companyId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.shippingService.cancelWaybill(companyId, orderId);
  }
}
