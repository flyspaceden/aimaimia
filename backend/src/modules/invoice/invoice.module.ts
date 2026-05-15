import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { AdminInvoicesModule } from '../admin/invoices/admin-invoices.module';

@Module({
  imports: [AdminInvoicesModule],
  controllers: [InvoiceController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
