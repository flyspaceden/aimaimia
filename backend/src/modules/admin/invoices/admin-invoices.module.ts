import { Module } from '@nestjs/common';
import { AdminInvoicesController } from './admin-invoices.controller';
import { AdminInvoicesService } from './admin-invoices.service';
import { UploadModule } from '../../upload/upload.module';
import { InvoiceProviderFactory } from './provider/invoice-provider.factory';
import { MockInvoiceProvider } from './provider/mock-invoice.provider';
import { NotificationModule } from '../../notification/notification.module';
import { ProfitModule } from '../../profit/profit.module';

@Module({
  imports: [UploadModule, NotificationModule, ProfitModule],
  controllers: [AdminInvoicesController],
  providers: [AdminInvoicesService, InvoiceProviderFactory, MockInvoiceProvider],
  exports: [AdminInvoicesService],
})
export class AdminInvoicesModule {}
