import { NotFoundException } from '@nestjs/common';
import { CompanyController } from './company.controller';

describe('CompanyController inspection report preview', () => {
  it('returns a verified report inline with an RFC 5987-safe Chinese filename', async () => {
    const file = {
      filePath: '/tmp/documents/report.pdf',
      mimeType: 'application/pdf',
      basename: 'report.pdf',
      title: '检测\r\n报告.pdf',
    };
    const companyService = {
      getInspectionReportPreview: jest.fn().mockResolvedValue(file),
    };
    const controller = new CompanyController(companyService as any, {} as any);
    const response = {
      setHeader: jest.fn(),
      sendFile: jest.fn(),
    };

    await controller.previewInspectionReport('report-1', response as any);

    expect(companyService.getInspectionReportPreview).toHaveBeenCalledWith('report-1');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="______.pdf"; filename*=UTF-8\'\'%E6%A3%80%E6%B5%8B__%E6%8A%A5%E5%91%8A.pdf',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.sendFile).toHaveBeenCalledWith('/tmp/documents/report.pdf');
  });

  it('shows a browser-readable error page for an unavailable report', async () => {
    const companyService = {
      getInspectionReportPreview: jest.fn().mockRejectedValue(new NotFoundException()),
    };
    const controller = new CompanyController(companyService as any, {} as any);
    const response = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await controller.previewInspectionReport('missing-report', response as any);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('暂无法预览报告'));
  });
});
