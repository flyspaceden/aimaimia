import Taro from '@tarojs/taro';

export function normalizeSecureDocumentUrl(value?: string): string | null {
  const raw = value?.trim();
  if (!raw || raw.length > 2_048 || /[\r\n]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function openSecureDocument(value?: string): Promise<boolean> {
  const url = normalizeSecureDocumentUrl(value);
  if (!url) {
    await Taro.showToast({ title: '报告文件地址无效', icon: 'none' });
    return false;
  }

  Taro.showLoading({ title: '报告加载中', mask: true });
  try {
    const result = await Taro.downloadFile({ url, timeout: 15_000 });
    if (!result.tempFilePath || result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`DOCUMENT_DOWNLOAD_${result.statusCode}`);
    }
    await Taro.openDocument({ filePath: result.tempFilePath, showMenu: true });
    return true;
  } catch {
    await Taro.showToast({ title: '报告打开失败，请稍后重试', icon: 'none' });
    return false;
  } finally {
    Taro.hideLoading();
  }
}
