import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSecureDocumentUrl, openSecureDocument } from '@/platform/document';

const downloadFileMock = vi.hoisted(() => vi.fn());
const openDocumentMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());

vi.mock('@tarojs/taro', () => ({
  default: {
    downloadFile: downloadFileMock,
    openDocument: openDocumentMock,
    showToast: showToastMock,
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
  },
}));

describe('secure company report opening', () => {
  beforeEach(() => {
    downloadFileMock.mockReset();
    openDocumentMock.mockReset();
    showToastMock.mockReset();
  });

  it('accepts only credential-free HTTPS document URLs', () => {
    expect(normalizeSecureDocumentUrl('https://reports.example.com/a.pdf')).toBe('https://reports.example.com/a.pdf');
    expect(normalizeSecureDocumentUrl('http://reports.example.com/a.pdf')).toBeNull();
    expect(normalizeSecureDocumentUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSecureDocumentUrl('https://user:secret@reports.example.com/a.pdf')).toBeNull();
  });

  it('downloads a validated file before opening it in WeChat', async () => {
    downloadFileMock.mockResolvedValue({ statusCode: 200, tempFilePath: 'wxfile://report.pdf' });
    openDocumentMock.mockResolvedValue(undefined);
    await expect(openSecureDocument('https://reports.example.com/a.pdf')).resolves.toBe(true);
    expect(downloadFileMock).toHaveBeenCalledWith({ url: 'https://reports.example.com/a.pdf', timeout: 15_000 });
    expect(openDocumentMock).toHaveBeenCalledWith({ filePath: 'wxfile://report.pdf', showMenu: true });
  });

  it('never starts a download for an unsafe URL', async () => {
    await expect(openSecureDocument('http://reports.example.com/a.pdf')).resolves.toBe(false);
    expect(downloadFileMock).not.toHaveBeenCalled();
  });
});
