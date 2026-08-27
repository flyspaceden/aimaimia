import { Body, Controller, Get, Param, Post, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentAdmin } from '../admin/common/decorators/current-admin';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AuditLog } from '../admin/common/decorators/audit-action';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { AdminVisualCreditAdjustmentDto, ConfigureVisualCreditWelcomePolicyDto, UpsertVisualRateCardDto } from './admin-visual-credit.dto';
import { VisualCreditService } from './visual-credit.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/visual-agent')
export class AdminVisualCreditController {
  constructor(private readonly credits: VisualCreditService) {}

  @Get('tenants/:tenantId/welcome-credit-policy')
  @RequirePermission('admin_visual_agent:manage')
  getWelcomePolicy(@Param('tenantId') tenantId: string) {
    return this.credits.getWelcomePolicy(tenantId);
  }

  @Put('tenants/:tenantId/welcome-credit-policy')
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent', isReversible: false })
  configureWelcomePolicy(@Param('tenantId') tenantId: string, @Body() dto: ConfigureVisualCreditWelcomePolicyDto) {
    return this.credits.configureWelcomePolicy({
      tenantId,
      enabled: dto.enabled,
      grantCredits: dto.grantCredits,
      creditValueCents: dto.creditValueCents,
      policyVersion: dto.policyVersion,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : null,
    });
  }

  @Get('tenants/:tenantId/rate-cards')
  @RequirePermission('admin_visual_agent:manage')
  listRateCards(
    @Param('tenantId') tenantId: string,
    @Query('clientId') clientId: string,
    @Query('adapterNamespace') adapterNamespace: string,
  ) {
    return this.credits.listRateCards({ tenantId, clientId, adapterNamespace });
  }

  @Post('tenants/:tenantId/rate-cards')
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent', isReversible: false })
  upsertRateCard(@Param('tenantId') tenantId: string, @Body() dto: UpsertVisualRateCardDto) {
    return this.credits.upsertRateCard({
      tenantId,
      clientId: dto.clientId,
      adapterNamespace: dto.adapterNamespace,
      code: dto.code,
      displayName: dto.displayName,
      description: dto.description,
      modelProfile: dto.modelProfile,
      outputSpec: dto.outputSpec as Prisma.InputJsonValue,
      allowedDirections: dto.allowedDirections,
      allowedRiskProfiles: dto.allowedRiskProfiles,
      candidateRole: dto.candidateRole,
      requiresHumanReview: dto.requiresHumanReview,
      candidateCount: dto.candidateCount,
      creditCost: dto.creditCost,
      status: dto.status,
      version: dto.version,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : null,
    });
  }

  @Post('tenants/:tenantId/credit-accounts/:ownerType/:ownerId/grant-welcome')
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent', isReversible: false })
  grantWelcome(
    @Param('tenantId') tenantId: string,
    @Param('ownerType') billingOwnerType: string,
    @Param('ownerId') billingOwnerId: string,
  ) {
    return this.credits.grantWelcomeCredits({ tenantId, billingOwnerType, billingOwnerId });
  }

  @Get('tenants/:tenantId/credit-accounts/:ownerType/:ownerId')
  @RequirePermission('admin_visual_agent:manage')
  getAccount(
    @Param('tenantId') tenantId: string,
    @Param('ownerType') billingOwnerType: string,
    @Param('ownerId') billingOwnerId: string,
  ) {
    return this.credits.getAccount({ tenantId, billingOwnerType, billingOwnerId });
  }

  @Get('tenants/:tenantId/credit-accounts/:ownerType/:ownerId/ledger')
  @RequirePermission('admin_visual_agent:manage')
  listLedger(
    @Param('tenantId') tenantId: string,
    @Param('ownerType') billingOwnerType: string,
    @Param('ownerId') billingOwnerId: string,
    @Query('take') take?: string,
  ) {
    return this.credits.listLedger({ tenantId, billingOwnerType, billingOwnerId, take: take ? Number(take) : undefined });
  }

  @Post('tenants/:tenantId/credit-accounts/:ownerType/:ownerId/adjust')
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent', isReversible: false, reasonBodyField: 'reason' })
  adjust(
    @Param('tenantId') tenantId: string,
    @Param('ownerType') billingOwnerType: string,
    @Param('ownerId') billingOwnerId: string,
    @Body() dto: AdminVisualCreditAdjustmentDto,
    @CurrentAdmin('sub') operatorId: string,
  ) {
    return this.credits.adminAdjust({
      tenantId,
      billingOwnerType,
      billingOwnerId,
      availableDelta: dto.availableDelta,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
      operatorId,
    });
  }
}
