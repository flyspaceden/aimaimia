import { IndustryFundPaymentService } from './industry-fund-payment.service';
import { Module } from '@nestjs/common';
import { FundLedgerModule } from '../../fund-ledger/fund-ledger.module';
import { AdminIndustryFundController } from './admin-industry-fund.controller';
import { AdminFundLedgerController } from './admin-fund-ledger.controller';
import { FundProofService } from './fund-proof.service';
import { IndustryFundQueryService } from './industry-fund-query.service';

@Module({
  imports: [FundLedgerModule],
  controllers: [AdminIndustryFundController, AdminFundLedgerController],
  providers: [IndustryFundPaymentService, FundProofService, IndustryFundQueryService],
})
export class AdminFundLedgerModule {}
