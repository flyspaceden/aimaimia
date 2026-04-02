import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import {
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_MAX_FILE_SIZE,
  UPLOAD_FOLDER_PATTERN,
} from './upload.constants';
import { ImageContentScannerService } from './image-content-scanner.service';

/**
 * 文件上传服务
 *
 * 当前为占位实现（本地存储），生产环境替换为阿里云 OSS：
 * 1. 安装 ali-oss：npm install ali-oss
 * 2. 配置 .env：OSS_REGION / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET
 * 3. 替换 uploadFile 方法中的本地存储逻辑为 OSS SDK 调用
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(
    private config: ConfigService,
    private imageContentScanner: ImageContentScannerService,
  ) {
    // 本地存储目录（生产环境不使用）
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.baseUrl = this.config.get('UPLOAD_BASE_URL', 'http://localhost:3000/uploads');

    // 确保上传目录存在
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * 上传单个文件
   *
   * @param file - Multer 文件对象
   * @param folder - 存储子目录（如 products / avatars / documents）
   * @returns 文件访问 URL
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'general',
  ): Promise<{ url: string; key: string; size: number; mimeType: string; expiresAt?: string | null }> {
    const safeFolder = this.normalizeFolder(folder);

    // 校验文件类型
    if (!UPLOAD_ALLOWED_MIME_TYPES.includes(file.mimetype as any)) {
      throw new BadRequestException(
        `不支持的文件类型：${file.mimetype}，允许的类型：${UPLOAD_ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    // 校验文件大小
    if (file.size > UPLOAD_MAX_FILE_SIZE) {
      throw new BadRequestException(
        `文件大小超限：${(file.size / 1024 / 1024).toFixed(1)}MB，最大允许 ${UPLOAD_MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // 文件头校验（基础版 magic number），防止仅伪造扩展名/MIME
    this.validateFileSignature(file);

    // P1 加固：静态图片转码（JPEG/PNG/WEBP -> WEBP）并去元数据
    // Sharp 默认不会保留 EXIF/ICC 等元数据（未调用 withMetadata 时），可降低隐私泄露风险。
    let finalBuffer = file.buffer;
    let finalMimeType = file.mimetype;
    if (this.isTranscodableImage(file.mimetype)) {
      const normalized = await this.normalizeImage(file.buffer);
      finalBuffer = normalized.buffer;
      finalMimeType = normalized.mimeType;
    }

    if (finalMimeType.startsWith('image/')) {
      const scanResult = await this.imageContentScanner.scanAndProcess(finalBuffer);
      finalBuffer = scanResult.processedBuffer;

      if (!scanResult.safe && !scanResult.needsReview) {
        throw new BadRequestException('图片中包含联系方式或二维码，请处理后重新上传');
      }

      if (scanResult.needsReview) {
        this.logger.warn(
          `图片上传进入人工复核队列: mime=${finalMimeType}, size=${finalBuffer.length}`,
        );
      }
    }

    if (finalBuffer.length > UPLOAD_MAX_FILE_SIZE) {
      throw new BadRequestException(
        `处理后的文件大小超限：${(finalBuffer.length / 1024 / 1024).toFixed(1)}MB，最大允许 ${UPLOAD_MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    // 生成唯一文件名
    const ext = this.getExtFromMime(finalMimeType); // 不信任原始文件扩展名
    const key = path.posix.join(safeFolder, `${randomUUID()}${ext}`);

    const useLocalStorage = this.config.get('UPLOAD_LOCAL', 'true');
    const nodeEnv = this.config.get('NODE_ENV', 'development');

    if (useLocalStorage === 'true') {
      // 生产环境仍使用本地存储时输出警告
      if (nodeEnv === 'production') {
        this.logger.warn(
          '生产环境使用本地文件存储，请配置 UPLOAD_LOCAL=false 并接入 OSS',
        );
      }

      // 占位实现：保存到本地文件系统
      const folderPath = path.join(this.uploadDir, safeFolder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      const filePath = path.join(this.uploadDir, key);
      fs.writeFileSync(filePath, finalBuffer);

      const access = this.buildLocalAccessUrl(key);
      this.logger.log(`文件上传成功：${key}（${(finalBuffer.length / 1024).toFixed(1)}KB）`);

      return {
        url: access.url,
        key,
        size: finalBuffer.length,
        mimeType: finalMimeType,
        expiresAt: access.expiresAt,
      };
    } else {
      // TODO: 接入阿里云 OSS / AWS S3
      // const ossClient = new OSS({
      //   region: this.config.get('OSS_REGION'),
      //   accessKeyId: this.config.get('OSS_ACCESS_KEY_ID'),
      //   accessKeySecret: this.config.get('OSS_ACCESS_KEY_SECRET'),
      //   bucket: this.config.get('OSS_BUCKET'),
      // });
      // const result = await ossClient.put(key, file.buffer);
      // return { url: result.url, key, size: file.size, mimeType: file.mimetype };
      throw new BadRequestException(
        'OSS 存储尚未接入，请设置 UPLOAD_LOCAL=true 或完成 OSS 配置',
      );
    }
  }

  /**
   * 批量上传文件
   */
  async uploadFiles(
    files: Express.Multer.File[],
    folder: string = 'general',
  ) {
    const results = await Promise.all(
      files.map((file) => this.uploadFile(file, folder)),
    );
    return results;
  }

  /**
   * 删除文件
   */
  async deleteFile(key: string): Promise<void> {
    const normalizedKey = this.normalizeKey(key);
    const resolvedPath = this.resolveLocalPath(normalizedKey);

    const useLocalStorage = this.config.get('UPLOAD_LOCAL', 'true');

    if (useLocalStorage === 'true') {
      const filePath = resolvedPath;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.log(`文件删除成功：${normalizedKey}`);
      }
    } else {
      // TODO: 接入阿里云 OSS 删除
      // await ossClient.delete(key);
      this.logger.warn(`OSS 删除尚未接入，跳过删除：${key}`);
    }
  }

  /** 生成文件访问 URL（本地私有模式下返回签名 URL） */
  async createAccessUrl(key: string, expiresSec?: number): Promise<{ url: string; expiresAt: string | null }> {
    const normalizedKey = this.normalizeKey(key);
    const useLocalStorage = this.config.get('UPLOAD_LOCAL', 'true');
    if (useLocalStorage !== 'true') {
      throw new BadRequestException('OSS 签名 URL 尚未接入');
    }
    return this.buildLocalAccessUrl(normalizedKey, expiresSec);
  }

  /** 校验签名并返回本地私有文件读取信息 */
  getSignedLocalFile(
    key: string,
    expires: string,
    signature: string,
  ): { filePath: string; mimeType: string } {
    const normalizedKey = this.normalizeKey(key);
    const expiresAtSec = Number.parseInt(expires, 10);
    if (!Number.isFinite(expiresAtSec) || expiresAtSec <= 0) {
      throw new BadRequestException('签名参数无效');
    }
    if (!signature) {
      throw new BadRequestException('缺少签名参数');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAtSec < nowSec) {
      throw new BadRequestException('签名已过期');
    }

    const expected = this.signLocalAccess(normalizedKey, expiresAtSec);
    const actualBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (
      actualBuf.length !== expectedBuf.length ||
      !timingSafeEqual(actualBuf, expectedBuf)
    ) {
      throw new BadRequestException('签名无效');
    }

    const filePath = this.resolveLocalPath(normalizedKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('文件不存在');
    }

    return {
      filePath,
      mimeType: this.getMimeFromKey(normalizedKey),
    };
  }

  private getExtFromMime(mime: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
    };
    return map[mime] || '.bin';
  }

  private getMimeFromKey(key: string): string {
    const ext = path.extname(key).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.pdf': 'application/pdf',
    };
    return map[ext] || 'application/octet-stream';
  }

  private normalizeFolder(folder?: string): string {
    const normalized = (folder || 'general').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return 'general';
    if (!UPLOAD_FOLDER_PATTERN.test(normalized) || normalized.includes('..')) {
      throw new BadRequestException('非法上传目录');
    }
    return normalized;
  }

  private normalizeKey(key?: string): string {
    const normalized = (key || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) throw new BadRequestException('文件 key 不能为空');
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      throw new BadRequestException('非法文件路径');
    }
    return normalized;
  }

  private resolveLocalPath(key: string): string {
    const resolvedPath = path.resolve(this.uploadDir, key);
    if (!resolvedPath.startsWith(this.uploadDir)) {
      throw new BadRequestException('非法文件路径');
    }
    return resolvedPath;
  }

  private buildLocalAccessUrl(
    key: string,
    expiresSec?: number,
  ): { url: string; expiresAt: string | null } {
    if (!this.isLocalPrivateMode()) {
      return { url: `${this.baseUrl}/${key}`, expiresAt: null };
    }

    const ttlSec = this.clampAccessTtl(expiresSec ?? this.getPositiveIntEnv('UPLOAD_SIGN_TTL_SEC', 3600));
    const expiresAtSec = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.signLocalAccess(key, expiresAtSec);
    const base = this.config.get(
      'UPLOAD_PRIVATE_BASE_URL',
      'http://localhost:3000/api/v1/upload/private',
    ).replace(/\/+$/, '');
    const encodedKey = key.split('/').map((s) => encodeURIComponent(s)).join('/');
    return {
      url: `${base}/${encodedKey}?expires=${expiresAtSec}&sig=${sig}`,
      expiresAt: new Date(expiresAtSec * 1000).toISOString(),
    };
  }

  private signLocalAccess(key: string, expiresAtSec: number): string {
    const secret = this.getUploadSignSecret();
    return createHmac('sha256', secret)
      .update(`v1:${key}:${expiresAtSec}`)
      .digest('hex');
  }

  private getUploadSignSecret(): string {
    const secret = this.config.get<string>('UPLOAD_SIGN_SECRET');
    if (secret) return secret;

    const nodeEnv = this.config.get('NODE_ENV', 'development');
    if (nodeEnv === 'production' && this.isLocalPrivateMode()) {
      throw new BadRequestException('生产环境启用私有上传时必须配置 UPLOAD_SIGN_SECRET');
    }

    this.logger.warn('未配置 UPLOAD_SIGN_SECRET，使用开发环境默认签名密钥（仅限本地开发）');
    return 'dev-upload-sign-secret-change-me';
  }

  private isLocalPrivateMode(): boolean {
    return this.config.get('UPLOAD_LOCAL_PRIVATE', 'false') === 'true';
  }

  private clampAccessTtl(ttlSec: number): number {
    const min = 30;
    const max = 24 * 60 * 60;
    if (!Number.isFinite(ttlSec)) return 3600;
    return Math.max(min, Math.min(max, Math.floor(ttlSec)));
  }

  private isTranscodableImage(mime: string): boolean {
    return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
  }

  private async normalizeImage(
    buffer: Buffer,
  ): Promise<{ buffer: Buffer; mimeType: 'image/webp' }> {
    const maxDimension = this.getPositiveIntEnv('UPLOAD_IMAGE_MAX_DIMENSION', 4096);
    const quality = this.getPositiveIntEnv('UPLOAD_IMAGE_WEBP_QUALITY', 82);
    const maxPixels = this.getPositiveIntEnv('UPLOAD_IMAGE_MAX_PIXELS', 40_000_000);

    try {
      let pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: maxPixels }).rotate();
      const meta = await pipeline.metadata();

      if (
        (meta.width && meta.width > maxDimension) ||
        (meta.height && meta.height > maxDimension)
      ) {
        pipeline = pipeline.resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const out = await pipeline
        .webp({ quality: Math.max(1, Math.min(100, quality)), effort: 4 })
        .toBuffer();

      return { buffer: out, mimeType: 'image/webp' };
    } catch (error) {
      this.logger.warn(`图片转码失败，拒绝上传：${(error as Error)?.message || 'unknown error'}`);
      throw new BadRequestException('图片处理失败，请检查图片内容是否损坏');
    }
  }

  private getPositiveIntEnv(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private validateFileSignature(file: Express.Multer.File) {
    const buffer = file.buffer;
    if (!buffer || buffer.length < 4) {
      throw new BadRequestException('文件内容为空或格式无效');
    }

    const ascii = (start: number, end: number) => buffer.slice(start, end).toString('ascii');
    const hex = (start: number, end: number) => buffer.slice(start, end).toString('hex').toLowerCase();

    const validators: Record<string, () => boolean> = {
      'image/jpeg': () => hex(0, 3).startsWith('ffd8ff'),
      'image/png': () => hex(0, 8) === '89504e470d0a1a0a',
      'image/gif': () => ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a',
      'image/webp': () => ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
      'application/pdf': () => ascii(0, 5) === '%PDF-',
      'video/mp4': () => ascii(4, 8) === 'ftyp',
    };

    const validator = validators[file.mimetype];
    if (validator && !validator()) {
      throw new BadRequestException('文件内容与声明类型不匹配');
    }
  }
}
