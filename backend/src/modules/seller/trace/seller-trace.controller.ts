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
import { SellerTraceService } from './seller-trace.service';
import { CreateTraceBatchDto, UpdateTraceBatchDto } from './seller-trace.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { SellerAudit } from '../common/decorators/seller-audit.decorator';
import { SellerAuditInterceptor } from '../common/interceptors/seller-audit.interceptor';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/trace')
export class SellerTraceController {
  constructor(private traceService: SellerTraceService) {}

  @Get()
  findAll(
    @CurrentSeller('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.traceService.findAll(
      companyId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get(':id')
  findById(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.traceService.findById(companyId, id);
  }

  @SellerAudit({ action: 'CREATE_TRACE', module: 'trace', targetType: 'TraceBatch' })
  @Post()
  create(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: CreateTraceBatchDto,
  ) {
    return this.traceService.create(companyId, dto);
  }

  @SellerAudit({ action: 'UPDATE_TRACE', module: 'trace', targetType: 'TraceBatch', targetIdParam: 'params.id' })
  @Put(':id')
  update(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTraceBatchDto,
  ) {
    return this.traceService.update(companyId, id, dto);
  }

  @SellerAudit({ action: 'DELETE_TRACE', module: 'trace', targetType: 'TraceBatch', targetIdParam: 'params.id' })
  @Delete(':id')
  remove(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.traceService.remove(companyId, id);
  }
}
