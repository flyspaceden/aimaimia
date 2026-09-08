import { IndustryFundReleaseService } from './industry-fund-release.service';
import { Module } from '@nestjs/common';
import { IndustryFundService } from './industry-fund.service';
import { PlatformFundQueryService } from './platform-fund-query.service';

@Module({
  providers: [IndustryFundReleaseService, IndustryFundService, PlatformFundQueryService],
  exports: [IndustryFundService, PlatformFundQueryService],
})
export class FundLedgerModule {}
