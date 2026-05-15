import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceProvider } from './invoice-provider.interface';
import { MockInvoiceProvider } from './mock-invoice.provider';

@Injectable()
export class InvoiceProviderFactory {
  constructor(private mockProvider: MockInvoiceProvider) {}

  resolve(mode: string): InvoiceProvider {
    if (mode === 'MOCK') return this.mockProvider;
    throw new BadRequestException(`暂不支持的发票 Provider：${mode}`);
  }
}
