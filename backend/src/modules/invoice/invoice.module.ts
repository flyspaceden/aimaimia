import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceAutoIssueRetryService } from './invoice-auto-issue-retry.service';
import { AdminInvoicesModule } from '../admin/invoices/admin-invoices.module';

@Module({
  imports: [AdminInvoicesModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceAutoIssueRetryService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
