import { Body, Controller, Get, Header, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentAdmin } from '../admin/common/decorators/current-admin';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AuditLog } from '../admin/common/decorators/audit-action';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { IssueVisualAgentClientKeyDto, ProvisionVisualAgentClientDto } from './admin-visual-agent-client.dto';
import { VisualAgentClientKeyService } from './visual-agent-client-key.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/visual-agent')
export class AdminVisualAgentClientController {
  constructor(private readonly clientKeys: VisualAgentClientKeyService) {}

  @Post('clients')
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent', isReversible: false })
  provision(@Body() dto: ProvisionVisualAgentClientDto) {
    return this.clientKeys.provisionClient(dto);
  }

  @Get('clients/:clientId/keys')
  @RequirePermission('admin_visual_agent:manage')
  listKeys(@Param('clientId') clientId: string) {
    return this.clientKeys.listKeys(clientId);
  }

  /** Raw key is returned once and must never be stored by the frontend. */
  @Post('clients/:clientId/keys')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent', isReversible: false })
  issueKey(
    @Param('clientId') clientId: string,
    @Body() dto: IssueVisualAgentClientKeyDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.clientKeys.issueKey({
      clientId,
      environment: dto.environment,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      issuedByOperatorId: adminUserId,
    });
  }

  @Post('clients/:clientId/keys/:keyId/revoke')
  @RequirePermission('admin_visual_agent:manage')
  @AuditLog({ action: 'CONFIG_CHANGE', module: 'visual-agent', isReversible: false })
  async revokeKey(
    @Param('clientId') clientId: string,
    @Param('keyId') keyId: string,
  ) {
    // The immutable issuer remains on the key record; the admin audit event
    // records who performed this revocation.
    await this.clientKeys.revokeKey(clientId, keyId);
    return { revoked: true };
  }
}
