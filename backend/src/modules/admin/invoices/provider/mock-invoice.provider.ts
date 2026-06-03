import { Injectable } from '@nestjs/common';
import { UploadService } from '../../../upload/upload.service';
import {
  InvoiceIssueInput,
  InvoiceIssueResult,
  InvoiceProvider,
} from './invoice-provider.interface';

@Injectable()
export class MockInvoiceProvider implements InvoiceProvider {
  constructor(private uploadService: UploadService) {}

  async issue(input: InvoiceIssueInput): Promise<InvoiceIssueResult> {
    const invoiceNo = this.buildInvoiceNo(input.invoiceId);
    const upload = await this.uploadService.uploadBuffer(
      this.buildPdfBuffer(input, invoiceNo),
      'invoices/mock',
      'pdf',
      'application/pdf',
    );

    return {
      invoiceNo,
      pdfUrl: upload.url,
      provider: 'MOCK',
      providerRequestId: input.providerRequestId,
      raw: {
        provider: 'MOCK',
        key: upload.key,
        size: upload.size,
      },
    };
  }

  private buildInvoiceNo(invoiceId: string): string {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const suffix = invoiceId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase().padStart(6, '0');
    return `MOCK-${yyyy}${mm}${dd}-${suffix}`;
  }

  private buildPdfBuffer(input: InvoiceIssueInput, invoiceNo: string): Buffer {
    const lines = [
      'Mock Invoice',
      `Invoice No: ${invoiceNo}`,
      `Order: ${input.orderId}`,
      `Buyer: ${input.buyer.title || ''}`,
      `Issuer: ${input.issuerProfile.companyName}`,
      `Amount: ${input.totalAmount.toFixed(2)}`,
    ];
    const escaped = lines.join('\\n').replace(/[()]/g, '');
    const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${escaped.length + 64} >>
stream
BT /F1 14 Tf 72 760 Td (${escaped}) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Root 1 0 R /Size 6 >>
startxref
0
%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }
}
