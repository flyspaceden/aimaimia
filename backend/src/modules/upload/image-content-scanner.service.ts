import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jsQR from 'jsqr';
import sharp = require('sharp');

/**
 * 图片内容安全扫描服务（占位实现）
 *
 * 检测图片中的联系方式信息（二维码、OCR 文字中的手机号/微信号等），
 * 防止买家/卖家通过图片传递联系方式。
 *
 * 当前为占位实现，返回"安全"结果。
 *
 * TODO: 对接阿里云 OCR / 内容安全服务替换占位实现
 *
 * 升级路径（按推荐顺序）：
 * 1. jsQR / zxing-wasm 检测二维码/条形码（离线，零成本）
 * 2. Tesseract.js 离线 OCR 提取文字 → 正则匹配联系方式（离线，零成本，精度一般）
 * 3. 阿里云 OCR 通用文字识别（精度高，按量付费）
 * 4. 阿里云内容安全（图片审核 + 文字审核一体化，精度最高）
 *
 * 阿里云 OCR API 文档: https://help.aliyun.com/document_detail/442312.html
 * 阿里云内容安全文档: https://help.aliyun.com/document_detail/467829.html
 *
 * 所需环境变量：
 * - ALIYUN_OCR_KEY: 阿里云 AccessKeyId
 * - ALIYUN_OCR_SECRET: 阿里云 AccessKeySecret
 * - ALIYUN_OCR_ENDPOINT: OCR 服务端点（默认: ocr-api.cn-hangzhou.aliyuncs.com）
 * - IMAGE_SCAN_ENABLED: 是否启用图片扫描（默认: false，占位模式直接返回安全）
 */
@Injectable()
export class ImageContentScannerService {
  private readonly logger = new Logger(ImageContentScannerService.name);

  /** 阿里云 OCR AccessKeyId（占位：未配置时为 undefined） */
  private readonly ocrKey?: string;
  /** 阿里云 OCR AccessKeySecret（占位：未配置时为 undefined） */
  private readonly ocrSecret?: string;
  /** 阿里云 OCR 服务端点 */
  private readonly ocrEndpoint: string;
  /** 是否启用图片扫描 */
  private readonly scanEnabled: boolean;

  /** 联系方式匹配正则表达式 */
  private static readonly CONTACT_PATTERNS = {
    /** 中国大陆手机号（1[3-9]开头 11位） */
    phone: /1[3-9]\d{9}/g,
    /** 微信号（字母开头，6-20位字母数字下划线） */
    wechat: /(?:微信|wx|weixin|v信|vx)[：:\s]*([a-zA-Z][\w-]{5,19})/gi,
    /** QQ 号（5-12 位纯数字） */
    qq: /(?:qq|QQ)[：:\s]*(\d{5,12})/gi,
    /** 邮箱地址 */
    email: /[\w.-]+@[\w.-]+\.\w{2,}/gi,
  } as const;

  constructor(private readonly configService: ConfigService) {
    this.ocrKey = this.configService.get<string>('ALIYUN_OCR_KEY');
    this.ocrSecret = this.configService.get<string>('ALIYUN_OCR_SECRET');
    this.ocrEndpoint = this.configService.get<string>(
      'ALIYUN_OCR_ENDPOINT',
      'ocr-api.cn-hangzhou.aliyuncs.com',
    );
    this.scanEnabled = this.configService.get<boolean>('IMAGE_SCAN_ENABLED', false);

    if (this.scanEnabled && (!this.ocrKey || !this.ocrSecret)) {
      this.logger.warn(
        '图片扫描已启用但阿里云 OCR 密钥未配置（ALIYUN_OCR_KEY / ALIYUN_OCR_SECRET），' +
        '将回退到占位实现',
      );
    } else if (!this.scanEnabled) {
      this.logger.log('图片内容扫描未启用（IMAGE_SCAN_ENABLED=false），使用占位实现');
    }
  }

