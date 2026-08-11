import { getInspectionReportPreviewUrl } from '../inspectionReportPreview';

describe('getInspectionReportPreviewUrl', () => {
  it('preserves the API version path and encodes the report id', () => {
    expect(
      getInspectionReportPreviewUrl('doc/report 1', 'HTTPS://api.example.com/api/v1'),
    ).toBe('https://api.example.com/api/v1/companies/inspection-reports/doc%2Freport%201/preview');
  });

  it.each([
    ['', 'https://api.example.com/api/v1'],
    ['doc-1', 'https:///api/v1'],
    ['doc-1', 'mailto:team@example.com'],
    ['doc-1', 'not a url'],
  ])('rejects unusable input: reportId=%p apiBaseUrl=%p', (reportId, apiBaseUrl) => {
    expect(getInspectionReportPreviewUrl(reportId, apiBaseUrl)).toBeNull();
  });
});
