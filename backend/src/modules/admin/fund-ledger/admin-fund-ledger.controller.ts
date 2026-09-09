import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequireAnyPermission, RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { SUPER_ADMIN_ROLE } from '../common/constants';
import { PlatformFundQueryService } from '../../fund-ledger/platform-fund-query.service';
import { IndustryFundQueryService } from './industry-fund-query.service';
import { FundQueryDto } from './fund-ledger.dto';

type FundAdmin = { roles: string[]; permissions: string[] };

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequireAnyPermission(['fund_ledgers:read', 'industry_funds:read'])
@Controller('admin/fund-ledgers')
export class AdminFundLedgerController {
  constructor(private readonly platform: PlatformFundQueryService, private readonly industry: IndustryFundQueryService) {}

  @Get('summary')
  @RequirePermission('fund_ledgers:read')
  async summary(@Query() q: FundQueryDto, @CurrentAdmin() admin: FundAdmin) {
    const platform = await this.platform.summary(q);
    if (!this.canReadIndustry(admin)) {
      return {
        ...platform,
        funds: platform.funds.map(f => ({ ...f, fundType: f.fundType === 'INDUSTRY_FUND' ? 'LEGACY_INDUSTRY_FUND' : f.fundType })),
      };
    }
    const industry = await this.industry.summary(q);
    // 新公司应付单列，旧 PLATFORM 产业基金保留历史类型查询，不叠加成可支配余额。
    return { ...platform, industry, unassigned: industry.unassigned, funds: [
      { fundType: 'INDUSTRY_FUND', currentBalance: industry.companyPayable, ...industry },
      ...platform.funds.map(f => ({ ...f, fundType: f.fundType === 'INDUSTRY_FUND' ? 'LEGACY_INDUSTRY_FUND' : f.fundType })),
    ] };
  }

  @Get(':fundType/entries')
  entries(@Param('fundType') type: string, @Query() q: FundQueryDto, @CurrentAdmin() admin: FundAdmin) {
    this.requireLedgerRead(type, admin);
    return type === 'INDUSTRY_FUND' ? this.industry.ledgers(q) : this.platform.entries(type === 'LEGACY_INDUSTRY_FUND' ? 'INDUSTRY_FUND' : type, q);
  }

  @Get(':fundType/entries/:id')
  entry(@Param('fundType') type: string, @Param('id') id: string, @CurrentAdmin() admin: FundAdmin) {
    this.requireLedgerRead(type, admin);
    return type === 'INDUSTRY_FUND' ? this.industry.ledger(id) : this.platform.entry(type === 'LEGACY_INDUSTRY_FUND' ? 'INDUSTRY_FUND' : type, id);
  }

  private canReadIndustry(admin: FundAdmin): boolean {
    return admin.roles.includes(SUPER_ADMIN_ROLE) || admin.permissions.includes('industry_funds:read');
  }

  private canReadPlatform(admin: FundAdmin): boolean {
    return admin.roles.includes(SUPER_ADMIN_ROLE) || admin.permissions.includes('fund_ledgers:read');
  }

  private requireLedgerRead(type: string, admin: FundAdmin): void {
    if (type === 'INDUSTRY_FUND') {
      if (!this.canReadIndustry(admin)) throw new ForbiddenException('暂无产业基金账本查看权限');
      return;
    }
    if (!this.canReadPlatform(admin)) throw new ForbiddenException('暂无平台基金账本查看权限');
  }
}
