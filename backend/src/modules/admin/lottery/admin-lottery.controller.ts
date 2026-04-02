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
import { AdminLotteryService } from './admin-lottery.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import {
  CreateLotteryPrizeDto,
  UpdateLotteryPrizeDto,
  BatchUpdateProbabilitiesDto,
} from './admin-lottery.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/lottery')
export class AdminLotteryController {
  constructor(private lotteryService: AdminLotteryService) {}

  /** 奖池列表 */
  @Get('prizes')
  @RequirePermission('lottery:read')
  findPrizes(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: string,
  ) {
    return this.lotteryService.findPrizes(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      type,
    );
  }

  /** 新增奖品 */
  @Post('prizes')
  @RequirePermission('lottery:create')
  @AuditLog({
    action: 'CREATE',
    module: 'lottery',
    targetType: 'LotteryPrize',
    isReversible: false,
  })
  createPrize(@Body() dto: CreateLotteryPrizeDto) {
    return this.lotteryService.createPrize(dto);
  }

  /** 批量调整奖品概率（所有活跃奖品一次性设置，确保总和=100%） */
  @Put('prizes/batch-probabilities')
  @RequirePermission('lottery:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'lottery',
    targetType: 'LotteryPrize',
    isReversible: true,
  })
  batchUpdateProbabilities(@Body() dto: BatchUpdateProbabilitiesDto) {
    return this.lotteryService.batchUpdateProbabilities(dto.items);
  }

  /** 编辑奖品 */
  @Put('prizes/:id')
  @RequirePermission('lottery:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'lottery',
    targetType: 'LotteryPrize',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updatePrize(@Param('id') id: string, @Body() dto: UpdateLotteryPrizeDto) {
    return this.lotteryService.updatePrize(id, dto);
  }

  /** 删除奖品（软删除） */
  @Delete('prizes/:id')
  @RequirePermission('lottery:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'lottery',
    targetType: 'LotteryPrize',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  deletePrize(@Param('id') id: string) {
    return this.lotteryService.deletePrize(id);
  }

  /** 抽奖记录列表 */
  @Get('records')
  @RequirePermission('lottery:read')
  findRecords(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('userId') userId?: string,
    @Query('result') result?: string,
  ) {
    return this.lotteryService.findRecords(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      userId,
      result,
    );
  }

  /** 抽奖统计 */
  @Get('stats')
  @RequirePermission('lottery:read')
  getStats() {
    return this.lotteryService.getStats();
  }
}
