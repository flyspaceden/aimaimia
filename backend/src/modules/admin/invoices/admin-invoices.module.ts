import { Module } from '@nestjs/common';
import { AdminInvoicesController } from './admin-invoices.controller';
import { AdminInvoicesService } from './admin-invoices.service';
import { UploadModule } from '../../upload/upload.module';
import { InvoiceProviderFactory } from './provider/invoice-provider.factory';
import { MockInvoiceProvider } from './provider/mock-invoice.provider';

@Module({
  imports: [UploadModule],
  controllers: [AdminInvoicesController],
  providers: [AdminInvoicesService, InvoiceProviderFactory, MockInvoiceProvider],
})
export class AdminInvoicesModule {}
