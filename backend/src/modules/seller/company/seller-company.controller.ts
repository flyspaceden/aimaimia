import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SellerCompanyService } from './seller-company.service';
import { UpdateCompanyDto, InviteStaffDto, UpdateStaffDto, UpdateHighlightsDto, AddDocumentDto, UpdateAiSearchProfileDto } from './seller-company.dto';
import { SetCompanyTagsDto } from '../../admin/tags/admin-tags.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { SellerAudit } from '../common/decorators/seller-audit.decorator';
import { SellerAuditInterceptor } from '../common/interceptors/seller-audit.interceptor';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/company')
export class SellerCompanyController {
  constructor(private companyService: SellerCompanyService) {}

  // ===================== 企业信息 =====================

  /** 获取企业信息 */
  @Get()
  getCompany(@CurrentSeller('companyId') companyId: string) {
    return this.companyService.getCompany(companyId);
  }

  /** 更新企业信息 */
  @SellerAudit({ action: 'UPDATE_COMPANY', module: 'company', targetType: 'Company' })
  @SellerRoles('OWNER', 'MANAGER')
  @Put()
  updateCompany(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companyService.updateCompany(companyId, dto);
  }

  /** 更新企业亮点 */
  @SellerAudit({ action: 'UPDATE_HIGHLIGHTS', module: 'company', targetType: 'Company' })
  @SellerRoles('OWNER', 'MANAGER')
  @Put('highlights')
  updateHighlights(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: UpdateHighlightsDto,
  ) {
    return this.companyService.updateHighlights(companyId, dto.highlights);
  }

  // ===================== AI 搜索资料 =====================

  /** 获取 AI 搜索资料 */
  @SellerRoles('OWNER', 'MANAGER')
  @Get('ai-search-profile')
  getAiSearchProfile(@CurrentSeller('companyId') companyId: string) {
    return this.companyService.getAiSearchProfile(companyId);
  }

  /** 更新 AI 搜索资料 */
  @SellerAudit({ action: 'UPDATE_AI_SEARCH_PROFILE', module: 'company', targetType: 'Company' })
  @SellerRoles('OWNER', 'MANAGER')
  @Put('ai-search-profile')
  updateAiSearchProfile(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: UpdateAiSearchProfileDto,
  ) {
    return this.companyService.updateAiSearchProfile(companyId, dto);
  }

  // ===================== 企业标签 =====================

  /** 获取企业标签 */
  @SellerRoles('OWNER', 'MANAGER')
  @Get('tags')
  getCompanyTags(@CurrentSeller('companyId') companyId: string) {
    return this.companyService.getCompanyTags(companyId);
  }

  /** 更新企业标签 */
  @SellerAudit({ action: 'UPDATE_COMPANY_TAGS', module: 'company', targetType: 'Company' })
  @SellerRoles('OWNER', 'MANAGER')
  @Put('tags')
  updateCompanyTags(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: SetCompanyTagsDto,
  ) {
    return this.companyService.updateCompanyTags(companyId, dto.tagIds);
  }

  // ===================== 资质文件 =====================

  /** 资质文件列表 */
  // M14修复：查看资质文件为只读操作，OPERATOR 也应有权查看
  @SellerRoles('OWNER', 'MANAGER', 'OPERATOR')
  @Get('documents')
  getDocuments(@CurrentSeller('companyId') companyId: string) {
    return this.companyService.getDocuments(companyId);
  }

  /** 上传资质文件 */
  @SellerAudit({ action: 'ADD_DOCUMENT', module: 'company', targetType: 'CompanyDocument' })
  @SellerRoles('OWNER')
  @Post('documents')
  addDocument(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: AddDocumentDto,
  ) {
    return this.companyService.addDocument(companyId, dto);
  }

  // ===================== 员工管理 =====================

  /** 员工列表 */
  @SellerRoles('OWNER')
  @Get('staff')
  getStaff(@CurrentSeller('companyId') companyId: string) {
    return this.companyService.getStaff(companyId);
  }

  /** 邀请员工 */
  @SellerAudit({ action: 'INVITE_STAFF', module: 'company', targetType: 'CompanyStaff' })
  @SellerRoles('OWNER')
  @Post('staff')
  inviteStaff(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('userId') userId: string,
    @Body() dto: InviteStaffDto,
  ) {
    return this.companyService.inviteStaff(companyId, userId, dto);
  }

  /** 修改员工角色/状态 */
  @SellerAudit({ action: 'UPDATE_STAFF', module: 'company', targetType: 'CompanyStaff', targetIdParam: 'params.id' })
  @SellerRoles('OWNER')
  @Put('staff/:id')
  updateStaff(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.companyService.updateStaff(companyId, id, dto);
  }

  /** 移除员工 */
  @SellerAudit({ action: 'REMOVE_STAFF', module: 'company', targetType: 'CompanyStaff', targetIdParam: 'params.id' })
  @SellerRoles('OWNER')
  @Delete('staff/:id')
  removeStaff(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.companyService.removeStaff(companyId, id);
  }
}
