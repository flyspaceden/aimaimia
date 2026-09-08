import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { PlatformFundQueryService } from '../../fund-ledger/platform-fund-query.service';
import { IndustryFundQueryService } from './industry-fund-query.service';
import { FundQueryDto } from './fund-ledger.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('fund_ledgers:read')
@Controller('admin/fund-ledgers')
export class AdminFundLedgerController {
  constructor(private readonly platform: PlatformFundQueryService, private readonly industry: IndustryFundQueryService) {}

  @Get('summary')
  async summary(@Query() q: FundQueryDto) {
    const [platform, industry] = await Promise.all([this.platform.summary(q), this.industry.summary(q)]);
    // 新公司应付单列，旧 PLATFORM 产业基金保留历史类型查询，不叠加成可支配余额。
    return { ...platform, industry, unassigned: industry.unassigned, funds: [
      { fundType: 'INDUSTRY_FUND', currentBalance: industry.companyPayable, ...industry },
      ...platform.funds.map(f => ({ ...f, fundType: f.fundType === 'INDUSTRY_FUND' ? 'LEGACY_INDUSTRY_FUND' : f.fundType })),
    ] };
  }

  @Get(':fundType/entries')
  entries(@Param('fundType') type: string, @Query() q: FundQueryDto) {
    return type === 'INDUSTRY_FUND' ? this.industry.ledgers(q) : this.platform.entries(type === 'LEGACY_INDUSTRY_FUND' ? 'INDUSTRY_FUND' : type, q);
  }

  @Get(':fundType/entries/:id')
  entry(@Param('fundType') type: string, @Param('id') id: string) {
    return type === 'INDUSTRY_FUND' ? this.industry.ledger(id) : this.platform.entry(type === 'LEGACY_INDUSTRY_FUND' ? 'INDUSTRY_FUND' : type, id);
  }
}
