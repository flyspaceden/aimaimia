import Taro from '@tarojs/taro';
import { isHttpUrl } from './utils';

export async function openInvoicePdf(url?: string | null): Promise<void> {
  if (!isHttpUrl(url)) throw new Error('发票 PDF 地址无效');
  const downloaded = await Taro.downloadFile({ url });
  if (downloaded.statusCode < 200 || downloaded.statusCode >= 300) throw new Error('发票下载失败');
  await Taro.openDocument({ filePath: downloaded.tempFilePath, fileType: 'pdf', showMenu: true });
}
