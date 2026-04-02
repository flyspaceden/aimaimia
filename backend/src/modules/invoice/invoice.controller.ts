import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateInvoiceProfileDto } from './dto/create-invoice-profile.dto';
import { UpdateInvoiceProfileDto } from './dto/update-invoice-profile.dto';
import { RequestInvoiceDto } from './dto/request-invoice.dto';

@Controller('invoices')
export class InvoiceController {
  constructor(private invoiceService: InvoiceService) {}

  // ===== 发票抬头管理 =====

  /** 获取用户所有发票抬头 */
  @Get('profiles')
  getProfiles(@CurrentUser('sub') userId: string) {
    return this.invoiceService.getProfiles(userId);
  }

  /** 创建发票抬头 */
  @Post('profiles')
  createProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateInvoiceProfileDto,
  ) {
    return this.invoiceService.createProfile(userId, dto);
  }

  /** 修改发票抬头 */
  @Patch('profiles/:id')
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceProfileDto,
  ) {
    return this.invoiceService.updateProfile(userId, id, dto);
  }

  /** 删除发票抬头 */
  @Delete('profiles/:id')
  deleteProfile(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.deleteProfile(userId, id);
  }

  // ===== 发票操作 =====

  /** 申请开票 */
  @Post()
  requestInvoice(
    @CurrentUser('sub') userId: string,
    @Body() dto: RequestInvoiceDto,
  ) {
    return this.invoiceService.requestInvoice(userId, dto);
  }

  /** 用户发票列表 */
  @Get()
  getUserInvoices(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.invoiceService.getUserInvoices(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  /** 发票详情 */
  @Get(':id')
  getInvoiceDetail(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.getInvoiceDetail(userId, id);
  }

  /** 取消发票申请 */
  @Post(':id/cancel')
  cancelInvoice(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.cancelInvoice(userId, id);
  }
}
