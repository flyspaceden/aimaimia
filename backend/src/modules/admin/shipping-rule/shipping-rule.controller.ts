import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ShippingRuleService } from './shipping-rule.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';
import { UpdateShippingRuleDto } from './dto/update-shipping-rule.dto';
import { PreviewShippingDto } from './dto/preview-shipping.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/shipping-rules')
export class ShippingRuleController {
  constructor(private shippingRuleService: ShippingRuleService) {}

  /** 运费规则列表 */
  @Get()
  @RequirePermission('shipping:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.shippingRuleService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  /** 运费预览测试 */
  @Post('preview')
  @RequirePermission('shipping:read')
  preview(@Body() dto: PreviewShippingDto) {
    return this.shippingRuleService.preview(dto);
  }

  /** 新增运费规则 */
  @Post()
  @RequirePermission('shipping:create')
  @AuditLog({
    action: 'CREATE',
    module: 'shipping',
    targetType: 'ShippingRule',
    isReversible: false,
  })
  create(@Body() dto: CreateShippingRuleDto) {
    return this.shippingRuleService.create(dto);
  }

  /** 编辑运费规则 */
  @Put(':id')
  @RequirePermission('shipping:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'shipping',
    targetType: 'ShippingRule',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: UpdateShippingRuleDto) {
    return this.shippingRuleService.update(id, dto);
  }

  /** 删除运费规则 */
  @Delete(':id')
  @RequirePermission('shipping:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'shipping',
    targetType: 'ShippingRule',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  remove(@Param('id') id: string) {
    return this.shippingRuleService.remove(id);
  }
}
