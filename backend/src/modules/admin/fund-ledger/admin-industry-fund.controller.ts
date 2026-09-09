import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { IndustryFundPaymentService } from './industry-fund-payment.service';
import { IndustryFundQueryService } from './industry-fund-query.service';
import { FundProofService } from './fund-proof.service';
import { FundPaymentConfirmDto, FundPaymentCreateDto, FundPaymentReasonDto, FundQueryDto, FundRecoveryDto } from './fund-ledger.dto';
import { SUPER_ADMIN_ROLE } from '../common/constants';

type FundAdmin = { sub: string; roles: string[]; permissions: string[] };

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/industry-funds')
export class AdminIndustryFundController {
  constructor(private readonly funds: IndustryFundPaymentService, private readonly query: IndustryFundQueryService, private readonly proofs: FundProofService) {}

  @Get('summary') @RequirePermission('industry_funds:read')
  summary(@Query() q: FundQueryDto) { return this.query.summary(q); }
  @Get('companies') @RequirePermission('industry_funds:read')
  companies(@Query() q: FundQueryDto) { return this.query.companies(q); }
  @Get('companies/:id') @RequirePermission('industry_funds:read')
  company(@Param('id') id: string) { return this.query.company(id); }
  @Get('companies/:id/ledgers') @RequirePermission('industry_funds:read')
  ledgers(@Param('id') id: string, @Query() q: FundQueryDto) { return this.query.ledgers(q, id); }
  @Get('unassigned') @RequirePermission('industry_funds:read')
  unassigned(@Query() q: FundQueryDto) { return this.query.unassigned(q); }
  @Get('payments') @RequirePermission('industry_funds:read')
  payments(@Query() q: FundQueryDto) { return this.query.payments(q); }
  @Get('payments/:id') @RequirePermission('industry_funds:read')
  payment(@Param('id') id: string, @CurrentAdmin() admin: FundAdmin) {
    return this.query.payment(id, admin.roles.includes(SUPER_ADMIN_ROLE) || admin.permissions.includes('industry_funds:pay') || admin.permissions.includes('industry_funds:reverse'));
  }

  @Post('proofs') @RequirePermission('industry_funds:read')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @AuditLog({ action: 'CREATE', module: 'industry_funds', targetType: 'FundPrivateProof', isReversible: false })
  upload(@UploadedFile() file: Express.Multer.File, @CurrentAdmin() admin: FundAdmin) { this.requireProofAccess(admin); return this.proofs.upload(file, admin.sub); }

  @Get('proofs/:id') @RequirePermission('industry_funds:read')
  @AuditLog({ action: 'EXPORT', module: 'industry_funds', targetType: 'FundPrivateProof', targetIdParam: 'params.id', isReversible: false })
  async proof(@Param('id') id: string, @CurrentAdmin() admin: FundAdmin, @Res() res: Response) {
    this.requireProofAccess(admin);
    const file = await this.proofs.download(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', 'attachment; filename="fund-proof"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.buffer);
  }

  private requireProofAccess(admin: FundAdmin) {
    if (!admin.roles.includes(SUPER_ADMIN_ROLE) && !admin.permissions.some(p => ['industry_funds:pay', 'industry_funds:reverse'].includes(p))) {
      throw new ForbiddenException('需要付款或回款登记权限才能访问凭证');
    }
  }

  @Post('payments') @RequirePermission('industry_funds:pay')
  @AuditLog({ action: 'CREATE', module: 'industry_funds', targetType: 'IndustryFundPayment', isReversible: false })
  create(@Body() body: FundPaymentCreateDto, @CurrentAdmin() admin: FundAdmin) {
    return this.funds.createPayment(body, admin.sub);
  }
  @Post('payments/:id/confirm') @RequirePermission('industry_funds:pay')
  @AuditLog({ action: 'UPDATE', module: 'industry_funds', targetType: 'IndustryFundPayment', targetIdParam: 'params.id', isReversible: false })
  async confirm(@Param('id') id: string, @Body() body: FundPaymentConfirmDto, @CurrentAdmin() admin: FundAdmin) {
    await this.proofs.requireProof(body.proofKey);
    return this.funds.confirmPayment(id, body, admin.sub);
  }
  @Post('payments/:id/cancel') @RequirePermission('industry_funds:pay')
  @AuditLog({ action: 'UPDATE', module: 'industry_funds', targetType: 'IndustryFundPayment', targetIdParam: 'params.id', isReversible: false })
  cancel(@Param('id') id: string, @Body() body: FundPaymentReasonDto, @CurrentAdmin() admin: FundAdmin) {
    return this.funds.cancelPayment(id, body, admin.sub);
  }
  @Post('payments/:id/reverse') @RequirePermission('industry_funds:reverse')
  @AuditLog({ action: 'UPDATE', module: 'industry_funds', targetType: 'IndustryFundPayment', targetIdParam: 'params.id', isReversible: false })
  reverse(@Param('id') id: string, @Body() body: FundPaymentReasonDto, @CurrentAdmin() admin: FundAdmin) {
    return this.funds.reversePayment(id, body, admin.sub);
  }
  @Post('payments/:id/recoveries') @RequirePermission('industry_funds:reverse')
  @AuditLog({ action: 'UPDATE', module: 'industry_funds', targetType: 'IndustryFundPayment', targetIdParam: 'params.id', isReversible: false })
  async recover(@Param('id') id: string, @Body() body: FundRecoveryDto, @CurrentAdmin() admin: FundAdmin) {
    await this.proofs.requireProof(body.proofKey);
    return this.funds.recordRecovery(id, body, admin.sub);
  }
}
