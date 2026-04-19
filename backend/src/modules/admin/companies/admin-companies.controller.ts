import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminCompaniesService } from './admin-companies.service';
import { AdminUpdateCompanyDto, AdminAuditCompanyDto, AdminUpdateHighlightsDto, AdminVerifyDocumentDto, BindOwnerDto, AdminUpdateAiSearchProfileDto, AdminCreateCompanyDto, AdminResetStaffPasswordDto } from './dto/admin-company.dto';
import { SetCompanyTagsDto } from '../tags/admin-tags.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/companies')
export class AdminCompaniesController {
  constructor(private companiesService: AdminCompaniesService) {}

  @Post()
  @RequirePermission('companies:audit')
  @AuditLog({
    action: 'CREATE',
    module: 'companies',
    targetType: 'Company',
    isReversible: false,
  })
  create(@Body() dto: AdminCreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @Get()
  @RequirePermission('companies:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.companiesService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      keyword,
    );
  }

  @Get(':id')
  @RequirePermission('companies:read')
  findById(@Param('id') id: string) {
    return this.companiesService.findById(id);
  }

  @Put(':id')
  @RequirePermission('companies:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'companies',
    targetType: 'Company',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: AdminUpdateCompanyDto) {
    return this.companiesService.update(id, dto);
  }

  @Post(':id/audit')
  @RequirePermission('companies:audit')
  @AuditLog({
    action: 'APPROVE',
    module: 'companies',
    targetType: 'Company',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  audit(@Param('id') id: string, @Body() dto: AdminAuditCompanyDto) {
    return this.companiesService.audit(id, dto);
  }

  @Get(':id/staff')
  @RequirePermission('companies:read')
  getStaff(@Param('id') id: string) {
    return this.companiesService.getStaff(id);
  }

  @Post(':id/bind-owner')
  @RequirePermission('companies:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'companies',
    targetType: 'Company',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  bindOwner(@Param('id') id: string, @Body() dto: BindOwnerDto) {
    return this.companiesService.bindOwner(id, dto);
  }

  /** C40c8 管理员兜底重置员工密码 */
  @Post(':id/staff/:staffId/reset-password')
  @RequirePermission('companies:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'companies',
    targetType: 'CompanyStaff',
    targetIdParam: 'params.staffId',
    isReversible: false,
  })
  resetStaffPassword(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Body() dto: AdminResetStaffPasswordDto,
  ) {
    return this.companiesService.resetStaffPassword(id, staffId, dto);
  }

  // ===================== AI 搜索资料 =====================

  @Get(':id/ai-search-profile')
  @RequirePermission('companies:read')
  getAiSearchProfile(@Param('id') id: string) {
    return this.companiesService.getAiSearchProfile(id);
  }

  @Put(':id/ai-search-profile')
  @RequirePermission('companies:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'companies',
    targetType: 'CompanyProfile',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateAiSearchProfile(@Param('id') id: string, @Body() dto: AdminUpdateAiSearchProfileDto) {
    return this.companiesService.updateAiSearchProfile(id, dto);
  }

  @Get(':id/highlights')
  @RequirePermission('companies:read')
  getHighlights(@Param('id') id: string) {
    return this.companiesService.getHighlights(id);
  }

  @Put(':id/highlights')
  @RequirePermission('companies:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'companies',
    targetType: 'CompanyProfile',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateHighlights(@Param('id') id: string, @Body() dto: AdminUpdateHighlightsDto) {
    return this.companiesService.updateHighlights(id, dto);
  }

  // ===================== 企业标签 =====================

  @Get(':id/tags')
  @RequirePermission('companies:read')
  getCompanyTags(@Param('id') id: string) {
    return this.companiesService.getCompanyTags(id);
  }

  @Put(':id/tags')
  @RequirePermission('companies:update')
  @AuditLog({ action: 'UPDATE', module: 'companies', targetType: 'CompanyTag', targetIdParam: 'params.id', isReversible: true })
  updateCompanyTags(@Param('id') id: string, @Body() dto: SetCompanyTagsDto) {
    return this.companiesService.updateCompanyTags(id, dto.tagIds);
  }

  @Post(':id/documents/:docId/verify')
  @RequirePermission('companies:audit')
  @AuditLog({
    action: 'APPROVE',
    module: 'companies',
    targetType: 'CompanyDocument',
    targetIdParam: 'params.docId',
    isReversible: true,
  })
  verifyDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: AdminVerifyDocumentDto,
  ) {
    return this.companiesService.verifyDocument(id, docId, dto);
  }
}