  private async detectQrCodes(buffer: Buffer): Promise<ImageScanResult['details']> {
    try {
      const { data, info } = await sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      if (!qr) {
        return [];
      }

      const points = [
        qr.location.topLeftCorner,
        qr.location.topRightCorner,
        qr.location.bottomLeftCorner,
        qr.location.bottomRightCorner,
      ];
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);

      return [
        {
          type: 'qrcode',
          text: qr.data,
          region: {
            x: Math.max(0, Math.floor(Math.min(...xs))),
            y: Math.max(0, Math.floor(Math.min(...ys))),
            width: Math.ceil(Math.max(...xs) - Math.min(...xs)),
            height: Math.ceil(Math.max(...ys) - Math.min(...ys)),
          },
        },
      ];
    } catch (err) {
      this.logger.warn(
        `二维码检测失败，回退为人工复核: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async blurRegions(
    buffer: Buffer,
    regions: Array<{ x: number; y: number; width: number; height: number }>,
  ): Promise<Buffer> {
    if (regions.length === 0) {
      return buffer;
    }

    const image = sharp(buffer);
    const metadata = await image.metadata();
    const imageWidth = metadata.width ?? 0;
    const imageHeight = metadata.height ?? 0;
    if (!imageWidth || !imageHeight) {
      return buffer;
    }

    const normalizedRegions = regions
      .map((region) => {
        const left = Math.max(0, Math.min(region.x, imageWidth - 1));
        const top = Math.max(0, Math.min(region.y, imageHeight - 1));
        const width = Math.max(
          1,
          Math.min(region.width, imageWidth - left),
        );
        const height = Math.max(
          1,
          Math.min(region.height, imageHeight - top),
        );

        return { left, top, width, height };
      })
      .filter((region) => region.width > 0 && region.height > 0);

    const composites = await Promise.all(
      normalizedRegions.map(async (region) => ({
        input: await sharp(buffer)
          .extract(region)
          .blur(24)
          .png()
          .toBuffer(),
        left: region.left,
        top: region.top,
      })),
    );

    return image.composite(composites).toBuffer();
  }

  /**
   * 扫描图片内容，检测是否包含联系方式
   *
   * TODO: 真实实现步骤：
   * 1. 调用阿里云通用文字识别 API（RecognizeGeneral）提取图片中的文字
   * 2. 用 jsQR / zxing-wasm 解析图片中的二维码内容
   * 3. 对提取的文字 + 二维码内容执行 scanForContactInfo 匹配联系方式
   * 4. 如检测到联系方式，标记为不安全并返回检测详情（类型、区域、文本）
   *
   * 阿里云 OCR 调用示例：
   * POST https://${ALIYUN_OCR_ENDPOINT}/api/predict/ocr_general
   * Headers: Authorization: Bearer ${签名}
   * Body: { image: base64EncodedImage }
   * 返回: { data: { content: "识别到的文字", prism_wordsInfo: [...] } }
   *
   * @param buffer 图片 Buffer
   * @returns 扫描结果
   */
  async scan(buffer: Buffer): Promise<ImageScanResult> {
    this.logger.debug(`图片内容扫描: size=${buffer.length} bytes`);

    const qrDetails = await this.detectQrCodes(buffer);
    const qrTextMatches = qrDetails
      .filter((detail) => detail.type === 'qrcode' && detail.text)
      .flatMap((detail) => this.scanForContactInfo(detail.text || ''))
      .map((match) => ({
        type: match.type,
        text: match.text,
      }));

    const qrCodesDetected = qrDetails.length;
    const contactInfoDetected = qrTextMatches.length > 0;
    const needsReview = this.scanEnabled && qrCodesDetected === 0;
    const safe = qrCodesDetected === 0 && !contactInfoDetected;

    if (qrCodesDetected > 0) {
      this.logger.warn(`检测到 ${qrCodesDetected} 个二维码，已标记为不安全`);
    }

    return {
      safe,
      qrCodesDetected,
      contactInfoDetected,
      needsReview,
      processedBuffer: buffer, // 占位：直接返回原 buffer
      ocrText: null, // TODO: 接入 OCR 后填充真实识别文本
      details: [...qrDetails, ...qrTextMatches],
    };
  }

  /**
   * 扫描并处理图片（检测 + 打码）
   *
   * TODO: 真实实现需在检测到联系方式后对对应区域进行马赛克/涂抹处理
   * - 使用 sharp 库对检测区域进行模糊处理
   * - 返回处理后的图片 Buffer
   *
   * @param buffer 原始图片 Buffer
   * @returns 处理后的 Buffer + 扫描报告
   */
  async scanAndProcess(buffer: Buffer): Promise<ImageScanResult> {
    const result = await this.scan(buffer);
    const qrRegions = result.details
      .filter((detail) => detail.type === 'qrcode' && detail.region)
      .map((detail) => detail.region as NonNullable<typeof detail.region>);

    if (qrRegions.length === 0) {
      return result;
    }

    try {
      const processedBuffer = await this.blurRegions(buffer, qrRegions);
      return {
        ...result,
        safe: true,
        needsReview: false,
        processedBuffer,
      };
    } catch (err) {
      this.logger.warn(
        `二维码打码失败，转人工复核: ${(err as Error).message}`,
      );
      return {
        ...result,
        safe: false,
        needsReview: true,
        processedBuffer: buffer,
      };
    }
  }

  /**
   * 专门检测文本中的联系方式信息（手机号/微信号/QQ号/邮箱）
   *
   * 该方法可独立使用，也作为 scan() 真实实现的子步骤。
   * 当前已实现正则匹配逻辑，待 OCR 接入后即可串联使用。
   *
   * TODO: 在 scan() 对接真实 OCR 后，将 OCR 识别文字传入此方法完成联系方式检测
   *
   * @param text OCR 识别出的文字内容
   * @returns 检测到的联系方式详情列表
   */
  scanForContactInfo(
    text: string,
  ): Array<{ type: 'phone' | 'wechat' | 'qq' | 'email'; text: string }> {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const results: Array<{ type: 'phone' | 'wechat' | 'qq' | 'email'; text: string }> = [];

    // 检测手机号
    const phoneMatches = text.match(ImageContentScannerService.CONTACT_PATTERNS.phone);
    if (phoneMatches) {
      for (const match of phoneMatches) {
        results.push({ type: 'phone', text: match });
      }
    }

    // 检测微信号
    const wechatRegex = new RegExp(
      ImageContentScannerService.CONTACT_PATTERNS.wechat.source,
      'gi',
    );
    let wechatMatch: RegExpExecArray | null;
    while ((wechatMatch = wechatRegex.exec(text)) !== null) {
      results.push({ type: 'wechat', text: wechatMatch[0] });
    }

    // 检测 QQ 号
    const qqRegex = new RegExp(
      ImageContentScannerService.CONTACT_PATTERNS.qq.source,
      'gi',
    );
    let qqMatch: RegExpExecArray | null;
    while ((qqMatch = qqRegex.exec(text)) !== null) {
      results.push({ type: 'qq', text: qqMatch[0] });
    }

    // 检测邮箱
    const emailMatches = text.match(ImageContentScannerService.CONTACT_PATTERNS.email);
    if (emailMatches) {
      for (const match of emailMatches) {
        results.push({ type: 'email', text: match });
      }
    }

    if (results.length > 0) {
      this.logger.warn(
        `检测到 ${results.length} 个联系方式: ${results.map((r) => `${r.type}=${r.text}`).join(', ')}`,
      );
    }

    return results;
  }
}

/** 图片扫描结果 */
export interface ImageScanResult {
  /** 是否安全（无联系方式） */
  safe: boolean;
  /** 检测到的二维码数量 */
  qrCodesDetected: number;
  /** 是否检测到联系方式文字 */
  contactInfoDetected: boolean;
  /** 是否需要人工复核 */
  needsReview: boolean;
  /** 处理后的图片 Buffer（打码后） */
  processedBuffer: Buffer;
  /** OCR 识别出的原始文字（占位实现为 null） */
  ocrText: string | null;
  /** 检测详情 */
  details: Array<{
    type: 'qrcode' | 'phone' | 'wechat' | 'qq' | 'email';
    region?: { x: number; y: number; width: number; height: number };
    text?: string;
  }>;
}
